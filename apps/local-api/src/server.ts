import { createRequire } from "node:module";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { pathToFileURL } from "node:url";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { serve } from "@hono/node-server";
import type { HostLaunchMode, HostStartedBy } from "@clash/shared-runtime";
import { createLocalApiApp } from "./app.js";
import {
  createHostDiscoveryRecord,
  removeHostDiscovery,
  writeHostDiscovery,
} from "./host-discovery.js";
import { createMockExternalAigcService } from "./local-aigc.js";
import { createDreaminaCliOAuthDriver } from "./dreamina-cli.js";
import {
  attachLocalAcpSessions,
  createLocalAcpAdapter,
  createLocalHarnessConfigStore,
  type SessionManagerLike,
  type SessionSender,
} from "./local-acp.js";
import { createMockFalQueueService } from "./fal-mock.js";
import { createLocalWorkflowProcessor } from "./local-processor.js";
import {
  providerAccountsForRuntime,
  publicProviderAccounts,
  type LocalProviderAccountConfig,
  type LocalProviderOAuthRecord,
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
  discovery?: {
    enabled?: boolean;
    runDir?: string;
    launchMode?: HostLaunchMode;
    ownerClientId?: string;
    startedBy?: HostStartedBy;
  };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function resolveClashCliEntry(env: Record<string, string | undefined>): string {
  return env.CLASH_CLI_ENTRY_PATH || require.resolve("@clash-space/cli");
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
  const cliEntry = resolveClashCliEntry(env);
  const shim = join(binDir, "clash");
  writeFileSync(
    shim,
    [
      "#!/bin/sh",
      `export CLASH_API_KEY=${shellQuote(apiKey)}`,
      `export CLASH_API_URL=${shellQuote(apiUrl)}`,
      "export ELECTRON_RUN_AS_NODE=1",
      `if [ -n "$CLASH_CLI_NODE_PATH" ]; then`,
      `  export NODE_PATH="$CLASH_CLI_NODE_PATH${"${NODE_PATH:+:$NODE_PATH}"}"`,
      "fi",
      `if [ -n "$CLASH_NODE_EXEC_PATH" ]; then`,
      `  exec "$CLASH_NODE_EXEC_PATH" ${shellQuote(cliEntry)} "$@"`,
      "fi",
      "if command -v node >/dev/null 2>&1; then",
      `  exec node ${shellQuote(cliEntry)} "$@"`,
      "fi",
      `exec ${shellQuote(process.execPath)} ${shellQuote(cliEntry)} "$@"`,
      "",
    ].join("\n"),
    "utf8",
  );
  chmodSync(shim, 0o755);

  return {
    CLASH_API_KEY: apiKey,
    CLASH_API_URL: apiUrl,
    ...(env.CLASH_NODE_EXEC_PATH ? { CLASH_NODE_EXEC_PATH: env.CLASH_NODE_EXEC_PATH } : {}),
    ...(env.CLASH_CLI_ENTRY_PATH ? { CLASH_CLI_ENTRY_PATH: env.CLASH_CLI_ENTRY_PATH } : {}),
    ...(env.CLASH_CLI_NODE_PATH ? { CLASH_CLI_NODE_PATH: env.CLASH_CLI_NODE_PATH } : {}),
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
  const delayMs = Number(process.env.CLASH_E2E_STUB_ACP_DELAY_MS ?? "0");
  const promptDelayMs = Number.isFinite(delayMs) && delayMs > 0 ? delayMs : 0;
  const waitForPromptDelay = () =>
    promptDelayMs > 0 ? new Promise<void>((resolve) => setTimeout(resolve, promptDelayMs)) : Promise.resolve();

  return {
    start: ({ session_id }) => {
      send({
        type: "session.ready",
        session_id,
        acp_session_id: "mock-acp-session",
      });
    },
    prompt: async ({ session_id, turn_id, text }) => {
      if (promptDelayMs > 0) {
        send({
          type: "session.event",
          session_id,
          turn_id,
          event: {
            sessionUpdate: "agent_thought_chunk",
            content: { type: "text", text: "Preparing mock response." },
          },
        });
      }
      await waitForPromptDelay();
      if (text.includes("列出画布上的节点")) {
        send({
          type: "session.event",
          session_id,
          turn_id,
          event: {
            sessionUpdate: "agent_thought_chunk",
            content: { type: "text", text: "先读取当前画布结构。" },
          },
        });
        send({
          type: "session.event",
          session_id,
          turn_id,
          event: {
            sessionUpdate: "tool_call",
            toolCallId: `tool-list-canvas-${turn_id}`,
            title: "List canvas nodes",
            kind: "list",
            status: "in_progress",
            rawInput: { query: "canvas.nodes", projectId: "mock-project" },
          },
        });
        send({
          type: "session.event",
          session_id,
          turn_id,
          event: {
            sessionUpdate: "tool_call_update",
            toolCallId: `tool-list-canvas-${turn_id}`,
            title: "List canvas nodes",
            kind: "list",
            status: "completed",
            rawOutput: [
              { id: "dianmwa7", type: "action-badge", label: "Image Prompt" },
              { id: "lrcleamx", type: "image", label: "生成类似的" },
              { id: "upload-1781414847642-oq6cbcl", type: "image", label: "258251d8857f30efff6b9b7085302bf5.JPG" },
            ],
          },
        });
        send({
          type: "session.event",
          session_id,
          turn_id,
          event: {
            sessionUpdate: "agent_message_chunk",
            content: {
              type: "text",
              text: [
                "画布上当前有 3 个节点：",
                "",
                "- `dianmwa7` — action-badge，标签是 **Image Prompt**，动作 `image-gen`。",
                "- `lrcleamx` — image，状态 **completed**，标签是 **生成类似的**。",
                "- `upload-1781414847642-oq6cbcl` — image，文件名是 `258251d8857f30efff6b9b7085302bf5.JPG`。",
              ].join("\n"),
            },
          },
        });
        send({ type: "session.complete", session_id, turn_id });
        return;
      }
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
  if (env.CLASH_E2E_STUB_ACP === "1") {
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
  const localDataDir = env.CLASH_LOCAL_DATA_DIR ?? dataDir;
  const harnessDownloadDir = join(localDataDir, "acp-bin");
  const acpBinDir = [env.CLASH_ACP_TEST_BIN_DIR, env.CLASH_ACP_BIN_DIR, harnessDownloadDir]
    .filter(Boolean)
    .join(delimiter);
  return createLocalAcpAdapter({
    harnessConfig: createLocalHarnessConfigStore(localDataDir),
    harnessDownloadDir,
    probeCwd: join(localDataDir, "acp-probe"),
    spawnEnv: {
      ...createLocalAgentToolEnv({
        dataDir: localDataDir,
        apiBaseUrl: options.apiBaseUrl ?? env.CLASH_API_URL ?? `http://127.0.0.1:${port}`,
        env,
      }),
      CLASH_ACP_BIN_DIR: acpBinDir,
    },
  });
}

async function loadLocalProviderAccounts(
  dataDir: string,
  userId = "local-user",
) {
  let providerAccounts: LocalProviderAccountConfig[] = [];
  let providerOAuth: LocalProviderOAuthRecord[] = [];
  try {
    const db = JSON.parse(await readFile(join(dataDir, "db.json"), "utf8")) as {
      providerAccounts?: LocalProviderAccountConfig[];
      providerOAuth?: LocalProviderOAuthRecord[];
    };
    providerAccounts = (db.providerAccounts ?? []).filter((account) => account.userId === userId);
    providerOAuth = (db.providerOAuth ?? []).filter((record) => record.userId === userId);
  } catch {
    // Missing local DB means no configured local provider accounts.
  }
  return providerAccountsForRuntime(providerAccounts, userId, providerOAuth);
}

export function startLocalApiServer(options: LocalApiServerOptions) {
  const localAcp = createConfiguredLocalAcpAdapter(process.env, {
    apiBaseUrl: `http://127.0.0.1:${options.port}`,
  });
  void Promise.resolve(localAcp.warmup?.()).catch(() => undefined);
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
    providerOAuth: {
      dreamina: createDreaminaCliOAuthDriver(),
    },
  });
  const workflowProcessor = createLocalWorkflowProcessor({
    dataDir: options.dataDir,
    textAgent: localAcp.runTextTask
      ? {
          generate: async (input) => {
            const result = await localAcp.runTextTask!({
              projectId: input.projectId,
              prompt: input.prompt,
              ...(input.actorAgentId ? { agentId: input.actorAgentId } : {}),
              modelId: typeof input.modelParams?.acp_model === "string" && input.modelParams.acp_model.trim()
                ? input.modelParams.acp_model.trim()
                : undefined,
              systemPrompt: typeof input.modelParams?.system_prompt === "string"
                ? input.modelParams.system_prompt
                : undefined,
            });
            return {
              text: result.text,
              provider: "local-acp",
              modelEndpoint: result.agentId ?? "default-agent",
            };
          },
        }
      : undefined,
    aigc: createMockExternalAigcService({
      fal: falMock,
      origin: `http://127.0.0.1:${options.port}`,
      providerAccounts: () => loadLocalProviderAccounts(options.dataDir),
      openAiBaseUrl: process.env.OPENAI_BASE_URL,
      anthropicBaseUrl: process.env.ANTHROPIC_BASE_URL,
      falQueueBaseUrl: process.env.CLASH_FAL_QUEUE_URL,
    }),
  });
  const remotePersistence = options.remotePersistence === undefined
    ? () => syncConfig.resolveRemotePersistence()
    : options.remotePersistence ?? undefined;
  let resolveListening!: (server: ReturnType<typeof serve>) => void;
  let rejectListening!: (error: unknown) => void;
  let settled = false;
  const listening = new Promise<ReturnType<typeof serve>>((resolve, reject) => {
    resolveListening = resolve;
    rejectListening = reject;
  });
  let discoveryHostId: string | undefined;
  const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: options.port }, (info) => {
    settled = true;
    console.log(`[local-api] listening on http://127.0.0.1:${info.port}`);
    console.log(`[local-api] data dir: ${options.dataDir}`);
    void syncConfig.getPublicConfig().then((config) => {
      if (config.remote_loro.enabled) {
        console.log(`[local-api] remote Loro persistence: enabled (${config.remote_loro.source})`);
      }
    });
    void (async () => {
      if (options.discovery?.enabled !== false) {
        discoveryHostId = await writeServerDiscoveryRecord(info.port, options);
      }
      resolveListening(server);
    })().catch((error) => {
      server.close();
      rejectListening(error);
    });
  });
  wrapServerCloseWithDiscoveryCleanup(server, () => discoveryHostId, options.discovery?.runDir);
  server.once("error", (error) => {
    if (settled) {
      console.error("[local-api] server error", error);
      return;
    }
    rejectListening(error);
  });
  attachLocalSync(server, { dataDir: options.dataDir, remotePersistence, workflowProcessor });
  attachLocalAcpSessions(server, localAcp);
  return listening;
}

async function writeServerDiscoveryRecord(
  actualPort: number,
  options: LocalApiServerOptions,
): Promise<string> {
  const record = createHostDiscoveryRecord({
    endpoint: `http://127.0.0.1:${actualPort}`,
    launchMode: options.discovery?.launchMode ?? "cli-once",
    startedBy: options.discovery?.startedBy ?? "cli",
    ownerClientId: options.discovery?.ownerClientId,
  });
  await writeHostDiscovery(record, { runDir: options.discovery?.runDir });
  return record.hostId;
}

function wrapServerCloseWithDiscoveryCleanup(
  server: ReturnType<typeof serve>,
  getHostId: () => string | undefined,
  runDir: string | undefined,
): void {
  const originalClose = server.close.bind(server);
  server.close = ((callback?: (error?: Error) => void) => {
    return originalClose((error?: Error) => {
      const hostId = getHostId();
      if (!hostId) {
        callback?.(error);
        return;
      }
      void removeHostDiscovery(hostId, { runDir })
        .catch(() => undefined)
        .finally(() => callback?.(error));
    });
  }) as typeof server.close;
}

const directRunUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === directRunUrl) {
  void startLocalApiServer({ port, dataDir });
}
