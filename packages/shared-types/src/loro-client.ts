/**
 * LoroSyncClient — framework-agnostic Loro CRDT sync client.
 *
 * Connects to a ProjectRoom Durable Object via WebSocket,
 * receives the initial snapshot, and provides canvas operations
 * via the Canvas class.
 *
 * Lifecycle: CONNECT → WAIT_SNAPSHOT → READY → OPERATE → FLUSH → DISCONNECT
 */
import { LoroDoc } from "loro-crdt";
import { Canvas } from "./canvas-ops";
import {
  canvasGraphReconciliationChanged,
  reconcileCanvasGraph,
} from "./node-upstreams";
import {
  DEFAULT_CANVAS_ID,
  attachTimelineToCanvas,
  copyTimelineActionToCanvas,
  createProjectCanvas,
  createProjectTimeline,
  deleteProjectCanvas,
  deleteProjectTimeline,
  detachTimelineFromCanvas,
  ensureProjectCanvas,
  listProjectCanvases,
  listProjectTimelines,
  reconcileProjectTimelineOwnership,
  renameProjectCanvas,
  updateProjectTimelineState,
} from "./project-workspace";
import {
  attachDirectorStageToCanvas,
  createProjectDirectorStage,
  detachDirectorStageFromCanvas,
  listProjectDirectorStages,
  reconcileProjectDirectorStageOwnership,
  updateProjectDirectorStageState,
} from "./director-stage";

const CONNECT_TIMEOUT_MS = 10_000;
const FLUSH_TIMEOUT_MS = 5_000;
const CLOSE_TIMEOUT_MS = 2_000;

// ─── Minimal WebSocket interface ──────────────────────────────
// Works with browser WebSocket, Node.js `ws`, and Cloudflare Workers.

interface WSLike {
  readonly readyState: number;
  readonly bufferedAmount: number;
  binaryType: string;
  send(data: ArrayBuffer | Uint8Array): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: any) => void) | null;
  onmessage: ((ev: { data: any }) => void) | null;
  onerror: ((ev: any) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
}

interface WSConstructor {
  new (url: string, protocols?: any, options?: any): WSLike;
}

/** Standard readyState constants */
const WS_OPEN = 1;
const WS_CLOSED = 3;

export type ClientType = "browser" | "cli" | "agent";

export interface LoroSyncClientOptions {
  serverUrl: string;
  projectId: string;
  /** Initial Canvas scope for node operations. Defaults to `main`. */
  canvasId?: string;
  token?: string;
  /** Client type for presence tracking. Default: "browser" */
  clientType?: ClientType;
  /** Human user represented by this connection. */
  userId?: string;
  /** Display name for browser/CLI presence. */
  userName?: string;
  /** Display name for agent presence. */
  agentName?: string;
  /** WebSocket constructor override (e.g., `ws` package for Node.js) */
  WebSocket?: WSConstructor;
}

export class LoroSyncClient {
  readonly doc: LoroDoc = new LoroDoc();
  private readonly canvasScopes = new Map<string, Canvas>();
  private activeCanvasId: string;

  private ws: WSLike | null = null;
  private unsubscribe: (() => void) | null = null;
  private readonly serverUrl: string;
  private readonly projectId: string;
  private readonly token: string;
  private readonly clientType: ClientType;
  private readonly userId?: string;
  private readonly userName?: string;
  private readonly agentName?: string;
  private readonly WS: WSConstructor;

  constructor(options: LoroSyncClientOptions) {
    this.serverUrl = options.serverUrl.replace(/\/$/, "");
    this.projectId = options.projectId;
    this.token = options.token ?? "";
    this.clientType = options.clientType ?? "browser";
    this.userId = options.userId;
    this.userName = options.userName;
    this.agentName = options.agentName;
    this.WS = (options.WebSocket ?? globalThis.WebSocket) as unknown as WSConstructor;
    this.activeCanvasId = options.canvasId?.trim() || DEFAULT_CANVAS_ID;
  }

  /** Canvas operations in the currently selected scope. */
  get canvas(): Canvas {
    return this.canvasFor(this.activeCanvasId);
  }

  canvasFor(canvasId: string): Canvas {
    const id = canvasId.trim() || DEFAULT_CANVAS_ID;
    const existing = this.canvasScopes.get(id);
    if (existing) return existing;
    // No-op broadcast: local updates are sent via subscribeLocalUpdates in connect().
    const canvas = new Canvas(this.doc, () => {}, id);
    this.canvasScopes.set(id, canvas);
    return canvas;
  }

  selectCanvas(canvasId: string): Canvas {
    const id = canvasId.trim() || DEFAULT_CANVAS_ID;
    const canvases = this.doc.getMap("canvases");
    if (!canvases.get(id)) {
      if (id === DEFAULT_CANVAS_ID && canvases.size === 0) {
        ensureProjectCanvas(this.doc);
        this.doc.commit({ origin: "sys:canvas-registry" });
      } else {
        throw new Error(`Canvas ${id} not found`);
      }
    }
    const canvas = this.canvasFor(id);
    this.activeCanvasId = id;
    return canvas;
  }

  listCanvases() {
    return listProjectCanvases(this.doc);
  }

  createCanvas(input: { id: string; name: string }) {
    const result = createProjectCanvas(this.doc, input);
    if (result.ok) this.doc.commit();
    return result;
  }

  renameCanvas(canvasId: string, name: string) {
    const result = renameProjectCanvas(this.doc, canvasId, name);
    if (result.ok) this.doc.commit();
    return result;
  }

  deleteCanvas(canvasId: string) {
    const result = deleteProjectCanvas(this.doc, canvasId);
    if (result.ok) this.doc.commit();
    return result;
  }

  listTimelines() {
    return listProjectTimelines(this.doc);
  }

  createTimeline(input: { id: string; name: string; state: unknown }) {
    const result = createProjectTimeline(this.doc, input);
    if (result.ok) this.doc.commit();
    return result;
  }

  updateTimelineState(timelineId: string, state: unknown) {
    const result = updateProjectTimelineState(this.doc, timelineId, state);
    if (result.ok) this.doc.commit();
    return result;
  }

  deleteTimeline(timelineId: string, expectedReadToken?: string) {
    const result = deleteProjectTimeline(this.doc, timelineId, expectedReadToken);
    if (result.ok) this.doc.commit();
    return result;
  }

  attachTimeline(input: {
    timelineId: string;
    canvasId: string;
    actionNodeId: string;
    position: { x: number; y: number };
  }) {
    const result = attachTimelineToCanvas(this.doc, input);
    if (result.ok) this.doc.commit();
    return result;
  }

  detachTimeline(timelineId: string) {
    const result = detachTimelineFromCanvas(this.doc, timelineId);
    if (result.ok) this.doc.commit();
    return result;
  }

  copyTimelineAction(input: {
    sourceTimelineId: string;
    targetCanvasId: string;
    newTimelineId: string;
    newActionNodeId: string;
    position: { x: number; y: number };
  }) {
    const result = copyTimelineActionToCanvas(this.doc, input);
    if (result.ok) this.doc.commit();
    return result;
  }

  listDirectorStages() {
    return listProjectDirectorStages(this.doc);
  }

  createDirectorStage(input: { id: string; name: string; state: unknown }) {
    const result = createProjectDirectorStage(this.doc, input);
    if (result.ok) this.doc.commit();
    return result;
  }

  updateDirectorStageState(stageId: string, state: unknown) {
    const result = updateProjectDirectorStageState(this.doc, stageId, state);
    if (result.ok) this.doc.commit();
    return result;
  }

  attachDirectorStage(input: {
    stageId: string;
    canvasId: string;
    actionNodeId: string;
    position: { x: number; y: number };
  }) {
    const result = attachDirectorStageToCanvas(this.doc, input);
    if (result.ok) this.doc.commit();
    return result;
  }

  detachDirectorStage(stageId: string) {
    const result = detachDirectorStageFromCanvas(this.doc, stageId);
    if (result.ok) this.doc.commit();
    return result;
  }

  // ─── Lifecycle ──────────────────────────────────────────────

  async connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const url = `${this.serverUrl}/sync/${encodeURIComponent(this.projectId)}`;
      const ws = new this.WS(url, undefined, {
        headers: {
          ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
          ...this.presenceHeaders(),
        },
      });
      ws.binaryType = "arraybuffer";
      let snapshotReceived = false;

      const timeout = setTimeout(() => {
        if (!snapshotReceived) {
          ws.close();
          reject(new Error(`Connection timeout: no snapshot received within ${CONNECT_TIMEOUT_MS}ms`));
        }
      }, CONNECT_TIMEOUT_MS);

      ws.onmessage = (event) => {
        if (typeof event.data === "string") return;

        const data = new Uint8Array(event.data as ArrayBuffer);
        if (!snapshotReceived) {
          this.doc.import(data);
          snapshotReceived = true;

          this.unsubscribe = this.doc.subscribeLocalUpdates((update: Uint8Array) => {
            if (this.ws?.readyState === WS_OPEN) {
              this.ws.send(update);
            }
          });

          const graphReconciliation = reconcileCanvasGraph(this.doc);
          const reconciliation = reconcileProjectTimelineOwnership(this.doc);
          const directorReconciliation = reconcileProjectDirectorStageOwnership(this.doc);
          let workspaceChanged = canvasGraphReconciliationChanged(graphReconciliation) ||
            reconciliation.removedActionNodeIds.length > 0 ||
            reconciliation.detachedTimelineIds.length > 0;
          workspaceChanged = workspaceChanged ||
            directorReconciliation.removedActionNodeIds.length > 0 ||
            directorReconciliation.detachedStageIds.length > 0;
          if (this.doc.getMap("canvases").size === 0) {
            ensureProjectCanvas(this.doc);
            workspaceChanged = true;
          }
          if (workspaceChanged) {
            this.doc.commit({ origin: "sys:workspace-reconcile" });
          }

          clearTimeout(timeout);
          resolve();
        } else {
          this.doc.import(data);
        }
      };

      ws.onerror = () => {
        if (!snapshotReceived) {
          clearTimeout(timeout);
          reject(new Error(`Cannot connect to Clash server at ${this.serverUrl}. Is it running?`));
        }
      };

      ws.onclose = (ev) => {
        if (!snapshotReceived) {
          clearTimeout(timeout);
          if (ev.code === 4001) {
            reject(new Error("Invalid API token. Run `clash auth login` to configure."));
          } else {
            reject(new Error(`Connection closed: ${ev.code} ${ev.reason || "unknown"}`));
          }
        }
      };

      this.ws = ws;
    });
  }

  private presenceHeaders(): Record<string, string> {
    return {
      "x-client-type": this.clientType,
      ...(this.userId ? { "x-user-id": this.userId } : {}),
      ...(this.userName ? { "x-user-name": this.userName } : {}),
      ...(this.agentName ? { "x-agent-name": this.agentName } : {}),
    };
  }

  async flush(): Promise<void> {
    if (!this.ws || this.ws.readyState !== WS_OPEN) return;
    const deadline = Date.now() + FLUSH_TIMEOUT_MS;
    while (this.ws.bufferedAmount > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    if (this.ws.bufferedAmount > 0) {
      console.warn("[LoroSyncClient] Warning: write buffer not fully flushed before disconnect");
    }
  }

  async disconnect(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;

    await this.flush();

    if (this.ws && this.ws.readyState !== WS_CLOSED) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, CLOSE_TIMEOUT_MS);
        this.ws!.onclose = () => {
          clearTimeout(timer);
          resolve();
        };
        this.ws!.close(1000, "done");
      });
    }
    this.ws = null;
  }

  get connected(): boolean {
    return this.ws?.readyState === WS_OPEN;
  }

  // ─── Convenience delegations ────────────────────────────────
  // Kept for backward compatibility; prefer `client.canvas.*` for new code.

  listNodes(nodeType?: string | null, parentId?: string | null) {
    return this.canvas.listNodes(nodeType, parentId);
  }
  readNode(nodeId: string) { return this.canvas.readNode(nodeId); }
  createNode(
    nodeId: string, nodeType: string, data: Record<string, unknown>,
    position?: { x: number; y: number } | null, parentId?: string | null, assetId?: string | null,
  ) { return this.canvas.createNode(nodeId, nodeType, data, position, parentId, assetId); }
  updateNode(nodeId: string, updates: Record<string, unknown>) { return this.canvas.updateNode(nodeId, updates); }
  deleteNode(nodeId: string) { return this.canvas.deleteNode(nodeId); }
  deleteNodes(nodeIds: string[]) { return this.canvas.deleteNodes(nodeIds); }
  searchNodes(query: string, nodeTypes?: string[] | null) { return this.canvas.searchNodes(query, nodeTypes); }
  getNodeStatus(nodeIdOrAssetId: string) { return this.canvas.getNodeStatus(nodeIdOrAssetId); }
  findNodeByIdOrAssetId(idOrAssetId: string) { return this.canvas.findNode(idOrAssetId); }
}
