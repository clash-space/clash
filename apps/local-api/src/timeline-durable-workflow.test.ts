import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LoroDoc } from "loro-crdt";
import {
  createProjectTimeline,
  listActionAssetBindingsForOwner,
  listProjectAssets,
  markActionAssetBindingAuthority,
  readProjectTimeline,
  requestTimelineRender,
} from "@clash/shared-types";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createSqliteDurableRunJournal } from "./durable-run-journal.js";
import { createLocalDurableOutputStagingStore } from "./local-durable-output-staging.js";
import { createMockExternalAigcService } from "./local-aigc.js";
import { createLocalWorkflowProcessor } from "./local-processor.js";

let dataDir = "";

async function recoverableIdentityForNode(
  nodeId: string,
): Promise<{ actionRunId: string; outputSlot: string }> {
  const runs = await createSqliteDurableRunJournal(dataDir).listRecoverable(
    "local-api",
    Number.MAX_SAFE_INTEGER,
  );
  const matches = runs.filter(
    (run) =>
      !!run.executorInput &&
      typeof run.executorInput === "object" &&
      !Array.isArray(run.executorInput) &&
      (run.executorInput as Record<string, unknown>).nodeId === nodeId,
  );
  expect(matches).toHaveLength(1);
  return {
    actionRunId: matches[0]!.actionRunId,
    outputSlot: matches[0]!.outputSlot,
  };
}

afterEach(async () => {
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
  dataDir = "";
});

function submittedTimelineRender(): {
  doc: LoroDoc;
  owner: {
    kind: "run";
    actionId: string;
    actionRevisionId: string;
    actionRunId: string;
  };
} {
  const doc = new LoroDoc();
  expect(
    createProjectTimeline(doc, {
      id: "timeline-1",
      name: "Cut",
      state: {
        fps: 30,
        durationInFrames: 30,
        tracks: [
          {
            id: "titles",
            items: [
              {
                id: "title-1",
                type: "text",
                text: "Opening",
                from: 0,
                durationInFrames: 30,
              },
            ],
          },
        ],
      },
    }),
  ).toMatchObject({ ok: true });
  const revisionId = readProjectTimeline(doc, "timeline-1")!.revisionId;
  expect(markActionAssetBindingAuthority(doc)).toMatchObject({ ok: true });
  const requested = requestTimelineRender(doc, {
    timelineId: "timeline-1",
    actorUserId: "user-1",
    generateId: () => "render-1",
  });
  if (!requested.ok) throw new Error(requested.error);
  expect(requested).toMatchObject({ ok: true, renderNodeId: "render-1" });
  return {
    doc,
    owner: {
      kind: "run",
      actionId: "timeline:timeline-1",
      actionRevisionId: revisionId,
      actionRunId: "timeline-render:render-1",
    },
  };
}

describe("Local durable Timeline render workflow", () => {
  it("publishes the render output through the shared durable journal identity", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "clash-timeline-durable-"));
    const { doc, owner } = submittedTimelineRender();
    const processor = createLocalWorkflowProcessor({
      dataDir,
      timelineRenderer: {
        async render() {
          return {
            bytes: new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]),
            contentType: "video/mp4",
            width: 1920,
            height: 1080,
            durationMs: 1_000,
          };
        },
      },
    });

    await processor.process({ doc, projectId: "project-1" });

    const run = await createSqliteDurableRunJournal(dataDir).load({
      actionRunId: owner.actionRunId,
      outputSlot: "render:output",
    });
    expect(run?.failure).toBeUndefined();
    expect(run).toMatchObject({
      actionRunId: owner.actionRunId,
      outputSlot: "render:output",
      phase: "succeeded",
      projectedAt: expect.any(Number),
    });
    const outputBindings = listActionAssetBindingsForOwner(doc, owner).filter(
      (binding) => binding.direction === "output",
    );
    expect(outputBindings).toEqual([
      expect.objectContaining({
        slot: "render:output",
        projectAssetId: expect.any(String),
      }),
    ]);
    expect(listProjectAssets(doc)).toEqual([
      expect.objectContaining({
        id: outputBindings[0]!.projectAssetId,
        source: {
          kind: "owned",
          resourceId: expect.stringMatching(/^sha256:/),
        },
        provenance: {
          kind: "render",
          actionRunId: owner.actionRunId,
          model: "remotion-render",
          prompt: "Render Timeline timeline-1",
        },
      }),
    ]);
    expect(doc.getMap("nodes").get("render-1")).toMatchObject({
      data: {
        status: "completed",
        assetId: outputBindings[0]!.projectAssetId,
      },
    });
  });

  it("recovers publication after restart without invoking the renderer again", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "clash-timeline-restart-"));
    const { doc, owner } = submittedTimelineRender();
    let now = 100;
    const render = vi.fn(async () => ({
      bytes: new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]),
      contentType: "video/mp4",
    }));
    const durableProviderRuns = {
      ownerId: "local-api",
      now: () => now,
      providerPluginExecutor: vi.fn(async () => {
        throw new Error("Provider adapter must not run for Timeline render");
      }),
    };
    let checkpoints = 0;
    await createLocalWorkflowProcessor({
      dataDir,
      timelineRenderer: { render },
      durableProviderRuns,
    }).process({
      doc,
      projectId: "project-1",
      async checkpoint() {
        checkpoints += 1;
        if (checkpoints === 2) throw new Error("snapshot acknowledgement lost");
      },
    });

    const journal = createSqliteDurableRunJournal(dataDir);
    await expect(
      journal.load({
        actionRunId: owner.actionRunId,
        outputSlot: "render:output",
      }),
    ).resolves.toMatchObject({ phase: "finalizing", nextAttemptAt: 1_100 });
    expect(render).toHaveBeenCalledOnce();

    now = 1_100;
    await createLocalWorkflowProcessor({
      dataDir,
      timelineRenderer: { render },
      durableProviderRuns,
    }).process({ doc, projectId: "project-1", checkpoint: async () => {} });

    await expect(
      journal.load({
        actionRunId: owner.actionRunId,
        outputSlot: "render:output",
      }),
    ).resolves.toMatchObject({ phase: "succeeded", projectedAt: 1_100 });
    expect(render).toHaveBeenCalledOnce();
  });

  it("retries a transient Host-local renderer failure through the shared policy", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "clash-timeline-retry-"));
    const { doc, owner } = submittedTimelineRender();
    let now = 100;
    const render = vi
      .fn()
      .mockRejectedValueOnce(new Error("renderer worker exited"))
      .mockResolvedValueOnce({
        bytes: new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]),
        contentType: "video/mp4",
      });
    const durableProviderRuns = {
      ownerId: "local-api",
      now: () => now,
      providerPluginExecutor: vi.fn(async () => {
        throw new Error("Provider adapter must not run for Timeline render");
      }),
    };
    const processor = createLocalWorkflowProcessor({
      dataDir,
      timelineRenderer: { render },
      durableProviderRuns,
      providerPollDelayCapMs: 0,
    });

    await processor.process({ doc, projectId: "project-1" });
    now = 1_100;
    await processor.process({ doc, projectId: "project-1" });

    await expect(
      createSqliteDurableRunJournal(dataDir).load({
        actionRunId: owner.actionRunId,
        outputSlot: "render:output",
      }),
    ).resolves.toMatchObject({ phase: "succeeded" });
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("keeps the first CAS output when an at-least-once renderer returns different bytes", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "clash-timeline-output-cas-"));
    const staging = createLocalDurableOutputStagingStore({ dataDir });
    const firstBytes = new TextEncoder().encode("first complete render");
    const secondBytes = new TextEncoder().encode("different retry render");
    const identity = {
      projectId: "project-1",
      actionRunId: "timeline-render:render-1",
      outputSlot: "render:output",
      kind: "video" as const,
      contentType: "video/mp4",
    };

    const first = await staging.stage({ ...identity, bytes: firstBytes });
    const sameReplay = await staging.stage({ ...identity, bytes: firstBytes });
    const replay = await staging.stage({ ...identity, bytes: secondBytes });

    const expectedDigest = createHash("sha256")
      .update(firstBytes)
      .digest("hex");
    expect(sameReplay.projectAssetId).toBe(first.projectAssetId);
    expect(first.projectAssetId).toBe(replay.projectAssetId);
    expect(replay.projection.resource.digest).toEqual({
      algorithm: "sha256",
      value: expectedDigest,
    });
  });
});

describe("Local executor generation uses the shared durable graph", () => {
  it("journals local-acp text before publishing the completed node", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "clash-local-acp-durable-"));
    const doc = new LoroDoc();
    doc.getMap("nodes").set("text-1", {
      type: "text",
      data: {
        status: "pending",
        actionType: "text-gen",
        modelId: "local-acp",
        prompt: "Write a title",
      },
    });
    const generate = vi.fn(async () => ({
      text: "A durable title",
      provider: "local-acp",
      modelEndpoint: "codex-acp",
    }));

    const processor = createLocalWorkflowProcessor({
      dataDir,
      textAgent: { generate },
    });
    await processor.process({
      doc,
      projectId: "project-1",
      checkpoint: async () => {
        throw new Error("pause after the frozen journal commit");
      },
    });
    const identity = await recoverableIdentityForNode("text-1");
    await processor.process({ doc, projectId: "project-1" });

    await expect(
      createSqliteDurableRunJournal(dataDir).load(identity),
    ).resolves.toMatchObject({
      phase: "succeeded",
      projectedAt: expect.any(Number),
    });
    expect(doc.getMap("nodes").get("text-1")).toMatchObject({
      data: {
        status: "completed",
        content: "A durable title",
        provider: "local-acp",
        modelEndpoint: "codex-acp",
      },
    });
  });

  it("retries the frozen local text executor without invoking a fallback executor", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "clash-local-acp-retry-"));
    const doc = new LoroDoc();
    doc.getMap("nodes").set("text-1", {
      type: "text",
      data: {
        status: "pending",
        actionType: "text-gen",
        modelId: "local-acp",
        prompt: "Write a title",
      },
    });
    const generate = vi
      .fn()
      .mockRejectedValueOnce(new Error("local ACP result is unknown"))
      .mockResolvedValueOnce({
        text: "Recovered durable title",
        provider: "local-acp",
        modelEndpoint: "codex-acp",
      });
    const generateText = vi.fn(async () => ({
      text: "Wrong fallback title",
      provider: "fallback-provider",
      modelEndpoint: "fallback-model",
    }));
    const aigc = { ...createMockExternalAigcService(), generateText };
    let now = 100;
    const durableProviderRuns = {
      ownerId: "local-api",
      now: () => now,
      providerPluginExecutor: vi.fn(async () => {
        throw new Error("Provider adapter must not run for local-acp text");
      }),
    };
    const journal = createSqliteDurableRunJournal(dataDir);

    await createLocalWorkflowProcessor({
      dataDir,
      aigc,
      textAgent: { generate },
      durableProviderRuns,
    }).process({ doc, projectId: "project-1" });

    expect(generate).toHaveBeenCalledOnce();
    expect(generateText).not.toHaveBeenCalled();
    const identity = await recoverableIdentityForNode("text-1");
    const firstFailure = await journal.load(identity);
    expect(firstFailure).toMatchObject({
      phase: "submitting",
      failure: {
        retryable: true,
        requestState: "unknown",
      },
      nextAttemptAt: expect.any(Number),
    });

    now = firstFailure!.nextAttemptAt!;
    await createLocalWorkflowProcessor({
      dataDir,
      aigc,
      durableProviderRuns,
    }).process({ doc, projectId: "project-1" });

    expect(generateText).not.toHaveBeenCalled();
    const unavailableFailure = await journal.load(identity);
    expect(unavailableFailure).toMatchObject({
      phase: "submitting",
      failure: {
        code: "plugin_unavailable",
        retryable: true,
        requestState: "unknown",
      },
      nextAttemptAt: expect.any(Number),
    });

    now = unavailableFailure!.nextAttemptAt!;
    await createLocalWorkflowProcessor({
      dataDir,
      aigc,
      textAgent: { generate },
      durableProviderRuns,
    }).process({ doc, projectId: "project-1" });

    await expect(journal.load(identity)).resolves.toMatchObject({
      phase: "succeeded",
    });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generateText).not.toHaveBeenCalled();
    expect(doc.getMap("nodes").get("text-1")).toMatchObject({
      data: {
        status: "completed",
        content: "Recovered durable title",
        provider: "local-acp",
        modelEndpoint: "codex-acp",
      },
    });
  });

  it("journals the built-in local-tts adapter before publishing audio", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "clash-local-tts-durable-"));
    const doc = new LoroDoc();
    doc.getMap("nodes").set("audio-1", {
      type: "audio",
      data: {
        status: "pending",
        actionType: "audio-gen",
        modelId: "kokoro-82m-tts",
        prompt: "Hello",
      },
    });
    const localTts = vi.fn(async () => ({
      bytes: new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 65, 86, 69]),
      contentType: "audio/wav",
      durationMs: 500,
      provider: "local",
      modelEndpoint: "mlx-community/Kokoro-82M-4bit",
    }));
    const aigc = createMockExternalAigcService({ localTts });

    const processor = createLocalWorkflowProcessor({ dataDir, aigc });
    await processor.process({
      doc,
      projectId: "project-1",
      checkpoint: async () => {
        throw new Error("pause after the frozen journal commit");
      },
    });
    const identity = await recoverableIdentityForNode("audio-1");
    await processor.process({ doc, projectId: "project-1" });

    await expect(
      createSqliteDurableRunJournal(dataDir).load(identity),
    ).resolves.toMatchObject({
      phase: "succeeded",
      projectedAt: expect.any(Number),
    });
    expect(localTts).toHaveBeenCalledWith(
      expect.objectContaining({ model: "mlx-community/Kokoro-82M-4bit" }),
    );
    expect(doc.getMap("nodes").get("audio-1")).toMatchObject({
      data: { status: "completed", assetId: expect.any(String) },
    });
  });
});
