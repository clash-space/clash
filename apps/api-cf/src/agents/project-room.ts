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
import { processPendingNodes, recoverOrphanedTasks } from "../loro/NodeProcessor";
import { pollNodeTasks } from "../loro/TaskPolling";
import { updateNodeData, appendNodeLog } from "../loro/NodeUpdater";
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
      clientType = "agent";
      userName = request.headers.get("x-agent-name") || "Agent";
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

    const clients = Array.from(this.clients.values()).map((c) => ({
      id: c.id,
      clientType: c.clientType,
      userId: c.userId,
      name: c.name,
      avatar: c.avatar,
    }));

    log.debug(`Presence: ${clients.length} clients`);

    const msg: PresenceMessage = { type: "presence", clients };
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

    // Handle binary messages (Loro CRDT updates)
    if (message instanceof ArrayBuffer) {
      const updates = new Uint8Array(message);
      this.messageQueue.push({ sender: ws, data: updates });
      if (!this.isProcessingQueue) {
        // Fire-and-forget — but ALWAYS catch so an unhandled rejection can't
        // leave isProcessingQueue stuck (which would silently grow the queue forever).
        this.processMessageQueue().catch((err) => {
          log.error("processMessageQueue rejected:", err);
          this.isProcessingQueue = false;
        });
      }
      return;
    }

    // Handle text messages (custom action protocol)
    if (typeof message === "string") {
      try {
        const parsed = JSON.parse(message);
        await this.handleTextMessage(ws, parsed);
      } catch (error) {
        // Not valid JSON or handler error — ignore
        log.error("Failed to handle text message:", error);
      }
    }
  }

  /**
   * Handle JSON text messages from clients (custom action protocol).
   */
  private async handleTextMessage(sender: WebSocket, msg: Record<string, any>): Promise<void> {
    if (this.initPromise) await this.initPromise;

    if (msg.type === "register_custom_actions") {
      // Local agent registering custom action definitions
      const actions = msg.actions as Array<Record<string, any>>;
      if (!Array.isArray(actions)) return;

      const versionBefore = this.doc.version();
      const actionsMap = this.doc.getMap("customActions");
      for (const action of actions) {
        if (!action.id || !action.name) continue;
        actionsMap.set(action.id, {
          id: action.id,
          name: action.name,
          description: action.description || "",
          parameters: action.parameters || [],
          outputType: action.outputType || "image",
          icon: action.icon || "",
          color: action.color || "",
        });
      }
      const update = this.doc.export({ mode: "update", from: versionBefore });
      this.broadcastBinary(update);
      this.debouncedSave();

      log.info("Custom actions registered", {
        count: actions.length,
        ids: actions.map((a) => a.id),
      });
    }

    if (msg.type === "unregister_custom_actions") {
      // Local agent removing its custom action definitions
      const actionIds = msg.actionIds as string[];
      if (!Array.isArray(actionIds)) return;

      const versionBefore = this.doc.version();
      const actionsMap = this.doc.getMap("customActions");
      for (const id of actionIds) {
        actionsMap.delete(id);
      }
      const update = this.doc.export({ mode: "update", from: versionBefore });
      this.broadcastBinary(update);
      this.debouncedSave();
    }

    if (msg.type === "write_understanding") {
      // Local agent writing understanding results to a node.
      // Each key in `understanding` is overwritten independently (no merge).
      const { nodeId, understanding } = msg;
      if (!nodeId || !understanding || typeof understanding !== "object") return;

      const nodesMap = this.doc.getMap("nodes");
      const existingNode = nodesMap.get(nodeId) as Record<string, any> | undefined;
      if (!existingNode) return;

      const existingData = existingNode.data || {};
      const existingUnderstanding = existingData.understanding || {};

      // Key-level overwrite: new keys replace old keys, unmentioned keys are preserved
      const merged = { ...existingUnderstanding };
      for (const [key, value] of Object.entries(understanding)) {
        merged[key] = value;
      }

      const versionBefore = this.doc.version();
      nodesMap.set(nodeId, {
        ...existingNode,
        data: { ...existingData, understanding: merged },
      });
      const update = this.doc.export({ mode: "update", from: versionBefore });
      this.broadcastBinary(update);
      this.debouncedSave();

      log.info("Understanding written", { nodeId, keys: Object.keys(understanding) });
    }

    if (msg.type === "complete_custom_task") {
      // Local agent reporting task completion
      const { taskId, nodeId, status, result } = msg;
      if (!taskId || !nodeId) return;

      const nodeUpdates: Record<string, any> = {
        pendingTask: undefined,
        status: status === "failed" ? "failed" : "completed",
      };

      if (result?.content) nodeUpdates.content = result.content;
      if (result?.description) nodeUpdates.description = result.description;
      if (result?.error) nodeUpdates.error = result.error;

      updateNodeData(this.doc, nodeId, nodeUpdates, (data) =>
        this.broadcastBinary(data)
      );

      // Clean up the tasks map entry
      const versionBefore = this.doc.version();
      const tasksMap = this.doc.getMap("tasks");
      tasksMap.delete(taskId);
      const update = this.doc.export({ mode: "update", from: versionBefore });
      this.broadcastBinary(update);

      this.debouncedSave();
      log.info("Custom task completed", { taskId, nodeId, status });
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    // Wrap top-level: previously a sync throw here surfaced as
    // outcome=exception with empty exceptions[] in wrangler tail (CF runtime
    // swallows the details), so we couldn't tell what was failing. Catch +
    // log so the next occurrence names the failing line.
    try {
      this.clients.delete(ws);
    } catch (e) {
      log.error(`[room proj=${this.projectId.slice(-6)}] webSocketClose: clients.delete threw:`, e);
    }
    try {
      this.broadcastPresence();
    } catch (e) {
      log.error(`[room proj=${this.projectId.slice(-6)}] webSocketClose: broadcastPresence threw:`, e);
    }
    try {
      ws.close(code, reason);
    } catch {
      // Already closed
    }
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    log.error("WebSocket error:", error);
    try {
      this.clients.delete(ws);
    } catch (e) {
      log.error(`[room proj=${this.projectId.slice(-6)}] webSocketError: clients.delete threw:`, e);
    }
    try {
      this.broadcastPresence();
    } catch (e) {
      log.error(`[room proj=${this.projectId.slice(-6)}] webSocketError: broadcastPresence threw:`, e);
    }
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

    // Run task polling. Snapshot the version so we can detect whether
    // anything actually mutated the doc (orphan recovery / completed-task
    // writeback both touch the doc).
    const versionBeforePoll = this.doc.version().toString();
    await this.taskPoll();
    const versionAfterPoll = this.doc.version().toString();

    // If taskPoll changed the doc, persist immediately. Without this the
    // hibernation API drops the in-memory mutation between alarms — next
    // wake reloads the old snapshot, sees pendingTask still set, re-runs
    // recovery, broadcasts another "FAILED" update… every 60s, forever.
    // saveDocumentSnapshot is idempotent + serialised, so calling it here
    // is safe even if the 5-min branch above already ran.
    if (versionAfterPoll !== versionBeforePoll) {
      await this.saveDocumentSnapshot();
    }

    // Re-schedule next alarm only if clients are connected
    if (this.ctx.getWebSockets().length > 0) {
      await this.ctx.storage.setAlarm(Date.now() + TASK_POLL_INTERVAL_MS);
    }
  }

  // ─── Task Polling ───────────────────────────────────────────

  private async taskPoll(): Promise<void> {
    if (!this.projectId) return;
    const tag = `[room proj=${this.projectId.slice(-6)}]`;

    try {
      await this.guardedProcessPendingNodes();
    } catch (e) {
      // Don't let a single broken stage take down the whole alarm — log loud
      // so we can see WHICH project is corrupt, then continue to the next stage.
      this.handleTaskPollFailure(tag, "guardedProcessPendingNodes", e);
    }

    try {
      await recoverOrphanedTasks(
        this.doc,
        this.env,
        (data: Uint8Array) => this.broadcastBinary(data),
      );
    } catch (e) {
      this.handleTaskPollFailure(tag, "recoverOrphanedTasks", e);
    }

    try {
      await pollNodeTasks(
        this.doc,
        this.env,
        this.projectId,
        (data: Uint8Array) => this.broadcastBinary(data),
      );
    } catch (e) {
      this.handleTaskPollFailure(tag, "pollNodeTasks", e);
    }
  }

  /**
   * Centralised failure handler for taskPoll stages. The repeating
   * `RangeError: Invalid array buffer length` we saw was unattributed —
   * we couldn't tell which project's doc was corrupt. Now we log the
   * project ID, the offending stage, and (if it looks like doc corruption)
   * a hint that the snapshot is bad.
   */
  private handleTaskPollFailure(tag: string, stage: string, error: unknown): void {
    const msg = error instanceof Error ? error.message : String(error);
    const isCorruption =
      msg.includes("Invalid array buffer length") ||
      msg.includes("not a snapshot") ||
      msg.includes("UnknownVersion");
    if (isCorruption) {
      log.error(`${tag} ${stage} CORRUPT_DOC: ${msg} — snapshot likely poisoned, project will not sync until reset`);
    } else {
      log.error(`${tag} ${stage} failed:`, error);
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
          /** Optional log line to append to node.data._log (kept visible in UI). */
          log?: string;
        };

        if (this.initPromise) await this.initPromise;

        updateNodeData(this.doc, body.nodeId, body.updates, (data) =>
          this.broadcastBinary(data)
        );

        if (body.log) {
          appendNodeLog(this.doc, body.nodeId, body.log, (data) =>
            this.broadcastBinary(data)
          );
        }

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

    // Debug endpoint: full Loro snapshot (nodes + edges + projectMeta).
    // Curl it to see exactly what the source of truth has — way faster than
    // hunting down race conditions through frontend console.log.
    if (url.pathname.endsWith("/loro-dump") && request.method === "GET") {
      try {
        if (this.initPromise) await this.initPromise;

        const nodes = this.doc.getMap("nodes").toJSON() as Record<string, any>;
        const edges = this.doc.getMap("edges").toJSON() as Record<string, any>;
        const projectMeta = (() => {
          try { return this.doc.getMap("projectMeta").toJSON(); } catch { return null; }
        })();

        return Response.json({
          nodes,
          edges,
          projectMeta,
          counts: {
            nodes: Object.keys(nodes).length,
            edges: Object.keys(edges).length,
          },
        }, {
          headers: { "cache-control": "no-store" },
        });
      } catch (error) {
        log.error("Loro dump error:", error);
        return Response.json({ error: "Failed to dump loro state", detail: String(error) }, { status: 500 });
      }
    }

    // Admin recovery endpoint: nuke this room's persisted snapshot + in-memory
    // doc so a corrupt CRDT state stops poisoning every subsequent alarm.
    // Requires the same internal-agent header used for cross-DO calls so it
    // can't be triggered from the public internet. The next browser connect
    // will rebuild from whatever D1 has (or start empty).
    if (url.pathname.endsWith("/reset-doc") && request.method === "POST") {
      const isInternal = request.headers.get("x-internal-agent") === "true";
      if (!isInternal) return new Response("forbidden", { status: 403 });
      try {
        log.warn(`[room proj=${this.projectId.slice(-6)}] /reset-doc invoked — wiping snapshot + closing live WS`);
        await this.ctx.storage.delete(["loro:snapshot", "loro:version"]);
        // Drop in-memory doc so any subsequent connection initialises fresh.
        this.doc = new LoroDoc();
        this.lastSnapshotTime = 0;
        // Close all live WS so clients reconnect cleanly against the new doc.
        for (const ws of this.ctx.getWebSockets()) {
          try { ws.close(1012, "doc reset"); } catch { /* already closing */ }
        }
        return Response.json({ ok: true, projectId: this.projectId });
      } catch (error) {
        log.error("Reset error:", error);
        return Response.json({ error: "Reset failed", detail: String(error) }, { status: 500 });
      }
    }

    return new Response("ProjectRoom", { status: 200 });
  }
}
