// tests/pcm.test.mjs
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { downsample, floatsToInt16PCM, peakWindowRmsDb } from '../dist/shared/pcm.js';

describe('peakWindowRmsDb', () => {
  const rate = 16000;
  const pcm = (ms, amp, at = []) => {
    const buf = Buffer.alloc(Math.round((rate * ms) / 1000) * 2);
    for (let i = 0; i < buf.length / 2; i++) buf.writeInt16LE(Math.round(amp), i * 2);
    for (const [fromMs, toMs, a] of at) {
      for (let i = (rate * fromMs) / 1000; i < (rate * toMs) / 1000; i++) {
        buf.writeInt16LE(i % 2 ? a : -a, i * 2);
      }
    }
    return buf;
  };

  it('reports -Infinity for digital silence', () => {
    assert.equal(peakWindowRmsDb(pcm(500, 0), rate), Number.NEGATIVE_INFINITY);
  });

  it('measures a full-scale square wave near 0 dBFS', () => {
    assert.ok(peakWindowRmsDb(pcm(200, 0, [[0, 200, 32767]]), rate) > -0.1);
  });

  it('finds a short loud burst inside a long quiet capture', () => {
    // 3 s at ~-60 dBFS with 100 ms at ~-20 dBFS
    const db = peakWindowRmsDb(pcm(3000, 33, [[1500, 1600, 3277]]), rate);
    assert.ok(db > -21 && db < -19, `got ${db}`);
  });
});

describe('floatsToInt16PCM', () => {
  it('converts +1.0 to max positive int16', () => {
    const result = floatsToInt16PCM([new Float32Array([1.0])]);
    assert.equal(result[0], 0x7fff);
  });

  it('converts -1.0 to max negative int16', () => {
    const result = floatsToInt16PCM([new Float32Array([-1.0])]);
    assert.equal(result[0], -0x8000);
  });

  it('clamps values outside [-1, 1]', () => {
    const result = floatsToInt16PCM([new Float32Array([2.0, -2.0])]);
    assert.equal(result[0], 0x7fff);
    assert.equal(result[1], -0x8000);
  });

  it('concatenates multiple chunks in order', () => {
    const result = floatsToInt16PCM([new Float32Array([0.5]), new Float32Array([-0.5])]);
    assert.equal(result.length, 2);
    assert.ok(result[0] > 0);
    assert.ok(result[1] < 0);
  });
});

describe('downsample', () => {
  it('returns original when rates are equal', () => {
    const input = new Int16Array([1, 2, 3, 4]);
    const result = downsample(input, 16000, 16000);
    assert.deepEqual(Array.from(result), [1, 2, 3, 4]);
  });

  it('halves sample count for 2x ratio', () => {
    const input = new Int16Array([100, 200, 300, 400, 500, 600]);
    const result = downsample(input, 32000, 16000);
    assert.equal(result.length, 3);
    assert.equal(result[0], 100);
    assert.equal(result[1], 300);
    assert.equal(result[2], 500);
  });

  it('handles non-integer ratios without crashing', () => {
    const input = new Int16Array(441);
    input.fill(1000);
    const result = downsample(input, 44100, 16000);
    assert.ok(result.length > 0);
    assert.ok(result.every((v) => v === 1000));
  });
});
