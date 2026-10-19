import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { startControlPanelServer } from '../dist/main/control-panel/server.js';

function makeFakeConfig(overrides = {}) {
  return {
    provider: 'ollama',
    baseUrl: 'http://localhost:11434',
    model: 'qwen3:4b',
    apiKey: null,
    temperature: 0.2,
    whisperCliPath: 'C:/whisper.exe',
    whisperModelPath: 'C:/model.bin',
    sampleRate: 16000,
    hotkeyCombo: 'Ctrl+Shift+Space',
    toggleHotkeyCombo: 'Ctrl+Shift+H',
    clipboardRestoreDelayMs: 150,
    clipboardRetention: 'keep-generated',
    injectionMethod: 'auto',
    systemPrompt: 'BASE PROMPT',
    enabledSkills: [],
    controlPanelPort: 0,
    mcpPort: 7332,
    recorderCommand: 'sox -q -d -r 16000 -c 1 -b 16 -e signed-integer -t raw -',
    logsDir: 'logs',
    skillsDir: overrides.skillsDir ?? 'skills',
    overlay: { anchor: 'bottom-center', offsetX: 0, offsetY: -40 },
    overlayAnchor: 'bottom-center',
    overlayOffsetX: 0,
    overlayOffsetY: -40,
    overlayPosition: null,
    configFilePath: overrides.configFilePath ?? 'C:/fake/config.json',
    ...overrides,
  };
}

describe('control-panel server', () => {
  let handle;
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'murmur-cp-'));
  });

  afterEach(async () => {
    if (handle) await handle.stop();
    handle = undefined;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('boots on an ephemeral port and serves the SPA shell', async () => {
    const cfg = makeFakeConfig({ skillsDir: tempDir });
    handle = await startControlPanelServer({
      getCurrentConfig: () => cfg,
      onConfigUpdated: () => {},
      testLlm: async () => ({ ok: true, message: 'mocked', latencyMs: 1 }),
    });
    assert.ok(handle.port > 0, 'port is assigned');
    assert.match(handle.url, /^http:\/\/localhost:\d+$/);

    const homeRes = await fetch(`${handle.url}/`);
    assert.equal(homeRes.status, 200);
    const html = await homeRes.text();
    assert.match(html, /<title>.*murmur/i);
  });

  it('exposes GET /api/state with config / skills / composedSystemPrompt / providers', async () => {
    const cfg = makeFakeConfig({ skillsDir: tempDir });
    handle = await startControlPanelServer({
      getCurrentConfig: () => cfg,
      onConfigUpdated: () => {},
      testLlm: async () => ({ ok: true, message: 'mocked' }),
    });

    const res = await fetch(`${handle.url}/api/state`);
    assert.equal(res.status, 200);
    const body = await res.json();

    for (const key of ['config', 'skills', 'composedSystemPrompt', 'providers']) {
      assert.ok(key in body, `/api/state includes ${key}`);
    }
    assert.equal(body.config.provider, 'ollama');
    assert.ok(Array.isArray(body.skills));
    assert.ok(Array.isArray(body.providers));
  });

  it('passes shadowed env vars through GET /api/state so the panel can explain them', async () => {
    const cfg = makeFakeConfig({ skillsDir: tempDir });
    const shadowedEnv = { hotkeyCombo: { envVar: 'MURMUR_HOTKEY', by: 'file' } };
    handle = await startControlPanelServer({
      getCurrentConfig: () => cfg,
      getCurrentOverrides: () => ({ model: 'env' }),
      getCurrentShadowedEnv: () => shadowedEnv,
      onConfigUpdated: () => {},
      testLlm: async () => ({ ok: true, message: 'mocked' }),
    });

    const body = await (await fetch(`${handle.url}/api/state`)).json();
    assert.deepEqual(body.shadowedEnv, shadowedEnv);
    assert.deepEqual(body.overrides, { model: 'env' });
  });

  it('redacts apiKey in GET /api/state output', async () => {
    const cfg = makeFakeConfig({ skillsDir: tempDir, apiKey: 'super-secret-token' });
    handle = await startControlPanelServer({
      getCurrentConfig: () => cfg,
      onConfigUpdated: () => {},
      testLlm: async () => ({ ok: true, message: 'mocked' }),
    });

    const body = await (await fetch(`${handle.url}/api/state`)).json();
    assert.notEqual(body.config.apiKey, 'super-secret-token');
    assert.equal(body.config.apiKeySet, true);
  });

  it('POST /api/test/llm forwards the deps.testLlm result', async () => {
    const cfg = makeFakeConfig({ skillsDir: tempDir });
    handle = await startControlPanelServer({
      getCurrentConfig: () => cfg,
      onConfigUpdated: () => {},
      testLlm: async () => ({ ok: false, message: 'connection refused', latencyMs: 7 }),
    });

    const token = (await (await fetch(`${handle.url}/api/state`)).json()).security.csrfToken;
    const res = await fetch(`${handle.url}/api/test/llm`, {
      method: 'POST',
      headers: { 'X-Murmur-Token': token },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.message, 'connection refused');
    assert.equal(body.latencyMs, 7);
  });

  it('does not allow cross-origin reads or wildcard CORS', async () => {
    const cfg = makeFakeConfig({ skillsDir: tempDir });
    handle = await startControlPanelServer({
      getCurrentConfig: () => cfg,
      onConfigUpdated: () => {},
      testLlm: async () => ({ ok: true, message: 'mocked' }),
    });

    const sameOrigin = await fetch(`${handle.url}/api/state`);
    assert.equal(sameOrigin.headers.get('access-control-allow-origin'), null);

    const crossOrigin = await fetch(`${handle.url}/api/state`, {
      headers: { Origin: 'https://evil.example' },
    });
    assert.equal(crossOrigin.status, 403);
  });

  it('refuses DNS-rebound requests so the control token cannot leak', async () => {
    const cfg = makeFakeConfig({ skillsDir: tempDir });
    handle = await startControlPanelServer({
      getCurrentConfig: () => cfg,
      onConfigUpdated: () => {},
      testLlm: async () => ({ ok: true, message: 'mocked' }),
    });

    // Same-origin GET from a rebound page: no Origin header, attacker's Host.
    const get = (host) =>
      new Promise((resolve, reject) => {
        const req = httpRequest(
          { host: '127.0.0.1', port: handle.port, path: '/api/state', headers: { Host: host } },
          (res) => {
            let body = '';
            res.on('data', (c) => {
              body += c;
            });
            res.on('end', () => resolve({ status: res.statusCode, body }));
          },
        );
        req.on('error', reject);
        req.end();
      });

    const rebound = await get(`evil.example:${handle.port}`);
    assert.equal(rebound.status, 403);
    assert.doesNotMatch(rebound.body, /csrfToken/);

    const local = await get(`127.0.0.1:${handle.port}`);
    assert.equal(local.status, 200);
  });

  it('requires the per-session token for state-changing API calls', async () => {
    const cfg = makeFakeConfig({ skillsDir: tempDir });
    let tested = false;
    handle = await startControlPanelServer({
      getCurrentConfig: () => cfg,
      onConfigUpdated: () => {},
      testLlm: async () => {
        tested = true;
        return { ok: true, message: 'mocked' };
      },
    });

    const missingToken = await fetch(`${handle.url}/api/test/llm`, { method: 'POST' });
    assert.equal(missingToken.status, 403);
    assert.equal(tested, false);

    const state = await (await fetch(`${handle.url}/api/state`)).json();
    const withToken = await fetch(`${handle.url}/api/test/llm`, {
      method: 'POST',
      headers: { 'X-Murmur-Token': state.security.csrfToken },
    });
    assert.equal(withToken.status, 200);
    assert.equal(tested, true);
  });

  it('rejects side-effectful overlay GET routes', async () => {
    const cfg = makeFakeConfig({ skillsDir: tempDir });
    let shown = false;
    handle = await startControlPanelServer({
      getCurrentConfig: () => cfg,
      onConfigUpdated: () => {},
      testLlm: async () => ({ ok: true, message: 'mocked' }),
      showOverlay: () => {
        shown = true;
      },
    });

    const res = await fetch(`${handle.url}/overlay/show`);
    assert.equal(res.status, 405);
    assert.equal(shown, false);
  });

  it('rejects traversal-style skill ids through the API', async () => {
    const cfg = makeFakeConfig({ skillsDir: tempDir });
    handle = await startControlPanelServer({
      getCurrentConfig: () => cfg,
      onConfigUpdated: () => {},
      testLlm: async () => ({ ok: true, message: 'mocked' }),
    });

    const state = await (await fetch(`${handle.url}/api/state`)).json();
    const headers = {
      'Content-Type': 'application/json',
      'X-Murmur-Token': state.security.csrfToken,
    };

    const create = await fetch(`${handle.url}/api/skills`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ id: '../evil', name: 'evil', content: 'nope' }),
    });
    assert.equal(create.status, 400);

    const del = await fetch(`${handle.url}/api/skills/%2e%2e%2fevil`, {
      method: 'DELETE',
      headers,
    });
    assert.equal(del.status, 400);
  });

  describe('with an unparseable config.json', () => {
    const MALFORMED = '{\n "provider": "anthropic",\n "systemPrompt": "TUNED",\n}\n';

    async function startWithMalformedConfig() {
      const configFilePath = path.join(tempDir, 'config.json');
      writeFileSync(configFilePath, MALFORMED, 'utf8');
      const cfg = makeFakeConfig({ skillsDir: tempDir, configFilePath });
      handle = await startControlPanelServer({
        getCurrentConfig: () => cfg,
        onConfigUpdated: () => {},
        testLlm: async () => ({ ok: true, message: 'mocked' }),
      });
      const state = await (await fetch(`${handle.url}/api/state`)).json();
      return { configFilePath, state };
    }

    it('reports the parse error in GET /api/state so the panel can show a banner', async () => {
      const { state } = await startWithMalformedConfig();
      assert.match(state.configError, /line 4\b/);
    });

    it('reports no configError for a valid config', async () => {
      const configFilePath = path.join(tempDir, 'config.json');
      writeFileSync(configFilePath, '{"model":"x"}', 'utf8');
      const cfg = makeFakeConfig({ skillsDir: tempDir, configFilePath });
      handle = await startControlPanelServer({
        getCurrentConfig: () => cfg,
        onConfigUpdated: () => {},
        testLlm: async () => ({ ok: true, message: 'mocked' }),
      });
      const state = await (await fetch(`${handle.url}/api/state`)).json();
      assert.equal(state.configError, null);
    });

    it('refuses PUT /api/config instead of overwriting the file', async () => {
      const { configFilePath, state } = await startWithMalformedConfig();
      const res = await fetch(`${handle.url}/api/config`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Murmur-Token': state.security.csrfToken,
        },
        body: JSON.stringify({ model: 'new-model' }),
      });
      assert.equal(res.status, 409);
      assert.match((await res.json()).error, /line 4\b/);
      assert.equal(readFileSync(configFilePath, 'utf8'), MALFORMED);
    });

    it('refuses PUT /api/system-prompt instead of overwriting the file', async () => {
      const { configFilePath, state } = await startWithMalformedConfig();
      const res = await fetch(`${handle.url}/api/system-prompt`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Murmur-Token': state.security.csrfToken,
        },
        body: JSON.stringify({ prompt: 'new prompt' }),
      });
      assert.equal(res.status, 409);
      assert.equal(readFileSync(configFilePath, 'utf8'), MALFORMED);
    });
  });
});
