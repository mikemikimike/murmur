// src/renderer/recorder.ts
import { downsample, floatsToInt16PCM, TARGET_SAMPLE_RATE } from '../shared/pcm.js';
import { createVadMonitor, type VadConfig, type VadMonitor } from './vad.js';

export interface CaptureOptions {
  vad: VadConfig;
  /** Fire `onSilenceTimeout` (auto-stop) — off for push-to-talk. */
  autoStop: boolean;
  onSpeechStart: () => void;
  onSilenceTimeout: () => void;
}

const ANALYSER_FFT_SIZE = 256;

interface WorkletMessage {
  samples: Float32Array;
  rms: number;
}

interface CaptureState {
  stream: MediaStream;
  audioContext: AudioContext;
  workletNode: AudioWorkletNode;
  mute: GainNode;
  analyser: AnalyserNode;
  freqBuffer: Uint8Array<ArrayBuffer>;
  chunks: Float32Array[];
  sourceSampleRate: number;
  vad: VadMonitor | null;
}

let state: CaptureState | null = null;
let latestRms: number | null = null;

export async function startCapture(opts?: CaptureOptions): Promise<void> {
  if (state) return;

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });

  let audioContext: AudioContext;
  try {
    audioContext = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
  } catch {
    audioContext = new AudioContext();
  }

  // Load the worklet module relative to this script's URL.
  const workletUrl = new URL('./recorder-worklet.js', import.meta.url);
  await audioContext.audioWorklet.addModule(workletUrl.href);

  const source = audioContext.createMediaStreamSource(stream);
  const workletNode = new AudioWorkletNode(audioContext, 'recorder-processor');
  const mute = audioContext.createGain();
  mute.gain.value = 0;
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = ANALYSER_FFT_SIZE;
  analyser.smoothingTimeConstant = 0.6;

  const chunks: Float32Array[] = [];
  const sourceSampleRate = audioContext.sampleRate;
  const vad =
    opts?.vad.enabled === true
      ? createVadMonitor(opts.vad, {
          onSpeechStart: opts.onSpeechStart,
          onSilenceTimeout: () => {
            if (opts.autoStop) opts.onSilenceTimeout();
          },
        })
      : null;
  workletNode.port.onmessage = (e: MessageEvent<WorkletMessage>) => {
    chunks.push(new Float32Array(e.data.samples));
    latestRms = e.data.rms;
    vad?.update(e.data.rms, (e.data.samples.length / sourceSampleRate) * 1000);
  };

  source.connect(analyser);
  source.connect(workletNode);
  workletNode.connect(mute);
  mute.connect(audioContext.destination);

  state = {
    stream,
    audioContext,
    workletNode,
    mute,
    analyser,
    freqBuffer: new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount)),
    chunks,
    sourceSampleRate,
    vad,
  };
}

export async function stopCapture(): Promise<ArrayBuffer> {
  if (!state) return new ArrayBuffer(0);
  const captured = state;
  state = null;
  latestRms = null;

  captured.workletNode.port.onmessage = null;
  captured.workletNode.disconnect();
  captured.mute.disconnect();
  captured.analyser.disconnect();
  try {
    await captured.audioContext.close();
  } catch {
    /* ignore */
  }
  for (const track of captured.stream.getTracks()) track.stop();

  let raw = floatsToInt16PCM(captured.chunks);
  // Drop leading silence beyond the VAD lead-in: less audio for whisper to
  // chew on, and fewer hallucinations on the quiet stretch before speech.
  const keepFromMs = captured.vad?.getKeepFromMs() ?? null;
  if (keepFromMs !== null && keepFromMs > 0) {
    raw = raw.subarray(Math.round((keepFromMs / 1000) * captured.sourceSampleRate));
  }
  const pcm16k = downsample(raw, captured.sourceSampleRate, TARGET_SAMPLE_RATE);

  console.log(
    `[recorder] captured ${captured.chunks.length} chunks, ${raw.length} samples at ${captured.sourceSampleRate} Hz -> ${pcm16k.length} samples at ${TARGET_SAMPLE_RATE} Hz` +
      (keepFromMs ? ` (trimmed ${Math.round(keepFromMs)} ms of leading silence)` : ''),
  );

  const ab = new ArrayBuffer(pcm16k.byteLength);
  new Int16Array(ab).set(pcm16k);
  return ab;
}

export function isCapturing(): boolean {
  return state !== null;
}

export function readRms(): number | null {
  return latestRms;
}

/**
 * Reads the current frequency-domain data into the recorder's internal buffer
 * and returns it. Returns `null` when not capturing.
 */
export function readFrequencies(): Uint8Array<ArrayBuffer> | null {
  if (!state) return null;
  state.analyser.getByteFrequencyData(state.freqBuffer);
  return state.freqBuffer;
}
