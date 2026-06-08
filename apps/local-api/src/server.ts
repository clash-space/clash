import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { serve } from "@hono/node-server";
import { createLocalApiApp } from "./app.js";
import { createMockExternalAigcService } from "./local-aigc.js";
import {
  attachLocalAcpSessions,
  createLocalAcpAdapter,
  type SessionManagerLike,
  type SessionSender,
} from "./local-acp.js";
import { createMockFalQueueService } from "./fal-mock.js";
import { createLocalWorkflowProcessor } from "./local-processor.js";
import {
  attachLocalSync,
  type RemoteLoroPersistenceSource,
} from "./sync.js";
import { createLocalSyncConfigStore } from "./sync-config.js";

const port = Number(process.env.PORT ?? 49321);
const dataDir =
  process.env.CLASH_LOCAL_DATA_DIR ??
  join(homedir(), ".clash", "local-api");

export interface LocalApiServerOptions {
  port: number;
  dataDir: string;
  remotePersistence?: RemoteLoroPersistenceSource | null;
}

function createMockCanvasPatch(turnId: string, text: string) {
  const safeTurnId = turnId.replace(/[^a-zA-Z0-9_-]/g, "-");
  return {
    sessionUpdate: "clash.canvas.patch",
    operations: [
      {
        op: "add_node",
        node: {
          id: `mock-agent-stage-${safeTurnId}`,
          type: "group",
          data: { label: "Agent Stage" },
          position: { x: 480, y: 140 },
          width: 620,
          height: 360,
          style: { width: 620, height: 360 },
        },
      },
      {
        op: "add_node",
        node: {
          id: `mock-agent-brief-${safeTurnId}`,
          type: "action-badge",
          data: {
            label: "Agent Brief",
            actionType: "text-gen",
            content: `# Agent Brief\n${text}`,
          },
          position: { x: 530, y: 210 },
          width: 260,
          height: 48,
        },
      },
      {
        op: "add_node",
        node: {
          id: `mock-agent-action-${safeTurnId}`,
          type: "action-badge",
          data: {
            label: "Agent Image Pass",
            actionType: "image-gen",
            content: `# Prompt\n${text}`,
          },
          position: { x: 530, y: 320 },
          width: 260,
          height: 48,
        },
      },
    ],
  };
}

function createMockAcpSessionManager(send: SessionSender): SessionManagerLike {
  return {
    start: ({ session_id }) => {
      send({
        type: "session.ready",
        session_id,
        acp_session_id: "mock-acp-session",
      });
    },
    prompt: ({ session_id, turn_id, text }) => {
      send({
        type: "session.event",
        session_id,
        turn_id,
        event: { type: "text", text: `Mock ACP reply: ${text}` },
      });
      send({
        type: "session.event",
        session_id,
        turn_id,
        event: createMockCanvasPatch(turn_id, text),
      });
      send({ type: "session.complete", session_id, turn_id });
    },
    cancel: () => undefined,
    dispose: (sessionId) => {
      send({ type: "session.disposed", session_id: sessionId });
    },
  };
}

export function createConfiguredLocalAcpAdapter(
  env: Record<string, string | undefined> = process.env,
) {
  if (env.CLASH_LOCAL_ACP_MOCK === "1") {
    return createLocalAcpAdapter({
      detectAgents: async () => [
        {
          id: "mock-acp",
          label: "Mock ACP",
          spec: { command: "mock-acp" },
        },
      ],
      listResumeSessions: async () => [],
      createSessionManager: createMockAcpSessionManager,
      hostname: () => "Mock Desktop",
      osTag: () => "mock/e2e",
    });
  }
  return createLocalAcpAdapter();
}

export function startLocalApiServer(options: LocalApiServerOptions) {
  const localAcp = createConfiguredLocalAcpAdapter();
  const falMock = createMockFalQueueService();
  const syncConfig = createLocalSyncConfigStore({
    dataDir: options.dataDir,
    env: process.env,
  });
  const app = createLocalApiApp({
    dataDir: options.dataDir,
    localAcp,
    falMock,
    syncConfig,
  });
  const workflowProcessor = createLocalWorkflowProcessor({
    dataDir: options.dataDir,
    aigc: createMockExternalAigcService({
      fal: falMock,
      origin: `http://127.0.0.1:${options.port}`,
    }),
  });
  const remotePersistence = options.remotePersistence === undefined
    ? () => syncConfig.resolveRemotePersistence()
    : options.remotePersistence ?? undefined;
  let resolveListening!: (server: ReturnType<typeof serve>) => void;
  const listening = new Promise<ReturnType<typeof serve>>((resolve) => {
    resolveListening = resolve;
  });
  const server = serve({ fetch: app.fetch, port: options.port }, (info) => {
    console.log(`[local-api] listening on http://127.0.0.1:${info.port}`);
    console.log(`[local-api] data dir: ${options.dataDir}`);
    void syncConfig.getPublicConfig().then((config) => {
      if (config.remote_loro.enabled) {
        console.log(`[local-api] remote Loro persistence: enabled (${config.remote_loro.source})`);
      }
    });
    resolveListening(server);
  });
  attachLocalSync(server, { dataDir: options.dataDir, remotePersistence, workflowProcessor });
  attachLocalAcpSessions(server, localAcp);
  return listening;
}

const directRunUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === directRunUrl) {
  void startLocalApiServer({ port, dataDir });
}
