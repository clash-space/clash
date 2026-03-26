/**
 * ProjectRoom — pure Loro CRDT sequencer Durable Object.
 *
 * Handles:
 * - Loro CRDT sync (binary WebSocket messages)
 * - Task submission (NodeProcessor) and polling (TaskPolling)
 * - Periodic snapshot persistence to D1
 *
 * Does NOT handle AI chat — that responsibility lives in SupervisorAgent.
 *
 * Two connection types:
 * - Browser clients via /sync/:projectId (authenticated)
 * - SupervisorAgent DOs via internal WS (x-internal-agent header)
 */

import { Agent } from "agents";
import type { Connection, WSMessage } from "agents";
import { LoroDoc } from "loro-crdt";

import type { Env } from "../config";
import { loadSnapshot, saveSnapshot } from "../loro/storage";
import { processPendingNodes } from "../loro/NodeProcessor";
import { pollNodeTasks } from "../loro/TaskPolling";
import { updateNodeData } from "../loro/NodeUpdater";
import { authenticateRequest } from "../loro/auth";

/** Schedule IDs for deduplication — only one of each should exist at a time. */
interface ScheduleIds {
  snapshotSave?: string;
  taskPoll?: string;
}

export class ProjectRoom extends Agent<Env> {
  private doc: LoroDoc = new LoroDoc();
  private projectId = "";
  private initPromise: Promise<void> | null = null;
  private messageQueue: Array<{ sender: Connection; data: Uint8Array }> = [];
  private isProcessingQueue = false;
  private isSaving = false;
  private needsSave = false;
  private saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private scheduleIds: ScheduleIds = {};

  // ─── Lifecycle ──────────────────────────────────────────────

  onStart(): void {
    // No SQL init needed — canvas state lives in Loro doc
  }

  async onConnect(connection: Connection, ctx: { request: Request }): Promise<void> {
    const url = new URL(ctx.request.url);

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
      console.error("[ProjectRoom] Missing project ID");
      connection.close(4000, "Missing project ID");
      return;
    }

    // Skip auth for internal agent connections
    const isInternal = ctx.request.headers.get("x-internal-agent") === "true";
    if (!isInternal) {
      try {
        await authenticateRequest(ctx.request, this.env, projectId);
      } catch (error) {
        console.error("[ProjectRoom] Auth failed:", error);
        connection.close(4001, "Unauthorized");
        return;
      }
    }

    // Initialize on first connection
    if (!this.initPromise) {
      this.initPromise = this.initRoom(projectId);
    }
    await this.initPromise;

    // Verify project ID matches
    if (this.projectId !== projectId) {
      console.error(`[ProjectRoom] Project ID mismatch: expected ${this.projectId}, got ${projectId}`);
      connection.close(4003, "Project ID mismatch");
      return;
    }

    // Send initial Loro state to new client
    try {
      const snapshot = this.doc.export({ mode: "snapshot" });
      connection.send(snapshot);
    } catch (error) {
      console.error("[ProjectRoom] Failed to send initial state:", error);
    }
  }

  private async initRoom(projectId: string): Promise<void> {
    this.projectId = projectId;

    // Load Loro document from D1
    const snapshot = await loadSnapshot(this.env.DB, projectId);
    if (snapshot) {
      try {
        this.doc = LoroDoc.fromSnapshot(snapshot);
      } catch (error) {
        console.error("[ProjectRoom] Failed to import snapshot:", error);
        this.doc = new LoroDoc();
      }
    } else {
      this.doc = new LoroDoc();
    }

    // Schedule periodic snapshot save (deduplicated)
    await this.scheduleOnce("snapshotSave", 300);

    // Process any pending nodes and trigger polling
    await this.taskPoll();
  }

  // ─── Schedule Helpers (deduplication) ─────────────────────

  /**
   * Schedule a callback, cancelling any previous schedule for the same callback.
   * Prevents schedule accumulation in cf_agents_schedules.
   */
  private async scheduleOnce(callback: keyof ScheduleIds, delaySeconds: number): Promise<void> {
    // Cancel previous schedule if it exists
    const prevId = this.scheduleIds[callback];
    if (prevId) {
      try {
        await this.cancelSchedule(prevId);
      } catch {
        // Schedule may have already fired or been cleaned up
      }
    }

    // Create new schedule — schedule() returns { id, callback, ... }
    const result = await this.schedule(delaySeconds, callback);
    this.scheduleIds[callback] = (result as any).id as string;
  }

  // ─── Message Handling ───────────────────────────────────────

  async onMessage(connection: Connection, message: WSMessage): Promise<void> {
    // Binary message → Loro CRDT update
    if (message instanceof ArrayBuffer) {
      const updates = new Uint8Array(message);
      this.messageQueue.push({ sender: connection, data: updates });
      if (!this.isProcessingQueue) {
        this.processMessageQueue();
      }
      return;
    }

    // Ignore non-binary messages — no chat handling in ProjectRoom
  }

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
          this.doc.import(msg.data);

          // Broadcast to all other clients FIRST so they have the base state
          // before receiving any derived updates from processPendingNodes.
          this.broadcastBinary(msg.data, msg.sender);

          // Check for pending nodes (may emit additional broadcasts)
          await processPendingNodes(
            this.doc,
            this.env,
            this.projectId,
            (data: Uint8Array) => this.broadcastBinary(data),
            () => this.triggerTaskPolling()
          );

          // Debounced snapshot save (5s after last update)
          this.debouncedSave();
        } catch (error) {
          console.error("[ProjectRoom] Failed to process Loro update:", error);
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
  private broadcastBinary(data: Uint8Array, sender?: Connection): void {
    for (const conn of this.getConnections()) {
      if (conn === sender) continue;
      try {
        conn.send(data);
      } catch (error) {
        console.error("[ProjectRoom] Failed to broadcast to client:", error);
      }
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
        console.error("[ProjectRoom] Failed to save snapshot:", err)
      );
    }, 5_000);
  }

  /**
   * Scheduled method: save Loro snapshot to D1.
   * Re-schedules itself every 5 minutes (deduplicated).
   */
  async snapshotSave(): Promise<void> {
    await this.saveDocumentSnapshot();
    // Re-schedule next save (deduplicated — cancels previous)
    await this.scheduleOnce("snapshotSave", 300);
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
      await saveSnapshot(this.env.DB, this.projectId, snapshot, version);
    } catch (error) {
      console.error("[ProjectRoom] Failed to save snapshot:", error);
    } finally {
      this.isSaving = false;
      if (this.needsSave) {
        setTimeout(() => this.saveDocumentSnapshot(), 100);
      }
    }
  }

  // ─── Task Polling ───────────────────────────────────────────

  /**
   * Scheduled method: process pending nodes + poll task status.
   */
  async taskPoll(): Promise<void> {
    if (!this.projectId) return;

    try {
      // Submit pending tasks
      await processPendingNodes(
        this.doc,
        this.env,
        this.projectId,
        (data: Uint8Array) => this.broadcastBinary(data),
        () => this.triggerTaskPolling()
      );

      // Poll tasks with pendingTask field
      const stillPending = await pollNodeTasks(
        this.doc,
        this.env,
        this.projectId,
        (data: Uint8Array) => this.broadcastBinary(data)
      );

      if (stillPending) {
        // Continue polling at 60s intervals (deduplicated)
        await this.scheduleOnce("taskPoll", 60);
      }
    } catch (error) {
      console.error("[ProjectRoom] Error in taskPoll:", error);
    }
  }

  private async triggerTaskPolling(): Promise<void> {
    await this.scheduleOnce("taskPoll", 2);
  }

  // ─── Internal HTTP Endpoints ────────────────────────────────

  async onRequest(request: Request): Promise<Response> {
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

        await processPendingNodes(
          this.doc,
          this.env,
          this.projectId,
          (data: Uint8Array) => this.broadcastBinary(data),
          () => this.triggerTaskPolling()
        );

        this.debouncedSave();

        return Response.json({ ok: true });
      } catch (error) {
        console.error("[ProjectRoom] Update node error:", error);
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
        console.error("[ProjectRoom] Get nodes error:", error);
        return Response.json({ error: "Failed to get nodes" }, { status: 500 });
      }
    }

    return new Response("ProjectRoom", { status: 200 });
  }
}
