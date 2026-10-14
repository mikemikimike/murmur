import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { isOnPath, isPathInside, whisperCliAvailable } from '../dist/main/platform.js';

describe('isPathInside', () => {
  const logs = path.resolve(tmpdir(), 'murmur-logs');

  it('accepts the dir itself and its descendants', () => {
    assert.equal(isPathInside(logs, logs), true);
    assert.equal(isPathInside(path.join(logs, '2026-10-14T10-00-00-000'), logs), true);
  });

  it('rejects siblings, parents, and traversal', () => {
    assert.equal(isPathInside(`${logs}-evil`, logs), false);
    assert.equal(isPathInside(path.dirname(logs), logs), false);
    assert.equal(isPathInside(path.join(logs, '..', 'calc.exe'), logs), false);
  });
});

describe('isOnPath', () => {
  it('returns true for a ubiquitous command', () => {
    // `node` is always on PATH for tests (we're running under node right now).
    assert.equal(isOnPath('node'), true);
  });

  it('returns false for a command that definitely does not exist', () => {
    assert.equal(isOnPath('definitely-not-a-real-command-7fa9c2'), false);
  });

  it('returns false for anything that has path separators in it', () => {
    // Paths are not PATH-resolvable by definition.
    assert.equal(isOnPath('./node'), false);
    assert.equal(isOnPath('/usr/bin/node'), false);
    assert.equal(isOnPath('bin\\whisper\\whisper-cli.exe'), false);
  });
});

describe('whisperCliAvailable', () => {
  it('returns true for an absolute path that exists on disk', () => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'murmur-platform-'));
    try {
      const fake = path.join(tmp, 'whisper-cli');
      writeFileSync(fake, '');
      assert.equal(whisperCliAvailable(fake), true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('returns false for an absolute path that does not exist', () => {
    assert.equal(whisperCliAvailable('/definitely/not/a/real/path/whisper-cli-9f2a'), false);
  });

  it('returns true for a bare command that is on PATH', () => {
    // Same trick as above: `node` is always on PATH in the test runner.
    assert.equal(whisperCliAvailable('node'), true);
  });

  it('returns false for a bare command that is not on PATH', () => {
    assert.equal(whisperCliAvailable('definitely-not-a-real-command-4c8e1'), false);
  });
});
