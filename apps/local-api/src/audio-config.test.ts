import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalAudioConfigStore } from "./audio-config";
import type { LocalAsrRuntime } from "@clash-space/sdk";

let dataDir = "";

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "clash-audio-config-"));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe("local audio config", () => {
  it("depends on an injected local ASR runtime for status, deploy, and transcription", async () => {
    const removedAudioSidecar = String.fromCharCode(97, 117, 100, 105, 111, 46, 106, 115, 111, 110);
    const runtime: LocalAsrRuntime = {
      status: vi.fn(async ({ model }) => ({ available: model === "iic/SenseVoiceSmall" })),
      deploy: vi.fn(async () => undefined),
      transcribe: vi.fn(async ({ audioPath, language, model }) => ({
        text: `${model}:${language ?? "auto"}:${audioPath.endsWith(".webm")}`,
      })),
    };
    const store = createLocalAudioConfigStore({ dataDir, asrRuntime: runtime });

    await expect(store.getPublicConfig()).resolves.toMatchObject({
      asr: {
        model: "iic/SenseVoiceSmall",
        setup: { available: true },
      },
    });
    expect(runtime.status).toHaveBeenCalledWith({ model: "iic/SenseVoiceSmall" });

    await store.installBuiltin({ model: "iic/SenseVoiceSmall" });
    expect(runtime.deploy).toHaveBeenCalledWith({ model: "iic/SenseVoiceSmall", kind: "asr" });

    await store.updateFromRequest({
      asr_enabled: true,
      asr_provider: "builtin-funasr",
      asr_model: "iic/SenseVoiceSmall",
    });
    await expect(stat(join(dataDir, removedAudioSidecar))).rejects.toMatchObject({ code: "ENOENT" });
    const sqliteInfo = await stat(join(dataDir, "local.sqlite"));
    expect(sqliteInfo.mode & 0o777).toBe(0o600);
    await expect(createLocalAudioConfigStore({ dataDir, asrRuntime: runtime }).getPublicConfig()).resolves.toMatchObject({
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
    expect(runtime.transcribe).toHaveBeenCalledWith({
      model: "iic/SenseVoiceSmall",
      audioPath: expect.stringMatching(/voice\.webm$/),
      language: "zh",
    });
  });
});
