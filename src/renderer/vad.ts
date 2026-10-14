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

/**
 * Once speech has started, quieter audio still counts as speech down to this
 * many dB below the start threshold. Soft syllables and trailing-off words sit
 * 5-15 dB under a speaker's peaks; with a single threshold, a quiet mic
 * (peaks around -31 dBFS) auto-stopped mid-sentence.
 */
const HYSTERESIS_DB = 12;
/** …but never closer than this to the measured background noise. */
const FLOOR_MARGIN_DB = 6;
/** Time constant for the noise-floor energy smoothing. */
const FLOOR_SMOOTHING_MS = 100;

export function createVadMonitor(config: VadConfig, callbacks: VadCallbacks): VadMonitor {
  const startThreshold = dbToLinear(config.thresholdDb);
  const hysteresisThreshold = dbToLinear(config.thresholdDb - HYSTERESIS_DB);
  let state: VadState = 'listening';
  let elapsedMs = 0;
  let silenceMs = 0;
  let speechStartMs: number | null = null;
  // Running minimum of smoothed signal level ≈ the room's noise floor.
  let smoothedPower: number | null = null;
  let floorRms = Number.POSITIVE_INFINITY;

  /**
   * "Still speaking" bar: well below the start threshold, but lifted above a
   * noisy room's floor so a fan or hum never counts as speech forever.
   */
  const continueThreshold = () =>
    Math.min(startThreshold, Math.max(hysteresisThreshold, floorRms * dbToLinear(FLOOR_MARGIN_DB)));

  return {
    update(rms, chunkMs) {
      const chunkStart = elapsedMs;
      elapsedMs += chunkMs;
      if (!config.enabled || state === 'done') return;

      const power = rms * rms;
      const alpha = chunkMs / (FLOOR_SMOOTHING_MS + chunkMs);
      smoothedPower =
        smoothedPower === null ? power : smoothedPower + alpha * (power - smoothedPower);
      floorRms = Math.min(floorRms, Math.sqrt(smoothedPower));

      if (state === 'listening') {
        if (rms > startThreshold) {
          state = 'speaking';
          speechStartMs = chunkStart;
          callbacks.onSpeechStart();
        }
        return;
      }

      if (rms > continueThreshold()) {
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
      smoothedPower = null;
      floorRms = Number.POSITIVE_INFINITY;
    },
    getState: () => state,
    getKeepFromMs() {
      if (speechStartMs === null) return null;
      return Math.max(0, speechStartMs - config.leadInMs);
    },
  };
}
