import { readFrequencies, readRms } from './recorder.js';

const BAR_COUNT = 18;
const BIN_START = 1;
const BIN_END = 50;
const MIN_HEIGHT = 0.08;
const DECAY = 0.85;
const IDLE_AMPLITUDE = 0.12;
const IDLE_PERIOD_MS = 3000;

export interface SoundbarController {
  start(): void;
  stop(): void;
  idle(): void;
}

export function createSoundbar(container: HTMLElement): SoundbarController {
  container.innerHTML = '';
  const bars: HTMLDivElement[] = [];
  const heights: number[] = new Array(BAR_COUNT).fill(MIN_HEIGHT);

  for (let i = 0; i < BAR_COUNT; i++) {
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.style.transform = `scaleY(${MIN_HEIGHT})`;
    container.appendChild(bar);
    bars.push(bar);
  }

  let raf: number | null = null;
  let mode: 'off' | 'recording' | 'idle' = 'off';
  let idleStart = 0;

  function recordingFrame(): void {
    const rms = readRms();
    const freq = readFrequencies();
    if (rms !== null) {
      const rmsHeight = Math.max(MIN_HEIGHT, Math.min(1, rms * 4));
      for (let i = 0; i < BAR_COUNT; i++) {
        const variation = 0.7 + 0.6 * Math.sin((i / BAR_COUNT) * Math.PI);
        const target = rmsHeight * variation;
        heights[i] = Math.max(target, (heights[i] ?? MIN_HEIGHT) * DECAY);
        bars[i]?.style.setProperty('transform', `scaleY(${heights[i]})`);
      }
    } else if (freq) {
      const range = BIN_END - BIN_START;
      const binsPerBar = range / BAR_COUNT;
      for (let i = 0; i < BAR_COUNT; i++) {
        const from = BIN_START + Math.floor(i * binsPerBar);
        const to = BIN_START + Math.floor((i + 1) * binsPerBar);
        let sum = 0;
        let count = 0;
        for (let j = from; j < to && j < freq.length; j++) {
          sum += freq[j] ?? 0;
          count++;
        }
        const avg = count > 0 ? sum / count / 255 : 0;
        const next = Math.max(MIN_HEIGHT, avg);
        heights[i] = Math.max(next, (heights[i] ?? MIN_HEIGHT) * DECAY);
        bars[i]?.style.setProperty('transform', `scaleY(${heights[i]})`);
      }
    } else {
      for (let i = 0; i < BAR_COUNT; i++) {
        heights[i] = Math.max(MIN_HEIGHT, (heights[i] ?? MIN_HEIGHT) * DECAY);
        bars[i]?.style.setProperty('transform', `scaleY(${heights[i]})`);
      }
    }
  }

  function idleFrame(now: number): void {
    const elapsed = now - idleStart;
    const phase = (elapsed / IDLE_PERIOD_MS) * Math.PI * 2;
    for (let i = 0; i < BAR_COUNT; i++) {
      const wave = Math.sin(phase + (i / BAR_COUNT) * Math.PI * 1.5);
      const h = MIN_HEIGHT + IDLE_AMPLITUDE * (0.5 + 0.5 * wave);
      heights[i] = h;
      bars[i]?.style.setProperty('transform', `scaleY(${h})`);
    }
  }

  function frame(now: number): void {
    if (mode === 'off') return;
    if (mode === 'recording') {
      recordingFrame();
    } else if (mode === 'idle') {
      idleFrame(now);
    }
    raf = requestAnimationFrame(frame);
  }

  return {
    start() {
      if (mode === 'recording') return;
      mode = 'recording';
      if (raf !== null) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
    },
    idle() {
      if (mode === 'idle') return;
      mode = 'idle';
      idleStart = performance.now();
      if (raf !== null) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
    },
    stop() {
      mode = 'off';
      if (raf !== null) cancelAnimationFrame(raf);
      raf = null;
      for (let i = 0; i < BAR_COUNT; i++) {
        heights[i] = MIN_HEIGHT;
        bars[i]?.style.removeProperty('transform');
      }
    },
  };
}
