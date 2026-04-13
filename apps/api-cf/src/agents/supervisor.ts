/**
 * SupervisorAgent — independent AI agent Durable Object.
 *
 * Each instance is a separate Loro replica + LLM conversation context.
 * Multiple SupervisorAgents can operate on the same project concurrently,
 * sharing the canvas through ProjectRoom (Loro sequencer).
 *
 * Architecture:
 *   Browser ──WS──► SupervisorAgent ──WS──► ProjectRoom
 *   (chat)          (Loro replica + LLM)    (Loro sequencer)
 *
 * The browser also connects directly to ProjectRoom for Loro sync.
 * This agent only handles chat + canvas tool operations.
 */

import { AIChatAgent } from "@cloudflare/ai-chat";
import type { Connection, WSMessage } from "agents";
import { LoroDoc } from "loro-crdt";
import { createOpenAI } from "@ai-sdk/openai";

import type { Env } from "../config";
import { log } from "../logger";
import { createCanvasTools } from "./tools/canvas";
import { createTimelineTools } from "./tools/timeline";
import { createDelegationTool } from "./tools/delegation";
import { getSupervisorPrompt } from "../prompts/supervisor";
import { applyChunkToParts } from "./apply-chunk";

export class SupervisorAgent extends AIChatAgent<Env> {
  /** Local Loro CRDT replica — synced with ProjectRoom via internal WS. */
  private doc: LoroDoc = new LoroDoc();
  /** Internal WebSocket to ProjectRoom for Loro sync. */
  private roomWs: WebSocket | null = null;
  /** Project ID extracted from the DO name (format: "projectId:threadId"). */
  private projectId = "";
  /** Thread ID extracted from the DO name. */
  private threadId = "";
  /** Whether the initial snapshot has been received from ProjectRoom. */
  private roomInitialized = false;
  /** Promise that resolves once the room connection + snapshot are ready. */
  private roomConnection: Promise<void> | null = null;
  /** Current workspace group ID for scoping agent work. */
  private workspaceGroupId?: string;

  // ─── Connection Lifecycle ──────────────────────────────────

  async onConnect(connection: Connection, ctx: { request: Request }): Promise<void> {
    // Only extract IDs — don't connect to ProjectRoom until agent actually works
    const projectId = this.extractProjectId(ctx.request);
    if (!projectId) {
      log.error("Missing project ID");
      connection.close(4000, "Missing project ID");
      return;
    }
    this.projectId = projectId;
  }

  /**
   * When last browser client disconnects, wait for any in-flight work
   * to finish, then disconnect from ProjectRoom so the DO can hibernate.
   */
  async onClose(_connection: Connection): Promise<void> {
    const remaining = [...this.getConnections()].length;
    log.info(`Client disconnected. Remaining clients: ${remaining}`);

    if (remaining > 0) return;

    // No more browser clients — wait for active work to finish
    log.info("No clients remaining. Waiting for agent to become stable...");
    await this.waitUntilStable({ timeout: 300_000 }); // 5 min max

    // Disconnect from ProjectRoom → presence disappears → DO can hibernate
    if (this.roomWs) {
      log.info("Agent stable. Disconnecting from ProjectRoom.");
      this.roomWs.close();
      this.roomWs = null;
      this.roomInitialized = false;
      this.roomConnection = null;
    }
  }

  private extractProjectId(request: Request): string {
    const parseRoom = (room: string): string => {
      const colonIdx = room.indexOf(":");
      if (colonIdx > 0) {
        this.threadId = room.substring(colonIdx + 1);
        return room.substring(0, colonIdx);
      }
      return room;
    };

    // Try x-partykit-room header first (set by router): "projectId:threadId"
    const room = request.headers.get("x-partykit-room");
    if (room) return parseRoom(room);

    // Fallback: parse URL path /agents/supervisor/:room
    const url = new URL(request.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    if (pathParts[0] === "agents" && pathParts[1] === "supervisor" && pathParts[2]) {
      return parseRoom(pathParts[2]);
    }

    return "";
  }

  // ─── ProjectRoom Connection ────────────────────────────────

  /**
   * Connect to ProjectRoom DO (same worker, shared bindings).
   * Receives the initial snapshot and subscribes to incremental updates.
   */
  private async connectToRoom(projectId: string): Promise<void> {
    const roomId = this.env.ROOM.idFromName(projectId);
    const stub = this.env.ROOM.get(roomId);

    const resp = await stub.fetch(
      new Request(`https://internal/sync/${projectId}`, {
        headers: {
          "Upgrade": "websocket",
          "x-partykit-room": projectId,
          "x-partykit-namespace": "ROOM",
          "x-internal-agent": "true",
          "x-agent-name": this.threadId?.slice(-6) || "Agent",
        },
      })
    );

    const ws = resp.webSocket;
    if (!ws) {
      throw new Error("ProjectRoom did not return a WebSocket");
    }
    ws.accept();
    this.roomWs = ws;

    // Wait for the initial snapshot before resolving
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timeout waiting for ProjectRoom snapshot"));
      }, 30_000);

      ws.addEventListener("message", (event) => {
        // Only handle binary messages (Loro updates)
        if (typeof event.data === "string") return;

        const data = new Uint8Array(event.data as ArrayBuffer);

        if (!this.roomInitialized) {
          // First binary message = snapshot
          try {
            this.doc = LoroDoc.fromSnapshot(data);
          } catch {
            // Might be an update rather than a snapshot — try import
            this.doc = new LoroDoc();
            try {
              this.doc.import(data);
            } catch (e) {
              log.error("Failed to initialize doc:", e);
            }
          }
          this.roomInitialized = true;
          clearTimeout(timeout);
          resolve();
        } else {
          // Subsequent messages = incremental updates
          try {
            this.doc.import(data);
          } catch (e) {
            log.error("Failed to import room update:", e);
          }
        }
      });

      ws.addEventListener("close", () => {
        this.roomWs = null;
        this.roomInitialized = false;
        this.roomConnection = null;
      });

      ws.addEventListener("error", (e) => {
        log.error("ProjectRoom WebSocket error:", e);
        clearTimeout(timeout);
        reject(new Error("ProjectRoom WebSocket error"));
      });
    });
  }

  /**
   * Send a Loro update to ProjectRoom for broadcast.
   * Used as the `broadcast` function for canvas tools.
   */
  private broadcastToRoom = (update: Uint8Array): void => {
    if (this.roomWs?.readyState === WebSocket.OPEN) {
      this.roomWs.send(update);
    } else {
      log.warn("Cannot broadcast — room WS not open");
    }
  };

  // ─── Message Handling ──────────────────────────────────────

  async onMessage(connection: Connection, message: WSMessage): Promise<void> {
    if (typeof message === "string") {
      try {
        const parsed = JSON.parse(message);

        // Handle context messages from frontend
        if (parsed.type === "context_update") {
          return; // No-op: agent has the Loro doc
        }

        if (parsed.type === "context" && parsed.workspaceGroupId) {
          this.workspaceGroupId = parsed.workspaceGroupId;
          return;
        }

        if (parsed.type === "cancel") {
          return;
        }

        // Legacy "chat" type — extract workspaceGroupId if present
        if (parsed.type === "chat" && parsed.workspaceGroupId) {
          this.workspaceGroupId = parsed.workspaceGroupId;
        }
      } catch {
        // Not JSON — fall through to AIChatAgent
      }
    }

    // Delegate to AIChatAgent protocol (handles cf_agent_use_chat_request, etc.)
    await super.onMessage(connection, message);
  }

  // ─── AI Chat ────────────────────────────────────────────────

  /**
   * Stream AI response directly via WebSocket, bypassing SSE serialization.
   *
   * The default AIChatAgent flow: streamText → SSE Response → _reply → _streamSSEReply → WS
   * has a bug where SSE chunks split mid-line cause silent event drops.
   *
   * Our flow: streamText → toUIMessageStream (objects) → WS directly.
   * We return `undefined` from onChatMessage and handle streaming + persistence ourselves.
   */
  async onChatMessage(_onFinish: unknown, options?: { abortSignal?: AbortSignal; requestId?: string }) {
    // Lazily connect to ProjectRoom on first chat message
    if (!this.roomConnection) {
      this.roomConnection = this.connectToRoom(this.projectId);
    }
    if (!this.roomInitialized) {
      await this.roomConnection;
    }

    const openai = createOpenAI({
      apiKey: this.env.CF_AIG_TOKEN,
      baseURL: this.env.CF_AIG_OPENAI_URL,
    });
    const model = openai.chat("gpt-5");

    // Send custom events to all connected browser clients
    const sendMsg = (msg: Record<string, unknown>) => {
      for (const conn of this.getConnections()) {
        try {
          conn.send(JSON.stringify(msg));
        } catch {
          // Connection may be closing
        }
      }
    };

    const generateId = () => crypto.randomUUID().slice(0, 8);
    const getWorkspaceGroupId = () => this.workspaceGroupId;

    const canvasTools = createCanvasTools(this.doc, this.broadcastToRoom, sendMsg, generateId, getWorkspaceGroupId, this.env, this.projectId);
    const timelineTools = createTimelineTools(sendMsg);
    const allTools = { ...canvasTools, ...timelineTools };
    const delegationTool = createDelegationTool(model as any, allTools);
    const tools = { ...allTools, task_delegation: delegationTool };

    const { streamText, convertToModelMessages, stepCountIs } = await import("ai");

    const result = streamText({
      model,
      system: getSupervisorPrompt([
        "ScriptWriter",
        "ConceptArtist",
        "StoryboardDesigner",
        "Editor",
      ]),
      messages: await convertToModelMessages(this.messages),
      tools,
      stopWhen: stepCountIs(30),
      abortSignal: options?.abortSignal,
    });

    // Stream directly via WebSocket — no SSE intermediate layer.
    const requestId = options?.requestId ?? crypto.randomUUID();
    const self = this as any;
    const streamId = self._startStream(requestId);
    const message = self._createStreamingAssistantMessage(false);
    self._streamingMessage = message;

    const MSG_TYPE = "cf_agent_use_chat_response";

    try {
      for await (const chunk of result.toUIMessageStream()) {
        // Build server-side message parts (mirrors what client does)
        applyChunkToParts(message.parts, chunk);

        // Remap finish event to include finishReason in messageMetadata
        let event = chunk as Record<string, unknown>;
        if (chunk.type === "finish" && "finishReason" in chunk) {
          const { finishReason, ...rest } = chunk as any;
          event = { ...rest, type: "finish", messageMetadata: { finishReason } };
        }

        // Handle start event: extract messageId
        if (chunk.type === "start" && (chunk as any).messageId != null) {
          message.id = (chunk as any).messageId;
        }
        if ((chunk.type === "start" || chunk.type === "finish" || chunk.type === "message-metadata") && (chunk as any).messageMetadata != null) {
          message.metadata = message.metadata
            ? { ...message.metadata, ...(chunk as any).messageMetadata }
            : (chunk as any).messageMetadata;
        }

        const body = JSON.stringify(event);
        self._storeStreamChunk(streamId, body);
        self._broadcastChatMessage({ body, done: false, id: requestId, type: MSG_TYPE });
      }
    } catch (err) {
      log.error("Stream error:", err);
      self._markStreamError(streamId);
      self._broadcastChatMessage({
        body: err instanceof Error ? err.message : "Stream error",
        done: true,
        error: true,
        id: requestId,
        type: MSG_TYPE,
      });
      throw err;
    } finally {
      self._streamingMessage = null;
    }

    // Signal stream complete
    self._completeStream(streamId);
    self._broadcastChatMessage({ body: "", done: true, id: requestId, type: MSG_TYPE });

    // Persist the message built by applyChunkToParts
    if (message.parts.length > 0) {
      await this.persistMessages([...this.messages, message] as any);
    }

    // Return undefined — we already streamed everything via WS.
    return undefined;
  }
}
