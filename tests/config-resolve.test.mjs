import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { loadConfig } from '../dist/main/config/index.js';

/**
 * Write a config file into a fresh temp dir and resolve it. Returns the
 * temp dir so the caller can clean up.
 */
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

describe('loadConfig — sampleRate', () => {
  it('ignores a configured sampleRate: capture is always 16 kHz', () => {
    withConfig({ sampleRate: 48000 }, (loaded) => {
      assert.equal('sampleRate' in loaded.resolved, false);
    });
  });
});

describe('loadConfig — whisperCliPath resolution', () => {
  it('preserves a bare command name so the OS can resolve it via $PATH', () => {
    withConfig({ whisperCliPath: 'whisper-cli' }, (loaded) => {
      assert.equal(loaded.resolved.whisperCliPath, 'whisper-cli');
    });
  });

  it('keeps an absolute path as-is', () => {
    // Must be a real file, otherwise the Linux/macOS migration in loadConfig
    // resets stale absolute paths back to the bare default.
    const tmp = mkdtempSync(path.join(tmpdir(), 'murmur-bin-'));
    try {
      const abs = path.join(tmp, 'whisper-cli');
      writeFileSync(abs, '');
      withConfig({ whisperCliPath: abs }, (loaded) => {
        assert.equal(loaded.resolved.whisperCliPath, abs);
      });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('resolves a relative path with separators against the config dir', () => {
    withConfig({ whisperCliPath: './bin/whisper-cli' }, (loaded, tmp) => {
      assert.equal(loaded.resolved.whisperCliPath, path.resolve(tmp, 'bin/whisper-cli'));
    });
  });
});

describe('loadConfig — non-whisper paths still resolve against config dir', () => {
  it('whisperModelPath with no separators is treated as a relative file under configDir', () => {
    // This is the legacy behavior: users who wrote `model.bin` expected it
    // relative to their config dir. Only whisperCliPath gets the bare-PATH
    // treatment.
    withConfig({ whisperModelPath: 'model.bin' }, (loaded, tmp) => {
      assert.equal(loaded.resolved.whisperModelPath, path.resolve(tmp, 'model.bin'));
    });
  });

  it('logsDir defaults to <configDir>/logs when unspecified', () => {
    withConfig({}, (loaded, tmp) => {
      assert.equal(loaded.resolved.logsDir, path.resolve(tmp, 'logs'));
    });
  });
});

describe('loadConfig — first-run LLM env precedence', () => {
  it('rejects non-http provider URLs from environment variables', () => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'murmur-cfg-'));
    const oldBaseUrl = process.env.LLM_BASE_URL;
    try {
      process.env.LLM_BASE_URL = 'file:///tmp/socket';

      const loaded = loadConfig({ userDataDir: tmp, argv: ['node', 'test'] });

      assert.equal(loaded.resolved.baseUrl, 'http://localhost:11434');
      assert.equal(loaded.valueSources.baseUrl, 'default');
    } finally {
      if (oldBaseUrl === undefined) delete process.env.LLM_BASE_URL;
      else process.env.LLM_BASE_URL = oldBaseUrl;
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('does not seed provider/baseUrl/model into a fresh config when env supplies them', () => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'murmur-cfg-'));
    const oldProvider = process.env.LLM_PROVIDER;
    const oldBaseUrl = process.env.LLM_BASE_URL;
    const oldModel = process.env.LLM_MODEL;
    try {
      process.env.LLM_PROVIDER = 'openai-compat';
      process.env.LLM_BASE_URL = 'http://localhost:1234/v1';
      process.env.LLM_MODEL = 'local-model';

      const loaded = loadConfig({ userDataDir: tmp, argv: ['node', 'test'] });

      assert.equal(loaded.configFileWritten, true);
      assert.equal(loaded.resolved.provider, 'openai-compat');
      assert.equal(loaded.resolved.baseUrl, 'http://localhost:1234/v1');
      assert.equal(loaded.resolved.model, 'local-model');
      assert.equal(loaded.valueSources.provider, 'env');
      assert.equal(loaded.valueSources.baseUrl, 'env');
      assert.equal(loaded.valueSources.model, 'env');

      const seeded = JSON.parse(readFileSync(path.join(tmp, 'config.json'), 'utf8'));
      assert.equal('provider' in seeded, false);
      assert.equal('baseUrl' in seeded, false);
      assert.equal('model' in seeded, false);
    } finally {
      if (oldProvider === undefined) delete process.env.LLM_PROVIDER;
      else process.env.LLM_PROVIDER = oldProvider;
      if (oldBaseUrl === undefined) delete process.env.LLM_BASE_URL;
      else process.env.LLM_BASE_URL = oldBaseUrl;
      if (oldModel === undefined) delete process.env.LLM_MODEL;
      else process.env.LLM_MODEL = oldModel;
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('marks first-run LLM values as built-in defaults when no env or file value exists', () => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'murmur-cfg-'));
    const oldProvider = process.env.LLM_PROVIDER;
    const oldBaseUrl = process.env.LLM_BASE_URL;
    const oldModel = process.env.LLM_MODEL;
    try {
      delete process.env.LLM_PROVIDER;
      delete process.env.LLM_BASE_URL;
      delete process.env.LLM_MODEL;

      const loaded = loadConfig({ userDataDir: tmp, argv: ['node', 'test'] });

      assert.equal(loaded.resolved.provider, 'ollama');
      assert.equal(loaded.valueSources.provider, 'default');
      assert.equal(loaded.valueSources.baseUrl, 'default');
      assert.equal(loaded.valueSources.model, 'default');
    } finally {
      if (oldProvider === undefined) delete process.env.LLM_PROVIDER;
      else process.env.LLM_PROVIDER = oldProvider;
      if (oldBaseUrl === undefined) delete process.env.LLM_BASE_URL;
      else process.env.LLM_BASE_URL = oldBaseUrl;
      if (oldModel === undefined) delete process.env.LLM_MODEL;
      else process.env.LLM_MODEL = oldModel;
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

const ENV_NAME = /^(LLM_|MURMUR_|WHISPER_|OLLAMA_URL$)/;

/**
 * Run `fn` with every Murmur-related env var cleared, then `vars` applied, and
 * restore the original environment afterwards.
 */
function withEnv(vars, fn) {
  const saved = {};
  for (const key of Object.keys(process.env)) {
    if (!ENV_NAME.test(key)) continue;
    saved[key] = process.env[key];
    delete process.env[key];
  }
  Object.assign(process.env, vars);
  try {
    return fn();
  } finally {
    for (const key of Object.keys(process.env)) {
      if (ENV_NAME.test(key)) delete process.env[key];
    }
    Object.assign(process.env, saved);
  }
}

function inTempDir(fn) {
  const tmp = mkdtempSync(path.join(tmpdir(), 'murmur-env-'));
  try {
    return fn(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const load = (tmp, argv = ['node', 'test']) => loadConfig({ userDataDir: tmp, argv });
const readSeeded = (tmp) => JSON.parse(readFileSync(path.join(tmp, 'config.json'), 'utf8'));

describe('loadConfig — env vars vs the seeded config file (CLI > file > env > default)', () => {
  it('honours non-LLM env vars on the very first run', () => {
    inTempDir((tmp) =>
      withEnv(
        {
          MURMUR_HOTKEY: 'Alt+F9',
          MURMUR_LOG_MODE: 'full',
          MURMUR_SYSTEM_PROMPT: 'ENV PROMPT',
          MURMUR_RECORDER_COMMAND: 'my-recorder -r 16000',
        },
        () => {
          const loaded = load(tmp);

          assert.equal(loaded.configFileWritten, true);
          assert.equal(loaded.resolved.hotkeyCombo, 'Alt+F9');
          assert.equal(loaded.resolved.logMode, 'full');
          assert.equal(loaded.resolved.systemPrompt, 'ENV PROMPT');
          assert.equal(loaded.resolved.recorderCommand, 'my-recorder -r 16000');
          for (const key of ['hotkeyCombo', 'logMode', 'systemPrompt', 'recorderCommand']) {
            assert.equal(loaded.valueSources[key], 'env', `${key} source`);
            assert.equal(loaded.overrides[key], 'env', `${key} override`);
          }
        },
      ),
    );
  });

  it('honours an env var that is set after the first launch', () => {
    inTempDir((tmp) => {
      withEnv({}, () => load(tmp));

      withEnv({ MURMUR_MCP_PORT: '9999', MURMUR_HOTKEY: 'Alt+F9' }, () => {
        const second = load(tmp);

        assert.equal(second.resolved.mcpPort, 9999);
        assert.equal(second.resolved.hotkeyCombo, 'Alt+F9');
        assert.equal(second.valueSources.mcpPort, 'env');
        assert.equal(second.valueSources.hotkeyCombo, 'env');
      });
    });
  });

  it('seeds only absolute paths, not defaults that would shadow env vars', () => {
    inTempDir((tmp) =>
      withEnv({}, () => {
        load(tmp);
        const seeded = readSeeded(tmp);

        assert.deepEqual(Object.keys(seeded).sort(), [
          'logsDir',
          'skillsDir',
          'whisperCliPath',
          'whisperModelPath',
        ]);
      }),
    );
  });

  it('does not seed a path whose env var is set at seed time', () => {
    inTempDir((tmp) =>
      withEnv({ MURMUR_LOGS_DIR: path.join(tmp, 'env-logs') }, () => {
        const loaded = load(tmp);

        assert.equal('logsDir' in readSeeded(tmp), false);
        assert.equal(loaded.resolved.logsDir, path.join(tmp, 'env-logs'));
        assert.equal(loaded.valueSources.logsDir, 'env');
      }),
    );
  });

  it('keeps a config-file value above env and does not report it as an env lock', () => {
    // This is what every config seeded by <= 0.7 looks like.
    withConfig({ hotkeyCombo: 'Ctrl+Alt+K', logMode: 'metadata-only' }, (_, tmp) =>
      withEnv({ MURMUR_HOTKEY: 'Alt+F9', MURMUR_LOG_MODE: 'full' }, () => {
        const loaded = load(tmp);

        assert.equal(loaded.resolved.hotkeyCombo, 'Ctrl+Alt+K');
        assert.equal(loaded.valueSources.hotkeyCombo, 'file');
        assert.equal(loaded.overrides.hotkeyCombo, undefined);
        assert.equal(loaded.overrides.logMode, undefined);
      }),
    );
  });

  it('reports overrides[field] === "env" only when env is the resolved source', () => {
    withConfig({ hotkeyCombo: 'Ctrl+Alt+K' }, (_, tmp) =>
      withEnv({ MURMUR_HOTKEY: 'Alt+F9', MURMUR_TOGGLE_HOTKEY: 'Alt+F8' }, () => {
        const loaded = load(tmp);

        assert.equal(loaded.overrides.hotkeyCombo, undefined, 'file wins, so no lock');
        assert.equal(loaded.overrides.toggleHotkeyCombo, 'env', 'env wins, so lock');
        assert.equal(loaded.resolved.toggleHotkeyCombo, 'Alt+F8');
      }),
    );
  });

  it('reports a CLI flag as the lock when it beats both file and env', () => {
    withConfig({ hotkeyCombo: 'Ctrl+Alt+K' }, (_, tmp) =>
      withEnv({ MURMUR_HOTKEY: 'Alt+F9' }, () => {
        const loaded = load(tmp, ['node', 'test', '--hotkey', 'F8']);

        assert.equal(loaded.resolved.hotkeyCombo, 'F8');
        assert.equal(loaded.overrides.hotkeyCombo, 'cli');
      }),
    );
  });

  it('lists env vars that are set but shadowed, with the source that wins', () => {
    withConfig({ hotkeyCombo: 'Ctrl+Alt+K', mcpPort: 7400 }, (_, tmp) =>
      withEnv(
        { MURMUR_HOTKEY: 'Alt+F9', MURMUR_MCP_PORT: '9999', MURMUR_TOGGLE_HOTKEY: 'Alt+F8' },
        () => {
          const loaded = load(tmp, ['node', 'test', '--mcp-port', '7500']);

          assert.deepEqual(loaded.shadowedEnv.hotkeyCombo, { envVar: 'MURMUR_HOTKEY', by: 'file' });
          assert.deepEqual(loaded.shadowedEnv.mcpPort, { envVar: 'MURMUR_MCP_PORT', by: 'cli' });
          assert.equal(loaded.shadowedEnv.toggleHotkeyCombo, undefined, 'env is in effect');
        },
      ),
    );
  });
});
