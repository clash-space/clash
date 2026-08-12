import { createRequire } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { serve } from "@hono/node-server";
import {
  PluginHostClient,
  pluginHostSocketPath,
  startPluginHostIpcServer,
  type PluginHostIpcServer,
} from "./runtime/host/lib/plugin-host-ipc.js";
import {
  ActionsHost,
  pruneOrphanActivationReceipts,
} from "./runtime/host/lib/actions-loader.js";
import {
  LOCAL_HOST_PROTOCOL_VERSION,
  type HostLaunchMode,
  type HostStartedBy,
} from "@clash/shared-runtime";
import {
  buildEffectiveModelCards,
  composeExecutablePluginModelCards,
  MODEL_CARDS,
  type ExecutablePluginCardRegistration,
  type ExecutablePluginModelBindingRegistration,
} from "@clash/shared-types";
import {
  createLocalApiApp,
  createLocalTtsGenerationHandler,
} from "./app.js";
import {
  createHostDiscoveryRecord,
  removeHostDiscovery,
  writeHostDiscovery,
} from "./host-discovery.js";
import { resolveMediaBaseUrl } from "./media-base-url.js";
import { createMockExternalAigcService } from "./local-aigc.js";
import {
  createJsonlProviderTestRecorder,
  createProviderTestReplayFixtures,
  readJsonlProviderTestRecording,
} from "./provider-test-recorder.js";
import { createProviderPluginProjector } from "./provider-plugin-projector.js";
import { createProviderPluginExecutor } from "./provider-plugin-executor.js";
import { createExecutablePluginActionInvoker } from "./plugin-action-runtime.js";
import {
  createCodexImagegenMarketplace,
  BUNDLED_PLUGINS,
  ensureBundledPlugin,
} from "./bundled-plugins.js";
import {
  activateOrUpdateHostExecutablePluginPackage,
  listHostExecutablePluginPackages,
  readHostExecutablePluginPackage,
  removeHostExecutablePluginPackage,
  rollbackHostExecutablePluginPackage,
  validateHostExecutablePluginPackageContracts,
  type HostExecutablePluginPackage,
} from "./runtime/plugin-package.js";
import { createCodexImageGenerator } from "./codex-imagegen.js";
import {
  attachLocalAcpSessions,
  createLocalAcpCapabilityCacheStore,
  createLocalAcpAdapter,
  createLocalAcpRunPreferencesStore,
  createLocalHarnessConfigStore,
  type LocalAcpRuntimeAdapter,
  type SessionManagerLike,
  type SessionSender,
} from "./local-acp.js";
import { createMockFalQueueService } from "./fal-mock.js";
import {
  createLocalWorkflowProcessor,
  type LocalTimelineRenderer,
} from "./local-processor.js";
import {
  providerAccountsForRuntime,
  publicProviderAccounts,
} from "./provider-accounts.js";
import { createLocalProviderStore } from "./local-provider-store.js";
import { fetchIntoSlot } from "./upload-slot-fetch.js";
import { openPluginStore } from "./plugin-store.js";
import { createLocalMetadataStore } from "./local-metadata-store.js";
import { assetPathForRead, assetPathForWrite } from "./local-asset-paths.js";
import {
  createLocalExecutablePluginBroker,
} from "./local-plugin-broker.js";
import {
  attachLocalSync,
  LocalLoroRoomHub,
  type RemoteLoroPersistenceSource,
} from "./sync.js";
import { createLocalSyncConfigStore } from "./sync-config.js";
import {
  createLocalAudioConfigStore,
  type LocalAudioConfigStore,
} from "./audio-config.js";
import {
  clashHomeForLocalDataDir,
  defaultLocalApiDataDir,
  resolveClashProfile,
} from "./local-paths.js";
import { watchClashUserConfig } from "./user-config.js";
import type { LocalDirectorStageRenderer } from "./director-stage-renderer.js";
import { createNpxSkillsMarketplace } from "./marketplace-skills.js";
import skillMarketplaceRegistry from "../../../skills/registry.json" with { type: "json" };

export { createRemotionTimelineRenderer } from "./remotion-timeline-renderer.js";
export { createHeadlessDirectorStageRenderer } from "./director-stage-renderer.js";
export { prepareDevelopmentBundledPlugins } from "./development-bundled-plugins.js";

export {
  clashHomeForLocalDataDir,
  defaultLocalApiDataDir,
} from "./local-paths.js";

const port = Number(process.env.PORT ?? 49321);
const dataDir = defaultLocalApiDataDir();

export interface LocalApiServerOptions {
  port: number;
  dataDir: string;
  timelineRenderer?: LocalTimelineRenderer;
  directorStageRenderer?: LocalDirectorStageRenderer;
  localAcp?: LocalAcpRuntimeAdapter;
  audioConfig?: LocalAudioConfigStore;
  remotePersistence?: RemoteLoroPersistenceSource | null;
  /** Injectable download transport for completed provider media URLs. */
  providerAssetFetch?: typeof fetch;
  /** Optional JSONL capture path; production normally supplies the equivalent environment value. */
  providerTrafficRecordingPath?: string;
  /** Optional JSONL replay path; production normally supplies the equivalent environment value. */
  providerTrafficReplayPath?: string;
  /** Replay harness only: workflow scheduling cap; provider responses remain untouched. */
  providerPollDelayCapMs?: number;
  /** Test-only process-boundary instrumentation for ordinary plugin HTTP clients. */
  providerHttpInstrumentation?: {
    mode: "record" | "replay";
    trafficPath: string;
    activeStubPath?: string;
    modulePath: string;
    loaderPath?: string;
  };
  /**
   * Development-only source roots for already-attested first-party plugin launchers.
   * Omitted by the packaged host and every normal `startLocalApiServer` caller.
   */
  developmentPluginWatchRoots?: Readonly<
    Record<string, readonly string[]>
  >;
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
  if (env.CLASH_CLI_ENTRY_PATH) return env.CLASH_CLI_ENTRY_PATH;
  const workspaceSource = fileURLToPath(
    new URL("../../../packages/cli/src/index.ts", import.meta.url),
  );
  if (existsSync(workspaceSource)) return workspaceSource;
  throw new Error(
    "CLASH_CLI_ENTRY_PATH is required when local-api is installed without the optional agent CLI resource.",
  );
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
  const localDataDir = resolve(dataDir);
  const clashHome = clashHomeForLocalDataDir(localDataDir);
  const profile = resolveClashProfile(env);
  const binDir = join(localDataDir, "agent-bin");
  mkdirSync(binDir, { recursive: true });

  const apiUrl = apiBaseUrl;
  const cliEntry = resolveClashCliEntry(env);
  const cliLoader = cliEntry.endsWith(".ts")
    ? createRequire(import.meta.url).resolve("tsx")
    : undefined;
  const cliInvocation = [
    ...(cliLoader ? ["--import", cliLoader] : []),
    cliEntry,
  ].map(shellQuote).join(" ");
  const shim = join(binDir, "clash");
  writeFileSync(
    shim,
    [
      "#!/bin/sh",
      `export CLASH_API_URL=${shellQuote(apiUrl)}`,
      `export CLASH_HOME=${shellQuote(clashHome)}`,
      `export CLASH_PROFILE=${shellQuote(profile)}`,
      `export CLASH_LOCAL_DATA_DIR=${shellQuote(localDataDir)}`,
      "export ELECTRON_RUN_AS_NODE=1",
      ...(env.CLASH_CLI_NODE_PATH
        ? [`export CLASH_CLI_NODE_PATH=${shellQuote(env.CLASH_CLI_NODE_PATH)}`]
        : []),
      ...(env.TSX_TSCONFIG_PATH
        ? [`export TSX_TSCONFIG_PATH=${shellQuote(env.TSX_TSCONFIG_PATH)}`]
        : []),
      `if [ -n "$CLASH_CLI_NODE_PATH" ]; then`,
      `  export NODE_PATH="$CLASH_CLI_NODE_PATH${"${NODE_PATH:+:$NODE_PATH}"}"`,
      "fi",
      `if [ -n "$CLASH_NODE_EXEC_PATH" ]; then`,
      `  exec "$CLASH_NODE_EXEC_PATH" ${cliInvocation} "$@"`,
      "fi",
      "if command -v node >/dev/null 2>&1; then",
      `  exec node ${cliInvocation} "$@"`,
      "fi",
      `exec ${shellQuote(process.execPath)} ${cliInvocation} "$@"`,
      "",
    ].join("\n"),
    "utf8",
  );
  chmodSync(shim, 0o755);

  return {
    CLASH_API_URL: apiUrl,
    CLASH_HOME: clashHome,
    CLASH_PROFILE: profile,
    CLASH_LOCAL_DATA_DIR: localDataDir,
    ...(env.CLASH_NODE_EXEC_PATH ? { CLASH_NODE_EXEC_PATH: env.CLASH_NODE_EXEC_PATH } : {}),
    ...(env.CLASH_CLI_ENTRY_PATH ? { CLASH_CLI_ENTRY_PATH: env.CLASH_CLI_ENTRY_PATH } : {}),
    ...(env.CLASH_CLI_NODE_PATH ? { CLASH_CLI_NODE_PATH: env.CLASH_CLI_NODE_PATH } : {}),
    ...(env.TSX_TSCONFIG_PATH ? { TSX_TSCONFIG_PATH: env.TSX_TSCONFIG_PATH } : {}),
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
      {
        op: "add_node",
        node: {
          id: `mock-agent-timeline-${safeTurnId}`,
          type: "video-editor",
          data: {
            label: "Agent Timeline",
            content: `# Timeline\n${text}`,
          },
          position: { x: 850, y: 210 },
          width: 360,
          height: 220,
          style: { width: 360, height: 220 },
        },
      },
      {
        op: "add_node",
        node: {
          id: `mock-agent-discard-${safeTurnId}`,
          type: "text",
          data: {
            label: "Agent Scratch",
            content: `# Scratch\n${text}`,
          },
          position: { x: 850, y: 460 },
          width: 240,
          height: 120,
          style: { width: 240, height: 120 },
        },
      },
      {
        op: "delete_node",
        node: {
          id: `mock-agent-discard-${safeTurnId}`,
        },
      },
      {
        op: "timeline_apply",
        timeline: {
          nodeId: `mock-agent-timeline-${safeTurnId}`,
          dsl: {
            fps: 30,
            durationInFrames: 90,
            tracks: [
              {
                id: "main",
                type: "video",
                items: [],
              },
            ],
          },
        },
      },
      {
        op: "add_edge",
        edge: {
          id: `mock-agent-brief-${safeTurnId}-mock-agent-action-${safeTurnId}`,
          source: `mock-agent-brief-${safeTurnId}`,
          target: `mock-agent-action-${safeTurnId}`,
          type: "default",
        },
      },
      {
        op: "update_edge",
        edge: {
          id: `mock-agent-brief-${safeTurnId}-mock-agent-action-${safeTurnId}`,
          patch: {
            label: "agent-reviewed",
            animated: true,
          },
        },
      },
      {
        op: "delete_edge",
        edge: {
          id: `mock-agent-brief-${safeTurnId}-mock-agent-action-${safeTurnId}`,
        },
      },
    ],
  };
}

function createMockMissingReadProofPatch(turnId: string) {
  const safeTurnId = turnId.replace(/[^a-zA-Z0-9_-]/g, "-");
  return {
    sessionUpdate: "clash.canvas.patch",
    operations: [
      {
        op: "delete_node",
        node: {
          id: `mock-agent-brief-${safeTurnId}`,
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
      send({
        type: "session.event",
        session_id,
        turn_id,
        event: createMockMissingReadProofPatch(turn_id),
      });
      send({ type: "session.complete", session_id, turn_id });
    },
    cancel: () => undefined,
    dispose: (sessionId) => {
      send({ type: "session.disposed", session_id: sessionId });
    },
  };
}

function withMockHarnessUpdateFixture(
  adapter: LocalAcpRuntimeAdapter,
  localDataDir: string,
): LocalAcpRuntimeAdapter {
  const readyPath = join(localDataDir, ".e2e-harness-update-ready");
  const listHarnesses = adapter.listHarnesses.bind(adapter);
  const getSessionRuntimeStatus = adapter.getSessionRuntimeStatus.bind(adapter);
  const restartSession = adapter.restartSession.bind(adapter);
  let upgraded = false;
  let restarted = false;

  adapter.listHarnesses = async (options) => {
    const result = await listHarnesses(options);
    if (!existsSync(readyPath)) return result;
    const mock = result.harnesses.find((harness) => harness.id === "mock-acp");
    if (!mock) return result;
    return {
      harnesses: [
        {
          ...mock,
          installed: true,
          installedVersion: upgraded ? "2.0.0" : "1.0.0",
          latestVersion: "2.0.0",
          ...(upgraded ? {} : { updateAvailable: true }),
        },
        ...result.harnesses.filter((harness) => harness.id !== "mock-acp"),
      ],
    };
  };
  adapter.upgradeHarness = async (id) => {
    if (id !== "mock-acp") throw new Error(`Unknown mock harness: ${id}`);
    upgraded = true;
    return adapter.listHarnesses({ probe: true, refresh: true });
  };
  adapter.getSessionRuntimeStatus = async (sessionId) => {
    const status = await getSessionRuntimeStatus(sessionId);
    if (!status) return null;
    return {
      ...status,
      harness_id: "mock-acp",
      harness_label: "Mock ACP",
      running_version: restarted ? "2.0.0" : "1.0.0",
      installed_version: upgraded ? "2.0.0" : "1.0.0",
      restart_required: upgraded && !restarted,
    };
  };
  adapter.restartSession = async (sessionId, options) => {
    const result = await restartSession(sessionId, options);
    if (result.status === "restarted") restarted = true;
    return result;
  };
  return adapter;
}

export function createConfiguredLocalAcpAdapter(
  env: Record<string, string | undefined> = process.env,
  options: { apiBaseUrl?: string; dataDir?: string } = {},
) {
  const localDataDir = options.dataDir ?? defaultLocalApiDataDir(env);
  if (env.CLASH_E2E_STUB_ACP === "1") {
    const adapter = createLocalAcpAdapter({
      detectAgents: async () => [
        {
          id: "mock-acp",
          label: "Mock ACP",
          spec: { command: "mock-acp" },
        },
      ],
      listResumeSessions: async () => [],
      createSessionManager: createMockAcpSessionManager,
      runPreferences: createLocalAcpRunPreferencesStore(localDataDir),
      hostname: () => "Mock Desktop",
      osTag: () => "mock/e2e",
    });
    return env.CLASH_E2E_STUB_HARNESS_UPDATE === "1"
      ? withMockHarnessUpdateFixture(adapter, localDataDir)
      : adapter;
  }
  const harnessDownloadDir = join(localDataDir, "acp-bin");
  const acpBinDir = env.CLASH_ACP_TEST_BIN_DIR || harnessDownloadDir;
  return createLocalAcpAdapter({
    harnessConfig: createLocalHarnessConfigStore(localDataDir),
    runPreferences: createLocalAcpRunPreferencesStore(localDataDir),
    capabilityCache: createLocalAcpCapabilityCacheStore(localDataDir),
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
  const store = createLocalProviderStore(dataDir);
  const [providerAccounts, providerOAuth] = await Promise.all([
    store.loadProviderAccounts(),
    store.loadProviderOAuth(),
  ]);
  return providerAccountsForRuntime(providerAccounts, userId, providerOAuth);
}

async function loadLocalModelCards(
  dataDir: string,
  userId = "local-user",
  pluginCards: readonly ExecutablePluginCardRegistration[] = [],
  pluginModelBindings: readonly ExecutablePluginModelBindingRegistration[] = [],
) {
  const store = createLocalProviderStore(dataDir);
  const [providerAccounts, providerOAuth, modelCardConfigs] = await Promise.all([
    store.loadProviderAccounts(),
    store.loadProviderOAuth(),
    store.loadModelCardConfigs(),
  ]);
  const providers = providerAccountsForRuntime(providerAccounts, userId, providerOAuth);
  return buildEffectiveModelCards({
    configs: modelCardConfigs
      .filter((config) => (config.userId ?? userId) === userId)
      .map(({ userId: _userId, ...config }) => config),
    providers,
    baseModels: composeExecutablePluginModelCards(MODEL_CARDS, pluginCards, pluginModelBindings),
  });
}

/**
 * Uploads a plugin has been offered a place for but not yet delivered.
 *
 * In memory and per process. A slot that survived a restart would name a URL nothing is listening
 * on, and the plugin holding it would stream into a void and report success.
 */
const pendingUploads = new Map<string, {
  assetId: string;
  slot: string;
  /** Absent when the vendor answered with a link: there is no count until the fetch finishes. */
  byteLength?: number;
  bytes: Uint8Array | undefined;
  mediaType?: string;
}>();

/**
 * Receive bytes for a slot that was handed out.
 *
 * The token is the authorisation: minted for one upload, given to one plugin, forgotten once
 * collected. An unknown or already-collected token is refused, so a leaked one names nothing.
 */
export function acceptPluginUpload(token: string, bytes: Uint8Array): boolean {
  const pending = pendingUploads.get(token);
  if (!pending || pending.bytes) return false;
  pending.bytes = bytes;
  return true;
}

export function createLocalPluginBrokerServices(options: {
  dataDir: string;
  /**
   * Where a plugin should PUT bytes it was given a slot for.
   *
   * Passed in rather than assembled here: this function does not know the port it is being served
   * on, and a hosted deployment does not have one -- there the origin is object storage.
   */
  uploadOrigin?: string | (() => string);
  assetFetch?: typeof fetch;
}) {
  const providerStore = createLocalProviderStore(options.dataDir);
  const metadataStore = createLocalMetadataStore(options.dataDir);
  const clashRoot = clashHomeForLocalDataDir(options.dataDir);
  async function writeAssetBytes({
      pluginId,
      pluginVersion,
      projectId,
      invocationId,
      taskId,
      slot,
      kind,
      mediaType,
      bytes,
    }: {
      pluginId: string; pluginVersion: string; projectId: string; invocationId: string;
      taskId: string; slot: string; kind: "image" | "video" | "audio" | "model"; mediaType?: string; bytes: Uint8Array;
    }) {
      const contentHash = createHash("sha256").update(bytes).digest("hex");
      const safe = (value: string) => value.replace(/[^a-zA-Z0-9._-]/g, "-");
      const extension = mediaType === "image/jpeg" ? "jpg"
        : mediaType === "image/webp" ? "webp"
          : mediaType === "video/mp4" ? "mp4"
            : mediaType === "audio/mpeg" ? "mp3"
              : mediaType === "audio/wav" ? "wav"
                : kind === "video" ? "mp4"
                  : kind === "audio" ? "mp3"
                    : kind === "model" ? "bin"
                      : "png";
      const assetId = [
        "plugin",
        safe(invocationId),
        safe(slot),
        contentHash.slice(0, 12),
      ].join("-");
      const storageKey = [
        "projects",
        safe(projectId),
        "plugins",
        `${assetId}.${extension}`,
      ].join("/");
      await writeFile(
        await assetPathForWrite(options.dataDir, storageKey, clashRoot),
        bytes,
      );
      const at = Math.floor(Date.now() / 1000);
      await metadataStore.upsertAsset({
        id: assetId,
        userId: "local-user",
        kind,
        srcR2Key: storageKey,
        coverR2Key: null,
        metadata: {
          bytes: bytes.byteLength,
          ...(mediaType ? { contentType: mediaType } : {}),
          contentHash,
        },
        sourceModel: `plugin:${pluginId}@${pluginVersion}`,
        sourcePrompt: null,
        sourceTaskId: taskId,
        sources: null,
        createdAt: at,
        updatedAt: at,
        projectId,
      }, {
        assetId,
        projectId,
        importedAt: at,
      });
      const assetOrigin = typeof options.uploadOrigin === "function"
        ? options.uploadOrigin()
        : options.uploadOrigin;
      return {
        assetId,
        uri: `clash-asset://${assetId}`,
        kind,
        ...(mediaType ? { mediaType } : {}),
        ...(assetOrigin
          ? {
              url: `${assetOrigin.replace(/\/+$/, "")}/assets/${storageKey}`,
              reach: "private" as const,
            }
          : {}),
      };
  }

  // Opened on first use rather than at construction: the table and the encryption key are created
  // as a side effect, and a host that never runs a plugin should not create either.
  let storePromise: Promise<Awaited<ReturnType<typeof openPluginStore>>> | undefined;
  const pluginStore = () => (storePromise ??= openPluginStore({ dataDir: options.dataDir }));

  return createLocalExecutablePluginBroker({
    loadProviderAccounts: async () => {
      const [accounts, oauthRecords] = await Promise.all([
        providerStore.loadProviderAccounts(),
        providerStore.loadProviderOAuth(),
      ]);
      return providerAccountsForRuntime(accounts, "local-user", oauthRecords);
    },
    generateCodexImage: createCodexImageGenerator(),
    readAsset: async ({ assetId, projectId }) => {
      const metadata = await metadataStore.load();
      const hasProjectRef = metadata.assetRefs.some(
        (reference) => reference.assetId === assetId && reference.projectId === projectId,
      );
      const asset = metadata.assets.find((candidate) =>
        candidate.id === assetId
        && (candidate.projectId === projectId || (!candidate.projectId && hasProjectRef))
      );
      if (!asset?.srcR2Key) {
        throw new Error(`Asset ${assetId} is not available in project ${projectId}.`);
      }
      const bytes = await readFile(
        await assetPathForRead(options.dataDir, asset.srcR2Key, clashRoot),
      );
      const metadataRecord = asset.metadata && typeof asset.metadata === "object"
        && !Array.isArray(asset.metadata)
        ? asset.metadata as Record<string, unknown>
        : {};
      return {
        kind: asset.kind,
        ...(typeof metadataRecord.contentType === "string"
          ? { mediaType: metadataRecord.contentType }
          : {}),
        bytes,
      };
    },
    /**
     * This plugin's own stored values, for the account this invocation runs on.
     *
     * The store existed with its own tests and was referenced by nothing outside them, so a plugin
     * asking for its credential got "Local plugin store is unavailable" -- built, tested, and
     * unreachable. Both halves are lazy because opening the store creates a table and reads a key
     * off disk, and a host that never runs a plugin should not pay for either.
     */
    storeGet: async ({ pluginId, accountId, key }) => {
      const store = await pluginStore();
      return await store.get({ pluginId, accountId, key });
    },

    storePut: async ({ pluginId, accountId, key, value, secret, expiresAt }) => {
      const store = await pluginStore();
      await store.put({
        pluginId,
        accountId,
        key,
        value,
        ...(secret === undefined ? {} : { secret }),
        ...(expiresAt === undefined ? {} : { expiresAt: Date.parse(expiresAt) }),
      });
    },

    /**
     * Somewhere to stream bytes, and the collection afterwards.
     *
     * Both halves are the host's business, which is the point: this host answers with a loopback
     * URL and writes to the local store, a hosted one answers with presigned object storage. The
     * plugin makes the same two calls either way.
     */
    openUploadSlot: async ({
      pluginId,
      pluginVersion,
      projectId,
      invocationId,
      taskId,
      slot,
      kind,
      byteLength,
      mediaType,
      url,
    }) => {
      const token = randomUUID();
      const assetId = `upload-${token}`;

      // A vendor that answered with a link has already produced the bytes; there is nobody left to
      // upload them. Handing back a slot URL here would leave the plugin holding an address it was
      // told to pass through, and the asset would never arrive -- which is where a completed,
      // paid-for generation was being dropped.
      if (url) {
        const fetched = await fetchIntoSlot(url, {
          ...(options.assetFetch ? { fetchImpl: options.assetFetch } : {}),
          ...(mediaType ? { mediaType } : {}),
        });
        return writeAssetBytes({
          pluginId,
          pluginVersion,
          projectId,
          invocationId,
          taskId,
          slot,
          kind,
          ...(fetched.mediaType ? { mediaType: fetched.mediaType } : {}),
          bytes: fetched.bytes,
        });
      }

      pendingUploads.set(token, { assetId, slot, byteLength, bytes: undefined });
      const uploadOrigin = typeof options.uploadOrigin === "function"
        ? options.uploadOrigin()
        : options.uploadOrigin;
      return {
        uploadUrl: `${uploadOrigin ?? ""}/api/v1/plugin-uploads/${token}`,
        assetId,
      };
    },

    finishUpload: async (input) => {
      const token = input.assetId.replace(/^upload-/, "");
      const pending = pendingUploads.get(token);
      if (!pending?.bytes) {
        // Naming an upload that never arrived would attach an empty asset to a finished node.
        throw new Error(`No bytes were uploaded for ${input.slot}.`);
      }
      if (pending.bytes.byteLength !== pending.byteLength) {
        throw new Error(
          `${input.slot} was announced as ${pending.byteLength} bytes and arrived as `
          + `${pending.bytes.byteLength}.`,
        );
      }
      pendingUploads.delete(token);
      return await writeAssetBytes({ ...input, pluginVersion: "", bytes: pending.bytes });
    },

    writeAsset: writeAssetBytes,
    audit: (record) => metadataStore.appendPluginBrokerAudit({
      id: randomUUID(),
      ...record,
    }),
  });
}

export function startLocalApiServer(options: LocalApiServerOptions) {
  const clashHome = clashHomeForLocalDataDir(options.dataDir);
  const actionsRoot = join(clashHome, "actions");
  const discoveryEnabled = options.discovery?.enabled !== false;
  const pendingDiscoveryHostId = discoveryEnabled ? randomUUID() : undefined;
  const discoveryProfile = resolveClashProfile(process.env);
  const codexImagegenMarketplace = createCodexImagegenMarketplace({
    actionsRoot,
  });
  const npxSkillsMarketplace = createNpxSkillsMarketplace({
    registry: skillMarketplaceRegistry,
  });
  const providerStore = createLocalProviderStore(options.dataDir);
  let boundPort: number | undefined = options.port || undefined;
  const localOrigin = () => boundPort ? `http://127.0.0.1:${boundPort}` : "";
  const providerTrafficRecordingPath = options.providerTrafficRecordingPath
    ?? process.env.CLASH_PROVIDER_TRAFFIC_RECORDING_PATH?.trim();
  const providerTrafficReplayPath = options.providerTrafficReplayPath
    ?? process.env.CLASH_PROVIDER_TRAFFIC_REPLAY_PATH?.trim();
  if (providerTrafficRecordingPath && providerTrafficReplayPath) {
    throw new Error(
      "CLASH_PROVIDER_TRAFFIC_RECORDING_PATH and CLASH_PROVIDER_TRAFFIC_REPLAY_PATH are mutually exclusive.",
    );
  }
  const pluginBroker = createLocalPluginBrokerServices({
    dataDir: options.dataDir,
    uploadOrigin: localOrigin,
    ...(options.providerAssetFetch ? { assetFetch: options.providerAssetFetch } : {}),
  });
  // Every first-party Provider, not one of them. Seeding a single plugin is what left clash.google
  // and clash.minimax invisible after the split: they were activated into ~/.clash/actions by hand,
  // and the host seeds this list rather than reading that directory.
  //
  // Sequential, because each seed runs the plugin's contract tests and a failure has to name which
  // Provider failed. One failing Provider does not stop the others -- a host that refuses to start
  // because one plugin is broken is worse than one that starts without it and says so.
  const bundledPluginsReady = (async () => {
    // Before seeding, drop receipts whose plugin is gone. A receipt attests a contentHash for an
    // id, so one left behind by a rename hands an unrelated plugin an attestation nobody issued for
    // it. Two were found on a development machine, from `clash-first-party-media` and
    // `hilo-hub-media`.
    try {
      const pruned = await pruneOrphanActivationReceipts(join(clashHome, "actions"));
      if (pruned.length > 0) {
        console.warn(`[local-api] pruned orphaned activation receipts: ${pruned.join(", ")}`);
      }
    } catch (error) {
      console.error(
        "[local-api] could not prune activation receipts:",
        error instanceof Error ? error.message : String(error),
      );
    }

    for (const plugin of BUNDLED_PLUGINS) {
      try {
        await ensureBundledPlugin({ id: plugin.id, actionsRoot: join(clashHome, "actions") });
      } catch (error) {
        console.error(
          `[local-api] bundled plugin ${plugin.id} seed degraded:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  })();
  const pluginHostClient = new PluginHostClient({
    socketPath: pluginHostSocketPath(process.env, clashHome),
  });
  const pluginHostProjector = createProviderPluginProjector({ client: pluginHostClient });
  const pluginHostProviderExecutor = createProviderPluginExecutor({
    client: pluginHostClient,
  });
  const pluginHostExecutableAction = createExecutablePluginActionInvoker({
    client: pluginHostClient,
  });
  let embeddedPluginHost: ActionsHost | null = null;
  let embeddedPluginIpc: PluginHostIpcServer | null = null;
  let pluginRuntimeReady: Promise<void> | null = null;
  const ensurePluginRuntime = () => pluginRuntimeReady ??= bundledPluginsReady.then(async () => {
    // A broken package degrades only that Provider. The host still starts every
    // successfully activated plugin, so Google work is not blocked by a bad
    // MiniMax payload (and vice versa). Resolving a binding for the failed
    // plugin will surface the provider-specific error at the operation boundary.
    const host = new ActionsHost({
      serverUrl: `http://127.0.0.1:${options.port}`,
      apiKey: "",
      runtimeId: "local-api",
      actionsRoot: join(clashHome, "actions"),
      executablePluginsOnly: true,
      pluginBroker,
      ...(options.providerHttpInstrumentation
        ? { providerHttpInstrumentation: options.providerHttpInstrumentation }
        : {}),
      ...(options.developmentPluginWatchRoots
        ? { developmentPluginWatchRoots: options.developmentPluginWatchRoots }
        : {}),
    });
    await host.start();
    try {
      embeddedPluginIpc = await startPluginHostIpcServer({
        host,
        socketPath: pluginHostSocketPath(process.env, clashHome),
      });
      embeddedPluginHost = host;
    } catch (error) {
      await host.stopAll();
      if (!(error && typeof error === "object" && "code" in error
        && (error as { code?: unknown }).code === "EADDRINUSE")) {
        throw error;
      }
      // Another local-api host already owns the socket.
    }
  });
  const providerPluginProjector = (async (request) => {
    await ensurePluginRuntime();
    return pluginHostProjector(request);
  }) satisfies import("./local-aigc.js").ProviderPluginProjector;
  const providerPluginExecutor = (async (request) => {
    await ensurePluginRuntime();
    return pluginHostProviderExecutor(request);
  }) satisfies import("./local-aigc.js").ProviderPluginExecutor;
  const executablePluginAction = (async (request) => {
    await ensurePluginRuntime();
    return pluginHostExecutableAction(request);
  }) satisfies import("./plugin-action-runtime.js").ExecutablePluginActionInvoker;
  const listPluginCards = async () => {
    await ensurePluginRuntime();
    return pluginHostClient.listCards();
  };
  const listPluginProviders = async () => {
    await ensurePluginRuntime();
    return pluginHostClient.listProviders();
  };
  const listPluginModelBindings = async () => {
    await ensurePluginRuntime();
    return pluginHostClient.listModelBindings();
  };
  const discoveryRunDir =
    options.discovery?.runDir ?? join(clashHome, "run");
  const localAcp = options.localAcp ?? createConfiguredLocalAcpAdapter(process.env, {
    apiBaseUrl: `http://127.0.0.1:${options.port}`,
    dataDir: options.dataDir,
  });
  let configWatcherClosed = false;
  let localAcpReady!: Promise<void>;
  let configReloadQueue = Promise.resolve();
  const stopConfigWatcher = watchClashUserConfig(options.dataDir, {
    onChange(config, previousConfig) {
      const apply = configReloadQueue.then(async () => {
        await localAcpReady;
        if (configWatcherClosed) return;
        const nextSignature = JSON.stringify(config.harnesses ?? null);
        const previousSignature = JSON.stringify(
          previousConfig?.harnesses ?? null,
        );
        if (nextSignature === previousSignature) return;
        await localAcp.reconcileConfiguration?.();
      });
      configReloadQueue = apply.catch(() => undefined);
      return apply;
    },
    onError(error) {
      console.error("[local-api] config.yaml reload rejected:", error.message);
    },
  });
  localAcpReady = Promise.resolve(localAcp.warmup?.()).catch((error) => {
    console.error(
      "[local-api] ACP startup warmup degraded:",
      error instanceof Error ? error.message : String(error),
    );
  });
  const falMock = createMockFalQueueService();
  const providerTraffic = providerTrafficRecordingPath
    ? {
        mode: "record" as const,
        recorder: (() => {
          const recorder = createJsonlProviderTestRecorder(providerTrafficRecordingPath);
          return () => recorder;
        })(),
      }
    : providerTrafficReplayPath
      ? {
          mode: "replay" as const,
          fixtures: (() => {
            const fixtures = readJsonlProviderTestRecording(providerTrafficReplayPath)
              .then(createProviderTestReplayFixtures);
            return () => fixtures;
          })(),
        }
      : undefined;
  const syncConfig = createLocalSyncConfigStore({
    dataDir: options.dataDir,
    env: process.env,
  });
  const audioConfig = options.audioConfig ?? createLocalAudioConfigStore({
    dataDir: options.dataDir,
  });
  void audioConfig.getVoiceInputConfig?.().catch((error) => {
    console.error(
      "[local-api] voice input startup probe degraded:",
      error instanceof Error ? error.message : String(error),
    );
  });
  const localTts = createLocalTtsGenerationHandler(audioConfig);
  let roomHub: LocalLoroRoomHub | undefined;
  const app = createLocalApiApp({
    dataDir: options.dataDir,
    acceptPluginUpload,
    hostIdentity: pendingDiscoveryHostId ? {
      hostId: pendingDiscoveryHostId,
      pid: process.pid,
      profile: discoveryProfile,
      protocolVersion: LOCAL_HOST_PROTOCOL_VERSION,
    } : undefined,
    localAcp,
    localAcpReady,
    falMock,
    syncConfig,
    audioConfig,
    providerTestRecordingPath: process.env.CLASH_PROVIDER_TEST_RECORDING_PATH,
    providerTestOpenAiBaseUrl: process.env.OPENAI_BASE_URL,
    providerTestAnthropicBaseUrl: process.env.ANTHROPIC_BASE_URL,
    providerTestFalQueueBaseUrl: process.env.CLASH_FAL_QUEUE_URL,
    providerTestGoogleAiStudioBaseUrl: process.env.CLASH_GOOGLE_AI_STUDIO_URL,
    providerTestPikaBaseUrl: process.env.CLASH_PIKA_URL,
    providerTestReplicateBaseUrl: process.env.CLASH_REPLICATE_URL,
    providerPluginExecutor,
    processProjectWork: async (projectId) => {
      if (!roomHub) {
        throw new Error("Local project room hub is not ready.");
      }
      await roomHub.refresh(projectId);
    },
    marketplaceActions: [...codexImagegenMarketplace.actions],
    listInstalledMarketplaceActions: () => codexImagegenMarketplace.listInstalled(),
    installMarketplaceAction: (packageId) => codexImagegenMarketplace.install(packageId),
    uninstallMarketplaceAction: (actionId) => codexImagegenMarketplace.uninstall(actionId),
    marketplaceSkills: [...npxSkillsMarketplace.skills],
    listInstalledMarketplaceSkills: () => npxSkillsMarketplace.listInstalled(),
    installMarketplaceSkill: (skillId) => npxSkillsMarketplace.install(skillId),
    uninstallMarketplaceSkill: (skillId) => npxSkillsMarketplace.uninstall(skillId),
    pluginPackages: {
      list: () => listHostExecutablePluginPackages(actionsRoot),
      validate: (input) => validateHostExecutablePluginPackageContracts(
        input as HostExecutablePluginPackage,
        actionsRoot,
      ),
      activate: (input) => activateOrUpdateHostExecutablePluginPackage(
        input as HostExecutablePluginPackage,
        actionsRoot,
      ),
      read: (id) => readHostExecutablePluginPackage(actionsRoot, id),
      rollback: (id) => rollbackHostExecutablePluginPackage(actionsRoot, id),
      remove: (id) => removeHostExecutablePluginPackage(actionsRoot, id),
    },
    resolvePluginBinding: async (pluginId, exportId, kind) => {
      await ensurePluginRuntime();
      return pluginHostClient.resolveBinding(pluginId, exportId, kind);
    },
    listPluginCards,
    directorStageRenderer: options.directorStageRenderer,
    listPluginModelBindings,
    listPluginProviders,
  });
  // Set once the socket is bound. `options.port` is normally 0, so anything that captured
  // it produced an unroutable `http://127.0.0.1:0` -- reads of a generated asset then
  // failed with a bare `fetch failed`.
  const workflowProcessor = createLocalWorkflowProcessor({
    dataDir: options.dataDir,
    mediaBaseUrl: resolveMediaBaseUrl(() => boundPort),
    ...(options.providerPollDelayCapMs === undefined
      ? {}
      : { providerPollDelayCapMs: options.providerPollDelayCapMs }),
    modelCards: async () => loadLocalModelCards(
      options.dataDir,
      "local-user",
      await listPluginCards(),
      await listPluginModelBindings(),
    ),
    executablePluginAction,
    timelineRenderer: options.timelineRenderer,
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
      modelCards: async () => loadLocalModelCards(
        options.dataDir,
        "local-user",
        await listPluginCards(),
        await listPluginModelBindings(),
      ),
      openAiBaseUrl: process.env.OPENAI_BASE_URL,
      anthropicBaseUrl: process.env.ANTHROPIC_BASE_URL,
      falQueueBaseUrl: process.env.CLASH_FAL_QUEUE_URL,
      googleAiStudioApiKey: process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY,
      googleAiStudioBaseUrl: process.env.GOOGLE_AI_STUDIO_BASE_URL,
      pikaBaseUrl: process.env.CLASH_PIKA_URL,
      providerUsageAudit: (event) => providerStore.appendProviderUsageEvent(event),
      providerTraffic,
      providerPluginProjector,
      providerPluginExecutor,
      localTts,
    }),
  });
  const remotePersistence = options.remotePersistence === undefined
    ? () => syncConfig.resolveRemotePersistence()
    : options.remotePersistence ?? undefined;
  roomHub = new LocalLoroRoomHub(
    options.dataDir,
    remotePersistence,
    workflowProcessor,
  );
  let resolveListening!: (server: ReturnType<typeof serve>) => void;
  let rejectListening!: (error: unknown) => void;
  let settled = false;
  const listening = new Promise<ReturnType<typeof serve>>((resolve, reject) => {
    resolveListening = resolve;
    rejectListening = reject;
  });
  let publishedDiscoveryHostId: string | undefined;
  const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: options.port }, (info) => {
    settled = true;
    boundPort = info.port;
    localAcp.updateSpawnEnv(createLocalAgentToolEnv({
      dataDir: options.dataDir,
      apiBaseUrl: `http://127.0.0.1:${info.port}`,
      env: process.env,
    }));
    console.log(`[local-api] listening on http://127.0.0.1:${info.port}`);
    console.log(`[local-api] data dir: ${options.dataDir}`);
    void syncConfig.getPublicConfig().then((config) => {
      if (config.remote_loro.enabled) {
        console.log(`[local-api] remote Loro persistence: enabled (${config.remote_loro.source})`);
      }
    });
    void (async () => {
      if (pendingDiscoveryHostId) {
        publishedDiscoveryHostId = await writeServerDiscoveryRecord(
          info.port,
          options,
          discoveryRunDir,
          pendingDiscoveryHostId,
          discoveryProfile,
        );
      }
      resolveListening(server);
    })().catch((error) => {
      server.close();
      rejectListening(error);
    });
  });
  wrapServerCloseWithLifecycleCleanup(
    server,
    async () => {
      configWatcherClosed = true;
      stopConfigWatcher();
      await Promise.all([
        localAcp.disposeAll(),
        options.directorStageRenderer?.dispose(),
        (pluginRuntimeReady ?? bundledPluginsReady).catch(() => undefined).then(async () => {
          await embeddedPluginIpc?.close().catch(() => undefined);
          await embeddedPluginHost?.stopAll().catch(() => undefined);
        }),
      ]);
    },
    () => publishedDiscoveryHostId,
    discoveryRunDir,
  );
  server.once("error", (error) => {
    if (settled) {
      console.error("[local-api] server error", error);
      return;
    }
    rejectListening(error);
  });
  attachLocalSync(server, {
    dataDir: options.dataDir,
    remotePersistence,
    workflowProcessor,
    hub: roomHub,
  });
  attachLocalAcpSessions(server, localAcp);
  return listening;
}

async function writeServerDiscoveryRecord(
  actualPort: number,
  options: LocalApiServerOptions,
  runDir: string,
  hostId: string,
  profile: "dev" | "prod",
): Promise<string> {
  const record = createHostDiscoveryRecord({
    hostId,
    endpoint: `http://127.0.0.1:${actualPort}`,
    agentCliPath: join(options.dataDir, "agent-bin", "clash"),
    launchMode: options.discovery?.launchMode ?? "cli-once",
    startedBy: options.discovery?.startedBy ?? "cli",
    ownerClientId: options.discovery?.ownerClientId,
    profile,
  });
  await writeHostDiscovery(record, { runDir });
  return record.hostId;
}

function wrapServerCloseWithLifecycleCleanup(
  server: ReturnType<typeof serve>,
  disposeLocalAcp: () => Promise<void> | void,
  getHostId: () => string | undefined,
  runDir: string | undefined,
): void {
  const originalClose = server.close.bind(server);
  let cleanupPromise: Promise<void> | null = null;
  const cleanup = () => {
    if (cleanupPromise) return cleanupPromise;
    cleanupPromise = Promise.all([
      Promise.resolve(disposeLocalAcp()).catch(() => undefined),
      Promise.resolve().then(async () => {
        const hostId = getHostId();
        if (hostId) await removeHostDiscovery(hostId, { runDir });
      }).catch(() => undefined),
    ]).then(() => undefined);
    return cleanupPromise;
  };
  server.close = ((callback?: (error?: Error) => void) => {
    const lifecycleCleanup = cleanup();
    return originalClose((error?: Error) => {
      void lifecycleCleanup.finally(() => callback?.(error));
    });
  }) as typeof server.close;
}

const directRunUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === directRunUrl && !process.env.CLASH_LOCAL_API_WRAPPER_ENTRY) {
  void startLocalApiServer({ port, dataDir });
}
