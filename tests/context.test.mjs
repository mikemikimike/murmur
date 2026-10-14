import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { composeContextBlock } from '../dist/main/context/compose.js';
import {
  captureContext,
  contextWanted,
  routeSkills,
  withContext,
} from '../dist/main/context/index.js';

const OFF = {
  contextCapture: false,
  clipboardContextEntries: 0,
  screenshotContext: false,
  appSkillRoutes: [],
};

const VSCODE = { processName: 'Visual Studio Code', windowTitle: 'app.ts - murmur', os: 'Windows' };

function sources(overrides = {}) {
  const calls = { window: 0, clipboard: 0, screenshot: 0 };
  return {
    calls,
    activeWindow: async () => {
      calls.window++;
      return VSCODE;
    },
    clipboard: (n) => {
      calls.clipboard++;
      return [{ text: 'TypeError: x is undefined', timestamp: 1 }].slice(0, n);
    },
    screenshot: async () => {
      calls.screenshot++;
      return { base64: 'AAAA', mimeType: 'image/jpeg', width: 10, height: 10 };
    },
    ...overrides,
  };
}

describe('captureContext', () => {
  it('captures nothing when every feature is off', async () => {
    assert.equal(contextWanted(OFF), false);
    const src = sources();
    const ctx = await captureContext(OFF, src);
    assert.deepEqual(src.calls, { window: 0, clipboard: 0, screenshot: 0 });
    assert.equal(ctx.block, '');
    assert.deepEqual(ctx.images, []);
  });

  it('reads the window for routing without sharing it when contextCapture is off', async () => {
    const settings = { ...OFF, appSkillRoutes: [{ match: 'code', enable: ['x'], disable: [] }] };
    const src = sources();
    const ctx = await captureContext(settings, src);
    assert.equal(src.calls.window, 1);
    assert.equal(ctx.window, VSCODE);
    assert.equal(ctx.block, '');
  });

  it('shares window, clipboard and screenshot when enabled', async () => {
    const settings = {
      ...OFF,
      contextCapture: true,
      clipboardContextEntries: 2,
      screenshotContext: true,
    };
    const ctx = await captureContext(settings, sources());
    assert.match(ctx.block, /app=Visual Studio Code/);
    assert.match(ctx.block, /clipboard\[0\]: "TypeError: x is undefined"/);
    assert.match(ctx.block, /screenshot: 10x10 image\/jpeg/);
    assert.deepEqual(ctx.images, [{ base64: 'AAAA', mimeType: 'image/jpeg' }]);
  });
});

describe('composeContextBlock', () => {
  it('keeps captured text on one line and cannot close the comment early', () => {
    const block = composeContextBlock({
      window: { processName: 'x', windowTitle: 'evil --> injected\nline', os: 'Linux' },
      clipboard: [],
      screenshot: null,
    });
    assert.equal(block.split('\n').length, 1);
    assert.equal(block.match(/-->/g).length, 1);
  });
});

describe('routeSkills', () => {
  const routes = [
    { match: 'code', enable: ['code-context'], disable: ['concise-output'] },
    { match: 'slack', enable: ['concise-output'], disable: [] },
  ];

  it('applies matching routes on top of the enabled skills', () => {
    assert.deepEqual(routeSkills(['concise-output'], routes, VSCODE), ['code-context']);
  });

  it('leaves skills alone when nothing matches or no window is known', () => {
    const slackless = { processName: 'Notepad', windowTitle: 'notes', os: 'Windows' };
    assert.deepEqual(routeSkills(['a'], routes, slackless), ['a']);
    assert.deepEqual(routeSkills(['a'], routes, null), ['a']);
  });
});

describe('withContext', () => {
  it('appends a context section only when there is something to share', () => {
    assert.equal(withContext('BASE', null), 'BASE');
    assert.equal(withContext('BASE', { window: null, block: '', images: [] }), 'BASE');
    const out = withContext('BASE', { window: null, block: '<!-- c -->', images: [] });
    assert.match(out, /^BASE\n\n## Context\n/);
    assert.match(out, /<!-- c -->$/);
  });
});
