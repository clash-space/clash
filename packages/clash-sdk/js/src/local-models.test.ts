import { describe, expect, it, vi } from 'vitest';
import { createPythonLocalAsrRuntime, type LocalModelRpcRequest } from './local-models.js';

describe('local model SDK', () => {
  it('routes ASR deploy/status/transcribe through an injected Python RPC boundary', async () => {
    const requests: LocalModelRpcRequest[] = [];
    const runtime = createPythonLocalAsrRuntime({
      invokeRpc: async (request) => {
        requests.push(request);
        if (request.method === 'status') return { available: true };
        if (request.method === 'deploy') return {};
        if (request.method === 'transcribe') return { text: 'hello local model' };
        throw new Error(`unexpected method ${request.method}`);
      },
    });

    await expect(runtime.status({ model: 'iic/SenseVoiceSmall' })).resolves.toEqual({ available: true });
    await expect(runtime.deploy({ model: 'iic/SenseVoiceSmall', kind: 'asr' })).resolves.toBeUndefined();
    await expect(runtime.transcribe({
      model: 'iic/SenseVoiceSmall',
      audioPath: '/tmp/input.webm',
      language: 'zh',
    })).resolves.toEqual({ text: 'hello local model' });

    expect(requests).toEqual([
      { method: 'status', params: { model: 'iic/SenseVoiceSmall' } },
      { method: 'deploy', params: { model: 'iic/SenseVoiceSmall', kind: 'asr' } },
      { method: 'transcribe', params: { model: 'iic/SenseVoiceSmall', audio_path: '/tmp/input.webm', language: 'zh' } },
    ]);
  });

  it('surfaces Python RPC errors without leaking transport details', async () => {
    const runtime = createPythonLocalAsrRuntime({
      invokeRpc: vi.fn(async () => ({ ok: false, error: 'missing funasr' })),
    });

    await expect(runtime.status({ model: 'iic/SenseVoiceSmall' })).rejects.toThrow('missing funasr');
  });
});
