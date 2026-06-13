import { createRequire } from "node:module";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { pathToFileURL } from "node:url";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
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
  publicProviderAccounts,
  type LocalProviderAccountConfig,
  type LocalVariableRecord,
} from "./provider-accounts.js";
import {
  attachLocalSync,
  type RemoteLoroPersistenceSource,
} from "./sync.js";
import { createLocalSyncConfigStore } from "./sync-config.js";

const port = Number(process.env.PORT ?? 49321);
const dataDir =
  process.env.CLASH_LOCAL_DATA_DIR ??
  join(homedir(), ".clash", "local-api");
const require = createRequire(import.meta.url);

export interface LocalApiServerOptions {
  port: number;
  dataDir: string;
  remotePersistence?: RemoteLoroPersistenceSource | null;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function resolveClashCliEntry(): string {
  return require.resolve("@clash-space/cli");
}

export function createLocalAgentToolEnv({
  dataDir,
  apiBaseUrl,
  env = process.env,
}: {
  dataDir: string;
  apiBaseUrl: string;
  env?: Record<string, string | undefined>;
}): Record<string, string> {
  const binDir = join(dataDir, "agent-bin");
  mkdirSync(binDir, { recursive: true });

  const apiKey = env.CLASH_API_KEY ?? "clsh_local_desktop";
  const apiUrl = env.CLASH_API_URL ?? apiBaseUrl;
  const shim = join(binDir, "clash");
  writeFileSync(
    shim,
    [
      "#!/bin/sh",
      `export CLASH_API_KEY=${shellQuote(apiKey)}`,
      `export CLASH_API_URL=${shellQuote(apiUrl)}`,
      `if [ -n "$CLASH_NODE_EXEC_PATH" ]; then`,
      `  exec "$CLASH_NODE_EXEC_PATH" ${shellQuote(resolveClashCliEntry())} "$@"`,
      "fi",
      "if command -v node >/dev/null 2>&1; then",
      `  exec node ${shellQuote(resolveClashCliEntry())} "$@"`,
      "fi",
      "export ELECTRON_RUN_AS_NODE=1",
      `exec ${shellQuote(process.execPath)} ${shellQuote(resolveClashCliEntry())} "$@"`,
      "",
    ].join("\n"),
    "utf8",
  );
  chmodSync(shim, 0o755);

  return {
    CLASH_API_KEY: apiKey,
    CLASH_API_URL: apiUrl,
    ...(env.CLASH_NODE_EXEC_PATH ? { CLASH_NODE_EXEC_PATH: env.CLASH_NODE_EXEC_PATH } : {}),
    PATH: [binDir, env.PATH].filter(Boolean).join(delimiter),
  };
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
  options: { apiBaseUrl?: string } = {},
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
  return createLocalAcpAdapter({
    spawnEnv: createLocalAgentToolEnv({
      dataDir: env.CLASH_LOCAL_DATA_DIR ?? dataDir,
      apiBaseUrl: options.apiBaseUrl ?? env.CLASH_API_URL ?? `http://127.0.0.1:${port}`,
      env,
    }),
  });
}

const LOCAL_PROVIDER_VARIABLE_KEYS = [
  "FAL_API_KEY",
  "OPENAI_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_VERTEX",
  "REPLICATE_API_TOKEN",
  "KIE_API_KEY",
  "OFFICIAL_API_KEY",
  "ANTHROPIC_API_KEY",
  "ELEVENLABS_API_KEY",
];

async function loadLocalVariables(
  dataDir: string,
  userId = "local-user",
  env: Record<string, string | undefined> = process.env,
): Promise<Record<string, string>> {
  const variables: Record<string, string> = {};
  for (const key of LOCAL_PROVIDER_VARIABLE_KEYS) {
    const value = env[key]?.trim();
    if (value) variables[key] = value;
  }
  try {
    const db = JSON.parse(await readFile(join(dataDir, "db.json"), "utf8")) as {
      variables?: Array<{ userId?: string; key?: string; value?: string }>;
    };
    for (const variable of db.variables ?? []) {
      if (variable.userId !== userId) continue;
      if (typeof variable.key !== "string" || typeof variable.value !== "string") continue;
      if (variable.value.trim()) variables[variable.key] = variable.value;
    }
    return variables;
  } catch {
    return variables;
  }
}

async function loadLocalProviderAccounts(
  dataDir: string,
  userId = "local-user",
  env: Record<string, string | undefined> = process.env,
) {
  const variables: LocalVariableRecord[] = [];
  for (const key of LOCAL_PROVIDER_VARIABLE_KEYS) {
    const value = env[key]?.trim();
    if (value) variables.push({ userId, key, value });
  }
  let providerAccounts: LocalProviderAccountConfig[] = [];
  try {
    const db = JSON.parse(await readFile(join(dataDir, "db.json"), "utf8")) as {
      variables?: LocalVariableRecord[];
      providerAccounts?: LocalProviderAccountConfig[];
    };
    for (const variable of db.variables ?? []) {
      if (variable.userId !== userId) continue;
      if (typeof variable.key !== "string" || typeof variable.value !== "string") continue;
      if (variable.value.trim()) variables.push(variable);
    }
    providerAccounts = (db.providerAccounts ?? []).filter((account) => account.userId === userId);
  } catch {
    // Missing local DB should not prevent env-only provider account discovery.
  }
  return publicProviderAccounts(providerAccounts, variables, userId);
}

export function startLocalApiServer(options: LocalApiServerOptions) {
  const localAcp = createConfiguredLocalAcpAdapter(process.env, {
    apiBaseUrl: `http://127.0.0.1:${options.port}`,
  });
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
      variables: () => loadLocalVariables(options.dataDir),
      providerAccounts: () => loadLocalProviderAccounts(options.dataDir),
      openAiBaseUrl: process.env.OPENAI_BASE_URL,
      falQueueBaseUrl: process.env.CLASH_FAL_QUEUE_URL,
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
