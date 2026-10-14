import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createVadMonitor, dbToLinear } from '../dist/renderer/vad.js';

const CFG = { enabled: true, thresholdDb: -40, silenceMs: 1500, leadInMs: 300 };
const LOUD = dbToLinear(-20);
const QUIET = dbToLinear(-60);
const CHUNK_MS = 8;

function run(cfg, pattern) {
  const events = [];
  const vad = createVadMonitor(cfg, {
    onSpeechStart: () => events.push('speech'),
    onSilenceTimeout: () => events.push('silence'),
  });
  for (const [rms, ms] of pattern) {
    for (let t = 0; t < ms; t += CHUNK_MS) vad.update(rms, CHUNK_MS);
  }
  return { vad, events };
}

describe('createVadMonitor', () => {
  it('stays listening on silence and keeps all audio', () => {
    const { vad, events } = run(CFG, [[QUIET, 2000]]);
    assert.deepEqual(events, []);
    assert.equal(vad.getState(), 'listening');
    assert.equal(vad.getKeepFromMs(), null);
  });

  it('fires speech start once, then silence after silenceMs of quiet', () => {
    const { vad, events } = run(CFG, [
      [QUIET, 1000],
      [LOUD, 500],
      [QUIET, 400], // a thinking pause shorter than silenceMs
      [LOUD, 500],
      [QUIET, 1600],
    ]);
    assert.deepEqual(events, ['speech', 'silence']);
    assert.equal(vad.getState(), 'done');
    // speech began at 1000 ms; keep 300 ms of lead-in
    assert.equal(vad.getKeepFromMs(), 700);
  });

  it('never trims into negative time when speech starts immediately', () => {
    const { vad } = run(CFG, [[LOUD, 100]]);
    assert.equal(vad.getKeepFromMs(), 0);
  });

  it('keeps a quiet mic recording through soft syllables (real-world levels)', () => {
    // Measured on a user's mic: speech peaks around -31 dBFS, so ordinary
    // speech sits near -38 and a softly spoken stretch dips to ~-46 for
    // longer than the silence timeout — below the -40 start threshold.
    const { vad, events } = run(CFG, [
      [dbToLinear(-65), 300],
      [dbToLinear(-36), 600],
      [dbToLinear(-46), 1800],
      [dbToLinear(-38), 600],
    ]);
    assert.deepEqual(events, ['speech']);
    assert.notEqual(vad.getState(), 'done');
  });

  it('does not stop on a natural thinking pause', () => {
    const { events } = run(CFG, [
      [LOUD, 800],
      [dbToLinear(-65), 1200],
      [LOUD, 500],
    ]);
    assert.deepEqual(events, ['speech']);
  });

  it('still stops in a noisy room once speech really ends', () => {
    // Fan noise at -48 dBFS sits above the hysteresis level; the floor
    // estimate must lift the "still speaking" bar above it.
    const { events } = run(CFG, [
      [dbToLinear(-48), 500],
      [LOUD, 1000],
      [dbToLinear(-48), 3000],
    ]);
    assert.deepEqual(events, ['speech', 'silence']);
  });

  it('does nothing when disabled', () => {
    const { vad, events } = run({ ...CFG, enabled: false }, [
      [LOUD, 500],
      [QUIET, 2000],
    ]);
    assert.deepEqual(events, []);
    assert.equal(vad.getKeepFromMs(), null);
  });
});
