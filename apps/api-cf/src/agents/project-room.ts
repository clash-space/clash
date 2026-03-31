/**
 * ProjectRoom — pure Loro CRDT sequencer Durable Object.
 *
 * Handles:
 * - Loro CRDT sync (binary WebSocket messages)
 * - Task submission (NodeProcessor) and polling (TaskPolling)
 * - Periodic snapshot persistence to D1
 * - Collaboration visibility (presence + activity sideband messages)
 *
 * Does NOT handle AI chat — that responsibility lives in SupervisorAgent.
 *
 * Two connection types:
 * - Browser clients via /sync/:projectId (authenticated)
 * - SupervisorAgent DOs via internal WS (x-internal-agent header)
 */

import { DurableObject } from "cloudflare:workers";
import { LoroDoc } from "loro-crdt";

import { log } from "../logger";
import type { Env } from "../config";
import { loadSnapshot, saveSnapshot } from "../loro/storage";
import { processPendingNodes } from "../loro/NodeProcessor";
import { pollNodeTasks } from "../loro/TaskPolling";
import { updateNodeData } from "../loro/NodeUpdater";
import { authenticateRequest } from "../loro/auth";
import type { ClientInfo, ClientType, PresenceMessage, ActivityMessage, ActivityAction } from "@clash/shared-types";

/** Alarm intervals in milliseconds */
const SNAPSHOT_INTERVAL_MS = 300_000; // 5 minutes
const TASK_POLL_INTERVAL_MS = 60_000; // 60 seconds
const TASK_POLL_URGENT_MS = 2_000; // 2 seconds (after new task submission)

export class ProjectRoom extends DurableObject<Env> {
  private doc: LoroDoc = new LoroDoc();
  private projectId = "";
  private initPromise: Promise<void> | null = null;
  private messageQueue: Array<{ sender: WebSocket; data: Uint8Array }> = [];
  private isProcessingQueue = false;
  private isProcessingNodes = false;
  private isSaving = false;
  private needsSave = false;
  private saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSnapshotTime = 0;

  /** Connected client identity map for presence tracking. */
  private clients: Map<WebSocket, ClientInfo> = new Map();

  /** Throttle activity broadcasts: nodeId → last broadcast timestamp */
  private activityThrottle: Map<string, number> = new Map();

  // ─── Fetch: entry point for all requests ─────────────────────

  async fetch(request: Request): Promise<Response> {
    // WebSocket upgrade
    if (request.headers.get("Upgrade") === "websocket") {
      return this.handleWebSocketUpgrade(request);
    }

    // HTTP endpoints
    return this.handleHttpRequest(request);
  }

  // ─── WebSocket Upgrade (replaces onConnect) ──────────────────

  private async handleWebSocketUpgrade(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Extract projectId from path: /sync/:projectId
    const pathParts = url.pathname.split("/").filter(Boolean);
    let projectId = "";
    if (pathParts[0] === "sync" && pathParts[1]) {
      projectId = pathParts[1];
    }
    if (!projectId) {
      projectId = url.searchParams.get("projectId") ?? "";
    }
    if (!projectId) {
      return new Response("Missing project ID", { status: 400 });
    }

    // Skip auth for internal agent connections
    const isInternal = request.headers.get("x-internal-agent") === "true";
    let clientType: ClientType = "browser";
    let userId = "unknown";
    let userName = "User";
    let userAvatar: string | undefined;

    if (!isInternal) {
      try {
        const authResult = await authenticateRequest(request, this.env, projectId);
        userId = authResult.userId;
        userName = authResult.userName ?? "User";
        userAvatar = authResult.userAvatar;

        // Detect client type from header
        const clientTypeHeader = request.headers.get("x-client-type");
        if (clientTypeHeader === "cli") {
          clientType = "cli";
          userName = authResult.userName ?? "CLI Agent";
        }
      } catch (error) {
        log.error("Auth failed:", error);
        return new Response("Unauthorized", { status: 401 });
      }
    } else {
      clientType = "cli";
      userName = "Internal Agent";
    }

    // Initialize on first connection
    if (!this.initPromise) {
      this.initPromise = this.initRoom(projectId);
    }
    await this.initPromise;

    // Verify project ID matches
    if (this.projectId !== projectId) {
      log.error(`Project ID mismatch: expected ${this.projectId}, got ${projectId}`);
      return new Response("Project ID mismatch", { status: 400 });
    }

    // Create WebSocket pair and accept via Hibernation API
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);

    // Register client for presence — persist via serializeAttachment so it survives hibernation
    const clientInfo: ClientInfo = {
      id: crypto.randomUUID(),
      userId,
      clientType,
      name: userName,
      avatar: userAvatar,
      connectedAt: Date.now(),
    };
    server.serializeAttachment(clientInfo);
    this.clients.set(server, clientInfo);

    // Send initial Loro state to new client
    try {
      const snapshot = this.doc.export({ mode: "snapshot" });
      server.send(snapshot);
    } catch (error) {
      log.error("Failed to send initial state:", error);
    }

    // Broadcast updated presence to all clients
    this.broadcastPresence();

    return new Response(null, { status: 101, webSocket: client });
  }

  // ─── Room Initialization ─────────────────────────────────────

  private async initRoom(projectId: string): Promise<void> {
    this.projectId = projectId;

    // Persist projectId so alarm() can recover after hibernation
    await this.ctx.storage.put("projectId", projectId);

    // Load Loro document from DO storage
    const snapshot = await loadSnapshot(this.ctx.storage);
    if (snapshot) {
      try {
        this.doc = LoroDoc.fromSnapshot(snapshot);
      } catch (error) {
        log.error("Failed to import snapshot:", error);
        this.doc = new LoroDoc();
      }
    } else {
      this.doc = new LoroDoc();
    }

    this.lastSnapshotTime = Date.now();

    // Schedule first alarm for snapshot save + task polling
    await this.ctx.storage.setAlarm(Date.now() + TASK_POLL_INTERVAL_MS);

    // Process any pending nodes and trigger polling
    await this.taskPoll();
  }

  // ─── Presence & Activity Broadcasts ─────────────────────────

  /**
   * Rebuild this.clients from live WebSockets after hibernation wake-up.
   * Uses serializeAttachment/deserializeAttachment to recover ClientInfo.
   */
  private rebuildClientsFromWebSockets(): void {
    const liveWs = this.ctx.getWebSockets();
    const knownWs = new Set(this.clients.keys());

    for (const ws of liveWs) {
      if (!knownWs.has(ws)) {
        const attachment = ws.deserializeAttachment() as ClientInfo | null;
        if (attachment) {
          this.clients.set(ws, attachment);
        }
      }
    }

    // Remove entries whose WebSocket is no longer in the live set
    const liveSet = new Set(liveWs);
    for (const ws of this.clients.keys()) {
      if (!liveSet.has(ws)) {
        this.clients.delete(ws);
      }
    }
  }

  /**
   * Broadcast current presence to all connected clients.
   */
  private broadcastPresence(): void {
    // Sync clients map with actual live WebSockets to avoid stale entries
    this.rebuildClientsFromWebSockets();

    const msg: PresenceMessage = {
      type: "presence",
      clients: Array.from(this.clients.values()).map((c) => ({
        id: c.id,
        clientType: c.clientType,
        userId: c.userId,
        name: c.name,
        avatar: c.avatar,
      })),
    };
    this.broadcastText(JSON.stringify(msg));
  }

  /**
   * Broadcast an activity event to all clients except the actor.
   * Throttled: max 1 message per node per 500ms.
   */
  private broadcastActivity(
    sender: WebSocket,
    action: ActivityAction,
    nodeId: string,
    nodeType: string,
    label: string
  ): void {
    const now = Date.now();
    const throttleKey = `${nodeId}:${action}`;
    const last = this.activityThrottle.get(throttleKey) ?? 0;
    if (now - last < 500) return;
    this.activityThrottle.set(throttleKey, now);

    const client = this.clients.get(sender);
    const msg: ActivityMessage = {
      type: "activity",
      actor: {
        clientType: client?.clientType ?? "browser",
        name: client?.name ?? "Unknown",
      },
      action,
      nodeId,
      nodeType,
      label,
      timestamp: now,
    };

    const json = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === sender) continue;
      try {
        ws.send(json);
      } catch {
        // Connection may have closed
      }
    }
  }

  /**
   * Broadcast a JSON text message to all connected clients.
   */
  private broadcastText(text: string): void {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(text);
      } catch {
        // Connection may have closed
      }
    }
  }

  // ─── Hibernation WebSocket Handlers ──────────────────────────

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    // After hibernation, in-memory state is lost — re-initialize if needed
    if (!this.projectId) {
      const storedId = await this.ctx.storage.get<string>("projectId");
      if (storedId && !this.initPromise) {
        this.initPromise = this.initRoom(storedId);
      }
      if (this.initPromise) await this.initPromise;
    }

    // Only handle binary messages (Loro CRDT updates)
    if (message instanceof ArrayBuffer) {
      const updates = new Uint8Array(message);
      this.messageQueue.push({ sender: ws, data: updates });
      if (!this.isProcessingQueue) {
        this.processMessageQueue();
      }
    }
    // Ignore string messages
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    this.clients.delete(ws);
    this.broadcastPresence();
    try {
      ws.close(code, reason);
    } catch {
      // Already closed
    }
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    log.error("WebSocket error:", error);
    this.clients.delete(ws);
    this.broadcastPresence();
    try {
      ws.close(1011, "WebSocket error");
    } catch {
      // Already closed
    }
  }

  // ─── Message Queue Processing ────────────────────────────────

  /**
   * Process Loro update queue serially.
   * CRITICAL: doc.import() must be serialized to prevent state corruption.
   */
  private async processMessageQueue(): Promise<void> {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    try {
      while (this.messageQueue.length > 0) {
        const msg = this.messageQueue.shift();
        if (!msg) continue;

        if (this.initPromise) await this.initPromise;

        try {
          // Snapshot node keys before import for activity diff
          const nodesBefore = new Map<string, Record<string, any>>();
          const nodesMap = this.doc.getMap("nodes");
          for (const [id, raw] of nodesMap.entries()) {
            nodesBefore.set(id, raw as Record<string, any>);
          }

          this.doc.import(msg.data);

          // Broadcast to all other clients FIRST so they have the base state
          // before receiving any derived updates from processPendingNodes.
          this.broadcastBinary(msg.data, msg.sender);

          // Detect activity: diff nodes before/after
          const nodesAfter = nodesMap.entries();
          const seenIds = new Set<string>();
          for (const [id, raw] of nodesAfter) {
            seenIds.add(id);
            const after = raw as Record<string, any>;
            const before = nodesBefore.get(id);
            if (!before) {
              // New node added
              const label = (after.data?.label as string) ?? (after.data?.name as string) ?? "";
              this.broadcastActivity(msg.sender, "added", id, after.type ?? "text", label);
            } else if (JSON.stringify(before) !== JSON.stringify(after)) {
              // Node updated
              const label = (after.data?.label as string) ?? (after.data?.name as string) ?? "";
              this.broadcastActivity(msg.sender, "updated", id, after.type ?? "text", label);
            }
          }
          // Check for deleted nodes
          for (const [id, before] of nodesBefore) {
            if (!seenIds.has(id)) {
              const label = (before.data?.label as string) ?? (before.data?.name as string) ?? "";
              this.broadcastActivity(msg.sender, "deleted", id, before.type ?? "text", label);
            }
          }

          // Check for pending nodes (may emit additional broadcasts)
          await this.guardedProcessPendingNodes();

          // Debounced snapshot save (5s after last update)
          this.debouncedSave();
        } catch (error) {
          log.error("Failed to process Loro update:", error);
        }
      }
    } finally {
      this.isProcessingQueue = false;
    }
  }

  // ─── Broadcast ──────────────────────────────────────────────

  /**
   * Broadcast binary Loro update to all connected clients except sender.
   */
  private broadcastBinary(data: Uint8Array, sender?: WebSocket): void {
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === sender) continue;
      try {
        ws.send(data);
      } catch (error) {
        log.error("Failed to broadcast to client:", error);
      }
    }
  }

  // ─── Guarded Node Processing ─────────────────────────────────

  /**
   * Run processPendingNodes with a guard to prevent concurrent execution
   * (alarm + processMessageQueue can race).
   */
  private async guardedProcessPendingNodes(): Promise<void> {
    if (this.isProcessingNodes) return;
    this.isProcessingNodes = true;
    try {
      await processPendingNodes(
        this.doc,
        this.env,
        this.projectId,
        (data: Uint8Array) => this.broadcastBinary(data),
        async () => this.triggerTaskPolling()
      );
    } finally {
      this.isProcessingNodes = false;
    }
  }

  // ─── Snapshots ──────────────────────────────────────────────

  /**
   * Debounce snapshot saves — wait 5s after last update before saving.
   */
  private debouncedSave(): void {
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
    }
    this.saveDebounceTimer = setTimeout(() => {
      this.saveDebounceTimer = null;
      this.saveDocumentSnapshot().catch((err) =>
        log.error("Failed to save snapshot:", err)
      );
    }, 5_000);
  }

  private async saveDocumentSnapshot(): Promise<void> {
    if (!this.projectId) return;

    if (this.isSaving) {
      this.needsSave = true;
      return;
    }

    this.isSaving = true;
    this.needsSave = false;

    try {
      const snapshot = this.doc.export({ mode: "snapshot" });
      const version = this.doc.version().toString();
      await saveSnapshot(this.ctx.storage, this.projectId, snapshot, version);
      this.lastSnapshotTime = Date.now();
    } catch (error) {
      log.error("Failed to save snapshot:", error);
    } finally {
      this.isSaving = false;
      if (this.needsSave) {
        setTimeout(() => this.saveDocumentSnapshot(), 100);
      }
    }
  }

  // ─── Alarm (replaces schedule/cancelSchedule) ────────────────

  async alarm(): Promise<void> {
    // After hibernation, in-memory state is lost — re-initialize if needed
    if (!this.projectId) {
      const storedId = await this.ctx.storage.get<string>("projectId");
      if (!storedId) return; // No project ever connected, nothing to do
      if (!this.initPromise) {
        this.initPromise = this.initRoom(storedId);
      }
      await this.initPromise;
    }

    // Save snapshot if enough time has passed
    const sinceLastSnapshot = Date.now() - this.lastSnapshotTime;
    if (sinceLastSnapshot >= SNAPSHOT_INTERVAL_MS) {
      await this.saveDocumentSnapshot();
    }

    // Run task polling
    await this.taskPoll();

    // Re-schedule next alarm only if clients are connected
    if (this.ctx.getWebSockets().length > 0) {
      await this.ctx.storage.setAlarm(Date.now() + TASK_POLL_INTERVAL_MS);
    }
  }

  // ─── Task Polling ───────────────────────────────────────────

  private async taskPoll(): Promise<void> {
    if (!this.projectId) return;

    try {
      // Submit pending tasks
      await this.guardedProcessPendingNodes();

      // Poll tasks with pendingTask field
      await pollNodeTasks(
        this.doc,
        this.env,
        this.projectId,
        (data: Uint8Array) => this.broadcastBinary(data)
      );
    } catch (error) {
      log.error("Error in taskPoll:", error);
    }
  }

  private triggerTaskPolling(): void {
    this.ctx.storage.setAlarm(Date.now() + TASK_POLL_URGENT_MS);
  }

  // ─── HTTP Endpoints (replaces onRequest) ─────────────────────

  private async handleHttpRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Handle /update-node internal request
    if (url.pathname.endsWith("/update-node") && request.method === "POST") {
      try {
        const body = (await request.json()) as {
          nodeId: string;
          updates: Record<string, any>;
        };

        if (this.initPromise) await this.initPromise;

        updateNodeData(this.doc, body.nodeId, body.updates, (data) =>
          this.broadcastBinary(data)
        );

        await this.guardedProcessPendingNodes();

        this.debouncedSave();

        return Response.json({ ok: true });
      } catch (error) {
        log.error("Update node error:", error);
        return Response.json({ error: "Update failed" }, { status: 500 });
      }
    }

    // Handle /nodes GET request
    if (url.pathname.endsWith("/nodes") && request.method === "GET") {
      try {
        if (this.initPromise) await this.initPromise;

        const nodesMap = this.doc.getMap("nodes");
        const nodesObj = nodesMap.toJSON() as Record<string, any>;
        const nodesArray = Object.values(nodesObj);

        return Response.json(nodesArray);
      } catch (error) {
        log.error("Get nodes error:", error);
        return Response.json({ error: "Failed to get nodes" }, { status: 500 });
      }
    }

    return new Response("ProjectRoom", { status: 200 });
  }
}
