import type {
  LlmProvider,
  ProviderConfig,
  RefineRequest,
  RefineResponse,
  StreamRefineOptions,
} from './types.js';
import { createThinkFilter, parseSseStream, stripThink } from './types.js';

interface AnthropicContentBlock {
  type: 'text' | string;
  text?: string;
}

interface AnthropicMessagesResponse {
  id?: string;
  content: AnthropicContentBlock[];
  stop_reason?: string;
}

interface AnthropicModelItem {
  id: string;
  display_name?: string;
}

interface AnthropicModelsResponse {
  data: AnthropicModelItem[];
}

interface AnthropicStreamEvent {
  type: string;
  delta?: { type: string; text?: string };
  index?: number;
  error?: { type?: string; message?: string };
}

/**
 * Anthropic Claude provider.
 *
 * Base URL convention: the user supplies the root including `/v1`
 * (e.g. `https://api.anthropic.com/v1`). The provider appends
 * `/messages` and `/models` to form the full endpoint URLs, which
 * mirrors the openai-compat pattern and keeps presets unambiguous.
 *
 * Required: `config.apiKey` must be a valid Anthropic API key.
 *
 * Online provider — audio transcriptions and refined prompts
 * leave your machine and are processed on Anthropic's servers.
 */
export class AnthropicProvider implements LlmProvider {
  constructor(public readonly config: ProviderConfig) {}

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.config.apiKey ?? '',
      'anthropic-version': '2023-06-01',
    };
  }

  async refine({ systemPrompt, userPrompt }: RefineRequest): Promise<RefineResponse> {
    const started = Date.now();

    const body = {
      model: this.config.model,
      max_tokens: 1024,
      temperature: this.config.temperature,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    };

    const res = await fetch(`${this.config.baseUrl}/messages`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Anthropic /messages HTTP ${res.status}: ${errText}`);
    }

    const data = (await res.json()) as AnthropicMessagesResponse;
    const raw = data.content.find((b) => b.type === 'text')?.text ?? '';
    return { text: stripThink(raw), durationMs: Date.now() - started };
  }

  async refineStream(
    { systemPrompt, userPrompt }: RefineRequest,
    { onToken }: StreamRefineOptions,
  ): Promise<RefineResponse> {
    const started = Date.now();

    const body = {
      model: this.config.model,
      max_tokens: 1024,
      temperature: this.config.temperature,
      system: systemPrompt,
      stream: true,
      messages: [{ role: 'user', content: userPrompt }],
    };

    const res = await fetch(`${this.config.baseUrl}/messages`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Anthropic /messages HTTP ${res.status}: ${errText}`);
    }

    if (!res.body) {
      throw new Error('Anthropic returned no response body for streaming request');
    }

    let fullText = '';
    const visible = createThinkFilter(onToken);

    await parseSseStream(res.body, (_eventType, data) => {
      let event: AnthropicStreamEvent;
      try {
        event = JSON.parse(data) as AnthropicStreamEvent;
      } catch {
        return; /* skip malformed SSE data lines */
      }
      // e.g. overloaded_error mid-stream; surface it instead of reporting an
      // "empty refinement".
      if (event.type === 'error') {
        throw new Error(
          `Anthropic stream error: ${event.error?.type ?? 'error'}: ${event.error?.message ?? ''}`,
        );
      }
      if (event.type === 'content_block_delta' && event.delta?.text) {
        fullText += event.delta.text;
        visible.push(event.delta.text);
      }
    });
    visible.flush();

    return { text: stripThink(fullText), durationMs: Date.now() - started };
  }

  async prewarm(): Promise<number> {
    const started = Date.now();
    try {
      await fetch(`${this.config.baseUrl}/messages`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          model: this.config.model,
          max_tokens: 1,
          messages: [{ role: 'user', content: ' ' }],
        }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      /* non-fatal */
    }
    return Date.now() - started;
  }

  async preflight(): Promise<string | null> {
    if (!this.config.apiKey) {
      return 'Anthropic requires an API key. Get one at https://console.anthropic.com/settings/api-keys';
    }

    let models: AnthropicModelsResponse;
    try {
      const res = await fetch(`${this.config.baseUrl}/models`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) {
        return (
          `Anthropic API returned HTTP ${res.status}. ` +
          'Check that your API key is valid and has the Messages permission.'
        );
      }
      models = (await res.json()) as AnthropicModelsResponse;
    } catch (err) {
      return (
        `Anthropic not reachable at ${this.config.baseUrl} ` +
        `(${(err as Error).message}). Check your internet connection.`
      );
    }

    const wanted = this.config.model;
    const available = models.data.map((m) => m.id);
    if (!available.some((id) => id === wanted || id.startsWith(wanted))) {
      const sample = available.slice(0, 5).join(', ');
      return (
        `Model '${wanted}' not found in Anthropic. ` +
        `Available (first 5): ${sample || '(none returned)'}`
      );
    }

    return null;
  }
}
