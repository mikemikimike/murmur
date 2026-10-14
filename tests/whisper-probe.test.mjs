import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { probeWhisperStreaming } from '../dist/main/whisper-probe.js';

describe('probeWhisperStreaming', () => {
  it('returns false for a non-existent binary', async () => {
    const result = await probeWhisperStreaming('/nonexistent/whisper-cli');
    assert.equal(result.supportsStreaming, false);
  });

  it('returns a WhisperStreamCapability object with supportsStreaming boolean', async () => {
    const result = await probeWhisperStreaming('/nonexistent/whisper-cli');
    assert.equal(typeof result.supportsStreaming, 'boolean');
  });

  it('completes within a reasonable timeout for a fast command', async () => {
    const start = Date.now();
    await probeWhisperStreaming('echo');
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 6000, `probe took ${elapsed}ms, expected < 6000ms`);
  });
});
