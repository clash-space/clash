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
import { createCanvasTools } from "./tools/canvas";
import { createTimelineTools } from "./tools/timeline";
import { createDelegationTool } from "./tools/delegation";
import { getSupervisorPrompt } from "../prompts/supervisor";

export class SupervisorAgent extends AIChatAgent<Env> {
  /** Local Loro CRDT replica — synced with ProjectRoom via internal WS. */
  private doc: LoroDoc = new LoroDoc();
  /** Internal WebSocket to ProjectRoom for Loro sync. */
  private roomWs: WebSocket | null = null;
  /** Project ID extracted from the DO name (format: "projectId:agentId"). */
  private projectId = "";
  /** Whether the initial snapshot has been received from ProjectRoom. */
  private roomInitialized = false;
  /** Promise that resolves once the room connection + snapshot are ready. */
  private roomConnection: Promise<void> | null = null;
  /** Current workspace group ID for scoping agent work. */
  private workspaceGroupId?: string;

  // ─── Connection Lifecycle ──────────────────────────────────

  async onConnect(connection: Connection, ctx: { request: Request }): Promise<void> {
    // Extract projectId from URL path or x-partykit-room header
    const projectId = this.extractProjectId(ctx.request);
    if (!projectId) {
      console.error("[SupervisorAgent] Missing project ID");
      connection.close(4000, "Missing project ID");
      return;
    }

    // Establish room connection (once per DO instance)
    if (!this.roomConnection) {
      this.roomConnection = this.connectToRoom(projectId);
    }

    try {
      await this.roomConnection;
    } catch (error) {
      console.error("[SupervisorAgent] Failed to connect to ProjectRoom:", error);
      // Reset so next connection can retry
      this.roomConnection = null;
      connection.close(4002, "Failed to connect to project room");
      return;
    }
  }

  private extractProjectId(request: Request): string {
    // Try x-partykit-room header first (set by router): "projectId:agentId"
    const room = request.headers.get("x-partykit-room");
    if (room) {
      const colonIdx = room.indexOf(":");
      return colonIdx > 0 ? room.substring(0, colonIdx) : room;
    }

    // Fallback: parse URL path /agents/supervisor/:room
    const url = new URL(request.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    if (pathParts[0] === "agents" && pathParts[1] === "supervisor" && pathParts[2]) {
      const room2 = pathParts[2];
      const colonIdx = room2.indexOf(":");
      return colonIdx > 0 ? room2.substring(0, colonIdx) : room2;
    }

    return "";
  }

  // ─── ProjectRoom Connection ────────────────────────────────

  /**
   * Establish internal WebSocket connection to ProjectRoom.
   * Receives the initial snapshot and subscribes to incremental updates.
   */
  private async connectToRoom(projectId: string): Promise<void> {
    this.projectId = projectId;

    const roomId = this.env.ROOM.idFromName(projectId);
    const stub = this.env.ROOM.get(roomId);

    // Create WebSocket upgrade request to ProjectRoom
    const resp = await stub.fetch(
      new Request(`https://internal/sync/${projectId}`, {
        headers: {
          "Upgrade": "websocket",
          "x-partykit-room": projectId,
          "x-partykit-namespace": "ROOM",
          "x-internal-agent": "true",
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
              console.error("[SupervisorAgent] Failed to initialize doc:", e);
            }
          }
          this.roomInitialized = true;
          clearTimeout(timeout);
          console.log(`[SupervisorAgent] Connected to ProjectRoom for project: ${projectId}`);
          resolve();
        } else {
          // Subsequent messages = incremental updates
          try {
            this.doc.import(data);
          } catch (e) {
            console.error("[SupervisorAgent] Failed to import room update:", e);
          }
        }
      });

      ws.addEventListener("close", () => {
        console.log("[SupervisorAgent] ProjectRoom connection closed");
        this.roomWs = null;
        this.roomInitialized = false;
        this.roomConnection = null;
      });

      ws.addEventListener("error", (e) => {
        console.error("[SupervisorAgent] ProjectRoom WebSocket error:", e);
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
      console.warn("[SupervisorAgent] Cannot broadcast — room WS not open");
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

  async onChatMessage(_onFinish: unknown, options?: { abortSignal?: AbortSignal }) {
    // Ensure room connection is ready
    if (!this.roomInitialized) {
      if (this.roomConnection) {
        await this.roomConnection;
      } else {
        throw new Error("Not connected to ProjectRoom");
      }
    }

    const openai = createOpenAI({
      apiKey: this.env.CF_AIG_TOKEN,
      baseURL: "https://gateway.ai.cloudflare.com/v1/44af79e51582ca20c9003eb926540242/clash/openai",
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

    const canvasTools = createCanvasTools(this.doc, this.broadcastToRoom, sendMsg, generateId, getWorkspaceGroupId);
    const timelineTools = createTimelineTools(sendMsg);
    const allTools = { ...canvasTools, ...timelineTools };
    const delegationTool = createDelegationTool(model as any, allTools, sendMsg);
    const tools = { ...allTools, task_delegation: delegationTool };

    const { streamText, convertToModelMessages } = await import("ai");

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
      abortSignal: options?.abortSignal,
    });

    return result.toUIMessageStreamResponse();
  }
}
