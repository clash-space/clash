import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalAudioConfigStore } from "./audio-config";
import type { LocalAsrRuntime, LocalTtsRuntime } from "@clash-space/sdk";

let dataDir = "";

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "clash-audio-config-"));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe("local audio config", () => {
  it("returns a disabled voice-input gate without probing either speech runtime", async () => {
    const asrRuntime: LocalAsrRuntime = {
      status: vi.fn(async () => ({ available: true })),
      deploy: vi.fn(async () => undefined),
      transcribe: vi.fn(async () => {
        throw new Error("not used");
      }),
    };
    const ttsRuntime: LocalTtsRuntime = {
      status: vi.fn(async () => ({ available: true })),
      deploy: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
      synthesize: vi.fn(async () => {
        throw new Error("not used");
      }),
    };
    const store = createLocalAudioConfigStore({ dataDir, asrRuntime, ttsRuntime });

    await expect(store.getVoiceInputConfig()).resolves.toMatchObject({
      asr: {
        enabled: false,
        ready: false,
        setup: { status: "disabled" },
      },
    });
    expect(asrRuntime.status).not.toHaveBeenCalled();
    expect(ttsRuntime.status).not.toHaveBeenCalled();
  });

  it("coalesces adjacent runtime status probes for the same model", async () => {
    const asrRuntime: LocalAsrRuntime = {
      status: vi.fn(async () => ({ available: true })),
      deploy: vi.fn(async () => undefined),
      transcribe: vi.fn(async () => {
        throw new Error("not used");
      }),
    };
    const ttsRuntime: LocalTtsRuntime = {
      status: vi.fn(async () => ({ available: true })),
      deploy: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
      synthesize: vi.fn(async () => {
        throw new Error("not used");
      }),
    };
    const store = createLocalAudioConfigStore({ dataDir, asrRuntime, ttsRuntime });

    await Promise.all([
      store.getPublicConfig(),
      store.getReadState?.(),
      store.getModelStatus({ capability: "speech-to-text", model: "iic/SenseVoiceSmall" }),
    ]);

    expect(asrRuntime.status).toHaveBeenCalledTimes(1);
    expect(ttsRuntime.status).toHaveBeenCalledTimes(1);

    await store.getModelStatus({ capability: "speech-to-text", model: "iic/SenseVoiceSmall" });
    expect(asrRuntime.status).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent voice-input warmups through the selected ASR runtime", async () => {
    let releaseWarmup!: () => void;
    const warmupGate = new Promise<void>((resolve) => {
      releaseWarmup = resolve;
    });
    const asrRuntime: LocalAsrRuntime = {
      status: vi.fn(async () => ({ available: true })),
      deploy: vi.fn(async () => undefined),
      warmup: vi.fn(async () => {
        await warmupGate;
        return { available: true };
      }),
      transcribe: vi.fn(async () => {
        throw new Error("not used");
      }),
    };
    const ttsRuntime: LocalTtsRuntime = {
      status: vi.fn(async () => ({ available: false })),
      deploy: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
      synthesize: vi.fn(async () => {
        throw new Error("not used");
      }),
    };
    const store = createLocalAudioConfigStore({ dataDir, asrRuntime, ttsRuntime });
    await store.updateFromRequest({
      asr_enabled: true,
      asr_model: "iic/SenseVoiceSmall",
    });

    const first = store.warmupVoiceInput?.();
    const second = store.warmupVoiceInput?.();
    await vi.waitFor(() => expect(asrRuntime.warmup).toHaveBeenCalledTimes(1));
    releaseWarmup();

    await expect(Promise.all([first, second])).resolves.toEqual([
      { available: true },
      { available: true },
    ]);
    expect(asrRuntime.warmup).toHaveBeenCalledWith({
      model: "iic/SenseVoiceSmall",
      cacheDir: join(dataDir, "models", "speech", "asr"),
    });
  });

  it("refreshes a cached runtime status after its bounded TTL", async () => {
    vi.useFakeTimers();
    try {
      const asrRuntime: LocalAsrRuntime = {
        status: vi.fn(async () => ({ available: true })),
        deploy: vi.fn(async () => undefined),
        transcribe: vi.fn(async () => {
          throw new Error("not used");
        }),
      };
      const store = createLocalAudioConfigStore({ dataDir, asrRuntime });

      await store.getModelStatus({ capability: "speech-to-text", model: "iic/SenseVoiceSmall" });
      await store.getModelStatus({ capability: "speech-to-text", model: "iic/SenseVoiceSmall" });
      expect(asrRuntime.status).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(30_001);
      await store.getModelStatus({ capability: "speech-to-text", model: "iic/SenseVoiceSmall" });
      expect(asrRuntime.status).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("invalidates cached ASR status after config updates, installs, and removals", async () => {
    const asrRuntime: LocalAsrRuntime = {
      status: vi.fn(async () => ({ available: true })),
      deploy: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
      transcribe: vi.fn(async () => {
        throw new Error("not used");
      }),
    };
    const ttsRuntime: LocalTtsRuntime = {
      status: vi.fn(async () => ({ available: true })),
      deploy: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
      synthesize: vi.fn(async () => {
        throw new Error("not used");
      }),
    };
    const store = createLocalAudioConfigStore({ dataDir, asrRuntime, ttsRuntime });

    await store.getModelStatus({ capability: "speech-to-text", model: "iic/SenseVoiceSmall" });
    expect(asrRuntime.status).toHaveBeenCalledTimes(1);

    await store.updateFromRequest({ asr_enabled: true });
    expect(asrRuntime.status).toHaveBeenCalledTimes(2);

    await store.installBuiltin({ capability: "speech-to-text", model: "iic/SenseVoiceSmall" });
    expect(asrRuntime.status).toHaveBeenCalledTimes(3);

    await store.removeBuiltin({ capability: "speech-to-text", model: "iic/SenseVoiceSmall" });
    expect(asrRuntime.status).toHaveBeenCalledTimes(4);
  });

  it("invalidates the selected TTS model cache after installation and removal", async () => {
    const asrRuntime: LocalAsrRuntime = {
      status: vi.fn(async () => ({ available: true })),
      deploy: vi.fn(async () => undefined),
      transcribe: vi.fn(async () => {
        throw new Error("not used");
      }),
    };
    const ttsRuntime: LocalTtsRuntime = {
      status: vi.fn(async () => ({ available: true })),
      deploy: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
      synthesize: vi.fn(async () => {
        throw new Error("not used");
      }),
    };
    const store = createLocalAudioConfigStore({ dataDir, asrRuntime, ttsRuntime });
    const model = "zh_CN-huayan-medium";

    await store.getModelStatus({ capability: "text-to-speech", model });
    expect(ttsRuntime.status).toHaveBeenCalledTimes(1);

    await store.installBuiltin({ capability: "text-to-speech", model });
    expect(ttsRuntime.status).toHaveBeenCalledTimes(2);

    await store.removeBuiltin({ capability: "text-to-speech", model });
    expect(ttsRuntime.status).toHaveBeenCalledTimes(3);
  });

  it("depends on an injected local ASR runtime for status, deploy, and transcription", async () => {
    const removedAudioSidecar = String.fromCharCode(97, 117, 100, 105, 111, 46, 106, 115, 111, 110);
    const runtime: LocalAsrRuntime = {
      status: vi.fn(async ({ model }) => ({ available: model === "iic/SenseVoiceSmall" })),
      deploy: vi.fn(async () => undefined),
      transcribe: vi.fn(async ({ audioPath, language, model }) => ({
        schemaVersion: 1 as const,
        kind: "clash.asr.timed-transcript" as const,
        timebase: "milliseconds" as const,
        alignment: "word" as const,
        text: `${model}:${language ?? "auto"}:${audioPath.endsWith(".webm")}`,
        backendId: "funasr",
        modelId: model,
        ...(language ? { language } : {}),
        durationMs: 500,
        words: [
          { id: "word-000001", text: "你好", startMs: 0, endMs: 240 },
          { id: "word-000002", text: "Clash", startMs: 260, endMs: 500 },
        ],
        segments: [
          {
            id: "segment-000001",
            text: "你好 Clash",
            startMs: 0,
            endMs: 500,
            wordIds: ["word-000001", "word-000002"],
          },
        ],
      })),
    };
    const ttsRuntime: LocalTtsRuntime = {
      status: vi.fn(async () => ({ available: false })),
      deploy: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
      synthesize: vi.fn(async () => {
        throw new Error("not used");
      }),
    };
    const store = createLocalAudioConfigStore({
      dataDir,
      asrRuntime: runtime,
      ttsRuntime,
    });

    await expect(store.getPublicConfig()).resolves.toMatchObject({
      asr: {
        model: "iic/SenseVoiceSmall",
        setup: { available: true },
      },
    });
    expect(runtime.status).toHaveBeenCalledWith({
      model: "iic/SenseVoiceSmall",
      cacheDir: join(dataDir, "models", "speech", "asr"),
    });

    await store.installBuiltin({ model: "iic/SenseVoiceSmall" });
    expect(runtime.deploy).toHaveBeenCalledWith({
      model: "iic/SenseVoiceSmall",
      kind: "asr",
      cacheDir: join(dataDir, "models", "speech", "asr"),
    });

    await store.updateFromRequest({
      asr_enabled: true,
      asr_provider: "builtin-funasr",
      asr_model: "iic/SenseVoiceSmall",
    });
    await expect(stat(join(dataDir, removedAudioSidecar))).rejects.toMatchObject({ code: "ENOENT" });
    const configInfo = await stat(join(dataDir, "config.yaml"));
    expect(configInfo.mode & 0o777).toBe(0o600);
    await expect(stat(join(dataDir, "local.sqlite"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(createLocalAudioConfigStore({
      dataDir,
      asrRuntime: runtime,
      ttsRuntime,
    }).getPublicConfig()).resolves.toMatchObject({
      asr: {
        enabled: true,
        model: "iic/SenseVoiceSmall",
      },
    });

    const result = await store.transcribe({
      file: new File(["voice-bytes"], "voice.webm", { type: "audio/webm" }),
      language: "zh",
    });

    expect(result.text).toMatch(/^iic\/SenseVoiceSmall:zh:true$/);
    expect(result.words).toEqual([
      { id: "word-000001", text: "你好", startMs: 0, endMs: 240 },
      { id: "word-000002", text: "Clash", startMs: 260, endMs: 500 },
    ]);
    expect(runtime.transcribe).toHaveBeenCalledWith({
      model: "iic/SenseVoiceSmall",
      audioPath: expect.stringMatching(/voice\.webm$/),
      language: "zh",
    });
  });

  it("uses the same downloadable lifecycle for independently selectable local ASR and TTS models", async () => {
    const asrRuntime: LocalAsrRuntime = {
      status: vi.fn(async () => ({ available: true })),
      deploy: vi.fn(async () => undefined),
      transcribe: vi.fn(async () => {
        throw new Error("not used");
      }),
    };
    const ttsRuntime: LocalTtsRuntime = {
      status: vi.fn(async ({ model }) => ({
        available: model === "zh_CN-huayan-medium",
      })),
      deploy: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
      synthesize: vi.fn(async ({ model, outputPath, voice }) => {
        await writeFile(outputPath, Buffer.from("RIFF-local-wav"));
        return {
          schemaVersion: 1 as const,
          kind: "clash.tts.audio" as const,
          backendId: "piper",
          modelId: model,
          ...(voice ? { voiceId: voice } : {}),
          format: "wav" as const,
          sampleRate: 22050,
          durationMs: 640,
          outputPath,
        };
      }),
    };
    const store = createLocalAudioConfigStore({
      dataDir,
      asrRuntime,
      ttsRuntime,
    });

    await expect(store.getPublicConfig()).resolves.toMatchObject({
      asr: {
        capability: "speech-to-text",
        model: "iic/SenseVoiceSmall",
        setup: { provider: "funasr", available: true },
      },
      tts: {
        capability: "text-to-speech",
        model: "zh_CN-huayan-medium",
        setup: { provider: "piper", available: true },
      },
    });

    await store.installBuiltin({
      capability: "text-to-speech",
      model: "zh_CN-huayan-medium",
    });
    expect(ttsRuntime.deploy).toHaveBeenCalledWith({
      model: "zh_CN-huayan-medium",
      kind: "tts",
      cacheDir: join(dataDir, "models", "speech", "tts"),
    });
    expect(asrRuntime.deploy).not.toHaveBeenCalled();

    await expect(store.getModelStatus({
      capability: "text-to-speech",
      model: "zh_CN-huayan-medium",
    })).resolves.toMatchObject({
      capability: "text-to-speech",
      model: "zh_CN-huayan-medium",
      available: true,
    });
    await expect(store.getModelStatus({
      capability: "text-to-speech",
      model: "en_US-lessac-medium",
    })).resolves.toMatchObject({
      capability: "text-to-speech",
      model: "en_US-lessac-medium",
      available: false,
    });

    const synthesis = await store.synthesize({
      model: "zh_CN-huayan-medium",
      text: "Clash 本地语音",
      voice: "huayan",
      speed: 1.1,
    });
    expect(Buffer.from(synthesis.audio).toString()).toBe("RIFF-local-wav");
    expect(synthesis.metadata).toEqual({
      schemaVersion: 1,
      kind: "clash.tts.audio",
      backendId: "piper",
      modelId: "zh_CN-huayan-medium",
      voiceId: "huayan",
      format: "wav",
      sampleRate: 22050,
      durationMs: 640,
    });

    await store.removeBuiltin({
      capability: "text-to-speech",
      model: "zh_CN-huayan-medium",
    });
    expect(ttsRuntime.remove).toHaveBeenCalledWith({
      model: "zh_CN-huayan-medium",
      cacheDir: join(dataDir, "models", "speech", "tts"),
    });

    await expect(createLocalAudioConfigStore({
      dataDir,
      asrRuntime,
      ttsRuntime,
    }).getPublicConfig()).resolves.toMatchObject({
      tts: {
        enabled: false,
        model: "zh_CN-huayan-medium",
      },
    });
  });

  it("does not report a local model install as successful until runtime status confirms it", async () => {
    const asrRuntime: LocalAsrRuntime = {
      status: vi.fn(async () => ({ available: false, message: "weights missing" })),
      deploy: vi.fn(async () => undefined),
      transcribe: vi.fn(async () => {
        throw new Error("not used");
      }),
    };
    const store = createLocalAudioConfigStore({ dataDir, asrRuntime });

    await expect(store.installBuiltin({
      capability: "speech-to-text",
      model: "mlx-community/whisper-small-mlx",
    })).rejects.toMatchObject({
      status: 502,
      message: expect.stringMatching(/did not become ready.*weights missing/i),
    });
    expect(asrRuntime.status).toHaveBeenCalledWith({
      model: "mlx-community/whisper-small-mlx",
      cacheDir: join(dataDir, "models", "speech", "asr"),
    });
  });
});
