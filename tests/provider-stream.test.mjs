import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseSseStream } from '../dist/main/providers/types.js';

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
