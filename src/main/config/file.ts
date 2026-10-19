import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { PartialConfig } from './schema.js';
import { sanitizePartial } from './schema.js';

export interface ConfigFileLoad {
  /** True if the file existed on disk (even if empty/invalid). */
  existed: boolean;
  /** Sanitized contents (empty object if missing or unreadable). */
  partial: PartialConfig;
  /** Why an existing file could not be used (unreadable, or not valid JSON). */
  error?: string;
}

/** `JSON.parse` messages carry a character offset (and, on newer V8, a line/column). */
function describeJsonError(filePath: string, content: string, err: Error): string {
  const offset = /position (\d+)/.exec(err.message);
  const reason = err.message.replace(/ \(line \d+ column \d+\)$/, '');
  if (!offset) return `${filePath} is not valid JSON: ${reason}`;
  const before = content.slice(0, Number(offset[1]));
  const line = before.split('\n').length;
  const column = before.length - before.lastIndexOf('\n');
  return `${filePath} is not valid JSON at line ${line}, column ${column}: ${reason}`;
}

export function readConfigFile(filePath: string): ConfigFileLoad {
  let content: string;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { existed: false, partial: {} };
    }
    console.warn(`[config] could not read ${filePath}:`, (err as Error).message);
    return {
      existed: true,
      partial: {},
      error: `could not read ${filePath}: ${(err as Error).message}`,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    const error = describeJsonError(filePath, content, err as Error);
    console.warn(`[config] ${error}`);
    return { existed: true, partial: {}, error };
  }
  return { existed: true, partial: sanitizePartial(parsed, filePath) };
}

/**
 * Why config.json can't be used right now, or null if it's missing or fine.
 * Quiet counterpart of `readConfigFile` for callers that poll (the panel).
 */
export function getConfigFileError(filePath: string): string | null {
  let content: string;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    return `could not read ${filePath}: ${(err as Error).message}`;
  }
  try {
    JSON.parse(content);
  } catch (err) {
    return describeJsonError(filePath, content, err as Error);
  }
  return null;
}

/**
 * Writes a default config to disk so the user has something to edit. Never
 * overwrites an existing file.
 */
export function writeDefaultConfigIfMissing(
  filePath: string,
  defaults: Record<string, unknown>,
): boolean {
  try {
    readFileSync(filePath, 'utf8');
    return false;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[config] could not check ${filePath}:`, (err as Error).message);
      return false;
    }
  }
  const body = JSON.stringify(defaults, null, 2);
  writeFileAtomic(filePath, `${body}\n`);
  return true;
}

const TRANSIENT_RENAME_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Writes `<file>.tmp` next to the target, then renames it into place so a
 * crash mid-write never leaves a truncated config. On Windows an antivirus
 * scan or indexer can briefly hold the target open, so retry the rename a few
 * times before giving up.
 */
function writeFileAtomic(filePath: string, body: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  try {
    writeFileSync(tmpPath, body, 'utf8');
    for (let attempt = 0; ; attempt++) {
      try {
        renameSync(tmpPath, filePath);
        return;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (attempt >= 4 || !code || !TRANSIENT_RENAME_CODES.has(code)) throw err;
        sleepSync(25 * (attempt + 1));
      }
    }
  } catch (err) {
    try {
      unlinkSync(tmpPath);
    } catch {
      // nothing to clean up, or not ours to remove
    }
    throw err;
  }
}

/**
 * Read-modify-write the config file, preserving fields we don't know about.
 * Used for runtime mutations like persisting the dragged overlay position.
 *
 * Returns false without touching the file when it exists but cannot be read or
 * parsed: rewriting it from an empty object would destroy the user's settings.
 */
export function updateConfigFile(
  filePath: string,
  mutator: (raw: Record<string, unknown>) => void,
): boolean {
  let raw: Record<string, unknown> = {};
  let content: string | null = null;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[config] could not read ${filePath} for update:`, (err as Error).message);
      return false;
    }
  }
  if (content !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      console.warn(
        `[config] not updating ${filePath}: ${describeJsonError(filePath, content, err as Error)}`,
      );
      return false;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      console.warn(`[config] not updating ${filePath}: top level is not a JSON object`);
      return false;
    }
    raw = parsed as Record<string, unknown>;
  }
  try {
    mutator(raw);
    writeFileAtomic(filePath, `${JSON.stringify(raw, null, 2)}\n`);
    return true;
  } catch (err) {
    console.warn(`[config] could not write ${filePath}:`, (err as Error).message);
    return false;
  }
}
