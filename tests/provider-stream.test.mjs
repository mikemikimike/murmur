import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { AnthropicProvider } from '../dist/main/providers/anthropic.js';
import { OllamaProvider } from '../dist/main/providers/ollama.js';
import { OpenAiCompatProvider } from '../dist/main/providers/openai-compat.js';
import { createThinkFilter, parseSseStream } from '../dist/main/providers/types.js';

const origFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = origFetch;
});

/** A Response whose body arrives in the given string chunks. */
function chunkedResponse(chunks) {
  const enc = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

function serve(chunks) {
  globalThis.fetch = async () => chunkedResponse(chunks);
}

const CFG = { displayName: 'Test', model: 'm', apiKey: 'k', temperature: 0 };
const REQ = { systemPrompt: 's', userPrompt: 'u' };

function collect(filterInput) {
  const out = [];
  const f = createThinkFilter((t) => out.push(t));
  for (const c of filterInput) f.push(c);
  f.flush();
  return out.join('');
}

describe('createThinkFilter', () => {
  it('passes plain text through unchanged', () => {
    assert.equal(collect(['Hello ', 'world']), 'Hello world');
  });

  it('drops a think block and the whitespace after it', () => {
    assert.equal(collect(['<think>plan stuff</think>\n\nFinal answer']), 'Final answer');
  });

  it('handles tags split across chunks', () => {
    assert.equal(
      collect(['<th', 'ink>secret', ' reasoning</thi', 'nk>', '\nVisible', ' text']),
      'Visible text',
    );
  });

  it('does not swallow a lone "<" that is not a think tag', () => {
    assert.equal(collect(['a <', 'b> c']), 'a <b> c');
    assert.equal(collect(['x <thi']), 'x <thi');
  });

  it('emits nothing for an unterminated think block', () => {
    assert.equal(collect(['<think>still thinking']), '');
  });
});

describe('parseSseStream', () => {
  it('parses CRLF-delimited events and a final event without a blank line', async () => {
    const events = [];
    await parseSseStream(
      chunkedResponse(['data: one\r\n\r\ndata: t', 'wo\r', '\n\r\ndata: three']).body,
      (_type, data) => events.push(data),
    );
    assert.deepEqual(events, ['one', 'two', 'three']);
  });
});

describe('streaming providers', () => {
  it('openai-compat hides <think> from tokens and returns the stripped text', async () => {
    const delta = (content) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
    serve([delta('<think>hmm'), delta('</think>\n'), delta('Fix the bug'), 'data: [DONE]\n\n']);
    const tokens = [];
    const p = new OpenAiCompatProvider({ ...CFG, id: 'openai-compat', baseUrl: 'http://x/v1' });
    const res = await p.refineStream(REQ, { onToken: (t) => tokens.push(t) });
    assert.equal(tokens.join(''), 'Fix the bug');
    assert.equal(res.text, 'Fix the bug');
  });

  it('openai-compat surfaces mid-stream errors', async () => {
    serve([`data: ${JSON.stringify({ error: { message: 'context overflow' } })}\n\n`]);
    const p = new OpenAiCompatProvider({ ...CFG, id: 'openai-compat', baseUrl: 'http://x/v1' });
    await assert.rejects(p.refineStream(REQ, { onToken: () => {} }), /context overflow/);
  });

  it('ollama surfaces {"error"} lines and reads a final line without newline', async () => {
    serve([`${JSON.stringify({ error: 'model requires more memory' })}\n`]);
    const p = new OllamaProvider({ ...CFG, id: 'ollama', baseUrl: 'http://x' });
    await assert.rejects(p.refineStream(REQ, { onToken: () => {} }), /more memory/);

    serve([
      `${JSON.stringify({ response: 'Hello', done: false })}\n`,
      JSON.stringify({ response: ' there', done: true }),
    ]);
    const res = await p.refineStream(REQ, { onToken: () => {} });
    assert.equal(res.text, 'Hello there');
  });

  it('anthropic surfaces stream error events', async () => {
    serve([
      `event: error\ndata: ${JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } })}\n\n`,
    ]);
    const p = new AnthropicProvider({ ...CFG, id: 'anthropic', baseUrl: 'http://x/v1' });
    await assert.rejects(
      p.refineStream(REQ, { onToken: () => {} }),
      /overloaded_error: Overloaded/,
    );
  });
});
