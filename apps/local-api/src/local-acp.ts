import type { IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import { detectAll, type KnownAgentEntry } from "@clash-space/bridge/acp-runtime";
import { listLocalCcSessions } from "@clash-space/bridge/cc-sessions";
import { machineName, osTag as defaultOsTag } from "@clash-space/bridge/platform";
import { SessionManager, type ManagerOut } from "@clash-space/bridge/session-manager";
import type {
  LocalAcpAdapter,
  LocalAcpCreateSessionParams,
  LocalAcpResumeSession,
} from "./app.js";

export const DESKTOP_LOCAL_RUNTIME_ID = "desktop-local";

export type SessionManagerOut = ManagerOut;
export type SessionSender = (msg: SessionManagerOut) => void;

export interface SessionStartParamsLike {
  session_id: string;
  crew_id: string;
  agent_id?: string;
  crew_member_id?: string;
  project_id?: string;
  resume?: { acp_session_id: string };
}

export interface SessionPromptParamsLike {
  session_id: string;
  turn_id: string;
  text: string;
}

export interface SessionManagerLike {
  start(params: SessionStartParamsLike): Promise<void> | void;
  prompt(params: SessionPromptParamsLike): Promise<void> | void;
  cancel(sessionId: string, turnId: string): void;
  dispose(sessionId: string): Promise<void> | void;
}

export interface DetectedAcpAgent {
  id: string;
  label: string;
  spec: {
    command: string;
    args?: string[];
  };
}

export interface LocalAcpAdapterOptions {
  detectAgents?: () => Promise<DetectedAcpAgent[]>;
  listResumeSessions?: () => Promise<LocalAcpResumeSession[]>;
  createSessionId?: () => string;
  createSessionManager?: (send: SessionSender) => SessionManagerLike;
  hostname?: () => string;
  osTag?: () => string;
  nowSeconds?: () => number;
}

interface BrowserMessage {
  type?: string;
  turn_id?: string;
  text?: string;
}

interface LocalAcpSession {
  id: string;
  manager: SessionManagerLike;
  clients: Set<WebSocket>;
  backlog: SessionManagerOut[];
}

type UpgradeCapableServer = {
  on(event: "upgrade", listener: (request: IncomingMessage, socket: any, head: Buffer) => void): void;
};

const MAX_BACKLOG_MESSAGES = 200;

function defaultDetectAgents(): Promise<DetectedAcpAgent[]> {
  return detectAll() as Promise<KnownAgentEntry[]>;
}

function createDefaultSessionManager(send: SessionSender): SessionManagerLike {
  return new SessionManager(send);
}

function sendJson(ws: WebSocket, msg: unknown): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function parseBrowserMessage(raw: WebSocket.RawData): BrowserMessage | null {
  try {
    const text = Buffer.isBuffer(raw)
      ? raw.toString("utf8")
      : Array.isArray(raw)
        ? Buffer.concat(raw).toString("utf8")
        : typeof raw === "string"
          ? raw
          : Buffer.from(raw as ArrayBuffer).toString("utf8");
    return JSON.parse(text) as BrowserMessage;
  } catch {
    return null;
  }
}

export class LocalAcpRuntimeAdapter implements LocalAcpAdapter {
  private readonly detectAgents: () => Promise<DetectedAcpAgent[]>;
  private readonly listLocalSessions: () => Promise<LocalAcpResumeSession[]>;
  private readonly createSessionId: () => string;
  private readonly createSessionManager: (send: SessionSender) => SessionManagerLike;
  private readonly hostname: () => string;
  private readonly osTag: () => string;
  private readonly nowSeconds: () => number;
  private readonly sessions = new Map<string, LocalAcpSession>();

  constructor(options: LocalAcpAdapterOptions = {}) {
    this.detectAgents = options.detectAgents ?? defaultDetectAgents;
    this.listLocalSessions = options.listResumeSessions ?? (() => listLocalCcSessions(20));
    this.createSessionId = options.createSessionId ?? randomUUID;
    this.createSessionManager = options.createSessionManager ?? createDefaultSessionManager;
    this.hostname = options.hostname ?? machineName;
    this.osTag = options.osTag ?? defaultOsTag;
    this.nowSeconds = options.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  }

  async listRuntimes() {
    const agents = await this.detectAgents();
    const now = this.nowSeconds();
    return {
      runtimes: [
        {
          id: DESKTOP_LOCAL_RUNTIME_ID,
          machine_id: DESKTOP_LOCAL_RUNTIME_ID,
          hostname: this.hostname(),
          os: this.osTag(),
          agents: agents.map((agent) => ({
            id: agent.id,
            binary: agent.spec.command,
          })),
          version: "desktop",
          status: "online" as const,
          last_heartbeat: now,
          created_at: now,
        },
      ],
    };
  }

  async createSession(params: LocalAcpCreateSessionParams) {
    if (params.runtimeId !== DESKTOP_LOCAL_RUNTIME_ID) {
      throw new Error(`Unknown local runtime: ${params.runtimeId}`);
    }

    const agents = await this.detectAgents();
    const agent = agents[0];
    if (!agent) throw new Error("No local ACP agent found on PATH");

    const sessionId = this.createSessionId();
    let entry: LocalAcpSession;
    const send: SessionSender = (msg) => {
      entry.backlog.push(msg);
      if (entry.backlog.length > MAX_BACKLOG_MESSAGES) {
        entry.backlog.splice(0, entry.backlog.length - MAX_BACKLOG_MESSAGES);
      }
      for (const client of entry.clients) sendJson(client, msg);
    };
    entry = {
      id: sessionId,
      manager: this.createSessionManager(send),
      clients: new Set(),
      backlog: [],
    };
    this.sessions.set(sessionId, entry);

    const startParams: SessionStartParamsLike = {
      session_id: sessionId,
      crew_id: params.crewId,
      agent_id: agent.id,
      ...(params.crewMemberId ? { crew_member_id: params.crewMemberId } : {}),
      ...(params.projectId ? { project_id: params.projectId } : {}),
      ...(params.resumeAcpSessionId ? { resume: { acp_session_id: params.resumeAcpSessionId } } : {}),
    };

    void Promise.resolve(entry.manager.start(startParams)).catch((error) => {
      send({
        type: "session.error",
        session_id: sessionId,
        message: error instanceof Error ? error.message : String(error),
      });
    });

    return { session_id: sessionId };
  }

  async listResumeSessions(runtimeId: string) {
    if (runtimeId !== DESKTOP_LOCAL_RUNTIME_ID) return { sessions: [] };
    return { sessions: await this.listLocalSessions() };
  }

  bindSessionSocket(sessionId: string, ws: WebSocket): void {
    const entry = this.sessions.get(sessionId);
    if (!entry) {
      sendJson(ws, {
        type: "session.error",
        session_id: sessionId,
        message: "local session not found",
      });
      ws.close(1008, "session not found");
      return;
    }

    entry.clients.add(ws);
    sendJson(ws, { type: "attached", session_id: sessionId, daemon_online: true });
    for (const msg of entry.backlog) sendJson(ws, msg);

    ws.on("message", (raw) => {
      const msg = parseBrowserMessage(raw);
      if (!msg?.type) return;
      switch (msg.type) {
        case "prompt":
          if (msg.turn_id && typeof msg.text === "string") {
            void Promise.resolve(entry.manager.prompt({
              session_id: sessionId,
              turn_id: msg.turn_id,
              text: msg.text,
            })).catch((error) => {
              sendJson(ws, {
                type: "session.error",
                session_id: sessionId,
                turn_id: msg.turn_id,
                message: error instanceof Error ? error.message : String(error),
              });
            });
          }
          return;
        case "cancel":
          if (msg.turn_id) entry.manager.cancel(sessionId, msg.turn_id);
          return;
        case "dispose":
          void Promise.resolve(entry.manager.dispose(sessionId)).finally(() => {
            this.sessions.delete(sessionId);
          });
          return;
      }
    });

    ws.on("close", () => {
      entry.clients.delete(ws);
    });
  }
}

export function createLocalAcpAdapter(options?: LocalAcpAdapterOptions): LocalAcpRuntimeAdapter {
  return new LocalAcpRuntimeAdapter(options);
}

export function attachLocalAcpSessions(
  server: UpgradeCapableServer,
  adapter: LocalAcpRuntimeAdapter,
): void {
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const match = /^\/api\/v1\/local-sessions\/([^/]+)\/_stream$/.exec(url.pathname);
    if (!match) return;

    const sessionId = decodeURIComponent(match[1]);
    wss.handleUpgrade(request, socket, head, (ws) => {
      adapter.bindSessionSocket(sessionId, ws);
    });
  });
}
