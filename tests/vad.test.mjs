import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createVadMonitor, dbToLinear } from '../dist/renderer/vad.js';

const CFG = { enabled: true, thresholdDb: -40, silenceMs: 900, leadInMs: 300 };
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
      [QUIET, 1000],
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

  it('does nothing when disabled', () => {
    const { vad, events } = run({ ...CFG, enabled: false }, [
      [LOUD, 500],
      [QUIET, 2000],
    ]);
    assert.deepEqual(events, []);
    assert.equal(vad.getKeepFromMs(), null);
  });
});
