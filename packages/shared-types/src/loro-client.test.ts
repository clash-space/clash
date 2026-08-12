import { LoroDoc } from "loro-crdt";
import { describe, expect, it } from "vitest";
import { LoroSyncClient } from "./loro-client.js";
import { MODEL_CARDS } from "./models.js";

class CapturingWebSocket {
  static instances: CapturingWebSocket[] = [];

  readonly readyState = 1;
  readonly bufferedAmount = 0;
  binaryType = "";
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  sent: unknown[] = [];

  constructor(
    readonly url: string,
    readonly protocols: unknown,
    readonly options: { headers?: Record<string, string> },
  ) {
    CapturingWebSocket.instances.push(this);
  }

  send(data: unknown) {
    this.sent.push(data);
  }
  close(code = 1000, reason = "closed") {
    this.onclose?.({ code, reason });
  }
}

function updateId(update: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of update) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return `${update.byteLength}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

describe("LoroSyncClient", () => {
  it("passes the host effective model catalogue to every Canvas scope", () => {
    const pluginCard = {
      ...MODEL_CARDS.find((card) => card.kind === "image")!,
      id: "plugin-only-image",
      aliases: [],
      name: "Plugin Only Image",
    };
    const client = new LoroSyncClient({
      serverUrl: "http://127.0.0.1",
      projectId: "project-effective-models",
      doc: new LoroDoc(),
      modelCards: [pluginCard],
    });
    client.createNode("badge", "image_gen", {
      content: "A lit workshop",
      modelId: pluginCard.id,
    });

    expect(client.canvas.execute("badge", () => "asset-1").error).toBeNull();
  });

  it("waits for a local server acknowledgement before flushing an update", async () => {
    CapturingWebSocket.instances = [];
    const client = new LoroSyncClient({
      serverUrl: "ws://127.0.0.1:49321",
      projectId: "project-sync-ack",
      token: "local-test-key",
      WebSocket: CapturingWebSocket as never,
    });

    const source = new LoroSyncClient({
      serverUrl: "wss://example.invalid",
      projectId: "project-sync-ack",
      WebSocket: CapturingWebSocket as never,
    });
    source.createNode("existing-node", "text", { content: "Existing" });

    const connected = client.connect();
    const socket = CapturingWebSocket.instances[0];
    socket.onmessage?.({ data: source.doc.export({ mode: "snapshot" }) });
    await connected;

    client.createNode("pending-node", "video", { status: "pending" });
    const sentUpdates = socket.sent.filter((sent): sent is Uint8Array => sent instanceof Uint8Array);
    expect(sentUpdates).toHaveLength(1);
    let flushed = false;
    const flush = client.flush().then(() => { flushed = true; });
    await Promise.resolve();

    expect(flushed).toBe(false);
    socket.onmessage?.({ data: JSON.stringify({ type: "sync_ack", updateId: "wrong-update" }) });
    await new Promise((resolve) => setTimeout(resolve, 75));
    expect(flushed).toBe(false);
    socket.onmessage?.({
      data: JSON.stringify({ type: "sync_ack", updateId: updateId(sentUpdates[0]) }),
    });
    await flush;
    expect(flushed).toBe(true);
  });

  it("scopes multiple Canvas clients over the same Project replica", () => {
    const client = new LoroSyncClient({
      serverUrl: "ws://127.0.0.1:49321",
      projectId: "project-multi-canvas",
      token: "local-test-key",
      WebSocket: CapturingWebSocket as never,
    });

    expect((client as any).canvasFor).toBeTypeOf("function");
    expect((client as any).selectCanvas).toBeTypeOf("function");
    const main = (client as any).canvasFor("main");
    expect((client as any).createCanvas({ id: "shots", name: "Shots" }).ok).toBe(true);
    const shots = (client as any).canvasFor("shots");
    main.createNode("main-node", "text", { content: "Main" });
    shots.createNode("shots-node", "image", { assetId: "asset-1" });

    expect(main.listNodes().map((node: any) => node.id)).toEqual(["main-node"]);
    expect(shots.listNodes().map((node: any) => node.id)).toEqual(["shots-node"]);
    (client as any).selectCanvas("shots");
    expect(client.canvas.listNodes().map((node) => node.id)).toEqual(["shots-node"]);
  });

  it("does not create a Canvas by selecting an unknown id", () => {
    const client = new LoroSyncClient({
      serverUrl: "ws://127.0.0.1:49321",
      projectId: "project-no-implicit-canvas",
      token: "local-test-key",
      WebSocket: CapturingWebSocket as never,
    });
    client.createNode("main-node", "text", { content: "Main" });

    expect(() => (client as any).selectCanvas("typo")).toThrow("Canvas typo not found");
    expect((client as any).listCanvases().map((canvas: any) => canvas.id)).toEqual(["main"]);
  });

  it("exposes Project Canvas and Timeline registry operations for CLI clients", () => {
    const client = new LoroSyncClient({
      serverUrl: "ws://127.0.0.1:49321",
      projectId: "project-registry",
      token: "local-test-key",
      WebSocket: CapturingWebSocket as never,
    });
    client.createNode("bootstrap", "text", { content: "Bootstrap" });

    expect((client as any).listCanvases()).toEqual([
      { id: "main", name: "Main", position: 0 },
    ]);
    expect((client as any).createCanvas({ id: "shots", name: "Shots" }).ok).toBe(true);
    expect((client as any).listCanvases().map((canvas: any) => canvas.id)).toEqual(["main", "shots"]);

    expect((client as any).createTimeline({
      id: "timeline-1",
      name: "Episode 1",
      state: { tracks: [] },
    }).ok).toBe(true);
    expect((client as any).attachTimeline({
      timelineId: "timeline-1",
      canvasId: "main",
      actionNodeId: "timeline-action-1",
      position: { x: 0, y: 0 },
    }).ok).toBe(true);
    expect((client as any).listTimelines()).toEqual([
      expect.objectContaining({
        id: "timeline-1",
        owner: { kind: "canvas-action", canvasId: "main", actionNodeId: "timeline-action-1" },
      }),
    ]);
  });

  it("exposes Project Director Stage registry operations for agent clients", () => {
    const client = new LoroSyncClient({
      serverUrl: "ws://127.0.0.1:49321",
      projectId: "project-director-stage",
      token: "local-test-key",
      WebSocket: CapturingWebSocket as never,
    });
    client.createNode("bootstrap", "text", { content: "Bootstrap" });

    expect((client as any).createDirectorStage).toBeTypeOf("function");
    expect((client as any).listDirectorStages).toBeTypeOf("function");
    expect((client as any).updateDirectorStageState).toBeTypeOf("function");
    expect((client as any).attachDirectorStage).toBeTypeOf("function");
    expect((client as any).detachDirectorStage).toBeTypeOf("function");

    const state = {
      schemaVersion: 1,
      scene: {
        backgroundColor: "#171816",
        grid: { visible: true, snap: false, size: 1 },
      },
      objects: [],
      cameras: [],
      shots: [],
    };
    expect((client as any).createDirectorStage({
      id: "stage-1",
      name: "Blocking",
      state,
    })).toMatchObject({ ok: true, stage: { id: "stage-1" } });
    expect((client as any).attachDirectorStage({
      stageId: "stage-1",
      canvasId: "main",
      actionNodeId: "director-stage-action-1",
      position: { x: 0, y: 0 },
    })).toMatchObject({
      ok: true,
      stage: {
        owner: {
          kind: "canvas-action",
          canvasId: "main",
          actionNodeId: "director-stage-action-1",
        },
      },
    });
    expect((client as any).listDirectorStages()).toEqual([
      expect.objectContaining({ id: "stage-1" }),
    ]);
    expect((client as any).detachDirectorStage("stage-1")).toMatchObject({
      ok: true,
      stage: { owner: { kind: "project" } },
    });
  });

  it("sends agent surrogate presence headers when the caller is a spawned agent", async () => {
    CapturingWebSocket.instances = [];

    const client = new LoroSyncClient({
      serverUrl: "ws://127.0.0.1:49321",
      projectId: "project-agent",
      token: "local-test-key",
      clientType: "agent",
      userId: "local-user",
      agentName: "local-director",
      WebSocket: CapturingWebSocket as never,
    });

    const connected = client.connect();
    const socket = CapturingWebSocket.instances[0];
    expect(socket.options.headers).toMatchObject({
      authorization: "Bearer local-test-key",
      "x-client-type": "agent",
      "x-user-id": "local-user",
      "x-agent-name": "local-director",
    });
    expect(socket.url).not.toContain("local-test-key");
    expect(new URL(socket.url).searchParams.has("token")).toBe(false);

    const snapshot = new LoroDoc().export({ mode: "snapshot" });
    socket.onmessage?.({ data: snapshot });
    await connected;
  });

  it("reconciles orphan graph identities when importing a Project snapshot", async () => {
    CapturingWebSocket.instances = [];
    const source = new LoroSyncClient({
      serverUrl: "ws://127.0.0.1:49321",
      projectId: "project-graph-reconcile",
      token: "local-test-key",
      WebSocket: CapturingWebSocket as never,
    });
    source.createNode("source", "text", {});
    source.createNode("target", "image_gen", {});
    source.canvas.insertEdge("orphan", "source", "target");
    source.doc.getMap("nodes").delete("source");

    const target = new LoroSyncClient({
      serverUrl: "ws://127.0.0.1:49321",
      projectId: "project-graph-reconcile",
      token: "local-test-key",
      WebSocket: CapturingWebSocket as never,
    });
    const connected = target.connect();
    CapturingWebSocket.instances.at(-1)?.onmessage?.({
      data: source.doc.export({ mode: "snapshot" }),
    });
    await connected;

    expect(target.doc.getMap("edgeIdentity").get("orphan")).toEqual({ deleted: true });
  });

  it("does not echo a repair for post-connect remote imports owned by the host", async () => {
    CapturingWebSocket.instances = [];
    const client = new LoroSyncClient({
      serverUrl: "ws://127.0.0.1:49321",
      projectId: "project-host-repair",
      token: "local-test-key",
      WebSocket: CapturingWebSocket as never,
    });
    const connected = client.connect();
    const socket = CapturingWebSocket.instances[0];
    socket.onmessage?.({ data: new LoroDoc().export({ mode: "snapshot" }) });
    await connected;
    const sentBeforeRemoteImport = socket.sent.length;

    const remote = new LoroDoc();
    remote.getMap("nodes").set("target", { canvasId: "main", type: "image_gen", data: {} });
    remote.getMap("nodeUpstreams").ensureMergeableMap("target").set("orphan", {
      nodeId: "missing-source",
      edgeId: "orphan",
      type: "default",
    });
    remote.getMap("edgeIdentity").set("orphan", { target: "target" });
    socket.onmessage?.({ data: remote.export({ mode: "snapshot" }) });

    expect(socket.sent).toHaveLength(sentBeforeRemoteImport);
    expect(client.canvas.listEdges()).toEqual([]);
    expect(client.doc.getMap("edgeIdentity").get("orphan")).toEqual({ target: "target" });
  });
});
