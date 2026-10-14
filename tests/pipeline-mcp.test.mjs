import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { Pipeline } from '../dist/main/pipeline.js';
import { loadSkills } from '../dist/main/skills.js';

function makeFakeConfig(overrides = {}) {
  const baseDir = overrides._baseDir ?? mkdtempSync(path.join(tmpdir(), 'murmur-pipe-'));
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
    systemPrompt: 'BASE PROMPT',
    enabledSkills: [],
    controlPanelPort: 7331,
    mcpPort: 7332,
    recorderCommand: 'sox -q -d -r 16000 -c 1 -b 16 -e signed-integer -t raw -',
    logsDir: path.join(baseDir, 'logs'),
    skillsDir: path.join(baseDir, 'skills'),
    overlay: { anchor: 'bottom-center', offsetX: 0, offsetY: -40 },
    overlayAnchor: 'bottom-center',
    overlayOffsetX: 0,
    overlayOffsetY: -40,
    overlayPosition: null,
    configFilePath: 'C:/fake/config.json',
    _baseDir: baseDir,
    ...overrides,
  };
}

function makeFakeProvider(refinements) {
  return {
    config: {
      id: 'test',
      displayName: 'Test',
      baseUrl: '',
      model: '',
      apiKey: null,
      temperature: 0,
    },
    async refine({ systemPrompt, userPrompt }) {
      refinements.push({ systemPrompt, userPrompt });
      return { text: `REFINED: ${userPrompt}`, durationMs: 1 };
    },
    async refineStream({ systemPrompt, userPrompt }, { onToken }) {
      refinements.push({ systemPrompt, userPrompt });
      const text = `REFINED: ${userPrompt}`;
      for (const word of text.split(' ')) {
        onToken(`${word} `);
      }
      return { text, durationMs: 1 };
    },
    async preflight() {
      return null;
    },
  };
}

/** 16-bit mono PCM, 1 s at 16 kHz (above the pipeline's minimum speech length). */
function samplePcm(bytes = 32_000) {
  const pcm = Buffer.alloc(bytes, 0);
  for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(1000, i);
  return pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength);
}

describe('Pipeline MCP / headless', () => {
  let tempBase;

  beforeEach(() => {
    tempBase = mkdtempSync(path.join(tmpdir(), 'murmur-pipe-'));
  });

  afterEach(() => {
    if (tempBase) rmSync(tempBase, { recursive: true, force: true });
  });

  it('processPcm with inject:false returns refined text without injecting', async () => {
    const cfg = makeFakeConfig({ _baseDir: tempBase });
    loadSkills(cfg.skillsDir);
    const statuses = [];
    const injections = [];
    const refinements = [];
    const provider = makeFakeProvider(refinements);

    const pipeline = new Pipeline({
      cfg,
      provider,
      emitStatus: (s) => statuses.push(s),
      transcribeAudio: async () => ({
        text: 'hello world',
        stderr: '',
        durationMs: 1,
      }),
      inject: async (text) => {
        injections.push(text);
      },
    });

    const result = await pipeline.processPcm(samplePcm(), { inject: false });

    assert.equal(result.text, 'REFINED: hello world');
    assert.equal(result.transcription, 'hello world');
    assert.ok(result.sessionDir);
    assert.equal(injections.length, 0);
    assert.deepEqual(
      statuses.filter((s) => s !== 'idle'),
      ['transcribing-streaming', 'refining-streaming', 'done'],
    );
  });

  it('refineText with skillIds composes skills without mutating cfg.enabledSkills', async () => {
    const cfg = makeFakeConfig({ _baseDir: tempBase, enabledSkills: [] });
    loadSkills(cfg.skillsDir);
    const refinements = [];
    const pipeline = new Pipeline({
      cfg,
      provider: makeFakeProvider(refinements),
    });

    const before = [...cfg.enabledSkills];
    const refined = await pipeline.refineText('raw text', { skillIds: ['concise-output'] });

    assert.equal(refined, 'REFINED: raw text');
    assert.deepEqual(cfg.enabledSkills, before);
    assert.match(refinements[0].systemPrompt, /## Active skills/);
    assert.match(refinements[0].systemPrompt, /### Concise output/);
  });

  it('record auto-stops, rejects concurrent calls, and resolves refined text', async () => {
    const cfg = makeFakeConfig({ _baseDir: tempBase });
    loadSkills(cfg.skillsDir);
    const refinements = [];
    const pcm = samplePcm();

    let activeRecorder = null;
    const pipeline = new Pipeline({
      cfg,
      provider: makeFakeProvider(refinements),
      transcribeAudio: async () => ({
        text: 'dictated',
        stderr: '',
        durationMs: 1,
      }),
      createRecorder: () => {
        const recorder = {
          async start() {
            if (activeRecorder) throw new Error('recorder already active');
            activeRecorder = recorder;
          },
          async stop() {
            activeRecorder = null;
            return pcm;
          },
        };
        return recorder;
      },
    });

    const first = pipeline.record({ durationMs: 1, inject: false });
    await assert.rejects(() => pipeline.record({ durationMs: 1 }), /already/i);
    const result = await first;

    assert.equal(result.text, 'REFINED: dictated');
    assert.equal(result.transcription, 'dictated');
    assert.equal(activeRecorder, null);
  });

  it('stopRecording rejects when no active headless recording', async () => {
    const cfg = makeFakeConfig({ _baseDir: tempBase });
    const pipeline = new Pipeline({
      cfg,
      provider: makeFakeProvider([]),
      createRecorder: () => ({
        async start() {},
        async stop() {
          return samplePcm();
        },
      }),
    });

    await assert.rejects(() => pipeline.stopRecording(), /no active recording/i);
  });

  it('open-ended record() rejects when stopRecording fails and allows recovery', async () => {
    const cfg = makeFakeConfig({ _baseDir: tempBase });
    loadSkills(cfg.skillsDir);
    const pcm = samplePcm();
    let failTranscribe = true;

    const pipeline = new Pipeline({
      cfg,
      provider: makeFakeProvider([]),
      transcribeAudio: async () => {
        if (failTranscribe) {
          failTranscribe = false;
          throw new Error('whisper blew up');
        }
        return { text: 'recovered', stderr: '', durationMs: 1 };
      },
      createRecorder: () => ({
        async start() {},
        async stop() {
          return pcm;
        },
      }),
    });

    const recordPromise = pipeline.record({ inject: false });
    await Promise.resolve();

    await assert.rejects(pipeline.stopRecording(), /whisper blew up/i);
    await assert.rejects(recordPromise, /whisper blew up/i);
    assert.equal(pipeline.isIdle(), true);

    const result = await pipeline.record({ durationMs: 1, inject: false });
    assert.equal(result.text, 'REFINED: recovered');
  });

  it('record() cleans up when recorder.start() fails and allows a later record()', async () => {
    const cfg = makeFakeConfig({ _baseDir: tempBase });
    loadSkills(cfg.skillsDir);
    const pcm = samplePcm();
    let failNextStart = true;

    const pipeline = new Pipeline({
      cfg,
      provider: makeFakeProvider([]),
      transcribeAudio: async () => ({
        text: 'recovered',
        stderr: '',
        durationMs: 1,
      }),
      createRecorder: () => ({
        async start() {
          if (failNextStart) {
            failNextStart = false;
            throw new Error('mic unavailable');
          }
        },
        async stop() {
          return pcm;
        },
      }),
    });

    await assert.rejects(() => pipeline.record({ durationMs: 1 }), /mic unavailable/i);
    assert.equal(pipeline.isIdle(), true);

    const result = await pipeline.record({ durationMs: 1, inject: false });
    assert.equal(result.text, 'REFINED: recovered');
  });
});

describe('Pipeline overlay path', () => {
  let tempBase;

  beforeEach(() => {
    tempBase = mkdtempSync(path.join(tmpdir(), 'murmur-pipe-'));
  });

  afterEach(() => {
    if (tempBase) rmSync(tempBase, { recursive: true, force: true });
  });

  it('start() triggers renderer start; handleAudioChunk injects with full status flow', async () => {
    const cfg = makeFakeConfig({ _baseDir: tempBase });
    loadSkills(cfg.skillsDir);
    const statuses = [];
    const rendererStarts = [];
    const injections = [];

    const pipeline = new Pipeline({
      cfg,
      provider: makeFakeProvider([]),
      emitStatus: (s) => statuses.push(s),
      requestRendererStart: () => rendererStarts.push(true),
      requestRendererStop: () => {
        throw new Error('renderer stop should not run in this test');
      },
      transcribeAudio: async () => ({
        text: 'overlay speech',
        stderr: '',
        durationMs: 1,
      }),
      inject: async (text) => injections.push(text),
    });

    pipeline.start();
    assert.equal(rendererStarts.length, 1);

    await pipeline.handleAudioChunk(samplePcm());

    assert.equal(injections.length, 1);
    assert.equal(injections[0], 'REFINED: overlay speech');
    assert.deepEqual(
      statuses.filter((s) => s !== 'idle' && s !== 'recording'),
      ['transcribing-streaming', 'refining-streaming', 'injecting', 'done'],
    );
  });

  it('stop() is ignored during headless recording and does not call renderer stop', async () => {
    const cfg = makeFakeConfig({ _baseDir: tempBase });
    const rendererStops = [];
    const pcm = samplePcm();

    const pipeline = new Pipeline({
      cfg,
      provider: makeFakeProvider([]),
      transcribeAudio: async () => ({
        text: 'dictated',
        stderr: '',
        durationMs: 1,
      }),
      requestRendererStop: () => rendererStops.push(true),
      createRecorder: () => ({
        async start() {},
        async stop() {
          return pcm;
        },
      }),
    });

    const pending = pipeline.record({ durationMs: 50, inject: false });
    pipeline.stop();
    assert.equal(rendererStops.length, 0);

    await pending;
    assert.equal(rendererStops.length, 0);
  });

  it('treats an empty transcription as no speech: no refine, no inject, no error', async () => {
    const cfg = makeFakeConfig({ _baseDir: tempBase });
    loadSkills(cfg.skillsDir);
    const statuses = [];
    const refinements = [];
    const injections = [];
    const sent = [];

    const pipeline = new Pipeline({
      cfg,
      provider: makeFakeProvider(refinements),
      emitStatus: (s) => statuses.push(s),
      getWindow: () => ({ webContents: { send: (ch, payload) => sent.push([ch, payload]) } }),
      requestRendererStart: () => {},
      transcribeAudio: async () => ({ text: '', stderr: '', durationMs: 1 }),
      inject: async (text) => injections.push(text),
    });

    pipeline.start();
    await pipeline.handleAudioChunk(samplePcm());

    assert.equal(refinements.length, 0);
    assert.equal(injections.length, 0);
    assert.equal(statuses.includes('error'), false);
    assert.equal(statuses.at(-1), 'idle');
    assert.equal(
      sent.some(([ch]) => ch === 'murmur:error'),
      false,
    );
    assert.equal(pipeline.isIdle(), true);
    assert.equal(pipeline.hasLastTranscription(), false);
  });

  it('skips whisper entirely for an accidental tap', async () => {
    const cfg = makeFakeConfig({ _baseDir: tempBase });
    let transcribed = false;
    const pipeline = new Pipeline({
      cfg,
      provider: makeFakeProvider([]),
      transcribeAudio: async () => {
        transcribed = true;
        return { text: 'should not run', stderr: '', durationMs: 1 };
      },
    });

    // 100 ms of audio
    await assert.rejects(pipeline.processPcm(samplePcm(3_200), { inject: false }), {
      name: 'NoSpeechError',
    });
    assert.equal(transcribed, false);
  });

  it('processPcm() defaults inject to true and emits injecting status', async () => {
    const cfg = makeFakeConfig({ _baseDir: tempBase });
    loadSkills(cfg.skillsDir);
    const statuses = [];
    const injections = [];

    const pipeline = new Pipeline({
      cfg,
      provider: makeFakeProvider([]),
      emitStatus: (s) => statuses.push(s),
      transcribeAudio: async () => ({
        text: 'spoken',
        stderr: '',
        durationMs: 1,
      }),
      inject: async (text) => injections.push(text),
    });

    await pipeline.processPcm(samplePcm());

    assert.equal(injections.length, 1);
    assert.ok(statuses.includes('injecting'));
  });
});
