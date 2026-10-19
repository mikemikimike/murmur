import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { describeRejected, sanitizePartial } from '../dist/main/config/schema.js';

describe('sanitizePartial', () => {
  it('returns an empty object for non-object input', () => {
    assert.deepEqual(sanitizePartial(null, 'test'), {});
    assert.deepEqual(sanitizePartial('nope', 'test'), {});
    assert.deepEqual(sanitizePartial(42, 'test'), {});
  });

  it('keeps known scalar fields and drops unknown ones', () => {
    const out = sanitizePartial(
      {
        provider: 'ollama',
        baseUrl: 'http://localhost:11434',
        model: 'qwen3:4b',
        temperature: 0.3,
        bogusField: 'ignored',
      },
      'test',
    );
    assert.equal(out.provider, 'ollama');
    assert.equal(out.baseUrl, 'http://localhost:11434');
    assert.equal(out.model, 'qwen3:4b');
    assert.equal(out.temperature, 0.3);
    assert.equal('bogusField' in out, false);
  });

  it('accepts only http and https provider base URLs', () => {
    assert.equal(
      sanitizePartial({ baseUrl: 'http://localhost:11434' }, 'test').baseUrl,
      'http://localhost:11434',
    );
    assert.equal(
      sanitizePartial({ baseUrl: 'https://api.example.com/v1' }, 'test').baseUrl,
      'https://api.example.com/v1',
    );
    assert.equal(sanitizePartial({ baseUrl: 'file:///tmp/socket' }, 'test').baseUrl, undefined);
    assert.equal(sanitizePartial({ baseUrl: 'not a url' }, 'test').baseUrl, undefined);
  });

  it('validates clipboard retention and log mode enums', () => {
    const out = sanitizePartial(
      { clipboardRetention: 'keep-generated', logMode: 'metadata-only' },
      'test',
    );
    assert.equal(out.clipboardRetention, 'keep-generated');
    assert.equal(out.logMode, 'metadata-only');

    const rejected = sanitizePartial(
      { clipboardRetention: 'discard', logMode: 'everything' },
      'test',
    );
    assert.equal(rejected.clipboardRetention, undefined);
    assert.equal(rejected.logMode, undefined);
  });

  it('rejects an unknown provider value', () => {
    const out = sanitizePartial({ provider: 'not-a-provider' }, 'test');
    assert.equal(out.provider, undefined);
  });

  it('filters enabledSkills to valid skill ids only', () => {
    const out = sanitizePartial(
      { enabledSkills: ['a', 1, 'b', null, 'c', '../evil', 'UPPER'] },
      'test',
    );
    assert.deepEqual(out.enabledSkills, ['a', 'b', 'c']);
  });

  it('validates controlPanelPort range', () => {
    assert.equal(sanitizePartial({ controlPanelPort: 7331 }, 'test').controlPanelPort, 7331);
    assert.equal(sanitizePartial({ controlPanelPort: 0 }, 'test').controlPanelPort, 0);
    assert.equal(sanitizePartial({ controlPanelPort: -1 }, 'test').controlPanelPort, undefined);
    assert.equal(sanitizePartial({ controlPanelPort: 999999 }, 'test').controlPanelPort, undefined);
    assert.equal(sanitizePartial({ controlPanelPort: 'nope' }, 'test').controlPanelPort, undefined);
  });

  it('accepts nested overlay block', () => {
    const out = sanitizePartial(
      { overlay: { anchor: 'bottom-right', offsetX: 10, offsetY: 20 } },
      'test',
    );
    assert.deepEqual(out.overlay, { anchor: 'bottom-right', offsetX: 10, offsetY: 20 });
  });
});

describe('describeRejected', () => {
  const reject = (input) => describeRejected(input, sanitizePartial(input, 'test'));

  it('reports nothing when every submitted field is accepted', () => {
    assert.deepEqual(
      reject({ baseUrl: 'http://localhost:1234/v1', model: 'm', apiKey: null, mcpPort: 0 }),
      {},
    );
  });

  it('names a scheme-less baseUrl and suggests the fix', () => {
    const rejected = reject({ baseUrl: 'localhost:1234/v1', model: 'ok' });
    assert.deepEqual(Object.keys(rejected), ['baseUrl']);
    assert.match(rejected.baseUrl, /http:\/\/localhost:1234\/v1/);
  });

  it('reports out-of-range numbers and unknown enum values', () => {
    const rejected = reject({
      vadThresholdDb: 5,
      mcpPort: 70000,
      provider: 'nope',
      logMode: 'verbose',
      temperature: null,
    });
    assert.deepEqual(Object.keys(rejected).sort(), [
      'logMode',
      'mcpPort',
      'provider',
      'temperature',
      'vadThresholdDb',
    ]);
  });

  it('reports lists that lost entries during sanitizing', () => {
    const rejected = reject({
      enabledSkills: ['ok', '../evil'],
      appSkillRoutes: [{ match: 'code', enable: ['ok'], disable: [] }, { match: 5 }],
    });
    assert.deepEqual(Object.keys(rejected).sort(), ['appSkillRoutes', 'enabledSkills']);
  });

  it('does not flag values that are merely normalised', () => {
    assert.deepEqual(reject({ vadSilenceMs: 1500.7, clipboardContextEntries: 99 }), {});
  });

  it('reports a rejected overlay field with a dotted name', () => {
    assert.deepEqual(Object.keys(reject({ overlay: { anchor: 'middle', offsetX: 4 } })), [
      'overlay.anchor',
    ]);
  });

  it('ignores unknown fields and non-object input', () => {
    assert.deepEqual(reject({ bogus: 1 }), {});
    assert.deepEqual(reject(null), {});
    assert.deepEqual(reject([1, 2]), {});
  });
});

describe('sanitizePartial — sampleRate', () => {
  it('drops a non-16000 sampleRate and says why', () => {
    const warn = mock.method(console, 'warn', () => {});
    try {
      const out = sanitizePartial({ sampleRate: 48000, model: 'm' }, 'test');
      assert.equal('sampleRate' in out, false);
      assert.equal(out.model, 'm');
      assert.equal(warn.mock.callCount(), 1);
      assert.match(String(warn.mock.calls[0].arguments[0]), /sampleRate.*16000/);
    } finally {
      warn.mock.restore();
    }
  });

  it('accepts a legacy sampleRate of 16000 without warning', () => {
    const warn = mock.method(console, 'warn', () => {});
    try {
      assert.deepEqual(sanitizePartial({ sampleRate: 16000 }, 'test'), {});
      assert.equal(warn.mock.callCount(), 0);
    } finally {
      warn.mock.restore();
    }
  });
});
