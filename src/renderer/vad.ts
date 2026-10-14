/**
 * Energy-based voice activity detection over the recorder worklet's per-chunk
 * RMS values. Pure (no DOM / Web Audio) so it is unit-testable under node.
 *
 * Timing is driven by the audio itself (each update reports how many ms of
 * audio the RMS value covers) rather than wall-clock time, so batching of
 * worklet messages cannot distort the silence timer.
 */

export interface VadConfig {
  enabled: boolean;
  thresholdDb: number;
  silenceMs: number;
  leadInMs: number;
}

export interface VadCallbacks {
  /** First chunk above the threshold in this capture. */
  onSpeechStart: () => void;
  /** `silenceMs` of continuous quiet after speech. Fires once per capture. */
  onSilenceTimeout: () => void;
}

export type VadState = 'listening' | 'speaking' | 'trailing-silence' | 'done';

export interface VadMonitor {
  /** Feed one chunk: its RMS (linear, 0..1) and the audio duration it covers. */
  update(rms: number, chunkMs: number): void;
  reset(): void;
  getState(): VadState;
  /**
   * Audio offset (ms from capture start) where kept audio should begin: the
   * speech onset minus the lead-in. `null` until speech has been detected.
   */
  getKeepFromMs(): number | null;
}

export function dbToLinear(db: number): number {
  return 10 ** (db / 20);
}

export function createVadMonitor(config: VadConfig, callbacks: VadCallbacks): VadMonitor {
  const threshold = dbToLinear(config.thresholdDb);
  let state: VadState = 'listening';
  let elapsedMs = 0;
  let silenceMs = 0;
  let speechStartMs: number | null = null;

  return {
    update(rms, chunkMs) {
      const chunkStart = elapsedMs;
      elapsedMs += chunkMs;
      if (!config.enabled || state === 'done') return;
      const loud = rms > threshold;

      if (state === 'listening') {
        if (loud) {
          state = 'speaking';
          speechStartMs = chunkStart;
          callbacks.onSpeechStart();
        }
        return;
      }

      if (loud) {
        state = 'speaking';
        silenceMs = 0;
        return;
      }
      state = 'trailing-silence';
      silenceMs += chunkMs;
      if (silenceMs >= config.silenceMs) {
        state = 'done';
        callbacks.onSilenceTimeout();
      }
    },
    reset() {
      state = 'listening';
      elapsedMs = 0;
      silenceMs = 0;
      speechStartMs = null;
    },
    getState: () => state,
    getKeepFromMs() {
      if (speechStartMs === null) return null;
      return Math.max(0, speechStartMs - config.leadInMs);
    },
  };
}
