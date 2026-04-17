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

import type { Env } from "../config";
import { log } from "../logger";
import { createModel } from "../providers";
import { createCanvasTools } from "./tools/canvas";
import { createTimelineTools } from "./tools/timeline";
import { createDelegationTool } from "./tools/delegation";
import { SUPERVISOR_PROMPT } from "../prompts/supervisor";
import { withCacheControl, cachedSystemPrompt } from "./cache-control";

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
  /** Cached model instance + provider type — avoids recreating per message. */
  private _model: ReturnType<typeof createModel> | null = null;

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
   * Stream AI response via the standard AIChatAgent flow.
   *
   * Uses createUIMessageStream + createUIMessageStreamResponse so the base
   * class handles SSE→WS conversion, resumable streaming, and persistence.
   */
  async onChatMessage(
    onFinish?: Parameters<AIChatAgent<Env>["onChatMessage"]>[0],
    options?: Parameters<AIChatAgent<Env>["onChatMessage"]>[1],
  ) {
    // Lazily connect to ProjectRoom on first chat message
    if (!this.roomConnection) {
      this.roomConnection = this.connectToRoom(this.projectId);
    }
    if (!this.roomInitialized) {
      await this.roomConnection;
    }

    if (!this._model) this._model = createModel(this.env);
    const { model, provider } = this._model;

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
    const delegationTool = createDelegationTool(model as any, allTools, provider);
    const tools = { ...allTools, task_delegation: delegationTool };

    const { streamText, convertToModelMessages, stepCountIs, createUIMessageStream, createUIMessageStreamResponse } = await import("ai");

    const modelMessages = await convertToModelMessages(this.messages, { tools });
    const MAX_STEPS = 100;

    const stream = createUIMessageStream({
      execute: ({ writer }) => {
        const result = streamText({
          model,
          system: cachedSystemPrompt(SUPERVISOR_PROMPT, provider),
          messages: withCacheControl(modelMessages, provider),
          tools,
          stopWhen: stepCountIs(MAX_STEPS),
          abortSignal: options?.abortSignal,
          // OpenAI Chat Completions tool messages only accept text content.
          // Tools that want to surface an image embed a [[CANVAS_IMAGE:mime:b64]] marker
          // in their text output. prepareStep strips the marker and injects a follow-up
          // user message with the image as image_url so the model can actually see it.
          prepareStep: ({ messages }) => {
            const out: any[] = [];
            const pendingImages: Array<{ mime: string; b64: string; toolCallId?: string }> = [];
            for (const msg of messages) {
              if (msg.role === "tool" && Array.isArray(msg.content)) {
                const cleanedContent = msg.content.map((part: any) => {
                  if (part.type !== "tool-result") return part;
                  const output = part.output;
                  // output can be { type: 'text', value: string } or { type: 'json', value: ... }
                  let text: string | null = null;
                  if (output?.type === "text" && typeof output.value === "string") text = output.value;
                  else if (output?.type === "json" && typeof output.value === "string") text = output.value;
                  if (!text) return part;
                  const MARKER = /\[\[CANVAS_IMAGE:([^:]+):([A-Za-z0-9+/=]+)\]\]/g;
                  let match: RegExpExecArray | null;
                  const localImages: Array<{ mime: string; b64: string }> = [];
                  while ((match = MARKER.exec(text)) !== null) {
                    localImages.push({ mime: match[1], b64: match[2] });
                  }
                  if (localImages.length === 0) return part;
                  const stripped = text.replace(MARKER, "").trim();
                  for (const img of localImages) pendingImages.push({ ...img, toolCallId: part.toolCallId });
                  return { ...part, output: { type: "text", value: stripped || "Image attached in the following user message." } };
                });
                out.push({ ...msg, content: cleanedContent });
                // Inject a follow-up user message with the images so the model can see them
                if (pendingImages.length > 0) {
                  const userContent: any[] = [
                    { type: "text", text: "Image(s) returned by the previous tool call:" },
                  ];
                  for (const img of pendingImages) {
                    // AI SDK 'image' part accepts base64 string (no data: prefix) or Uint8Array.
                    // See: ImagePart in @ai-sdk/provider
                    userContent.push({
                      type: "image",
                      image: img.b64,
                      mediaType: img.mime,
                    });
                  }
                  out.push({ role: "user", content: userContent });
                  pendingImages.length = 0;
                }
              } else {
                out.push(msg);
              }
            }
            return { messages: out };
          },
          onFinish: async ({ steps }) => {
            if (steps.length >= MAX_STEPS) {
              log.warn(`Step limit reached (${MAX_STEPS} steps)`);
              sendMsg({
                type: "suggestions",
                suggestions: [
                  { label: "Continue", message: "continue" },
                ],
              });
            }
          },
        });

        writer.merge(result.toUIMessageStream());
      },
    });

    return createUIMessageStreamResponse({ stream });
  }
}
