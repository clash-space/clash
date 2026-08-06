import { describe, expect, it, vi } from 'vitest';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createPythonLocalAsrRuntime,
  createPythonLocalTtsRuntime,
  type LocalModelRpcRequest,
} from './local-models.js';

describe('local model SDK', () => {
  it('routes ASR deploy/status/transcribe through an injected Python RPC boundary', async () => {
    const requests: LocalModelRpcRequest[] = [];
    const runtime = createPythonLocalAsrRuntime({
      cacheDir: '/tmp/clash-asr-models',
      invokeRpc: async (request) => {
        requests.push(request);
        if (request.method === 'status') return { available: true };
        if (request.method === 'deploy') return {};
        if (request.method === 'transcribe') return {
          schemaVersion: 1,
          kind: 'clash.asr.timed-transcript',
          timebase: 'milliseconds',
          alignment: 'word',
          text: 'hello local model',
          backendId: 'funasr',
          modelId: 'iic/SenseVoiceSmall',
          language: 'en',
          durationMs: 860,
          words: [
            { id: 'word-000001', text: 'hello', startMs: 40, endMs: 320 },
            { id: 'word-000002', text: 'local', startMs: 360, endMs: 590 },
            { id: 'word-000003', text: 'model', startMs: 620, endMs: 860, confidence: 0.94 },
          ],
          segments: [{
            id: 'segment-000001',
            text: 'hello local model',
            startMs: 40,
            endMs: 860,
            wordIds: ['word-000001', 'word-000002', 'word-000003'],
          }],
        };
        throw new Error(`unexpected method ${request.method}`);
      },
    });

    await expect(runtime.status({ model: 'iic/SenseVoiceSmall' })).resolves.toEqual({ available: true });
    await expect(runtime.deploy({ model: 'iic/SenseVoiceSmall', kind: 'asr' })).resolves.toBeUndefined();
    await expect(runtime.transcribe({
      model: 'iic/SenseVoiceSmall',
      audioPath: '/tmp/input.webm',
      language: 'zh',
    })).resolves.toEqual({
      schemaVersion: 1,
      kind: 'clash.asr.timed-transcript',
      timebase: 'milliseconds',
      alignment: 'word',
      text: 'hello local model',
      backendId: 'funasr',
      modelId: 'iic/SenseVoiceSmall',
      language: 'en',
      durationMs: 860,
      words: [
        { id: 'word-000001', text: 'hello', startMs: 40, endMs: 320 },
        { id: 'word-000002', text: 'local', startMs: 360, endMs: 590 },
        { id: 'word-000003', text: 'model', startMs: 620, endMs: 860, confidence: 0.94 },
      ],
      segments: [{
        id: 'segment-000001',
        text: 'hello local model',
        startMs: 40,
        endMs: 860,
        wordIds: ['word-000001', 'word-000002', 'word-000003'],
      }],
    });

    expect(requests).toEqual([
      { method: 'status', params: { model: 'iic/SenseVoiceSmall', cache_dir: '/tmp/clash-asr-models' } },
      { method: 'deploy', params: { model: 'iic/SenseVoiceSmall', kind: 'asr', cache_dir: '/tmp/clash-asr-models' } },
      {
        method: 'transcribe',
        params: {
          model: 'iic/SenseVoiceSmall',
          audio_path: '/tmp/input.webm',
          language: 'zh',
          cache_dir: '/tmp/clash-asr-models',
        },
      },
    ]);
  });

  it('reuses one lazily started Python worker across ASR transcriptions', async () => {
    const fixtureDir = await mkdtemp(join(tmpdir(), 'clash-asr-rpc-'));
    const executable = join(fixtureDir, 'fake-local-model-rpc.mjs');
    await writeFile(executable, `#!/usr/bin/env node
import readline from 'node:readline';

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let handled = 0;
setTimeout(() => process.exit(0), 250);
lines.on('line', (line) => {
  const request = JSON.parse(line);
  const response = {
    ...(request.id ? { id: request.id } : {}),
    ok: true,
    result: {
      schemaVersion: 1,
      kind: 'clash.asr.timed-transcript',
      timebase: 'milliseconds',
      alignment: 'word',
      text: 'worker ' + process.pid,
      backendId: String(process.pid),
      modelId: request.params.model,
      durationMs: 1,
      words: [{ id: 'word-1', text: 'worker', startMs: 0, endMs: 1 }],
      segments: [{ id: 'segment-1', text: 'worker', startMs: 0, endMs: 1, wordIds: ['word-1'] }],
    },
  };
  process.stdout.write(JSON.stringify(response) + '\\n');
  handled += 1;
  if (handled === 2) setTimeout(() => process.exit(0), 0);
});
`);
    await chmod(executable, 0o755);

    try {
      const runtime = createPythonLocalAsrRuntime({ pythonBinary: executable });
      const first = await runtime.transcribe({
        model: 'iic/SenseVoiceSmall',
        audioPath: '/tmp/first.webm',
      });
      const second = await runtime.transcribe({
        model: 'iic/SenseVoiceSmall',
        audioPath: '/tmp/second.webm',
      });

      expect(first.backendId).toBe(second.backendId);
    } finally {
      await rm(fixtureDir, { recursive: true, force: true });
    }
  });

  it('shares one lazily started Python worker across ASR and TTS runtimes', async () => {
    const fixtureDir = await mkdtemp(join(tmpdir(), 'clash-local-model-router-'));
    const executable = join(fixtureDir, 'fake-local-model-router.mjs');
    await writeFile(executable, `#!/usr/bin/env node
import readline from 'node:readline';

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let handled = 0;
lines.on('line', (line) => {
  const request = JSON.parse(line);
  const result = request.adapter === 'asr'
    ? {
        schemaVersion: 1,
        kind: 'clash.asr.timed-transcript',
        timebase: 'milliseconds',
        alignment: 'word',
        text: 'shared worker',
        backendId: String(process.pid),
        modelId: request.params.model,
        durationMs: 1,
        words: [{ id: 'word-1', text: 'shared', startMs: 0, endMs: 1 }],
        segments: [{ id: 'segment-1', text: 'shared', startMs: 0, endMs: 1, wordIds: ['word-1'] }],
      }
    : {
        schemaVersion: 1,
        kind: 'clash.tts.audio',
        backendId: String(process.pid),
        modelId: request.params.model,
        format: 'wav',
        sampleRate: 24000,
        durationMs: 1,
        outputPath: request.params.output_path,
      };
  process.stdout.write(JSON.stringify({ id: request.id, ok: true, result }) + '\\n');
  handled += 1;
  if (handled === 2) setTimeout(() => process.exit(0), 0);
});
`);
    await chmod(executable, 0o755);

    try {
      const asrRuntime = createPythonLocalAsrRuntime({ pythonBinary: executable });
      const ttsRuntime = createPythonLocalTtsRuntime({ pythonBinary: executable });
      const transcription = await asrRuntime.transcribe({
        model: 'iic/SenseVoiceSmall',
        audioPath: '/tmp/shared.webm',
      });
      const synthesis = await ttsRuntime.synthesize({
        model: 'zh_CN-huayan-medium',
        text: '共享进程',
        outputPath: '/tmp/shared.wav',
      });

      expect(transcription.backendId).toBe(synthesis.backendId);
    } finally {
      await rm(fixtureDir, { recursive: true, force: true });
    }
  });

  it('restarts the shared Python worker after it exits', async () => {
    const fixtureDir = await mkdtemp(join(tmpdir(), 'clash-local-model-restart-'));
    const executable = join(fixtureDir, 'fake-restarting-local-model-router.mjs');
    const generationFile = join(fixtureDir, 'generation.txt');
    await writeFile(generationFile, '0');
    await writeFile(executable, `#!/usr/bin/env node
import readline from 'node:readline';
import { readFileSync, writeFileSync } from 'node:fs';

const generationFile = ${JSON.stringify(generationFile)};
const generation = Number(readFileSync(generationFile, 'utf8')) + 1;
writeFileSync(generationFile, String(generation));
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.once('line', (line) => {
  const request = JSON.parse(line);
  process.stdout.write(JSON.stringify({
    id: request.id,
    ok: true,
    result: {
      schemaVersion: 1,
      kind: 'clash.asr.timed-transcript',
      timebase: 'milliseconds',
      alignment: 'word',
      text: 'generation ' + generation,
      backendId: String(generation),
      modelId: request.params.model,
      durationMs: 1,
      words: [{ id: 'word-1', text: 'generation', startMs: 0, endMs: 1 }],
      segments: [{ id: 'segment-1', text: 'generation', startMs: 0, endMs: 1, wordIds: ['word-1'] }],
    },
  }) + '\\n');
  setTimeout(() => process.exit(0), 0);
});
`);
    await chmod(executable, 0o755);

    try {
      const runtime = createPythonLocalAsrRuntime({ pythonBinary: executable });
      const first = await runtime.transcribe({ model: 'fixture', audioPath: '/tmp/first.wav' });
      await new Promise((resolve) => setTimeout(resolve, 50));
      const second = await runtime.transcribe({ model: 'fixture', audioPath: '/tmp/second.wav' });

      expect(first.backendId).toBe('1');
      expect(second.backendId).toBe('2');
    } finally {
      await rm(fixtureDir, { recursive: true, force: true });
    }
  });

  it('surfaces Python RPC errors without leaking transport details', async () => {
    const runtime = createPythonLocalAsrRuntime({
      invokeRpc: vi.fn(async () => ({ ok: false, error: 'missing funasr' })),
    });

    await expect(runtime.status({ model: 'iic/SenseVoiceSmall' })).rejects.toThrow('missing funasr');
  });

  it('rejects malformed or non-word-aligned ASR responses at the SDK boundary', async () => {
    const runtime = createPythonLocalAsrRuntime({
      invokeRpc: vi.fn(async () => ({
        schemaVersion: 1,
        kind: 'clash.asr.timed-transcript',
        timebase: 'milliseconds',
        alignment: 'word',
        text: 'bad range',
        backendId: 'fixture',
        modelId: 'fixture-model',
        durationMs: 20,
        words: [{ id: 'word-1', text: 'bad', startMs: 20, endMs: 10 }],
        segments: [],
      })),
    });

    await expect(runtime.transcribe({
      model: 'fixture-model',
      audioPath: '/tmp/input.wav',
    })).rejects.toThrow(/word.*endMs/i);
  });

  it('routes TTS lifecycle and synthesis through the same Python RPC boundary', async () => {
    const requests: LocalModelRpcRequest[] = [];
    const runtime = createPythonLocalTtsRuntime({
      cacheDir: '/tmp/clash-speech-models',
      invokeRpc: async (request) => {
        requests.push(request);
        if (request.method === 'status') return { available: true };
        if (request.method === 'deploy' || request.method === 'remove') return {};
        if (request.method === 'synthesize') {
          return {
            schemaVersion: 1,
            kind: 'clash.tts.audio',
            backendId: 'piper',
            modelId: 'zh_CN-huayan-medium',
            voiceId: 'huayan',
            format: 'wav',
            sampleRate: 22050,
            durationMs: 1280,
            outputPath: '/tmp/clash-output.wav',
          };
        }
        throw new Error(`unexpected method ${request.method}`);
      },
    });

    await expect(runtime.status({ model: 'zh_CN-huayan-medium' })).resolves.toEqual({ available: true });
    await expect(runtime.deploy({ model: 'zh_CN-huayan-medium', kind: 'tts' })).resolves.toBeUndefined();
    await expect(runtime.synthesize({
      model: 'zh_CN-huayan-medium',
      text: 'Clash 本地语音',
      outputPath: '/tmp/clash-output.wav',
      voice: 'huayan',
      speed: 1.1,
    })).resolves.toEqual({
      schemaVersion: 1,
      kind: 'clash.tts.audio',
      backendId: 'piper',
      modelId: 'zh_CN-huayan-medium',
      voiceId: 'huayan',
      format: 'wav',
      sampleRate: 22050,
      durationMs: 1280,
      outputPath: '/tmp/clash-output.wav',
    });
    await expect(runtime.remove({ model: 'zh_CN-huayan-medium' })).resolves.toBeUndefined();

    expect(requests).toEqual([
      {
        method: 'status',
        params: { model: 'zh_CN-huayan-medium', cache_dir: '/tmp/clash-speech-models' },
      },
      {
        method: 'deploy',
        params: {
          model: 'zh_CN-huayan-medium',
          kind: 'tts',
          cache_dir: '/tmp/clash-speech-models',
        },
      },
      {
        method: 'synthesize',
        params: {
          model: 'zh_CN-huayan-medium',
          text: 'Clash 本地语音',
          output_path: '/tmp/clash-output.wav',
          cache_dir: '/tmp/clash-speech-models',
          voice: 'huayan',
          speed: 1.1,
        },
      },
      {
        method: 'remove',
        params: { model: 'zh_CN-huayan-medium', cache_dir: '/tmp/clash-speech-models' },
      },
    ]);
  });
});
