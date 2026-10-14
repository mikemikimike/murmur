// src/renderer/recorder-worklet.ts
// Runs inside AudioWorkletGlobalScope. No external imports allowed.

// AudioWorkletProcessor and registerProcessor live in AudioWorkletGlobalScope,
// not in the standard lib.dom types — declare them here to satisfy tsc.
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;

class RecorderProcessor extends AudioWorkletProcessor {
  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (channel && channel.length > 0) {
      let sumSq = 0;
      for (let i = 0; i < channel.length; i++) {
        sumSq += channel[i] * channel[i];
      }
      const rms = Math.sqrt(sumSq / channel.length);
      this.port.postMessage({ samples: channel.slice(0), rms });
    }
    return true;
  }
}

registerProcessor('recorder-processor', RecorderProcessor);
