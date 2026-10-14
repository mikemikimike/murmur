import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createProgressiveInjector } from '../dist/main/progressive-inject.js';

describe('createProgressiveInjector', () => {
  it('types tokens in order via the provided typeFn', async () => {
    const typed = [];
    const injector = createProgressiveInjector({
      typeFn: async (text) => {
        typed.push(text);
      },
    });

    injector.pushToken('Hello ');
    injector.pushToken('world');
    await injector.flush();

    assert.deepEqual(typed, ['Hello ', 'world']);
  });

  it('flush resolves after all queued tokens are typed', async () => {
    let gate;
    const gatePromise = new Promise((resolve) => {
      gate = resolve;
    });
    let callCount = 0;
    const injector = createProgressiveInjector({
      typeFn: (text) => {
        callCount++;
        if (callCount === 2) {
          return gatePromise;
        }
        return Promise.resolve();
      },
    });

    injector.pushToken('a');
    injector.pushToken('b');
    injector.pushToken('c');

    let flushed = false;
    const flushPromise = injector.flush().then(() => {
      flushed = true;
    });

    await new Promise((r) => setTimeout(r, 20));
    assert.equal(flushed, false);
    gate();
    await flushPromise;
    assert.equal(flushed, true);
  });

  it('abort prevents further tokens from being typed', async () => {
    const typed = [];
    const injector = createProgressiveInjector({
      typeFn: async (text) => {
        await new Promise((r) => setTimeout(r, 10));
        typed.push(text);
      },
    });

    injector.pushToken('a');
    injector.pushToken('b');
    injector.abort();
    injector.pushToken('c');

    await new Promise((r) => setTimeout(r, 50));
    assert.equal(typed.includes('c'), false);
  });

  it('flush resolves even if a typeFn call rejects', async () => {
    const injector = createProgressiveInjector({
      typeFn: async () => {
        throw new Error('type failed');
      },
    });

    injector.pushToken('a');
    await injector.flush();
  });
});
