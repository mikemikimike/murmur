// src/shared/pcm.ts

export const TARGET_SAMPLE_RATE = 16_000;

export function floatsToInt16PCM(chunks: Float32Array[]): Int16Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Int16Array(total);
  let offset = 0;
  for (const c of chunks) {
    for (let i = 0; i < c.length; i++) {
      const v = Math.max(-1, Math.min(1, c[i] ?? 0));
      out[offset++] = v < 0 ? v * 0x8000 : v * 0x7fff;
    }
  }
  return out;
}

/**
 * Loudness of the loudest `windowMs` stretch of 16-bit little-endian mono PCM,
 * in dBFS (0 = full scale, -Infinity = digital silence). Using the loudest
 * window rather than the overall average keeps short utterances in a long,
 * mostly quiet capture from being mistaken for silence.
 */
export function peakWindowRmsDb(pcm: Uint8Array, sampleRate: number, windowMs = 50): number {
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const samples = Math.floor(pcm.byteLength / 2);
  const window = Math.max(1, Math.round((sampleRate * windowMs) / 1000));
  let peakMeanSq = 0;
  for (let start = 0; start < samples; start += window) {
    const end = Math.min(samples, start + window);
    let sumSq = 0;
    for (let i = start; i < end; i++) {
      const v = view.getInt16(i * 2, true) / 0x8000;
      sumSq += v * v;
    }
    peakMeanSq = Math.max(peakMeanSq, sumSq / (end - start));
  }
  return peakMeanSq > 0 ? 10 * Math.log10(peakMeanSq) : Number.NEGATIVE_INFINITY;
}

export function downsample(input: Int16Array, fromRate: number, toRate: number): Int16Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const outLength = Math.floor(input.length / ratio);
  const out = new Int16Array(outLength);
  for (let i = 0; i < outLength; i++) {
    out[i] = input[Math.floor(i * ratio)] ?? 0;
  }
  return out;
}
