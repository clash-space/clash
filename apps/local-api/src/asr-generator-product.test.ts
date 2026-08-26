import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createProjectAsset,
  markProjectAssetAuthority,
} from "@clash/shared-types";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createLocalAudioConfigStore } from "./audio-config.js";
import { createClashUserConfigStore } from "./user-config.js";
import { createLocalResourceStore } from "./local-resource-store.js";
import { FileReplicaStore } from "./loro/file-replica-store.js";
import {
  clashHomeForLocalDataDir,
  createConfiguredLocalAcpAdapter,
  startLocalApiServer,
} from "./server.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("first-party ASR Generator product path", () => {
  it("processes a discovery-enabled Host Generator Action against a frozen Asset", async () => {
    const clashRoot = await mkdtemp(join(tmpdir(), "clash-asr-product-"));
    directories.push(clashRoot);
    const dataDir = join(clashRoot, "local-api");
    const projectId = "asr-product-project";
    await createClashUserConfigStore(dataDir).setSection("audio", {
      asr: {
        enabled: true,
        provider: "builtin-funasr",
        model: "iic/SenseVoiceSmall",
      },
      tts: {
        enabled: false,
        provider: "builtin-piper",
        model: "zh_CN-huayan-medium",
      },
    });
    const transcribe = vi.fn(async ({ model }: { model: string }) => ({
      schemaVersion: 1 as const,
      kind: "clash.asr.timed-transcript" as const,
      timebase: "milliseconds" as const,
      alignment: "word" as const,
      text: "hello world",
      backendId: "funasr",
      modelId: model,
      language: "en",
      durationMs: 920,
      words: [
        { id: "word-1", text: "hello", startMs: 80, endMs: 410 },
        { id: "word-2", text: "world", startMs: 500, endMs: 920 },
      ],
      segments: [
        {
          id: "segment-1",
          text: "hello world",
          startMs: 80,
          endMs: 920,
          wordIds: ["word-1", "word-2"],
        },
      ],
    }));
    const available = async () => ({ available: true });
    const audioConfig = createLocalAudioConfigStore({
      dataDir,
      asrRuntime: {
        status: available,
        deploy: async () => {},
        remove: async () => {},
        transcribe,
      },
      ttsRuntime: {
        status: async () => ({ available: false }),
        deploy: async () => {},
        remove: async () => {},
        synthesize: async () => {
          throw new Error("TTS is outside this test.");
        },
      },
    });
    const resource = await createLocalResourceStore({
      dataDir,
      clashRoot: clashHomeForLocalDataDir(dataDir),
    }).install({
      kind: "audio",
      bytes: new TextEncoder().encode("RIFF-frozen-ASR-input"),
      contentType: "audio/wav",
      originalName: "source.wav",
    });
    await new FileReplicaStore(join(dataDir, "projects")).updateSnapshotAtomic(
      projectId,
      (doc) => {
        expect(markProjectAssetAuthority(doc)).toMatchObject({ ok: true });
        expect(
          createProjectAsset(doc, {
            id: "audio-1",
            kind: "audio",
            source: { kind: "owned", resourceId: resource.resource.id },
            lifecycle: { state: "active" },
            metadata: {
              contentType: "audio/wav",
              durationMs: 920,
              audioCodec: "pcm_s16le",
              sampleRate: 16_000,
              channelCount: 1,
              channelLayout: "mono",
            },
          }),
        ).toMatchObject({ ok: true });
        return { value: undefined };
      },
    );

    const server = await startLocalApiServer({
      dataDir,
      port: 0,
      remotePersistence: null,
      discovery: { enabled: true },
      audioConfig,
      localAcp: createConfiguredLocalAcpAdapter({ CLASH_E2E_STUB_ACP: "1" }),
    });
    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("local-api did not bind a TCP port");
      }
      const origin = `http://127.0.0.1:${address.port}`;
      const createGenerator = await fetch(
        `${origin}/api/v1/projects/${projectId}/generators`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            generatorId: "speech-1",
            generatorRevisionId: "speech-1:r1",
            pluginId: "clash.asr",
            definitionId: "speech-analysis",
            state: { modelId: "sensevoice-small-asr" },
            persistentInputRefs: [],
          }),
        },
      );
      expect(createGenerator.status, await createGenerator.clone().text()).toBe(
        201,
      );
      const submit = await fetch(
        `${origin}/api/v1/projects/${projectId}/generators/speech-1/actions/transcribe/runs`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            actionRunId: "asr-run-1",
            generatorRevisionId: "speech-1:r1",
            parameters: { language: "en" },
            invocationInputRefs: [
              {
                slot: "source",
                target: { kind: "media", projectAssetId: "audio-1" },
              },
            ],
          }),
        },
      );
      expect(submit.status, await submit.clone().text()).toBe(202);
      await expect(submit.json()).resolves.toMatchObject({
        run: { actionRunId: "asr-run-1", status: "running" },
      });

      let run: Record<string, unknown> | undefined;
      await vi.waitFor(
        async () => {
          const response = await fetch(
            `${origin}/api/v1/projects/${projectId}/generator-runs/asr-run-1`,
          );
          expect(response.status, await response.clone().text()).toBe(200);
          run = ((await response.json()) as { run: Record<string, unknown> })
            .run;
          expect(run).toMatchObject({ status: "succeeded" });
        },
        { timeout: 10_000 },
      );
      const output = await fetch(
        `${origin}/api/v1/projects/${projectId}/generator-runs/asr-run-1/outputs/transcript`,
      );
      expect(output.status, await output.clone().text()).toBe(200);
      const outputBody = (await output.json()) as {
        commit: {
          asset: { documentAssetId: string; revisionId: string };
        };
      };
      expect(outputBody.commit.asset).toMatchObject({ kind: "document" });
      const document = await fetch(
        `${origin}/api/v1/projects/${projectId}/documents/${outputBody.commit.asset.documentAssetId}/revisions/${outputBody.commit.asset.revisionId}`,
      );
      expect(document.status, await document.clone().text()).toBe(200);
      await expect(document.json()).resolves.toMatchObject({
        revision: {
          documentKind: "media.transcript",
          producer: { kind: "action-run", actionRunId: "asr-run-1" },
          sourceRefs: [
            {
              slot: "source",
              target: { kind: "media", projectAssetId: "audio-1" },
            },
          ],
        },
        body: {
          modelId: "sensevoice-small-asr",
          durationMs: 920,
          words: [
            { id: "word-1", startMs: 80, endMs: 410 },
            { id: "word-2", startMs: 500, endMs: 920 },
          ],
        },
      });
      expect(transcribe).toHaveBeenCalledOnce();
    } finally {
      await new Promise<void>((resolveClose) =>
        server.close(() => resolveClose()),
      );
    }
  }, 20_000);
});
