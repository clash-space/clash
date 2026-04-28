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
import { loadDocState, appendUpdate, compactToSnapshot, wipeDocState } from "../loro/storage";
import { processPendingNodes, recoverOrphanedTasks } from "../loro/NodeProcessor";
import { pollNodeTasks } from "../loro/TaskPolling";
import { updateNodeData, appendNodeLog } from "../loro/NodeUpdater";
import { authenticateRequest } from "../loro/auth";
import type { ClientInfo, ClientType, PresenceMessage, ActivityMessage, ActivityAction } from "@clash/shared-types";

/** Alarm intervals in milliseconds */
const TASK_POLL_INTERVAL_MS = 60_000; // 60 seconds
const TASK_POLL_URGENT_MS = 2_000; // 2 seconds (after new task submission)
/** Compact the update log into a fresh shallow snapshot every N appended updates. */
const UPDATES_PER_COMPACT = 100;
/** Hard cap — if compaction is somehow stuck, force one to keep load fast. */
const UPDATES_HARD_COMPACT_THRESHOLD = 500;

export class ProjectRoom extends DurableObject<Env> {
  private doc: LoroDoc = new LoroDoc();
  private projectId = "";
  private initPromise: Promise<void> | null = null;
  private messageQueue: Array<{ sender: WebSocket; data: Uint8Array }> = [];
  private isProcessingQueue = false;
  private isProcessingNodes = false;

  /** Next sequence number for an appended update (loaded from storage on init). */
  private nextSeq = 0;
  /** Updates appended since last compaction. Triggers compactToSnapshot when it crosses UPDATES_PER_COMPACT. */
  private updatesSinceCompact = 0;
  /** Guard so we don't fire two compactions concurrently. */
  private compactionInFlight = false;
  /** Unsubscribe handle for the local-updates listener; cleared on destroy. */
  private unsubscribeLocalUpdates: (() => void) | null = null;

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

    // Persist projectId so alarm() can recover after hibernation.
    await this.ctx.storage.put("projectId", projectId);

    // Load via update-log: snapshot + replay all updates since.
    const state = await loadDocState(this.ctx.storage);
    this.doc = state.doc;
    this.nextSeq = state.nextSeq;
    this.updatesSinceCompact = state.nextSeq - state.snapshotSeq;

    // Subscribe to LOCAL commits (taskPoll / orphan recovery / HTTP /update-node).
    // Imports from client WebSockets are persisted explicitly in
    // processMessageQueue — Loro's subscribeLocalUpdates does NOT fire for
    // imported updates, by design.
    if (this.unsubscribeLocalUpdates) this.unsubscribeLocalUpdates();
    this.unsubscribeLocalUpdates = this.doc.subscribeLocalUpdates((update) => {
      void this.persistAndMaybeCompact(update);
    });

    // Schedule first alarm for task polling. Persistence is event-driven now,
    // not alarm-driven — the alarm is only for polling external task state.
    await this.ctx.storage.setAlarm(Date.now() + TASK_POLL_INTERVAL_MS);

    // Process any pending nodes and trigger polling.
    await this.taskPoll();
  }

  /**
   * Append one update to the persisted log and trigger compaction if
   * the log has grown past the threshold. Single funnel for both local
   * commits (via subscribeLocalUpdates) and remote imports (called
   * from processMessageQueue after doc.import).
   */
  private async persistAndMaybeCompact(update: Uint8Array): Promise<void> {
    const tag = `[room proj=${this.projectId.slice(-6)}]`;
    try {
      const seq = this.nextSeq;
      this.nextSeq = seq + 1;
      await appendUpdate(this.ctx.storage, seq, update);
      this.updatesSinceCompact++;
      if (
        !this.compactionInFlight &&
        this.updatesSinceCompact >= UPDATES_PER_COMPACT
      ) {
        this.compactionInFlight = true;
        // Run after the current write returns so we don't block the caller.
        queueMicrotask(() => {
          void this.runCompaction(tag);
        });
      } else if (
        this.compactionInFlight &&
        this.updatesSinceCompact >= UPDATES_HARD_COMPACT_THRESHOLD
      ) {
        log.warn(`${tag} update log past hard threshold (${this.updatesSinceCompact}); compaction stuck?`);
      }
    } catch (e) {
      log.error(`${tag} appendUpdate seq=${this.nextSeq - 1} failed:`, e);
    }
  }

  private async runCompaction(tag: string): Promise<void> {
    try {
      const compactionSeq = this.nextSeq;
      const t0 = Date.now();
      await compactToSnapshot(this.ctx.storage, this.doc, compactionSeq);
      this.updatesSinceCompact = this.nextSeq - compactionSeq;
      log.info(`${tag} compacted at seq ${compactionSeq} in ${Date.now() - t0}ms`);
    } catch (e) {
      log.error(`${tag} compaction failed:`, e);
    } finally {
      this.compactionInFlight = false;
    }
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
      editingNodeId: c.editingNodeId ?? null,
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

    if (msg.type === "set_editing_node") {
      // Soft edit-lock declaration. Clients announce which timeline node they
      // are actively editing; server-side writers (agent tools) consult
      // presence before mutating that node's timelineDsl. See
      // packages/shared-types/src/presence.ts → SetEditingNodeMessage.
      const nodeId = typeof msg.nodeId === "string" && msg.nodeId.length > 0 ? msg.nodeId : null;
      const client = this.clients.get(sender);
      if (!client) return;
      if (client.editingNodeId === nodeId) return; // no-op
      client.editingNodeId = nodeId;
      // Persist via attachment so it survives hibernation.
      sender.serializeAttachment(client);
      this.broadcastPresence();
      return;
    }

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

          // Persist this remote update — subscribeLocalUpdates does NOT fire
          // for imports, so this is the only persistence hook for client-
          // originated changes. Append-only, so it's safe to do unconditionally.
          void this.persistAndMaybeCompact(msg.data);

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

  // ─── Alarm (replaces schedule/cancelSchedule) ────────────────

  async alarm(): Promise<void> {
    // After hibernation, in-memory state is lost — re-initialize if needed.
    if (!this.projectId) {
      const storedId = await this.ctx.storage.get<string>("projectId");
      if (!storedId) return; // No project ever connected, nothing to do
      if (!this.initPromise) {
        this.initPromise = this.initRoom(storedId);
      }
      await this.initPromise;
    }

    // Persistence is event-driven now — every doc commit (local via
    // subscribeLocalUpdates, or imported via processMessageQueue) appends
    // to the update log inside persistAndMaybeCompact. The alarm only
    // runs task polling; it doesn't need to coordinate snapshot saves.
    await this.taskPoll();

    // Re-schedule next alarm only if clients are connected.
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
        log.warn(`[room proj=${this.projectId.slice(-6)}] /reset-doc invoked — wiping snapshot + update log + closing live WS`);
        await wipeDocState(this.ctx.storage);
        // Drop in-memory doc + reset seq counters so any subsequent
        // connection initialises fresh from an empty store.
        if (this.unsubscribeLocalUpdates) {
          this.unsubscribeLocalUpdates();
          this.unsubscribeLocalUpdates = null;
        }
        this.doc = new LoroDoc();
        this.nextSeq = 0;
        this.updatesSinceCompact = 0;
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
