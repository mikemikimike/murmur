export type ProviderId = 'ollama' | 'openai-compat' | 'anthropic';

export interface ProviderConfig {
  id: ProviderId;
  displayName: string;
  baseUrl: string;
  model: string;
  apiKey: string | null;
  temperature: number;
}

export interface RefineRequest {
  systemPrompt: string;
  userPrompt: string;
}

export interface RefineResponse {
  text: string;
  durationMs: number;
}

export interface StreamRefineOptions {
  onToken: (token: string) => void;
}

export interface LlmProvider {
  readonly config: ProviderConfig;
  refine(req: RefineRequest): Promise<RefineResponse>;
  refineStream(req: RefineRequest, opts: StreamRefineOptions): Promise<RefineResponse>;
  /**
   * Verifies the provider is reachable and `config.model` is available.
   * Returns `null` if everything is fine, otherwise a human-readable error
   * message intended for the preflight log.
   */
  preflight(): Promise<string | null>;
  /**
   * Fires a silent no-op request to pre-load the model into memory.
   * Must not throw — errors are logged and swallowed by the caller.
   * Returns wall-clock latency in milliseconds.
   */
  prewarm?(): Promise<number>;
}

export const THINK_BLOCK = /<think>[\s\S]*?<\/think>/g;

export function stripThink(text: string): string {
  return text.replace(THINK_BLOCK, '').trim();
}

export async function parseSseStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (eventType: string, data: string) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';

      for (const event of events) {
        let eventType = 'message';
        let data = '';
        for (const line of event.split('\n')) {
          if (line.startsWith('event:')) {
            eventType = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            data += (data ? '\n' : '') + line.slice(5).trim();
          }
        }
        if (data) onEvent(eventType, data);
      }
    }
  } finally {
    reader.releaseLock();
  }
}
