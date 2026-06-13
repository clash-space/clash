import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LoroDoc } from "loro-crdt";
import WebSocket from "ws";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  attachLocalSync,
  createHttpRemoteLoroPersistence,
  createRemoteLoroPersistenceFromEnv,
  LocalLoroRoom,
} from "./sync";

let dataDir = "";

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "clash-local-sync-"));
});

afterEach(async () => {
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});

describe("LocalLoroRoom", () => {
  it("registers local custom actions from JSON sideband messages", async () => {
    const room = await LocalLoroRoom.open({
      dataDir,
      projectId: "project/custom-register",
      workflowProcessor: null,
    });
    const peer = room.addPeer(() => {}, { runtimeId: "runtime-1", sendJson: () => {} });

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

    const doc = new LoroDoc();
    doc.import(room.snapshot());
    expect(doc.getMap("customActions").get("grid-split")).toMatchObject({
      id: "grid-split",
      name: "Grid Split",
      registeredByRuntime: "runtime-1",
    });
  });

  it("dispatches pending local custom action nodes over JSON sideband", async () => {
    const room = await LocalLoroRoom.open({ dataDir, projectId: "project/custom-dispatch" });
    const sideband: Record<string, unknown>[] = [];
    const peer = room.addPeer(() => {}, {
      runtimeId: "runtime-1",
      sendJson: (msg) => sideband.push(msg),
    });

    await room.receiveJson(peer, {
      type: "register_custom_actions",
      actions: [{ id: "grid-split", name: "Grid Split", outputType: "image" }],
    });
    sideband.length = 0;

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

    const assigned = sideband.find((msg) => msg.type === "custom_task_assigned") as any;
    expect(assigned?.task).toMatchObject({
      nodeId: "custom-child",
      customActionId: "grid-split",
      params: { grid_size: "2x2" },
      status: "waiting_for_agent",
    });

    const doc = new LoroDoc();
    doc.import(room.snapshot());
    expect((doc.getMap("nodes").get("custom-child") as any).data.status).toBe("generating");
    expect(doc.getMap("tasks").get(assigned.task.taskId)).toMatchObject({
      customActionId: "grid-split",
      registeredByRuntime: "runtime-1",
    });
  });

  it("imports a client update, broadcasts it to peers, and persists a snapshot", async () => {
    const room = await LocalLoroRoom.open({ dataDir, projectId: "project/one" });
    const peerA: Uint8Array[] = [];
    const peerB: Uint8Array[] = [];
    const a = room.addPeer((data) => peerA.push(data));
    room.addPeer((data) => peerB.push(data));
    peerA.length = 0;
    peerB.length = 0;

    const clientDoc = new LoroDoc();
    clientDoc.getMap("nodes").set("node-1", { type: "text", data: { label: "Local" } });
    const update = clientDoc.export({ mode: "snapshot" });

    await room.receive(a, update);

    expect(peerB).toHaveLength(1);
    const peerDoc = new LoroDoc();
    peerDoc.import(peerB[0]);
    expect((peerDoc.getMap("nodes").get("node-1") as any).data.label).toBe("Local");

    const reopened = await LocalLoroRoom.open({ dataDir, projectId: "project/one" });
    const snapshot = reopened.snapshot();
    const persisted = new LoroDoc();
    persisted.import(snapshot);
    expect((persisted.getMap("nodes").get("node-1") as any).data.label).toBe("Local");
  });

  it("processes pending image generation nodes through the local mock fal service", async () => {
    const room = await LocalLoroRoom.open({ dataDir, projectId: "project/local-gen" });
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
        modelId: "gemini-flash-image-2",
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

    const db = JSON.parse(await readFile(join(dataDir, "db.json"), "utf8"));
    expect(db.assets).toHaveLength(1);
    expect(db.assets[0]).toMatchObject({
      id: imageNode.data.assetId,
      kind: "image",
      sourceModel: "gemini-flash-image-2",
      sourcePrompt: "小狗一只",
      sourceTaskId: expect.stringMatching(/^fal-mock-/),
      metadata: expect.objectContaining({
        provider: "fal-mock",
        requestId: expect.stringMatching(/^fal-mock-/),
        modelEndpoint: expect.stringContaining("fal-ai/"),
      }),
    });
    expect(db.assetRefs).toEqual([
      expect.objectContaining({
        assetId: imageNode.data.assetId,
        projectId: "project/local-gen",
      }),
    ]);

    const generated = await readFile(join(dataDir, "assets", db.assets[0].srcR2Key), "utf8");
    expect(generated).toContain("小狗一只");
    expect(generated).toContain("Mock fal");
    expect(peerUpdates.length).toBeGreaterThan(0);
  });

  it("processes pending video and audio generation nodes with media-aware mock outputs", async () => {
    const room = await LocalLoroRoom.open({ dataDir, projectId: "project/local-media-gen" });
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

    const db = JSON.parse(await readFile(join(dataDir, "db.json"), "utf8"));
    const videoAsset = db.assets.find((asset: any) => asset.id === videoNode.data.assetId);
    const audioAsset = db.assets.find((asset: any) => asset.id === audioNode.data.assetId);
    expect(videoAsset).toMatchObject({
      kind: "video",
      sourcePrompt: "竖屏小狗视频",
      sourceTaskId: expect.stringMatching(/^fal-mock-/),
      metadata: expect.objectContaining({
        provider: "fal-mock",
        width: 720,
        height: 1280,
        durationMs: 4000,
        contentType: "video/mp4",
        modelEndpoint: expect.stringContaining("fal-ai/"),
        mockText: "竖屏小狗视频",
      }),
    });
    expect(audioAsset).toMatchObject({
      kind: "audio",
      sourcePrompt: "这是一段三秒 mock 音频",
      sourceTaskId: expect.stringMatching(/^fal-mock-/),
      metadata: expect.objectContaining({
        provider: "fal-mock",
        durationMs: 3000,
        contentType: "audio/wav",
        transcript: "这是一段三秒 mock 音频",
      }),
    });
    expect(audioAsset.metadata.waveform).toHaveLength(128);

    const audioBytes = await readFile(join(dataDir, "assets", audioAsset.srcR2Key), "utf8");
    expect(audioBytes).toContain("这是一段三秒 mock 音频");
  });

  it("mirrors received updates to optional remote persistence", async () => {
    const appendUpdate = vi.fn(async (_projectId: string, _update: Uint8Array) => {});
    const room = await LocalLoroRoom.open({
      dataDir,
      projectId: "project/remote",
      remotePersistence: { appendUpdate },
    });
    const peer = room.addPeer(() => {});

    const clientDoc = new LoroDoc();
    clientDoc.getMap("nodes").set("node-remote", { type: "text", data: { label: "Mirror" } });
    const update = clientDoc.export({ mode: "snapshot" });

    await room.receive(peer, update);

    expect(appendUpdate).toHaveBeenCalledTimes(1);
    expect(appendUpdate).toHaveBeenCalledWith("project/remote", expect.any(Uint8Array));
    expect(Array.from(appendUpdate.mock.calls[0][1])).toEqual(Array.from(update));
  });

  it("resolves remote persistence dynamically for later mirrored updates", async () => {
    const appendUpdate = vi.fn(async (_projectId: string, _update: Uint8Array) => {});
    let remotePersistence: { appendUpdate(projectId: string, update: Uint8Array): Promise<void> } | undefined;
    const room = await LocalLoroRoom.open({
      dataDir,
      projectId: "project/dynamic-remote",
      remotePersistence: () => remotePersistence,
      workflowProcessor: null,
    });
    const peer = room.addPeer(() => {});

    const firstDoc = new LoroDoc();
    firstDoc.getMap("nodes").set("node-local-only", { type: "text", data: { label: "Local only" } });
    await room.receive(peer, firstDoc.export({ mode: "snapshot" }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(appendUpdate).not.toHaveBeenCalled();

    remotePersistence = { appendUpdate };
    const secondDoc = new LoroDoc();
    secondDoc.getMap("nodes").set("node-cloud-sync", { type: "text", data: { label: "Cloud sync" } });
    const secondUpdate = secondDoc.export({ mode: "snapshot" });
    await room.receive(peer, secondUpdate);
    await vi.waitFor(() => expect(appendUpdate).toHaveBeenCalledTimes(1));
    expect(appendUpdate).toHaveBeenCalledWith("project/dynamic-remote", expect.any(Uint8Array));
  });

  it("keeps local persistence and peer broadcast when remote persistence fails", async () => {
    const appendUpdate = vi.fn(async (_projectId: string, _update: Uint8Array) => {
      throw new Error("remote unavailable");
    });
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
    clientDoc.getMap("nodes").set("node-local", { type: "text", data: { label: "Offline" } });
    const update = clientDoc.export({ mode: "snapshot" });

    await room.receive(a, update);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(peerB).toHaveLength(1);
    const reopened = await LocalLoroRoom.open({ dataDir, projectId: "project/offline" });
    const persisted = new LoroDoc();
    persisted.import(reopened.snapshot());
    expect((persisted.getMap("nodes").get("node-local") as any).data.label).toBe("Offline");
    expect(errorSpy).toHaveBeenCalledWith(
      "[local-sync] failed to mirror update to remote persistence",
      expect.any(Error),
    );
  });

  it("imports remote snapshots on open and writes the merged state locally", async () => {
    const remoteDoc = new LoroDoc();
    remoteDoc.getMap("nodes").set("node-cloud", { type: "text", data: { label: "Cloud" } });
    const room = await LocalLoroRoom.open({
      dataDir,
      projectId: "project/hybrid",
      remotePersistence: {
        loadSnapshot: vi.fn(async () => remoteDoc.export({ mode: "snapshot" })),
        appendUpdate: vi.fn(async (_projectId: string, _update: Uint8Array) => {}),
      },
    });

    const opened = new LoroDoc();
    opened.import(room.snapshot());
    expect((opened.getMap("nodes").get("node-cloud") as any).data.label).toBe("Cloud");

    const reopened = await LocalLoroRoom.open({ dataDir, projectId: "project/hybrid" });
    const persisted = new LoroDoc();
    persisted.import(reopened.snapshot());
    expect((persisted.getMap("nodes").get("node-cloud") as any).data.label).toBe("Cloud");
  });
});

describe("attachLocalSync", () => {
  it("broadcasts local agent presence as the local user's surrogate", async () => {
    const server = createServer();
    attachLocalSync(server, { dataDir });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    const browser = new WebSocket(`ws://127.0.0.1:${port}/sync/${encodeURIComponent("project/presence")}`);
    const agent = new WebSocket(`ws://127.0.0.1:${port}/sync/${encodeURIComponent("project/presence")}`, {
      headers: {
        "x-client-type": "agent",
        "x-agent-name": "Mock ACP",
      },
    });
    const browserPresence: any[] = [];

    browser.on("message", (data, isBinary) => {
      if (isBinary) return;
      const msg = JSON.parse(String(data));
      if (msg.type === "presence") browserPresence.push(msg);
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

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/sync/${encodeURIComponent("project/one")}`);

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
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("https://remote.example/loro/project%2Fone/snapshot");
      expect(init?.method).toBe("GET");
      expect(init?.headers).toMatchObject({ authorization: "Bearer secret" });
      return new Response(new Uint8Array([1, 2, 3]));
    });
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
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("https://remote.example/loro/project%2Fone/updates");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({ "content-type": "application/octet-stream" });
      postedBody = init?.body ?? null;
      return new Response(null, { status: 204 });
    });
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
      expect(init?.headers).toMatchObject({ authorization: "Bearer env-token" });
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
