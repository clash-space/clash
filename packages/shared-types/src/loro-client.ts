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

export type ClientType = "browser" | "cli";

export interface LoroSyncClientOptions {
  serverUrl: string;
  projectId: string;
  token: string;
  /** Client type for presence tracking. Default: "browser" */
  clientType?: ClientType;
  /** WebSocket constructor override (e.g., `ws` package for Node.js) */
  WebSocket?: WSConstructor;
}

export class LoroSyncClient {
  readonly doc: LoroDoc = new LoroDoc();
  /** Canvas operations on this client's Loro document. */
  readonly canvas: Canvas;

  private ws: WSLike | null = null;
  private unsubscribe: (() => void) | null = null;
  private readonly serverUrl: string;
  private readonly projectId: string;
  private readonly token: string;
  private readonly clientType: ClientType;
  private readonly WS: WSConstructor;

  constructor(options: LoroSyncClientOptions) {
    this.serverUrl = options.serverUrl.replace(/\/$/, "");
    this.projectId = options.projectId;
    this.token = options.token;
    this.clientType = options.clientType ?? "browser";
    this.WS = (options.WebSocket ?? globalThis.WebSocket) as unknown as WSConstructor;
    // No-op broadcast: local updates are sent via subscribeLocalUpdates in connect().
    this.canvas = new Canvas(this.doc, () => {});
  }

  // ─── Lifecycle ──────────────────────────────────────────────

  async connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const url = `${this.serverUrl}/sync/${this.projectId}?token=${encodeURIComponent(this.token)}`;
      const ws = new this.WS(url, undefined, {
        headers: { "x-client-type": this.clientType },
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
  searchNodes(query: string, nodeTypes?: string[] | null) { return this.canvas.searchNodes(query, nodeTypes); }
  getNodeStatus(nodeIdOrAssetId: string) { return this.canvas.getNodeStatus(nodeIdOrAssetId); }
  findNodeByIdOrAssetId(idOrAssetId: string) { return this.canvas.findNode(idOrAssetId); }
}
