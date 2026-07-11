import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { LoroDoc } from "loro-crdt";
import {
  Canvas,
  canvasGraphReconciliationChanged,
  CustomActionDefinitionSchema,
  reconcileCanvasGraph,
  reconcileProjectTimelineOwnership,
  type ClientType,
  type PresenceClient,
} from "@clash/shared-types";
import { WebSocketServer, type WebSocket } from "ws";
import { FileReplicaStore } from "./loro/file-replica-store.js";
import { createLocalWorkflowProcessor, type LocalWorkflowProcessor } from "./local-processor.js";

type UpgradeCapableServer = {
  on(event: "upgrade", listener: (request: any, socket: any, head: any) => void): void;
};

export interface LocalSyncOptions {
  dataDir: string;
  projectId: string;
  remotePersistence?: RemoteLoroPersistenceSource;
  workflowProcessor?: LocalWorkflowProcessor | null;
}

export interface RemoteLoroPersistence {
  loadSnapshot?(projectId: string): Promise<Uint8Array | null>;
  appendUpdate(projectId: string, update: Uint8Array): Promise<void>;
}

export type RemoteLoroPersistenceSource =
  | RemoteLoroPersistence
  | (() => RemoteLoroPersistence | undefined | Promise<RemoteLoroPersistence | undefined>);

type PeerId = symbol;
type SendPeerUpdate = (data: Uint8Array) => void;
type SendPeerJson = (msg: Record<string, unknown>) => void;
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
const LOCAL_LORO_COMPACT_UPDATE_THRESHOLD = 16;
const LOCAL_LORO_COMPACT_BYTES_THRESHOLD = 1024 * 1024;

interface LocalPeer {
  sendUpdate: SendPeerUpdate;
  sendJson?: SendPeerJson;
  runtimeId?: string;
  presence?: PresenceClient;
}

export interface HttpRemoteLoroPersistenceOptions {
  baseUrl: string;
  token?: string;
  fetch?: FetchLike;
}

export interface RemoteLoroPersistenceEnv {
  CLASH_REMOTE_LORO_URL?: string;
  CLASH_REMOTE_LORO_TOKEN?: string;
}

function exactBytes(view: Uint8Array): Uint8Array {
  return view.byteOffset === 0 && view.byteLength === view.buffer.byteLength
    ? view
    : view.slice();
}

function exactArrayBuffer(view: Uint8Array): ArrayBuffer {
  const bytes = exactBytes(view);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function remoteProjectUrl(baseUrl: string, projectId: string, suffix: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/loro/${encodeURIComponent(projectId)}/${suffix}`;
}

function remoteHeaders(token: string | undefined, extra?: Record<string, string>) {
  return {
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

async function assertRemoteOk(response: Response, operation: string): Promise<void> {
  if (response.ok) return;
  throw new Error(`Remote Loro ${operation} failed with HTTP ${response.status}`);
}

async function resolveRemotePersistence(
  source: RemoteLoroPersistenceSource | undefined,
): Promise<RemoteLoroPersistence | undefined> {
  if (!source) return undefined;
  if (typeof source === "function") return source();
  return source;
}

export function createHttpRemoteLoroPersistence(
  options: HttpRemoteLoroPersistenceOptions,
): RemoteLoroPersistence {
  const fetchImpl = options.fetch ?? fetch;
  return {
    async loadSnapshot(projectId) {
      const response = await fetchImpl(remoteProjectUrl(options.baseUrl, projectId, "snapshot"), {
        method: "GET",
        headers: remoteHeaders(options.token),
      });
      if (response.status === 404 || response.status === 204) return null;
      await assertRemoteOk(response, "snapshot load");
      return new Uint8Array(await response.arrayBuffer());
    },
    async appendUpdate(projectId, update) {
      const response = await fetchImpl(remoteProjectUrl(options.baseUrl, projectId, "updates"), {
        method: "POST",
        headers: remoteHeaders(options.token, {
          "content-type": "application/octet-stream",
        }),
        body: exactArrayBuffer(update),
      });
      await assertRemoteOk(response, "update append");
    },
  };
}

export function createRemoteLoroPersistenceFromEnv(
  env: RemoteLoroPersistenceEnv,
  fetchImpl?: FetchLike,
): RemoteLoroPersistence | undefined {
  const baseUrl = env.CLASH_REMOTE_LORO_URL?.trim();
  if (!baseUrl) return undefined;
  return createHttpRemoteLoroPersistence({
    baseUrl,
    token: env.CLASH_REMOTE_LORO_TOKEN?.trim() || undefined,
    fetch: fetchImpl,
  });
}

async function loadDoc(options: LocalSyncOptions): Promise<{
  doc: LoroDoc;
  store: FileReplicaStore;
  importedRemoteSnapshot: boolean;
  workspaceRepaired: boolean;
}> {
  const store = new FileReplicaStore(join(options.dataDir, "projects"));
  let doc: LoroDoc;
  try {
    doc = await store.recover(options.projectId);
  } catch (error) {
    console.error("[local-sync] failed to recover local replica", error);
    doc = new LoroDoc();
  }

  let importedRemoteSnapshot = false;
  const remotePersistence = await resolveRemotePersistence(options.remotePersistence);
  if (remotePersistence?.loadSnapshot) {
    try {
      const remoteSnapshot = await remotePersistence.loadSnapshot(options.projectId);
      if (remoteSnapshot?.byteLength) {
        doc.import(remoteSnapshot);
        importedRemoteSnapshot = true;
      }
    } catch (error) {
      console.error("[local-sync] failed to import remote snapshot", error);
    }
  }

  const graphRepair = reconcileCanvasGraph(doc);
  const timelineRepair = reconcileProjectTimelineOwnership(doc);
  const workspaceRepaired = canvasGraphReconciliationChanged(graphRepair) ||
    timelineRepair.removedActionNodeIds.length > 0 ||
    timelineRepair.detachedTimelineIds.length > 0;

  return { doc, store, importedRemoteSnapshot, workspaceRepaired };
}

export class LocalLoroRoom {
  private peers = new Map<PeerId, LocalPeer>();
  private updatesSinceSnapshot = 0;
  private updateBytesSinceSnapshot = 0;

  private constructor(
    private readonly projectId: string,
    private readonly doc: LoroDoc,
    private readonly store: FileReplicaStore,
    private readonly remotePersistence?: RemoteLoroPersistenceSource,
    private readonly workflowProcessor?: LocalWorkflowProcessor,
  ) {}

  static async open(options: LocalSyncOptions): Promise<LocalLoroRoom> {
    const loaded = await loadDoc(options);
    const workflowProcessor = options.workflowProcessor === undefined
      ? createLocalWorkflowProcessor({ dataDir: options.dataDir })
      : options.workflowProcessor ?? undefined;
    const room = new LocalLoroRoom(
      options.projectId,
      loaded.doc,
      loaded.store,
      options.remotePersistence,
      workflowProcessor,
    );
    if (loaded.importedRemoteSnapshot || loaded.workspaceRepaired) await room.saveSnapshot();
    await room.processPendingWork();
    return room;
  }

  snapshot(): Uint8Array {
    return this.doc.export({ mode: "snapshot" });
  }

  addPeer(send: SendPeerUpdate, options?: { sendJson?: SendPeerJson; runtimeId?: string; presence?: PresenceClient }): PeerId {
    const id = Symbol("peer");
    this.peers.set(id, {
      sendUpdate: send,
      sendJson: options?.sendJson,
      runtimeId: options?.runtimeId,
      presence: options?.presence,
    });
    send(this.snapshot());
    this.broadcastPresence();
    return id;
  }

  removePeer(id: PeerId): void {
    this.peers.delete(id);
    this.broadcastPresence();
  }

  async receive(sender: PeerId, update: Uint8Array): Promise<void> {
    const updateBytes = exactBytes(update);
    this.doc.import(updateBytes);
    const repairVersion = this.doc.version();
    const graphRepair = reconcileCanvasGraph(this.doc);
    const timelineRepair = reconcileProjectTimelineOwnership(this.doc);
    const workspaceRepaired = canvasGraphReconciliationChanged(graphRepair) ||
      timelineRepair.removedActionNodeIds.length > 0 ||
      timelineRepair.detachedTimelineIds.length > 0;
    const repairUpdate = workspaceRepaired
      ? exactBytes(this.doc.export({ mode: "update", from: repairVersion }))
      : null;
    await this.persistUpdate(updateBytes);
    for (const [peerId, peer] of this.peers.entries()) {
      if (peerId !== sender) peer.sendUpdate(updateBytes);
    }
    this.mirrorRemoteUpdate(updateBytes);
    if (repairUpdate?.byteLength) {
      await this.persistUpdate(repairUpdate);
      for (const peer of this.peers.values()) peer.sendUpdate(repairUpdate);
      this.mirrorRemoteUpdate(repairUpdate);
    }
    await this.processPendingWork();
  }

  async receiveJson(sender: PeerId, msg: Record<string, any>): Promise<void> {
    if (msg.type === "register_custom_actions") {
      const peer = this.peers.get(sender);
      const runtimeId = peer?.runtimeId;
      const actions = Array.isArray(msg.actions) ? msg.actions as Array<Record<string, any>> : [];
      const wantsLocalRuntime = actions.some((action) => (action?.runtime || "local") !== "worker");
      if (wantsLocalRuntime && !runtimeId) {
        peer?.sendJson?.({
          type: "register_custom_actions.rejected",
          error: "missing_runtime_id",
        });
        return;
      }
      const versionBefore = this.doc.version();
      const actionsMap = this.doc.getMap("customActions");
      for (const action of actions) {
        const parsed = CustomActionDefinitionSchema.safeParse(action);
        if (!parsed.success) continue;
        const def = parsed.data;
        const storedDef: Record<string, unknown> = {
          id: def.id,
          name: def.name,
          description: def.description || "",
          parameters: def.parameters || [],
          outputType: def.outputType || "image",
          icon: def.icon || "",
          color: def.color || "",
          runtime: def.runtime || "local",
          version: def.version || "",
          author: def.author || "",
          repository: def.repository || "",
          workerUrl: def.workerUrl || "",
          secrets: def.secrets || [],
          tags: def.tags || [],
          promptModalities: def.promptModalities,
        };
        const model = (def as typeof def & { model?: unknown }).model;
        if (model) storedDef.model = model;
        if (def.runtime === "local" && runtimeId) storedDef.registeredByRuntime = runtimeId;
        actionsMap.set(def.id, storedDef);
      }
      await this.publishUpdate(versionBefore);

      const registeredIds = new Set(actions.map((action) => action.id).filter(Boolean));
      const tasksMap = this.doc.getMap("tasks");
      for (const [, raw] of tasksMap.entries()) {
        const task = raw as Record<string, any>;
        if (task?.status !== "waiting_for_agent") continue;
        if (!registeredIds.has(task.customActionId)) continue;
        if (task.registeredByRuntime && task.registeredByRuntime !== runtimeId) continue;
        peer?.sendJson?.({ type: "custom_task_assigned", task });
      }
      return;
    }

    if (msg.type === "unregister_custom_actions") {
      const actionIds = Array.isArray(msg.actionIds)
        ? msg.actionIds.filter((id: unknown): id is string => typeof id === "string" && id.length > 0)
        : [];
      if (!actionIds.length) return;
      const versionBefore = this.doc.version();
      const actionsMap = this.doc.getMap("customActions");
      for (const id of actionIds) actionsMap.delete(id);
      await this.publishUpdate(versionBefore);
      return;
    }

    if (msg.type === "complete_custom_task") {
      await this.completeCustomTask(msg);
    }
  }

  private async saveSnapshot(): Promise<void> {
    await this.store.compactSnapshot(this.projectId, this.snapshot(), this.doc.version());
    this.updatesSinceSnapshot = 0;
    this.updateBytesSinceSnapshot = 0;
  }

  private async persistUpdate(update: Uint8Array): Promise<void> {
    await this.store.appendUpdate(this.projectId, update);
    this.updatesSinceSnapshot += 1;
    this.updateBytesSinceSnapshot += update.byteLength;
    if (
      this.updatesSinceSnapshot >= LOCAL_LORO_COMPACT_UPDATE_THRESHOLD ||
      this.updateBytesSinceSnapshot >= LOCAL_LORO_COMPACT_BYTES_THRESHOLD
    ) {
      await this.saveSnapshot();
    }
  }

  private async processPendingWork(): Promise<void> {
    if (!this.workflowProcessor) return;
    const versionBefore = this.doc.version();
    const sideband: Record<string, unknown>[] = [];
    const changed = await this.workflowProcessor.process({
      doc: this.doc,
      projectId: this.projectId,
      broadcastJson: (msg) => sideband.push(msg),
    });
    if (!changed) return;
    const update = exactBytes(this.doc.export({ mode: "update", from: versionBefore }));
    await this.persistUpdate(update);
    for (const peer of this.peers.values()) {
      peer.sendUpdate(update);
    }
    this.mirrorRemoteUpdate(update);
    for (const msg of sideband) this.broadcastJson(msg);
  }

  private async publishUpdate(versionBefore: unknown): Promise<void> {
    const update = exactBytes(this.doc.export({ mode: "update", from: versionBefore as never }));
    await this.persistUpdate(update);
    for (const peer of this.peers.values()) {
      peer.sendUpdate(update);
    }
    this.mirrorRemoteUpdate(update);
  }

  private broadcastJson(msg: Record<string, unknown>): void {
    for (const peer of this.peers.values()) {
      peer.sendJson?.(msg);
    }
  }

  private async completeCustomTask(msg: Record<string, any>): Promise<void> {
    const taskId = typeof msg.taskId === "string" ? msg.taskId : "";
    const nodeId = typeof msg.nodeId === "string" ? msg.nodeId : "";
    if (!taskId || !nodeId) return;
    const tasksMap = this.doc.getMap("tasks");
    if (!tasksMap.get(taskId)) return;

    const versionBefore = this.doc.version();
    const nodesMap = this.doc.getMap("nodes");
    const node = nodesMap.get(nodeId) as Record<string, any> | undefined;
    const data = node?.data && typeof node.data === "object" ? node.data : {};
    const result = msg.result && typeof msg.result === "object" ? msg.result : {};
    const assets = Array.isArray(result.assets) ? result.assets as Array<Record<string, any>> : [];
    const isFailure = msg.status === "failed";

    if (!node) {
      tasksMap.delete(taskId);
      await this.publishUpdate(versionBefore);
      return;
    }

    if (isFailure || assets.length === 0) {
      nodesMap.set(nodeId, {
        ...node,
        data: {
          ...data,
          pendingTask: undefined,
          status: isFailure ? "failed" : "completed",
          ...(result.description ? { description: result.description } : {}),
          ...(result.error ? { error: result.error } : {}),
        },
      });
    } else {
      const primary = assets[0];
      const primaryData: Record<string, unknown> = {
        ...data,
        pendingTask: undefined,
        status: "completed",
      };
      if (primary.type === "text") primaryData.content = primary.content ?? "";
      else if (primary.storageKey) primaryData.assetId = taskId;
      if (primary.label) primaryData.label = primary.label;
      if (result.description) primaryData.description = result.description;
      nodesMap.set(nodeId, { ...node, data: primaryData });

      if (assets.length > 1) {
        const canvas = new Canvas(this.doc, () => {});
        const incoming = canvas.listEdges().filter((edge) => edge.target === nodeId);
        for (let i = 1; i < assets.length; i++) {
          const asset = assets[i];
          const siblingNodeId = crypto.randomUUID().slice(0, 8);
          const siblingType = asset.type === "video" ? "video" : asset.type === "audio" ? "audio" : asset.type === "text" ? "text" : "image";
          const siblingData: Record<string, unknown> = {
            status: "completed",
            label: asset.label || `Output ${i + 1}`,
          };
          if (asset.type === "text") siblingData.content = asset.content ?? "";
          else siblingData.assetId = `${taskId}-${i}`;
          if (incoming.length === 0) {
            canvas.createNode(siblingNodeId, siblingType, siblingData);
          } else {
            canvas.createLinkedNode({
              nodeId: siblingNodeId,
              nodeType: siblingType,
              data: siblingData,
              parentId: null,
              sourceNodeId: incoming[0].source,
            });
            for (let k = 1; k < incoming.length; k++) {
              const extra = incoming[k];
              canvas.insertEdge(`${extra.source}-${siblingNodeId}`, extra.source, siblingNodeId, "default");
            }
          }
        }
      }
    }

    tasksMap.delete(taskId);
    await this.publishUpdate(versionBefore);
  }

  private mirrorRemoteUpdate(update: Uint8Array): void {
    if (!this.remotePersistence) return;
    void resolveRemotePersistence(this.remotePersistence)
      .then((remotePersistence) => remotePersistence?.appendUpdate(this.projectId, update))
      .catch((error) => {
        console.error("[local-sync] failed to mirror update to remote persistence", error);
      });
  }

  private broadcastPresence(): void {
    const clients = Array.from(this.peers.values())
      .map((peer) => peer.presence)
      .filter((client): client is PresenceClient => !!client);
    for (const peer of this.peers.values()) {
      peer.sendJson?.({ type: "presence", clients });
    }
  }
}

export class LocalLoroRoomHub {
  private rooms = new Map<string, Promise<LocalLoroRoom>>();

  constructor(
    private readonly dataDir: string,
    private readonly remotePersistence?: RemoteLoroPersistenceSource,
    private readonly workflowProcessor?: LocalWorkflowProcessor | null,
  ) {}

  room(projectId: string): Promise<LocalLoroRoom> {
    let room = this.rooms.get(projectId);
    if (!room) {
      room = LocalLoroRoom.open({
        dataDir: this.dataDir,
        projectId,
        remotePersistence: this.remotePersistence,
        workflowProcessor: this.workflowProcessor,
      });
      this.rooms.set(projectId, room);
    }
    return room;
  }
}

export function attachLocalSync(
  server: UpgradeCapableServer,
  options: {
    dataDir: string;
    remotePersistence?: RemoteLoroPersistenceSource;
    workflowProcessor?: LocalWorkflowProcessor | null;
  },
): void {
  const hub = new LocalLoroRoomHub(
    options.dataDir,
    options.remotePersistence,
    options.workflowProcessor,
  );
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const match = /^\/sync\/(.+)$/.exec(url.pathname);
    if (!match) return;

    const projectId = decodeURIComponent(match[1]);
    const runtimeHeader = request.headers?.["x-runtime-id"];
    const runtimeId = Array.isArray(runtimeHeader) ? runtimeHeader[0] : runtimeHeader;
    const presence = presenceFromHeaders(request.headers);
    wss.handleUpgrade(request, socket, head, (ws) => {
      void bindSocket(hub, projectId, ws, typeof runtimeId === "string" ? runtimeId : undefined, presence);
    });
  });
}

function headerString(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  return trimmed || undefined;
}

function presenceFromHeaders(headers: Record<string, string | string[] | undefined>): PresenceClient {
  const rawClientType = headerString(headers["x-client-type"]);
  const clientType: ClientType =
    rawClientType === "agent" || rawClientType === "cli" || rawClientType === "browser"
      ? rawClientType
      : "browser";
  const userId = headerString(headers["x-user-id"]) ?? "local-user";
  const userName = headerString(headers["x-user-name"]);
  const name = clientType === "agent"
    ? headerString(headers["x-agent-name"]) ?? userName ?? "Local Agent"
    : clientType === "cli"
      ? userName ?? "Local CLI"
      : userName ?? "Local User";

  return {
    id: randomUUID(),
    clientType,
    userId,
    name,
  };
}

async function bindSocket(
  hub: LocalLoroRoomHub,
  projectId: string,
  ws: WebSocket,
  runtimeId?: string,
  presence?: PresenceClient,
): Promise<void> {
  const room = await hub.room(projectId);
  const peerId = room.addPeer((update) => {
    if (ws.readyState === ws.OPEN) ws.send(update);
  }, {
    runtimeId,
    presence,
    sendJson: (msg) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    },
  });

  ws.on("message", (data, isBinary) => {
    if (!isBinary) {
      try {
        const text = typeof data === "string"
          ? data
          : data instanceof Buffer
            ? data.toString("utf8")
            : Array.isArray(data)
              ? Buffer.concat(data).toString("utf8")
              : Buffer.from(data as ArrayBuffer).toString("utf8");
        const msg = JSON.parse(text) as Record<string, any>;
        void room.receiveJson(peerId, msg).catch((error) => {
          console.error("[local-sync] failed to handle sideband message", error);
        });
      } catch {
        // Ignore non-JSON sideband chatter.
      }
      return;
    }
    const bytes = data instanceof Buffer
      ? new Uint8Array(data)
      : Array.isArray(data)
        ? new Uint8Array(Buffer.concat(data))
        : new Uint8Array(data as ArrayBuffer);
    void room.receive(peerId, bytes).catch((error) => {
      console.error("[local-sync] failed to import update", error);
    });
  });

  ws.on("close", () => {
    room.removePeer(peerId);
  });
}
