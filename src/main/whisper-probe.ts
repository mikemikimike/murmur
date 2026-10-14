import { type ChildProcess, spawn } from 'node:child_process';

export interface WhisperStreamCapability {
  supportsStreaming: boolean;
}

const PROBE_TIMEOUT_MS = 5_000;

export async function probeWhisperStreaming(cliPath: string): Promise<WhisperStreamCapability> {
  return new Promise<WhisperStreamCapability>((resolve) => {
    let resolved = false;
    const done = (result: WhisperStreamCapability) => {
      if (resolved) return;
      resolved = true;
      resolve(result);
    };

    let proc: ChildProcess;
    try {
      proc = spawn(cliPath, ['--help'], { windowsHide: true });
    } catch {
      done({ supportsStreaming: false });
      return;
    }

    const timer = setTimeout(() => {
      proc.kill();
      done({ supportsStreaming: false });
    }, PROBE_TIMEOUT_MS);

    let helpText = '';

    proc.stdout?.on('data', (chunk: Buffer) => {
      helpText += chunk.toString();
    });

    proc.stderr?.on('data', (chunk: Buffer) => {
      helpText += chunk.toString();
    });

    proc.on('error', () => {
      clearTimeout(timer);
      done({ supportsStreaming: false });
    });

    proc.on('close', () => {
      clearTimeout(timer);
      const lower = helpText.toLowerCase();
      const supportsStreaming =
        lower.includes('--print-progress') ||
        lower.includes('print-progress') ||
        lower.includes('-otxt') ||
        lower.includes('--output-txt');
      done({ supportsStreaming: supportsStreaming });
    });
  });
}
