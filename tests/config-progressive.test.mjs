import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { loadConfig } from '../dist/main/config/index.js';
import { sanitizePartial } from '../dist/main/config/schema.js';

function withConfig(fileContents, fn) {
  const tmp = mkdtempSync(path.join(tmpdir(), 'murmur-cfg-'));
  try {
    writeFileSync(path.join(tmp, 'config.json'), JSON.stringify(fileContents));
    const loaded = loadConfig({ userDataDir: tmp, argv: ['node', 'test'] });
    fn(loaded, tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

describe('sanitizePartial — progressiveInjection', () => {
  it('accepts boolean true', () => {
    const out = sanitizePartial({ progressiveInjection: true }, 'test');
    assert.equal(out.progressiveInjection, true);
  });

  it('accepts boolean false', () => {
    const out = sanitizePartial({ progressiveInjection: false }, 'test');
    assert.equal(out.progressiveInjection, false);
  });

  it('rejects non-boolean values', () => {
    assert.equal(
      sanitizePartial({ progressiveInjection: 'yes' }, 'test').progressiveInjection,
      undefined,
    );
    assert.equal(
      sanitizePartial({ progressiveInjection: 1 }, 'test').progressiveInjection,
      undefined,
    );
    assert.equal(
      sanitizePartial({ progressiveInjection: null }, 'test').progressiveInjection,
      undefined,
    );
  });
});

describe('loadConfig — progressiveInjection', () => {
  it('defaults to false', () => {
    withConfig({}, (loaded) => {
      assert.equal(loaded.resolved.progressiveInjection, false);
    });
  });

  it('reads from config file', () => {
    withConfig({ progressiveInjection: true }, (loaded) => {
      assert.equal(loaded.resolved.progressiveInjection, true);
    });
  });

  it('CLI flag overrides config file', () => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'murmur-cfg-'));
    try {
      writeFileSync(path.join(tmp, 'config.json'), JSON.stringify({ progressiveInjection: false }));
      const loaded = loadConfig({
        userDataDir: tmp,
        argv: ['node', 'test', '--progressive-injection'],
      });
      assert.equal(loaded.resolved.progressiveInjection, true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('disables progressive injection when injectionMethod is clipboard', () => {
    withConfig({ progressiveInjection: true, injectionMethod: 'clipboard' }, (loaded) => {
      assert.equal(loaded.resolved.progressiveInjection, false);
      assert.equal(loaded.resolved.injectionMethod, 'clipboard');
    });
  });

  it('env var MURMUR_PROGRESSIVE_INJECTION=true enables it', () => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'murmur-cfg-'));
    const oldEnv = process.env.MURMUR_PROGRESSIVE_INJECTION;
    try {
      process.env.MURMUR_PROGRESSIVE_INJECTION = 'true';
      const loaded = loadConfig({ userDataDir: tmp, argv: ['node', 'test'] });
      assert.equal(loaded.resolved.progressiveInjection, true);
    } finally {
      if (oldEnv === undefined) delete process.env.MURMUR_PROGRESSIVE_INJECTION;
      else process.env.MURMUR_PROGRESSIVE_INJECTION = oldEnv;
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('env var MURMUR_PROGRESSIVE_INJECTION=false disables it when file has no value', () => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'murmur-cfg-'));
    const oldEnv = process.env.MURMUR_PROGRESSIVE_INJECTION;
    try {
      writeFileSync(path.join(tmp, 'config.json'), JSON.stringify({}));
      process.env.MURMUR_PROGRESSIVE_INJECTION = 'false';
      const loaded = loadConfig({ userDataDir: tmp, argv: ['node', 'test'] });
      assert.equal(loaded.resolved.progressiveInjection, false);
    } finally {
      if (oldEnv === undefined) delete process.env.MURMUR_PROGRESSIVE_INJECTION;
      else process.env.MURMUR_PROGRESSIVE_INJECTION = oldEnv;
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
