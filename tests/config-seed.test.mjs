import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { loadConfig } from '../dist/main/config/index.js';

const IS_WINDOWS = process.platform === 'win32';

/**
 * Run `fn` with cwd pointed at an empty temp dir, mimicking `npx` launched
 * from the user's home folder (no ./bin/whisper next to the cwd).
 */
function inEmptyCwd(fn) {
  const oldCwd = process.cwd();
  const cwd = mkdtempSync(path.join(tmpdir(), 'murmur-cwd-'));
  const userData = mkdtempSync(path.join(tmpdir(), 'murmur-ud-'));
  try {
    process.chdir(cwd);
    fn({ cwd, userData });
  } finally {
    process.chdir(oldCwd);
    rmSync(cwd, { recursive: true, force: true });
    rmSync(userData, { recursive: true, force: true });
  }
}

describe('loadConfig — first-run seeding', () => {
  it('seeds logsDir under the user data dir, not the cwd', () => {
    inEmptyCwd(({ cwd, userData }) => {
      const loaded = loadConfig({ userDataDir: userData, argv: ['node', 'test'] });
      assert.equal(loaded.configFileWritten, true);
      assert.equal(loaded.resolved.logsDir, path.join(userData, 'logs'));
      assert.equal(loaded.resolved.logsDir.startsWith(cwd), false);
    });
  });

  it('seeds Windows whisper paths where the installer puts them', { skip: !IS_WINDOWS }, () => {
    inEmptyCwd(({ userData }) => {
      const loaded = loadConfig({ userDataDir: userData, argv: ['node', 'test'] });
      const whisperDir = path.join(userData, 'bin', 'whisper');
      assert.equal(loaded.resolved.whisperCliPath, path.join(whisperDir, 'whisper-cli.exe'));
      assert.equal(
        loaded.resolved.whisperModelPath,
        path.join(whisperDir, 'models', 'ggml-base.en.bin'),
      );
      const seeded = JSON.parse(readFileSync(path.join(userData, 'config.json'), 'utf8'));
      assert.equal(seeded.whisperCliPath, path.join(whisperDir, 'whisper-cli.exe'));
    });
  });

  it('keeps a dev checkout whisper install found under the cwd', { skip: !IS_WINDOWS }, () => {
    inEmptyCwd(({ cwd, userData }) => {
      const devDir = path.join(cwd, 'bin', 'whisper');
      mkdirSync(devDir, { recursive: true });
      writeFileSync(path.join(devDir, 'whisper-cli.exe'), '');
      const loaded = loadConfig({ userDataDir: userData, argv: ['node', 'test'] });
      assert.equal(loaded.resolved.whisperCliPath, path.join(devDir, 'whisper-cli.exe'));
    });
  });
});
