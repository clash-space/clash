import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LoroDoc } from "loro-crdt";

import { createMockExternalAigcService } from "./local-aigc.js";
import {
  Canvas,
  createActionAssetBinding,
  createProjectAsset,
  listActionAssetReferences,
  markActionAssetBindingAuthority,
  MODEL_CARDS,
  readActionAssetBinding,
  readProjectAsset,
  trashProjectAssetIfUnreferenced,
} from "@clash/shared-types";
import WebSocket from "ws";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  attachLocalSync,
  createHttpRemoteLoroPersistence,
  createRemoteLoroPersistenceFromEnv,
  LocalLoroRoom,
  LocalLoroRoomHub,
} from "./sync";
import { createLocalWorkflowProcessor } from "./local-processor";
import { createLocalMetadataStore } from "./local-metadata-store";
import { FileReplicaStore } from "./loro/file-replica-store";
import { createLocalResourceStore } from "./local-resource-store";
import { createLocalPluginAssetStagingStore } from "./local-plugin-asset-staging";

let dataDir = "";

function openSqlite() {
  const require = createRequire(import.meta.url);
  const { DatabaseSync } = require("node:sqlite") as {
    DatabaseSync: new (path: string) => {
      prepare(sql: string): {
        get(...params: unknown[]): Record<string, unknown> | undefined;
        all(...params: unknown[]): Array<Record<string, unknown>>;
      };
      close(): void;
    };
  };
  return new DatabaseSync(join(dataDir, "local.sqlite"));
}

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "clash-local-sync-"));
});

afterEach(async () => {
  vi.useRealTimers();
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});

function countUpdateLogRecords(log: Buffer): number {
  let count = 0;
  let offset = 0;
  while (offset < log.byteLength) {
    if (offset + 4 > log.byteLength)
      throw new Error("truncated update log header");
    const length = log.readUInt32BE(offset);
    offset += 4 + length;
    if (offset > log.byteLength) throw new Error("truncated update log record");
    count += 1;
  }
  return count;
}

function updateId(update: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of update) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return `${update.byteLength}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

describe("LocalLoroRoom", () => {
  /**
   * A generator the test names, rather than one the host falls into.
   *
   * These cases are about the room -- that a pending node is processed, that a generated path cannot
   * escape the asset store through a symlink -- and neither needs a vendor. The host no longer
   * reaches a placeholder on its own, so the stand-in has to be handed in here, where it is visible.
   */
  function testAigc() {
    return createLocalWorkflowProcessor({
      dataDir,
      aigc: createMockExternalAigcService({
        // Named here, in the test, rather than reached by default. The host refuses a route that
        // resolves to nothing, so the stand-in has to be selected like any other provider.
        providerAccounts: async () => [
          {
            id: "mock-primary",
            providerId: "mock",
            upstreamId: "mock",
            enabled: true,
          },
        ],
      }),
    });
  }

  it("drains in-flight Project work and cancels future polls when its hub closes", async () => {
    let releaseWork!: () => void;
    let notifyStarted!: () => void;
    const workStarted = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    const workGate = new Promise<void>((resolve) => {
      releaseWork = resolve;
    });
    let processCalls = 0;
    const hub = new LocalLoroRoomHub(dataDir, undefined, {
      minimumPollDelayMs: 1,
      async process() {
        processCalls += 1;
        notifyStarted();
        await workGate;
        return false;
      },
      async nextWakeAt() {
        return Date.now() + 10;
      },
    });

    const opening = hub.room("project/shutdown-drain");
    await workStarted;
    let closeResolved = false;
    const closing = hub.close().then(() => {
      closeResolved = true;
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(closeResolved).toBe(false);

    releaseWork();
    await opening;
    await closing;
    await new Promise<void>((resolve) => setTimeout(resolve, 25));

    expect(processCalls).toBe(1);
  });

  it("acknowledges a peer update after persisting it", async () => {
    const room = await LocalLoroRoom.open({
      dataDir,
      projectId: "project/sync-ack",
      workflowProcessor: null,
    });
    const sideband: Record<string, unknown>[] = [];
    const peer = room.addPeer(() => {}, {
      sendJson: (message) => sideband.push(message),
    });
    const clientDoc = new LoroDoc();
    clientDoc.getMap("nodes").set("pending-node", {
      id: "pending-node",
      type: "video",
      position: { x: 0, y: 0 },
      data: { status: "pending" },
    });

    const update = clientDoc.export({ mode: "snapshot" });
    await room.receive(peer, update);

    expect(sideband).toContainEqual({
      type: "sync_ack",
      updateId: updateId(update),
    });
    expect(
      countUpdateLogRecords(
        await readFile(
          join(
            dataDir,
            "projects",
            encodeURIComponent("project/sync-ack"),
            "loro",
            "updates.log",
          ),
        ),
      ),
    ).toBe(1);
  });

  it("restores a trashed Project Asset when a concurrent input binding arrives", async () => {
    const projectId = "project/asset-binding-race";
    const room = await LocalLoroRoom.open({
      dataDir,
      projectId,
      workflowProcessor: null,
    });
    const seedSender = room.addPeer(() => {});
    const base = new LoroDoc();
    expect(
      createProjectAsset(base, {
        id: "asset-1",
        kind: "image",
        source: { kind: "owned", resourceId: "sha256:asset-1" },
        lifecycle: { state: "active" },
        metadata: {},
      }),
    ).toMatchObject({ ok: true });
    expect(markActionAssetBindingAuthority(base)).toMatchObject({ ok: true });
    await room.receive(seedSender, base.export({ mode: "snapshot" }));

    const snapshot = base.export({ mode: "snapshot" });
    const deletingPeer = LoroDoc.fromSnapshot(snapshot);
    const bindingPeer = LoroDoc.fromSnapshot(snapshot);
    const deletingVersion = deletingPeer.version();
    const bindingVersion = bindingPeer.version();
    expect(
      trashProjectAssetIfUnreferenced(deletingPeer, {
        id: "asset-1",
        deleteOperationId: "delete-1",
        deletedAt: "2026-08-13T00:00:00.000Z",
        purgeAfter: "2026-08-20T00:00:00.000Z",
      }),
    ).toMatchObject({ ok: true });
    expect(
      createActionAssetBinding(bindingPeer, {
        id: "binding-1",
        owner: { kind: "draft", actionId: "action-1" },
        direction: "input",
        slot: "reference",
        projectAssetId: "asset-1",
        role: "reference",
      }),
    ).toMatchObject({ ok: true });

    const deletingSender = room.addPeer(() => {});
    await room.receive(
      deletingSender,
      deletingPeer.export({ mode: "update", from: deletingVersion }),
    );
    expect(
      readProjectAsset(LoroDoc.fromSnapshot(room.snapshot()), "asset-1")
        ?.lifecycle.state,
    ).toBe("trashed");

    const observerUpdates: Uint8Array[] = [];
    const observer = new LoroDoc();
    room.addPeer((update) => observerUpdates.push(update));
    observer.import(observerUpdates.shift()!);
    const bindingSender = room.addPeer(() => {});
    await room.receive(
      bindingSender,
      bindingPeer.export({ mode: "update", from: bindingVersion }),
    );
    for (const update of observerUpdates) observer.import(update);

    expect(readProjectAsset(observer, "asset-1")?.lifecycle).toEqual({
      state: "active",
    });
    expect(readActionAssetBinding(observer, "binding-1")).toMatchObject({
      projectAssetId: "asset-1",
      direction: "input",
    });
    const persisted = await new FileReplicaStore(
      join(dataDir, "projects"),
    ).recover(projectId);
    expect(readProjectAsset(persisted, "asset-1")?.lifecycle.state).toBe(
      "active",
    );
  });

  it("serializes concurrent pending-work scans so one Canvas execute submits once", async () => {
    let releaseGeneration!: () => void;
    let markStarted!: () => void;
    const generationStarted = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const generationGate = new Promise<void>((resolve) => {
      releaseGeneration = resolve;
    });
    const generateVideo = vi.fn(async () => {
      markStarted();
      await generationGate;
      return {
        bytes: new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]),
        contentType: "video/mp4",
        provider: "google",
        modelEndpoint: "gemini-omni-flash-preview",
      };
    });
    const room = await LocalLoroRoom.open({
      dataDir,
      projectId: "project/concurrent-provider-submit",
      workflowProcessor: createLocalWorkflowProcessor({
        dataDir,
        aigc: {
          generateVideo,
          generateImage: vi.fn(),
          generateAudio: vi.fn(),
          generateText: vi.fn(),
        },
      }),
    });
    const firstPeer = room.addPeer(() => {});
    const secondPeer = room.addPeer(() => {});
    const executeDoc = new LoroDoc();
    executeDoc.getMap("nodes").set("gemini-output", {
      id: "gemini-output",
      type: "video",
      position: { x: 0, y: 0 },
      data: {
        status: "pending",
        actionType: "video-gen",
        prompt: "text @[Image](node:image-ref) text",
        modelId: "gemini-omni-flash",
        duration: 3,
        aspectRatio: "16:9",
      },
    });

    const firstReceive = room.receive(
      firstPeer,
      executeDoc.export({ mode: "snapshot" }),
    );
    await generationStarted;

    const concurrentDoc = new LoroDoc();
    concurrentDoc.import(room.snapshot());
    concurrentDoc.getMap("e2e").set("heartbeat", Date.now());
    const secondReceive = room.receive(
      secondPeer,
      concurrentDoc.export({ mode: "snapshot" }),
    );
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(generateVideo).toHaveBeenCalledTimes(1);
    releaseGeneration();
    await Promise.all([firstReceive, secondReceive]);
    expect(generateVideo).toHaveBeenCalledTimes(1);
  });

  it("schedules durable recovery from the processor journal wake time, not node poll fields", async () => {
    vi.useFakeTimers();
    const now = Date.now();
    const projectId = "project/durable-provider-wake";
    const seedRoom = await LocalLoroRoom.open({
      dataDir,
      projectId,
      workflowProcessor: null,
    });
    const seedPeer = seedRoom.addPeer(() => {});
    const seed = new LoroDoc();
    seed.getMap("nodes").set("legacy-private-state", {
      id: "legacy-private-state",
      type: "video",
      position: { x: 0, y: 0 },
      data: {
        status: "generating",
        actionType: "video-gen",
        providerPollState: { taskId: "legacy-task" },
        providerPollAt: now + 100,
      },
    });
    await seedRoom.receive(seedPeer, seed.export({ mode: "snapshot" }));

    const process = vi.fn(async () => false);
    const nextWakeAt = vi
      .fn()
      .mockResolvedValueOnce(now + 5_000)
      .mockResolvedValue(undefined);
    await LocalLoroRoom.open({
      dataDir,
      projectId,
      workflowProcessor: { process, nextWakeAt },
    });
    await vi.advanceTimersByTimeAsync(4_999);

    expect(process).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(process).toHaveBeenCalledTimes(2);
    expect(nextWakeAt).toHaveBeenCalledWith(projectId);
  });

  it("flattens authored inline references only at the local provider boundary", async () => {
    const generateText = vi.fn(async () => ({
      text: "Compared",
      provider: "mock",
    }));
    const room = await LocalLoroRoom.open({
      dataDir,
      projectId: "project/local-interleaved-text",
      workflowProcessor: createLocalWorkflowProcessor({
        dataDir,
        aigc: {
          generateText,
          generateVideo: vi.fn(),
          generateImage: vi.fn(),
          generateAudio: vi.fn(),
        },
      }),
    });
    const peer = room.addPeer(() => {});
    const clientDoc = new LoroDoc();
    clientDoc.getMap("nodes").set("text-node", {
      id: "text-node",
      type: "text",
      position: { x: 0, y: 0 },
      data: {
        status: "pending",
        actionType: "text-gen",
        prompt: "Compare @[First](node:image-a), then @[Second](node:image-b).",
        modelId: "gpt-5.4",
        modelParams: {},
      },
    });

    await room.receive(peer, clientDoc.export({ mode: "snapshot" }));

    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "Compare First, then Second.",
      }),
    );
  });

  it("maps the unified H3 start/end card slots before calling the desktop provider", async () => {
    const generateVideo = vi.fn(async () => ({
      bytes: new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]),
      contentType: "video/mp4",
      provider: "minimax",
      modelEndpoint: "MiniMax-H3",
    }));
    const room = await LocalLoroRoom.open({
      dataDir,
      projectId: "project/h3-startend",
      workflowProcessor: createLocalWorkflowProcessor({
        dataDir,
        aigc: {
          generateVideo,
          generateImage: vi.fn(),
          generateAudio: vi.fn(),
          generateText: vi.fn(),
        },
      }),
    });
    const peer = room.addPeer(() => {});
    const clientDoc = new LoroDoc();
    for (const [id, originalName] of [
      ["asset-start", "start.png"],
      ["asset-end", "end.png"],
    ] as const) {
      expect(
        createProjectAsset(clientDoc, {
          id,
          kind: "image",
          source: { kind: "owned", resourceId: `sha256:${id}` },
          lifecycle: { state: "active" },
          metadata: { contentType: "image/png", originalName },
        }),
      ).toMatchObject({ ok: true });
    }
    clientDoc.getMap("nodes").set("h3-startend-node", {
      id: "h3-startend-node",
      type: "video",
      position: { x: 0, y: 0 },
      data: {
        status: "pending",
        actionType: "video-gen",
        prompt: "transition between frames",
        modelId: "minimax-h3-startend",
        referenceImageAssetIds: ["asset-start", "asset-end"],
      },
    });

    await room.receive(peer, clientDoc.export({ mode: "snapshot" }));

    expect(generateVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "minimax-h3-startend",
        references: [
          {
            slot: "startFrame",
            index: 0,
            asset: {
              assetId: "asset-start",
              uri: "clash-asset://asset-start",
              kind: "image",
              mediaType: "image/png",
            },
          },
          {
            slot: "endFrame",
            index: 0,
            asset: {
              assetId: "asset-end",
              uri: "clash-asset://asset-end",
              kind: "image",
              mediaType: "image/png",
            },
          },
        ],
      }),
    );
    expect(generateVideo).toHaveBeenCalledWith(
      expect.not.objectContaining({
        referenceImageUrls: expect.anything(),
      }),
    );
  });

  it("uses a hot-loaded plugin model Card when interpreting pending Canvas inputs", async () => {
    const generateVideo = vi.fn(async () => ({
      bytes: new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]),
      contentType: "video/mp4",
      provider: "agent-provider",
      modelEndpoint: "agent/start-end",
    }));
    const baseStartEnd = MODEL_CARDS.find(
      (model) => model.id === "minimax-h3-startend",
    )!;
    const pluginCard = {
      ...baseStartEnd,
      id: "agent-start-end",
      aliases: [],
      name: "Agent Start End",
    };
    const room = await LocalLoroRoom.open({
      dataDir,
      projectId: "project/plugin-card-startend",
      workflowProcessor: createLocalWorkflowProcessor({
        dataDir,
        modelCards: async () => [...MODEL_CARDS, pluginCard],
        aigc: {
          generateVideo,
          generateImage: vi.fn(),
          generateAudio: vi.fn(),
          generateText: vi.fn(),
        },
      }),
    });
    const peer = room.addPeer(() => {});
    const clientDoc = new LoroDoc();
    for (const [id, originalName] of [
      ["plugin-asset-start", "start.png"],
      ["plugin-asset-end", "end.png"],
    ] as const) {
      expect(
        createProjectAsset(clientDoc, {
          id,
          kind: "image",
          source: { kind: "owned", resourceId: `sha256:${id}` },
          lifecycle: { state: "active" },
          metadata: { contentType: "image/png", originalName },
        }),
      ).toMatchObject({ ok: true });
    }
    clientDoc.getMap("nodes").set("plugin-startend-node", {
      id: "plugin-startend-node",
      type: "video",
      position: { x: 0, y: 0 },
      data: {
        status: "pending",
        actionType: "video-gen",
        prompt: "transition",
        modelId: "agent-start-end",
        referenceImageAssetIds: [
          "plugin-asset-start",
          "plugin-asset-end",
        ],
      },
    });

    await room.receive(peer, clientDoc.export({ mode: "snapshot" }));

    expect(generateVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "agent-start-end",
        references: [
          {
            slot: "startFrame",
            index: 0,
            asset: {
              assetId: "plugin-asset-start",
              uri: "clash-asset://plugin-asset-start",
              kind: "image",
              mediaType: "image/png",
            },
          },
          {
            slot: "endFrame",
            index: 0,
            asset: {
              assetId: "plugin-asset-end",
              uri: "clash-asset://plugin-asset-end",
              kind: "image",
              mediaType: "image/png",
            },
          },
        ],
      }),
    );
  });

  it("executes a pinned local action plugin directly without legacy runtime registration", async () => {
    const binding = {
      pluginId: "test.agent-caption-actions",
      version: "1.2.0",
      exportId: "run-caption-helper",
      schemaHash: `sha256:${"c".repeat(64)}`,
    } as const;
    const executablePluginAction = vi.fn(async () => ({
      protocol: "clash.plugin.result/v1" as const,
      invocationId: "result-action-1",
      status: "completed" as const,
      outputs: [
        { slot: "result", kind: "value" as const, value: { text: "Done" } },
      ],
    }));
    const room = await LocalLoroRoom.open({
      dataDir,
      projectId: "project/plugin-action",
      workflowProcessor: createLocalWorkflowProcessor({
        dataDir,
        executablePluginAction,
        aigc: {
          generateVideo: vi.fn(),
          generateImage: vi.fn(),
          generateAudio: vi.fn(),
          generateText: vi.fn(),
        },
      }),
    });
    const peer = room.addPeer(() => {});
    const clientDoc = new LoroDoc();
    clientDoc.getMap("nodes").set("plugin-action-node", {
      id: "plugin-action-node",
      type: "text",
      position: { x: 0, y: 0 },
      data: {
        status: "pending",
        actionType: "custom:caption-helper",
        customActionId: "test.caption-helper",
        customActionParams: { tone: "concise" },
        outputType: "text",
        prompt: "Caption this",
        pluginBinding: binding,
        actorType: "user",
        actorUserId: "local-user",
      },
    });

    await room.receive(peer, clientDoc.export({ mode: "snapshot" }));

    expect(executablePluginAction).toHaveBeenCalledWith(
      expect.objectContaining({
        binding,
        taskId: "local-custom-plugin-action-node",
        projectId: "project/plugin-action",
        nodeId: "plugin-action-node",
        input: {
          values: { prompt: "Caption this", tone: "concise" },
          references: [],
        },
        actor: { kind: "user", id: "local-user" },
      }),
    );
    const finalDoc = new LoroDoc();
    finalDoc.import(room.snapshot());
    expect(finalDoc.getMap("nodes").get("plugin-action-node")).toMatchObject({
      data: { status: "completed", content: "Done", pluginBinding: binding },
    });
  });

  it("publishes a staged plugin output and its Action binding in the live Project replica", async () => {
    const projectId = "project/plugin-media-action";
    const taskId = "local-custom-plugin-media-node";
    const staged = await createLocalPluginAssetStagingStore({ dataDir }).stage({
      projectId,
      taskId,
      slot: "media",
      pluginId: "test.agent-image-actions",
      pluginVersion: "1.0.0",
      invocationId: "invoke-media-1",
      kind: "image",
      mediaType: "image/png",
      bytes: new Uint8Array([1, 2, 3]),
    });
    const binding = {
      pluginId: "test.agent-image-actions",
      version: "1.0.0",
      exportId: "run-image-helper",
      schemaHash: `sha256:${"d".repeat(64)}`,
    } as const;
    const executablePluginAction = vi.fn(async () => ({
      protocol: "clash.plugin.result/v1" as const,
      invocationId: "result-media-1",
      status: "completed" as const,
      outputs: [
        {
          slot: "media",
          kind: "asset" as const,
          asset: {
            assetId: staged.projectAssetId,
            uri: `clash-asset://${staged.projectAssetId}`,
            kind: "image" as const,
            mediaType: "image/png",
          },
        },
      ],
    }));
    const room = await LocalLoroRoom.open({
      dataDir,
      projectId,
      workflowProcessor: createLocalWorkflowProcessor({
        dataDir,
        executablePluginAction,
        aigc: {
          generateVideo: vi.fn(),
          generateImage: vi.fn(),
          generateAudio: vi.fn(),
          generateText: vi.fn(),
        },
      }),
    });
    const peer = room.addPeer(() => {});
    const clientDoc = new LoroDoc();
    clientDoc.getMap("nodes").set("plugin-media-node", {
      id: "plugin-media-node",
      type: "image",
      position: { x: 0, y: 0 },
      data: {
        status: "pending",
        actionType: "custom:image-helper",
        customActionId: "test.image-helper",
        outputType: "image",
        prompt: "Create this",
        pluginBinding: binding,
      },
    });

    await room.receive(peer, clientDoc.export({ mode: "snapshot" }));

    const finalDoc = new LoroDoc();
    finalDoc.import(room.snapshot());
    expect(finalDoc.getMap("nodes").get("plugin-media-node")).toMatchObject({
      data: { status: "completed", assetId: staged.projectAssetId },
    });
    expect(readProjectAsset(finalDoc, staged.projectAssetId)).toMatchObject({
      id: staged.projectAssetId,
      kind: "image",
      source: { kind: "owned", resourceId: staged.resourceId },
      lifecycle: { state: "active" },
    });
    expect(listActionAssetReferences(finalDoc, staged.projectAssetId)).toEqual([
      expect.objectContaining({
        direction: "output",
        slot: "media",
        projectAssetId: staged.projectAssetId,
        owner: expect.objectContaining({ actionRunId: taskId }),
      }),
    ]);
  });

  it("pins the exact executable provider plugin binding on the generated Canvas node", async () => {
    const authoredBinding = {
      pluginId: "clash.minimax",
      version: "0.1.0",
      exportId: "minimax-execute",
      schemaHash: `sha256:${"b".repeat(64)}`,
    } as const;
    const generateVideo = vi.fn(async () => ({
      bytes: new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]),
      contentType: "video/mp4",
      provider: "fal",
      modelEndpoint: "minimax/h3/text-to-video",
      pluginBinding: authoredBinding,
    }));
    const room = await LocalLoroRoom.open({
      dataDir,
      projectId: "project/plugin-binding",
      workflowProcessor: createLocalWorkflowProcessor({
        dataDir,
        aigc: {
          generateVideo,
          generateImage: vi.fn(),
          generateAudio: vi.fn(),
          generateText: vi.fn(),
        },
      }),
    });
    const peer = room.addPeer(() => {});
    const clientDoc = new LoroDoc();
    clientDoc.getMap("nodes").set("h3-plugin-node", {
      id: "h3-plugin-node",
      type: "video",
      position: { x: 0, y: 0 },
      data: {
        status: "pending",
        actionType: "video-gen",
        prompt: "paper city",
        modelId: "minimax-h3",
        pluginBinding: authoredBinding,
      },
    });

    await room.receive(peer, clientDoc.export({ mode: "snapshot" }));

    expect(generateVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project/plugin-binding",
        nodeId: "h3-plugin-node",
        pluginBinding: authoredBinding,
      }),
    );
    const finalDoc = new LoroDoc();
    finalDoc.import(room.snapshot());
    expect(finalDoc.getMap("nodes").get("h3-plugin-node")).toMatchObject({
      data: { pluginBinding: authoredBinding },
    });
  });

  it("carries authored H3 reference badges to the desktop provider in order", async () => {
    const generateVideo = vi.fn(async () => ({
      bytes: new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]),
      contentType: "video/mp4",
      provider: "minimax",
      modelEndpoint: "MiniMax-H3",
    }));
    const room = await LocalLoroRoom.open({
      dataDir,
      projectId: "project/h3-ordered",
      workflowProcessor: createLocalWorkflowProcessor({
        dataDir,
        aigc: {
          generateVideo,
          generateImage: vi.fn(),
          generateAudio: vi.fn(),
          generateText: vi.fn(),
        },
      }),
    });
    const peer = room.addPeer(() => {});
    const clientDoc = new LoroDoc();
    for (const asset of [
      {
        id: "asset-image",
        kind: "image" as const,
        contentType: "image/png",
        originalName: "subject.png",
      },
      {
        id: "asset-video",
        kind: "video" as const,
        contentType: "video/mp4",
        originalName: "motion.mp4",
      },
      {
        id: "asset-audio",
        kind: "audio" as const,
        contentType: "audio/mpeg",
        originalName: "ambience.mp3",
      },
    ]) {
      expect(
        createProjectAsset(clientDoc, {
          id: asset.id,
          kind: asset.kind,
          source: {
            kind: "owned",
            resourceId: `sha256:${asset.id}`,
          },
          lifecycle: { state: "active" },
          metadata: {
            contentType: asset.contentType,
            originalName: asset.originalName,
          },
        }),
      ).toMatchObject({ ok: true });
    }
    clientDoc.getMap("nodes").set("image-ref", {
      id: "image-ref",
      type: "image",
      position: { x: 0, y: 0 },
      data: { status: "completed", assetId: "asset-image" },
    });
    clientDoc.getMap("nodes").set("video-ref", {
      id: "video-ref",
      type: "video",
      position: { x: 0, y: 0 },
      data: { status: "completed", assetId: "asset-video" },
    });
    clientDoc.getMap("nodes").set("h3-ref-node", {
      id: "h3-ref-node",
      type: "video",
      position: { x: 0, y: 0 },
      data: {
        status: "pending",
        actionType: "video-gen",
        prompt:
          "Use @[Subject](node:image-ref), then @[Motion](node:video-ref).",
        modelId: "minimax-h3-ref",
        referenceImageAssetIds: ["asset-image"],
        referenceVideoAssetIds: ["asset-video"],
        referenceAudioAssetIds: ["asset-audio"],
      },
    });

    await room.receive(peer, clientDoc.export({ mode: "snapshot" }));

    expect(generateVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        references: [
          {
            slot: "content",
            index: 0,
            text: { nodeId: "h3-ref-node:prompt:0", value: "Use " },
          },
          {
            slot: "content",
            index: 1,
            asset: {
              assetId: "asset-image",
              uri: "clash-asset://asset-image",
              kind: "image",
              mediaType: "image/png",
            },
          },
          {
            slot: "content",
            index: 2,
            text: { nodeId: "h3-ref-node:prompt:2", value: ", then " },
          },
          {
            slot: "content",
            index: 3,
            asset: {
              assetId: "asset-video",
              uri: "clash-asset://asset-video",
              kind: "video",
              mediaType: "video/mp4",
            },
          },
          {
            slot: "content",
            index: 4,
            text: { nodeId: "h3-ref-node:prompt:4", value: "." },
          },
          {
            slot: "content",
            index: 5,
            asset: {
              assetId: "asset-audio",
              uri: "clash-asset://asset-audio",
              kind: "audio",
              mediaType: "audio/mpeg",
            },
          },
        ],
      }),
    );
  });

  it("broadcasts structured agent node add and update activity with its Canvas target", async () => {
    const room = await LocalLoroRoom.open({
      dataDir,
      projectId: "project/agent-follow",
      workflowProcessor: null,
    });
    const browserSideband: Record<string, unknown>[] = [];
    const agent = room.addPeer(() => {}, {
      presence: {
        id: "agent-peer",
        clientType: "agent",
        userId: "local-user",
        name: "Codex",
      },
    });
    room.addPeer(() => {}, {
      presence: {
        id: "browser-peer",
        clientType: "browser",
        userId: "local-user",
        name: "Local User",
      },
      sendJson: (message) => browserSideband.push(message),
    });
    browserSideband.length = 0;

    const agentDoc = new LoroDoc();
    agentDoc.getMap("nodes").set("agent-shot", {
      canvasId: "storyboard",
      type: "image",
      data: { label: "Agent shot" },
      position: { x: 900, y: 400 },
    });

    await room.receive(agent, agentDoc.export({ mode: "snapshot" }));

    expect(browserSideband).toContainEqual({
      type: "activity",
      actor: { clientType: "agent", name: "Codex" },
      action: "added",
      nodeId: "agent-shot",
      nodeType: "image",
      label: "Agent shot",
      canvasId: "storyboard",
      timestamp: expect.any(Number),
    });

    browserSideband.length = 0;
    const updateFrom = agentDoc.version();
    agentDoc.getMap("nodes").set("agent-shot", {
      canvasId: "storyboard",
      type: "image",
      data: { label: "Agent shot revised" },
      position: { x: 1100, y: 520 },
    });
    await room.receive(
      agent,
      agentDoc.export({ mode: "update", from: updateFrom }),
    );

    expect(browserSideband).toContainEqual({
      type: "activity",
      actor: { clientType: "agent", name: "Codex" },
      action: "updated",
      nodeId: "agent-shot",
      nodeType: "image",
      label: "Agent shot revised",
      canvasId: "storyboard",
      timestamp: expect.any(Number),
    });
  });

  it("persists and broadcasts graph repair updates after importing an orphan edge", async () => {
    const projectId = "project/orphan-repair";
    const room = await LocalLoroRoom.open({
      dataDir,
      projectId,
      workflowProcessor: null,
    });
    const sender = room.addPeer(() => {});
    const peerUpdates: Uint8Array[] = [];
    room.addPeer((update) => peerUpdates.push(update));
    peerUpdates.length = 0;

    const clientDoc = new LoroDoc();
    clientDoc
      .getMap("nodes")
      .set("target", { canvasId: "main", type: "image_gen", data: {} });
    clientDoc
      .getMap("nodeUpstreams")
      .ensureMergeableMap("target")
      .set("orphan", {
        nodeId: "missing-source",
        edgeId: "orphan",
        type: "default",
      });
    clientDoc.getMap("edgeIdentity").set("orphan", { target: "target" });

    await room.receive(sender, clientDoc.export({ mode: "snapshot" }));

    expect(peerUpdates).toHaveLength(2);
    const peerDoc = new LoroDoc();
    for (const update of peerUpdates) peerDoc.import(update);
    expect(new Canvas(peerDoc, () => {}, "main").listEdges()).toEqual([]);
    expect(peerDoc.getMap("edgeIdentity").get("orphan")).toEqual({
      deleted: true,
    });

    const reopened = await LocalLoroRoom.open({
      dataDir,
      projectId,
      workflowProcessor: null,
    });
    const persisted = new LoroDoc();
    persisted.import(reopened.snapshot());
    expect(new Canvas(persisted, () => {}, "main").listEdges()).toEqual([]);
    expect(persisted.getMap("edgeIdentity").get("orphan")).toEqual({
      deleted: true,
    });
  });

  it("rejects legacy custom-action registration sideband messages", async () => {
    const room = await LocalLoroRoom.open({
      dataDir,
      projectId: "project/custom-register",
      workflowProcessor: null,
    });
    const sideband: Record<string, unknown>[] = [];
    const peer = room.addPeer(() => {}, {
      runtimeId: "runtime-1",
      sendJson: (message) => sideband.push(message),
    });

    await room.receiveJson(peer, {
      type: "register_custom_actions",
      actions: [
        {
          id: "grid-split",
          name: "Grid Split",
          outputType: "image",
          promptModalities: ["text", "image"],
        },
      ],
    });

    expect(sideband).toContainEqual({
      type: "register_custom_actions.rejected",
      code: "LEGACY_CUSTOM_ACTION_PROTOCOL_RETIRED",
      error:
        "Legacy ClashAgent custom-action transport is retired; install a clash.plugin/v1 executable plugin.",
    });
    const doc = new LoroDoc();
    doc.import(room.snapshot());
    expect(doc.getMap("customActions").get("grid-split")).toBeUndefined();
  });

  it("fails legacy custom-action nodes without dispatching sideband work", async () => {
    const room = await LocalLoroRoom.open({
      dataDir,
      projectId: "project/custom-dispatch",
      workflowProcessor: testAigc(),
    });
    const sideband: Record<string, unknown>[] = [];
    const peer = room.addPeer(() => {}, {
      runtimeId: "runtime-1",
      sendJson: (msg) => sideband.push(msg),
    });

    const clientDoc = new LoroDoc();
    clientDoc.getMap("nodes").set("custom-child", {
      id: "custom-child",
      type: "image",
      position: { x: 0, y: 0 },
      data: {
        status: "pending",
        actionType: "custom:grid-split",
        customActionId: "grid-split",
        outputType: "image",
        customActionParams: { grid_size: "2x2" },
        actorType: "user",
        actorUserId: "local-user",
      },
    });

    await room.receive(peer, clientDoc.export({ mode: "snapshot" }));

    expect(sideband).not.toContainEqual(
      expect.objectContaining({ type: "custom_task_assigned" }),
    );

    const doc = new LoroDoc();
    doc.import(room.snapshot());
    expect((doc.getMap("nodes").get("custom-child") as any).data).toMatchObject(
      {
        status: "failed",
        failureCode: "LEGACY_CUSTOM_ACTION_PROTOCOL_RETIRED",
        error:
          "Legacy custom action grid-split has no executable plugin binding. Install a clash.plugin/v1 plugin and recreate the Action.",
      },
    );
    expect(doc.getMap("tasks").size).toBe(0);
  });

  it("imports a client update, broadcasts it to peers, and persists a snapshot", async () => {
    const room = await LocalLoroRoom.open({
      dataDir,
      projectId: "project/one",
    });
    const peerA: Uint8Array[] = [];
    const peerB: Uint8Array[] = [];
    const a = room.addPeer((data) => peerA.push(data));
    room.addPeer((data) => peerB.push(data));
    peerA.length = 0;
    peerB.length = 0;

    const clientDoc = new LoroDoc();
    clientDoc
      .getMap("nodes")
      .set("node-1", { type: "text", data: { label: "Local" } });
    const update = clientDoc.export({ mode: "snapshot" });

    await room.receive(a, update);

    expect(peerB).toHaveLength(1);
    const peerDoc = new LoroDoc();
    peerDoc.import(peerB[0]);
    expect((peerDoc.getMap("nodes").get("node-1") as any).data.label).toBe(
      "Local",
    );

    const reopened = await LocalLoroRoom.open({
      dataDir,
      projectId: "project/one",
    });
    const snapshot = reopened.snapshot();
    const persisted = new LoroDoc();
    persisted.import(snapshot);
    expect((persisted.getMap("nodes").get("node-1") as any).data.label).toBe(
      "Local",
    );
  });

  it("does not invent a workflow processor for a bare CRDT room", async () => {
    const room = await LocalLoroRoom.open({
      dataDir,
      projectId: "project/crdt-only",
    });
    const peer = room.addPeer(() => {});
    const clientDoc = new LoroDoc();
    clientDoc.getMap("nodes").set("pending-image", {
      id: "pending-image",
      type: "image",
      position: { x: 0, y: 0 },
      data: {
        status: "pending",
        actionType: "image-gen",
        prompt: "must remain pending",
        modelId: "gemini-3.1-flash-image",
      },
    });

    await room.receive(peer, clientDoc.export({ mode: "snapshot" }));

    const finalDoc = new LoroDoc();
    finalDoc.import(room.snapshot());
    expect((finalDoc.getMap("nodes").get("pending-image") as any).data).toMatchObject({
      status: "pending",
      prompt: "must remain pending",
    });
  });

  it("processes pending image generation nodes through the local mock fal service", async () => {
    const room = await LocalLoroRoom.open({
      dataDir,
      projectId: "project/local-gen",
      workflowProcessor: testAigc(),
    });
    const peerUpdates: Uint8Array[] = [];
    const peer = room.addPeer((data) => peerUpdates.push(data));
    peerUpdates.length = 0;

    const clientDoc = new LoroDoc();
    clientDoc.getMap("nodes").set("image-node-1", {
      id: "image-node-1",
      type: "image",
      position: { x: 0, y: 0 },
      data: {
        status: "pending",
        actionType: "image-gen",
        prompt: "小狗一只",
        modelId: "gemini-3.1-flash-image",
        modelParams: { aspect_ratio: "16:9" },
        actorType: "user",
        actorUserId: "local-user",
      },
    });

    await room.receive(peer, clientDoc.export({ mode: "snapshot" }));

    const finalDoc = new LoroDoc();
    finalDoc.import(room.snapshot());
    const imageNode = finalDoc.getMap("nodes").get("image-node-1") as any;
    expect(imageNode.data.status).toBe("completed");
    expect(imageNode.data.assetId).toMatch(/^local-asset-/);
    expect(imageNode.data.pendingTask).toBeUndefined();

    const asset = readProjectAsset(finalDoc, imageNode.data.assetId);
    expect(asset).toMatchObject({
      id: imageNode.data.assetId,
      kind: "image",
      source: { kind: "owned", resourceId: expect.stringMatching(/^sha256:/) },
      metadata: { contentType: "image/svg+xml", bytes: expect.any(Number) },
      provenance: {
        kind: "generation",
        actionRunId: expect.stringMatching(/^fal-mock-/),
        model: expect.stringContaining("fal-ai/"),
        prompt: "小狗一只",
      },
    });
    const projection = await createLocalResourceStore({ dataDir }).resolve(
      asset!.source.resourceId,
    );
    const generated = await readFile(projection!.path, "utf8");
    expect(generated).toContain("小狗一只");
    expect(generated).toContain("Mock fal");
    expect(peerUpdates.length).toBeGreaterThan(0);
  });

  it("renders pending Timeline video nodes through the local backend renderer", async () => {
    const importedAt = Math.floor(Date.now() / 1000);
    await mkdir(join(dataDir, "assets", "uploads"), { recursive: true });
    await writeFile(
      join(dataDir, "assets", "uploads", "music.wav"),
      "music bytes",
    );
    const metadata = createLocalMetadataStore(dataDir);
    const legacy = await metadata.load();
    legacy.assets.push({
      id: "music-asset-1",
      userId: "local-user",
      kind: "audio",
      srcR2Key: "uploads/music.wav",
      coverR2Key: null,
      metadata: { contentType: "audio/wav", durationMs: 2000 },
      sourceModel: null,
      sourcePrompt: null,
      sourceTaskId: null,
      sources: null,
      signedUrl: "http://127.0.0.1:49431/assets/uploads/music.wav",
      signedUrlExp: importedAt + 3600,
      createdAt: importedAt,
      updatedAt: importedAt,
      projectId: "project/local-render",
    });
    legacy.assetRefs.push({
      assetId: "music-asset-1",
      projectId: "project/local-render",
      importedAt,
    });
    await metadata.save(legacy, {
      replaceLegacyAssetMigrationInput: true,
    });
    const renderTimeline = vi.fn(async () => ({
      bytes: new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]),
      contentType: "video/mp4",
      width: 1920,
      height: 1080,
      durationMs: 2000,
    }));
    const room = await LocalLoroRoom.open({
      dataDir,
      projectId: "project/local-render",
      workflowProcessor: createLocalWorkflowProcessor({
        dataDir,
        mediaBaseUrl: "http://127.0.0.1:49321",
        timelineRenderer: { render: renderTimeline },
      } as any),
    });
    const peer = room.addPeer(() => {});
    const clientDoc = new LoroDoc();
    clientDoc.getMap("nodes").set("render-node-1", {
      canvasId: "main",
      type: "video",
      position: { x: 0, y: 0 },
      data: {
        status: "pending",
        actorType: "user",
        actorUserId: "local-user",
        timelineDsl: {
          compositionWidth: 1920,
          compositionHeight: 1080,
          fps: 30,
          durationInFrames: 60,
          tracks: [
            {
              id: "music",
              role: "music",
              items: [
                {
                  id: "music-1",
                  type: "audio",
                  from: 0,
                  durationInFrames: 60,
                  assetId: "music-asset-1",
                  audioDucking: {
                    amountDb: -18,
                    attackFrames: 6,
                    releaseFrames: 12,
                  },
                },
              ],
            },
          ],
        },
      },
    });

    await room.receive(peer, clientDoc.export({ mode: "snapshot" }));

    expect(renderTimeline).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project/local-render",
        taskId: "local-render-render-node-1",
        timelineDsl: expect.objectContaining({
          durationInFrames: 60,
          tracks: [
            expect.objectContaining({
              items: [
                expect.objectContaining({
                  src: "http://127.0.0.1:49321/api/v1/projects/project%2Flocal-render/assets/music-asset-1/media",
                  audioDucking: {
                    amountDb: -18,
                    attackFrames: 6,
                    releaseFrames: 12,
                  },
                }),
              ],
            }),
          ],
        }),
      }),
    );
    const finalDoc = new LoroDoc();
    finalDoc.import(room.snapshot());
    expect(finalDoc.getMap("nodes").get("render-node-1")).toMatchObject({
      data: {
        status: "completed",
        assetId: "local-asset-local-render-render-node-1",
      },
    });
  });

  it("rejects generated asset writes when the generated storage parent escapes through a symlink", async () => {
    const outsideDir = await mkdtemp(
      join(tmpdir(), "clash-local-sync-outside-generated-"),
    );
    try {
      await mkdir(join(dataDir, "assets"), { recursive: true });
      await symlink(outsideDir, join(dataDir, "assets", "blobs"));
      const room = await LocalLoroRoom.open({
        dataDir,
        projectId: "project/local-gen-symlink",
        workflowProcessor: testAigc(),
      });
      const peer = room.addPeer(() => {});

      const clientDoc = new LoroDoc();
      clientDoc.getMap("nodes").set("image-node-symlink", {
        id: "image-node-symlink",
        type: "image",
        position: { x: 0, y: 0 },
        data: {
          status: "pending",
          actionType: "image-gen",
          prompt: "must not escape",
          modelId: "gemini-3.1-flash-image",
        },
      });

      await room.receive(peer, clientDoc.export({ mode: "snapshot" }));

      const finalDoc = new LoroDoc();
      finalDoc.import(room.snapshot());
      const imageNode = finalDoc
        .getMap("nodes")
        .get("image-node-symlink") as any;
      expect(imageNode.data.status).toBe("failed");
      expect(imageNode.data.assetId).toBeUndefined();
      expect(imageNode.data.error).toBe(
        "Asset path escapes local asset storage",
      );
      await expect(readdir(outsideDir)).resolves.toEqual([]);
      const sqlite = openSqlite();
      try {
        expect(
          sqlite.prepare("select count(*) as count from local_resources").get(),
        ).toEqual({ count: 0 });
      } finally {
        sqlite.close();
      }
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("processes pending video and audio generation nodes with media-aware mock outputs", async () => {
    const room = await LocalLoroRoom.open({
      dataDir,
      projectId: "project/local-media-gen",
      workflowProcessor: testAigc(),
    });
    const peer = room.addPeer(() => {});

    const clientDoc = new LoroDoc();
    clientDoc.getMap("nodes").set("video-node-1", {
      id: "video-node-1",
      type: "video",
      position: { x: 0, y: 0 },
      data: {
        status: "pending",
        actionType: "video-gen",
        prompt: "竖屏小狗视频",
        modelId: "sora-2",
        modelParams: { aspect_ratio: "9:16", duration: 4 },
        aspectRatio: "9:16",
        duration: 4,
      },
    });
    clientDoc.getMap("nodes").set("audio-node-1", {
      id: "audio-node-1",
      type: "audio",
      position: { x: 0, y: 360 },
      data: {
        status: "pending",
        actionType: "audio-gen",
        prompt: "这是一段三秒 mock 音频",
        modelId: "gemini-3.1-flash-tts",
        modelParams: { duration: 3 },
      },
    });

    await room.receive(peer, clientDoc.export({ mode: "snapshot" }));

    const finalDoc = new LoroDoc();
    finalDoc.import(room.snapshot());
    const videoNode = finalDoc.getMap("nodes").get("video-node-1") as any;
    const audioNode = finalDoc.getMap("nodes").get("audio-node-1") as any;
    expect(videoNode.data.status).toBe("completed");
    expect(audioNode.data.status).toBe("completed");
    expect(videoNode.data.assetId).toMatch(/^local-asset-/);
    expect(audioNode.data.assetId).toMatch(/^local-asset-/);

    const videoAsset = readProjectAsset(finalDoc, videoNode.data.assetId);
    const audioAsset = readProjectAsset(finalDoc, audioNode.data.assetId);
    expect(videoAsset).toMatchObject({
      kind: "video",
      provenance: {
        kind: "generation",
        prompt: "竖屏小狗视频",
        actionRunId: expect.stringMatching(/^fal-mock-/),
        model: expect.stringContaining("fal-ai/"),
      },
      metadata: {
        width: 720,
        height: 1280,
        durationMs: 4000,
        contentType: "video/mp4",
      },
    });
    expect(audioAsset).toMatchObject({
      kind: "audio",
      provenance: {
        kind: "generation",
        prompt: "这是一段三秒 mock 音频",
        actionRunId: expect.stringMatching(/^fal-mock-/),
      },
      metadata: {
        durationMs: 3000,
        contentType: "audio/wav",
        waveform: expect.any(Array),
      },
    });
    expect(audioAsset!.metadata.waveform).toHaveLength(128);
    const audioProjection = await createLocalResourceStore({ dataDir }).resolve(
      audioAsset!.source.resourceId,
    );
    const audioBytes = await readFile(audioProjection!.path, "utf8");
    expect(audioBytes).toContain("这是一段三秒 mock 音频");
  });

  it("processes pending text generation nodes in place", async () => {
    const room = await LocalLoroRoom.open({
      dataDir,
      projectId: "project/local-text-gen",
      workflowProcessor: testAigc(),
    });
    const peer = room.addPeer(() => {});

    const clientDoc = new LoroDoc();
    clientDoc.getMap("nodes").set("text-node-1", {
      id: "text-node-1",
      type: "text",
      position: { x: 0, y: 0 },
      data: {
        status: "pending",
        actionType: "text-gen",
        prompt: "Write three title options",
        modelId: "gpt-5.4",
        modelParams: {},
      },
    });

    await room.receive(peer, clientDoc.export({ mode: "snapshot" }));

    const finalDoc = new LoroDoc();
    finalDoc.import(room.snapshot());
    const textNode = finalDoc.getMap("nodes").get("text-node-1") as any;
    expect(textNode.data.status).toBe("completed");
    expect(textNode.data.content).toContain("Generated text (gpt-5.4)");
    expect(textNode.data.content).toContain("Write three title options");
    expect(textNode.data.assetId).toBeUndefined();
    expect(textNode.data.pendingTask).toBeUndefined();

    const metadataStore = createLocalMetadataStore(dataDir);
    const loaded = await metadataStore.load();
    expect(loaded.assets).toHaveLength(0);
    const revisions = await metadataStore.listTextRevisions({
      projectId: "project/local-text-gen",
      nodeId: "text-node-1",
    });
    expect(revisions).toHaveLength(1);
    const revision = revisions[0]!;
    expect(revision).toMatchObject({
      textId: "text:project/local-text-gen:text-node-1",
      projectId: "project/local-text-gen",
      nodeId: "text-node-1",
      hashAlgorithm: "sha256-64",
      sourceFilePath: "workflow/text-node-1.md",
    });
    expect(revision.revisionId).toEqual(
      expect.stringMatching(/^txrev-[a-f0-9]{16}-/),
    );
    expect(revision.contentHash).toBe(revision.sourceFileHash);
    const revisionBodyPath = join(
      dataDir,
      "text-revision-blobs",
      revision.contentHash.slice(0, 2),
      `${revision.contentHash}.md`,
    );
    expect(await readFile(revisionBodyPath, "utf8")).toBe(
      textNode.data.content,
    );
    expect((await stat(revisionBodyPath)).mode & 0o222).toBe(0);
    const audits = await metadataStore.listMutationAudit({
      operation: "text_generate",
      entityId: revision.revisionId,
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      operation: "text_generate",
      entity: { kind: "text-revision", id: revision.revisionId },
      actorClientType: null,
      accepted: true,
      reason: "workflow generated text",
      resultEntityId: revision.revisionId,
    });
    expect(audits[0]?.mutation).toMatchObject({
      operation: "text_generate",
      entity: { kind: "text-revision", id: revision.revisionId },
      accepted: true,
      resultEntityId: revision.revisionId,
    });
    expect(audits[0]?.mutation.expectedReadToken).toBeUndefined();
    expect(audits[0]?.mutation.beforeReadToken).toBeUndefined();
    expect(audits[0]?.mutation.afterReadToken).toBeUndefined();
  });

  it("processes pending local-agent text generation nodes through a local text agent", async () => {
    const generate = vi.fn(async ({ prompt, modelParams }) => ({
      text: `agent generated: ${prompt} (${String(modelParams?.acp_model ?? "")})`,
      provider: "local-acp",
      modelEndpoint: "codex-acp",
    }));
    const room = await LocalLoroRoom.open({
      dataDir,
      projectId: "project/local-agent-text-gen",
      workflowProcessor: createLocalWorkflowProcessor({
        dataDir,
        textAgent: { generate },
      }),
    });
    const peer = room.addPeer(() => {});

    const clientDoc = new LoroDoc();
    clientDoc.getMap("nodes").set("text-node-agent", {
      id: "text-node-agent",
      type: "text",
      position: { x: 0, y: 0 },
      data: {
        status: "pending",
        actionType: "text-gen",
        prompt: "Write three title options",
        modelId: "local-acp",
        modelParams: { acp_model: "gpt-5.4" },
      },
    });

    await room.receive(peer, clientDoc.export({ mode: "snapshot" }));

    const finalDoc = new LoroDoc();
    finalDoc.import(room.snapshot());
    const textNode = finalDoc.getMap("nodes").get("text-node-agent") as any;
    expect(textNode.data).toMatchObject({
      status: "completed",
      content: "agent generated: Write three title options (gpt-5.4)",
      provider: "local-acp",
      modelEndpoint: "codex-acp",
    });
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: "local-acp",
        modelParams: { acp_model: "gpt-5.4" },
      }),
    );
  });

  it("mirrors received updates to optional remote persistence", async () => {
    const appendUpdate = vi.fn(
      async (_projectId: string, _update: Uint8Array) => {},
    );
    const room = await LocalLoroRoom.open({
      dataDir,
      projectId: "project/remote",
      remotePersistence: { appendUpdate },
      workflowProcessor: null,
    });
    const peer = room.addPeer(() => {});

    const clientDoc = new LoroDoc();
    clientDoc
      .getMap("nodes")
      .set("node-remote", { type: "text", data: { label: "Mirror" } });
    const update = clientDoc.export({ mode: "snapshot" });

    await room.receive(peer, update);

    expect(appendUpdate).toHaveBeenCalledTimes(1);
    expect(appendUpdate).toHaveBeenCalledWith(
      "project/remote",
      expect.any(Uint8Array),
    );
    expect(Array.from(appendUpdate.mock.calls[0][1])).toEqual(
      Array.from(update),
    );
  });

  it("resolves remote persistence dynamically for later mirrored updates", async () => {
    const appendUpdate = vi.fn(
      async (_projectId: string, _update: Uint8Array) => {},
    );
    let remotePersistence:
      | { appendUpdate(projectId: string, update: Uint8Array): Promise<void> }
      | undefined;
    const room = await LocalLoroRoom.open({
      dataDir,
      projectId: "project/dynamic-remote",
      remotePersistence: () => remotePersistence,
      workflowProcessor: null,
    });
    const peer = room.addPeer(() => {});

    const firstDoc = new LoroDoc();
    firstDoc
      .getMap("nodes")
      .set("node-local-only", { type: "text", data: { label: "Local only" } });
    await room.receive(peer, firstDoc.export({ mode: "snapshot" }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(appendUpdate).not.toHaveBeenCalled();

    remotePersistence = { appendUpdate };
    const secondDoc = new LoroDoc();
    secondDoc
      .getMap("nodes")
      .set("node-cloud-sync", { type: "text", data: { label: "Cloud sync" } });
    const secondUpdate = secondDoc.export({ mode: "snapshot" });
    await room.receive(peer, secondUpdate);
    await vi.waitFor(() => expect(appendUpdate).toHaveBeenCalledTimes(1));
    expect(appendUpdate).toHaveBeenCalledWith(
      "project/dynamic-remote",
      expect.any(Uint8Array),
    );
  });

  it("keeps local persistence and peer broadcast when remote persistence fails", async () => {
    const appendUpdate = vi.fn(
      async (_projectId: string, _update: Uint8Array) => {
        throw new Error("remote unavailable");
      },
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const room = await LocalLoroRoom.open({
      dataDir,
      projectId: "project/offline",
      remotePersistence: { appendUpdate },
    });
    const peerA: Uint8Array[] = [];
    const peerB: Uint8Array[] = [];
    const a = room.addPeer((data) => peerA.push(data));
    room.addPeer((data) => peerB.push(data));
    peerA.length = 0;
    peerB.length = 0;

    const clientDoc = new LoroDoc();
    clientDoc
      .getMap("nodes")
      .set("node-local", { type: "text", data: { label: "Offline" } });
    const update = clientDoc.export({ mode: "snapshot" });

    await room.receive(a, update);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(peerB).toHaveLength(1);
    const reopened = await LocalLoroRoom.open({
      dataDir,
      projectId: "project/offline",
    });
    const persisted = new LoroDoc();
    persisted.import(reopened.snapshot());
    expect(
      (persisted.getMap("nodes").get("node-local") as any).data.label,
    ).toBe("Offline");
    expect(errorSpy).toHaveBeenCalledWith(
      "[local-sync] failed to mirror update to remote persistence",
      expect.any(Error),
    );
  });

  it("imports remote snapshots on open and writes the merged state locally", async () => {
    const remoteDoc = new LoroDoc();
    remoteDoc
      .getMap("nodes")
      .set("node-cloud", { type: "text", data: { label: "Cloud" } });
    const room = await LocalLoroRoom.open({
      dataDir,
      projectId: "project/hybrid",
      remotePersistence: {
        loadSnapshot: vi.fn(async () => remoteDoc.export({ mode: "snapshot" })),
        appendUpdate: vi.fn(
          async (_projectId: string, _update: Uint8Array) => {},
        ),
      },
    });

    const opened = new LoroDoc();
    opened.import(room.snapshot());
    expect((opened.getMap("nodes").get("node-cloud") as any).data.label).toBe(
      "Cloud",
    );

    const reopened = await LocalLoroRoom.open({
      dataDir,
      projectId: "project/hybrid",
    });
    const persisted = new LoroDoc();
    persisted.import(reopened.snapshot());
    expect(
      (persisted.getMap("nodes").get("node-cloud") as any).data.label,
    ).toBe("Cloud");
  });

  it("periodically compacts local update log records instead of keeping one record per edit", async () => {
    const projectId = "project/compact-log";
    const room = await LocalLoroRoom.open({
      dataDir,
      projectId,
      workflowProcessor: null,
    });
    const peer = room.addPeer(() => {});

    for (let i = 0; i < 40; i += 1) {
      const clientDoc = new LoroDoc();
      clientDoc
        .getMap("nodes")
        .set(`node-${i}`, { type: "text", data: { label: `Edit ${i}` } });
      await room.receive(peer, clientDoc.export({ mode: "snapshot" }));
    }

    const logPath = join(
      dataDir,
      "projects",
      encodeURIComponent(projectId),
      "loro",
      "updates.log",
    );
    const log = await readFile(logPath);
    expect(countUpdateLogRecords(log)).toBeLessThan(40);

    const reopened = await LocalLoroRoom.open({
      dataDir,
      projectId,
      workflowProcessor: null,
    });
    const persisted = new LoroDoc();
    persisted.import(reopened.snapshot());
    expect((persisted.getMap("nodes").get("node-0") as any).data.label).toBe(
      "Edit 0",
    );
    expect((persisted.getMap("nodes").get("node-39") as any).data.label).toBe(
      "Edit 39",
    );
  });
});

describe("attachLocalSync", () => {
  it("broadcasts local agent presence and structured Canvas activity", async () => {
    const server = createServer();
    attachLocalSync(server, { dataDir });

    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const port = (server.address() as { port: number }).port;
    const browser = new WebSocket(
      `ws://127.0.0.1:${port}/sync/${encodeURIComponent("project/presence")}`,
    );
    const agent = new WebSocket(
      `ws://127.0.0.1:${port}/sync/${encodeURIComponent("project/presence")}`,
      {
        headers: {
          "x-client-type": "agent",
          "x-agent-name": "Mock ACP",
        },
      },
    );
    const browserPresence: any[] = [];
    const browserActivity: any[] = [];

    browser.on("message", (data, isBinary) => {
      if (isBinary) return;
      const msg = JSON.parse(String(data));
      if (msg.type === "presence") browserPresence.push(msg);
      if (msg.type === "activity") browserActivity.push(msg);
    });

    await Promise.all([
      new Promise<void>((resolve, reject) => {
        browser.once("open", resolve);
        browser.once("error", reject);
      }),
      new Promise<void>((resolve, reject) => {
        agent.once("open", resolve);
        agent.once("error", reject);
      }),
    ]);

    await vi.waitFor(() => {
      expect(browserPresence.at(-1)?.clients).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            clientType: "browser",
            userId: "local-user",
            name: "Local User",
          }),
          expect.objectContaining({
            clientType: "agent",
            userId: "local-user",
            name: "Mock ACP",
          }),
        ]),
      );
    });

    const agentDoc = new LoroDoc();
    agentDoc.getMap("nodes").set("ws-agent-shot", {
      canvasId: "shot-board",
      type: "image",
      data: { label: "WebSocket agent shot" },
      position: { x: 400, y: 200 },
    });
    agent.send(agentDoc.export({ mode: "snapshot" }));

    await vi.waitFor(() => {
      expect(browserActivity).toContainEqual({
        type: "activity",
        actor: { clientType: "agent", name: "Mock ACP" },
        action: "added",
        nodeId: "ws-agent-shot",
        nodeType: "image",
        label: "WebSocket agent shot",
        canvasId: "shot-board",
        timestamp: expect.any(Number),
      });
    });

    await closeWebSocket(agent);

    await vi.waitFor(() => {
      const clients = browserPresence.at(-1)?.clients ?? [];
      expect(clients).toEqual([
        expect.objectContaining({
          clientType: "browser",
          userId: "local-user",
        }),
      ]);
    });

    await closeWebSocket(browser);
    await closeServer(server);
  });

  it("ignores text sideband messages instead of importing them as Loro updates", async () => {
    const server = createServer();
    attachLocalSync(server, { dataDir });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const port = (server.address() as { port: number }).port;
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/sync/${encodeURIComponent("project/one")}`,
    );

    await new Promise<void>((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });

    ws.send(JSON.stringify({ type: "activity", clientId: "client-1" }));
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(errorSpy).not.toHaveBeenCalledWith(
      "[local-sync] failed to import update",
      expect.anything(),
    );

    await closeWebSocket(ws);
    await closeServer(server);
  });
});

describe("createHttpRemoteLoroPersistence", () => {
  it("loads remote snapshots over HTTP with optional bearer auth", async () => {
    const fetchImpl = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        expect(String(input)).toBe(
          "https://remote.example/loro/project%2Fone/snapshot",
        );
        expect(init?.method).toBe("GET");
        expect(init?.headers).toMatchObject({ authorization: "Bearer secret" });
        return new Response(new Uint8Array([1, 2, 3]));
      },
    );
    const persistence = createHttpRemoteLoroPersistence({
      baseUrl: "https://remote.example/",
      token: "secret",
      fetch: fetchImpl,
    });

    await expect(persistence.loadSnapshot?.("project/one")).resolves.toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });

  it("treats missing remote snapshots as empty state", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 404 }));
    const persistence = createHttpRemoteLoroPersistence({
      baseUrl: "https://remote.example",
      fetch: fetchImpl,
    });

    await expect(persistence.loadSnapshot?.("missing")).resolves.toBeNull();
  });

  it("appends exact update bytes over HTTP", async () => {
    let postedBody: BodyInit | null = null;
    const fetchImpl = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        expect(String(input)).toBe(
          "https://remote.example/loro/project%2Fone/updates",
        );
        expect(init?.method).toBe("POST");
        expect(init?.headers).toMatchObject({
          "content-type": "application/octet-stream",
        });
        postedBody = init?.body ?? null;
        return new Response(null, { status: 204 });
      },
    );
    const persistence = createHttpRemoteLoroPersistence({
      baseUrl: "https://remote.example",
      fetch: fetchImpl,
    });
    const arena = new Uint8Array([0, 9, 8, 7, 0]);

    await persistence.appendUpdate("project/one", arena.subarray(1, 4));

    expect(postedBody).toBeInstanceOf(ArrayBuffer);
    const postedBuffer = postedBody as unknown as ArrayBuffer;
    expect(Array.from(new Uint8Array(postedBuffer))).toEqual([9, 8, 7]);
  });
});

describe("createRemoteLoroPersistenceFromEnv", () => {
  it("leaves remote persistence disabled when no remote URL is configured", () => {
    expect(createRemoteLoroPersistenceFromEnv({})).toBeUndefined();
  });

  it("creates an HTTP persistence adapter from environment configuration", async () => {
    const fetchImpl = vi.fn(async (_input: string, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({
        authorization: "Bearer env-token",
      });
      return new Response(null, { status: 204 });
    });
    const persistence = createRemoteLoroPersistenceFromEnv(
      {
        CLASH_REMOTE_LORO_URL: "https://remote.example/",
        CLASH_REMOTE_LORO_TOKEN: "env-token",
      },
      fetchImpl,
    );

    expect(persistence).toBeDefined();
    await persistence?.appendUpdate("project/one", new Uint8Array([1]));
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://remote.example/loro/project%2Fone/updates",
      expect.objectContaining({ method: "POST" }),
    );
  });
});

async function closeWebSocket(ws: WebSocket): Promise<void> {
  if (ws.readyState === WebSocket.CLOSED) return;
  await new Promise<void>((resolve) => {
    ws.once("close", resolve);
    ws.close();
  });
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
