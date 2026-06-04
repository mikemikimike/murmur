import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';

export interface TranscribeOptions {
  cliPath: string;
  modelPath: string;
}

export interface TranscribeResult {
  text: string;
  stderr: string;
  durationMs: number;
}

export interface TranscribeStreamOptions {
  onToken: (token: string) => void;
}

const TIMESTAMP_RE = /^\[[\d:. >]+\]\s*-->\s*\[[\d:. >]+\]\s*/;
const NOISE_RE =
  /^(whisper_|system:|main:|error:|warn|info|\[|progress\s*=|ggml_|load_|init_|[=]+$)/i;

function parseWhisperLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let text = trimmed;
  if (TIMESTAMP_RE.test(text)) {
    text = text.replace(TIMESTAMP_RE, '').trim();
  }

  if (!text) return null;
  if (NOISE_RE.test(text)) return null;
  if (/^\d+%$/.test(text)) return null;

  return text;
}

export async function transcribe(
  wavPath: string,
  opts: TranscribeOptions,
  streamOpts?: TranscribeStreamOptions,
): Promise<TranscribeResult> {
  const outPrefix = path.join(path.dirname(wavPath), 'transcription');
  const args = ['-m', opts.modelPath, '-f', wavPath, '-otxt', '-of', outPrefix, '--print-progress'];

  const started = Date.now();
  let stderr = '';

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(opts.cliPath, args, { windowsHide: true });

    if (streamOpts?.onToken && proc.stdout) {
      const rl = createInterface({ input: proc.stdout });
      rl.on('line', (line: string) => {
        const token = parseWhisperLine(line);
        if (token) streamOpts.onToken(`${token} `);
      });
    }

    proc.stderr.on('data', (b: Buffer) => {
      stderr += b.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`whisper-cli exited with code ${code}. stderr:\n${stderr}`));
    });
  });

  const text = (await readFile(`${outPrefix}.txt`, 'utf8')).trim();
  return { text, stderr, durationMs: Date.now() - started };
}
