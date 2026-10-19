import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { readConfigFile, updateConfigFile } from '../dist/main/config/file.js';
import { loadConfig } from '../dist/main/config/index.js';

const MALFORMED = `{
 "provider": "anthropic",
 "apiKey": "sk-FAKE-SENTINEL",
 "systemPrompt": "MY CAREFULLY TUNED PROMPT",
 "enabledSkills": ["code-context"],
}
`;

describe('updateConfigFile', () => {
  let dir;
  let file;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'murmur-cfgfile-'));
    file = path.join(dir, 'config.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('leaves an unparseable config.json byte-identical and returns false', () => {
    writeFileSync(file, MALFORMED, 'utf8');
    const before = readFileSync(file);

    const ok = updateConfigFile(file, (raw) => {
      raw.overlay = { anchor: 'free', position: { x: 10, y: 20 } };
    });

    assert.equal(ok, false);
    assert.deepEqual(readFileSync(file), before);
  });

  it('does not run the mutator against a file it could not parse', () => {
    writeFileSync(file, MALFORMED, 'utf8');
    let called = false;
    updateConfigFile(file, () => {
      called = true;
    });
    assert.equal(called, false);
  });

  it('refuses a config.json whose top level is not an object', () => {
    writeFileSync(file, '["not", "an", "object"]\n', 'utf8');
    const before = readFileSync(file);

    const ok = updateConfigFile(file, (raw) => {
      raw.model = 'x';
    });

    assert.equal(ok, false);
    assert.deepEqual(readFileSync(file), before);
  });

  it('still creates the file when it does not exist yet', () => {
    const ok = updateConfigFile(file, (raw) => {
      raw.model = 'fresh';
    });
    assert.equal(ok, true);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { model: 'fresh' });
  });

  it('preserves unknown keys and leaves no temp file behind on success', () => {
    writeFileSync(file, JSON.stringify({ model: 'a', custom: { keep: true } }), 'utf8');

    const ok = updateConfigFile(file, (raw) => {
      raw.model = 'b';
    });

    assert.equal(ok, true);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), {
      model: 'b',
      custom: { keep: true },
    });
    assert.deepEqual(readdirSync(dir), ['config.json']);
  });

  it('keeps the original intact when the mutator throws partway through', () => {
    const original = `${JSON.stringify({ model: 'a', systemPrompt: 'KEEP ME' }, null, 2)}\n`;
    writeFileSync(file, original, 'utf8');

    const ok = updateConfigFile(file, (raw) => {
      raw.model = 'half-applied';
      throw new Error('boom');
    });

    assert.equal(ok, false);
    assert.equal(readFileSync(file, 'utf8'), original);
    assert.deepEqual(readdirSync(dir), ['config.json']);
  });

  it('writes through a temp file and renames it over the original', () => {
    // Occupy the temp path with a directory. An in-place write would ignore it
    // and succeed; a temp-file write cannot, and must leave the original alone.
    const original = `${JSON.stringify({ model: 'a' }, null, 2)}\n`;
    writeFileSync(file, original, 'utf8');
    mkdirSync(`${file}.tmp`);

    const ok = updateConfigFile(file, (raw) => {
      raw.model = 'b';
    });

    assert.equal(ok, false);
    assert.equal(readFileSync(file, 'utf8'), original);
  });
});

describe('readConfigFile — parse errors', () => {
  let dir;
  let file;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'murmur-cfgfile-'));
    file = path.join(dir, 'config.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports the file as unparseable with a line number', () => {
    writeFileSync(file, MALFORMED, 'utf8');
    const load = readConfigFile(file);
    assert.equal(load.existed, true);
    assert.deepEqual(load.partial, {});
    assert.match(load.error ?? '', /line 6\b/);
  });

  it('has no error for a valid or missing file', () => {
    assert.equal(readConfigFile(file).error, undefined);
    writeFileSync(file, '{"model":"x"}', 'utf8');
    assert.equal(readConfigFile(file).error, undefined);
    assert.equal(existsSync(file), true);
  });
});

describe('loadConfig — malformed config.json', () => {
  it('surfaces the parse error instead of silently using defaults', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'murmur-cfgfile-'));
    try {
      const file = path.join(dir, 'config.json');
      writeFileSync(file, MALFORMED, 'utf8');

      const loaded = loadConfig({ userDataDir: dir, argv: ['node', 'test'] });

      assert.match(loaded.configFileError ?? '', /line 6\b/);
      assert.match(loaded.configFileError ?? '', /config\.json/);
      assert.equal(readFileSync(file, 'utf8'), MALFORMED);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
