import type { IncomingMessage } from "node:http";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import {
  detectAll,
  detectEntry,
  KNOWN_ACP_AGENTS,
  authenticateAgent as authenticateRuntimeAgent,
  listLocalAgentSessions,
  probeAgentAuthStatus as probeRuntimeAgentAuthStatus,
  probeAgentSessionConfig as probeRuntimeAgentSessionConfig,
  type AuthenticateAgentResult,
  type KnownAgentEntry,
} from "@clash-space/bridge/acp-runtime";
import { listLocalCcSessions } from "@clash-space/bridge/cc-sessions";
import { machineName, osTag as defaultOsTag } from "@clash-space/bridge/platform";
import { SessionManager, type ManagerOut } from "@clash-space/bridge/session-manager";
import type {
  LocalAcpAdapter,
  LocalAcpAttachSessionParams,
  LocalAcpCreateSessionParams,
  LocalAcpResumeSession,
  LocalAcpSessionMessage,
  LocalAcpSessionMessageStore,
} from "./app.js";
import {
  installAcpRegistryAgent,
  installManagedAdapter,
  listAcpRegistryCatalog,
  readAcpRegistryInstallMetadata,
  uninstallAcpRegistryAgent,
  uninstallManagedAdapter,
} from "./acp-registry-installer.js";
import { createSqliteLocalConfigStore, type SqliteLocalConfigStore } from "./local-config-store.js";

export const DESKTOP_LOCAL_RUNTIME_ID = "desktop-local";

export type SessionManagerOut = ManagerOut;
export type SessionSender = (msg: SessionManagerOut) => void;

export interface SessionStartParamsLike {
  session_id: string;
  agent_template_id?: string;
  agent_id?: string;
  agent_spec?: {
    command: string;
    args?: string[];
    env?: Record<string, string>;
  };
  permission_mode?: string;
  agent_member_id?: string;
  project_id?: string;
  resume?: { acp_session_id: string };
}

export interface SessionPromptParamsLike {
  session_id: string;
  turn_id: string;
  text: string;
}

export interface SessionManagerLike {
  setSpawnEnv?(env: Record<string, string | undefined>): void;
  start(params: SessionStartParamsLike): Promise<void> | void;
  prompt(params: SessionPromptParamsLike): Promise<void> | void;
  setConfigOption?(sessionId: string, configId: string, value: string | boolean): Promise<void> | void;
  setMode?(sessionId: string, modeId: string): Promise<void> | void;
  cancel(sessionId: string, turnId: string): void;
  dispose(sessionId: string): Promise<void> | void;
}

export interface DetectedAcpAgent {
  id: string;
  label: string;
  configOptions?: unknown[];
  sessionModes?: unknown;
  auth?: LocalAcpHarnessAuth;
  spec: {
    command: string;
    args?: string[];
    env?: Record<string, string>;
  };
}

export interface LocalAcpHarnessAuthMethod {
  id: string;
  name?: string;
  description?: string;
  type?: string;
  vars?: Array<{
    name: string;
    label?: string;
    secret?: boolean;
    optional?: boolean;
  }>;
  link?: string;
  terminalLaunch?: InteractiveAuthLaunchOptions;
}

export interface LocalAcpHarnessAuth {
  status: "configured" | "needs-auth" | "unknown";
  message: string;
  command?: string;
  methodId?: string;
  methodName?: string;
  methods?: LocalAcpHarnessAuthMethod[];
}

export interface LocalAcpHarness {
  id: string;
  label: string;
  binary: string;
  enabled: boolean;
  available: boolean;
  custom?: boolean;
  installed?: boolean;
  installedVersion?: string;
  latestVersion?: string;
  updateAvailable?: boolean;
  installable?: boolean;
  installSource?: "registry" | "adapter";
  downloadUrl?: string;
  downloadKind?: "adapter";
  homepage?: string;
  auth?: LocalAcpHarnessAuth;
  session_modes?: unknown;
}

export interface LocalAcpHarnessListOptions {
  probe?: boolean | "auth" | "config" | "none";
  refresh?: boolean;
}

export interface LocalAcpRuntimeListOptions {
  probe?: boolean | "auth" | "config" | "none";
  refresh?: boolean;
}

export interface LocalAcpAuthenticateOptions {
  methodId?: string;
}

type DetectedAgentProbeScope = "enabled" | "installed";

interface DetectedAgentListOptions {
  probeAuth?: boolean;
  probeConfigOptions?: boolean;
  probeScope?: DetectedAgentProbeScope;
  refresh?: boolean;
}

export interface LocalAcpHarnessConfigStore {
  loadEnabledHarnessIds(): Promise<string[] | null>;
  saveEnabledHarnessIds(ids: string[]): Promise<void>;
  loadAgentServers?(): Promise<LocalAcpAgentServersConfig | null>;
  saveAgentServers?(servers: LocalAcpAgentServersConfig): Promise<void>;
}

export interface LocalAcpCustomAgentServer {
  type: "custom";
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export type LocalAcpAgentServersConfig = Record<string, LocalAcpCustomAgentServer>;

export interface LocalAcpTextTaskParams {
  projectId: string;
  prompt: string;
  agentId?: string;
  modelId?: string;
  modelConfigId?: string;
  systemPrompt?: string;
  timeoutMs?: number;
}

export interface LocalAcpAdapterOptions {
  detectAgents?: () => Promise<DetectedAcpAgent[]>;
  probeAgentAuth?: (agent: DetectedAcpAgent) => Promise<LocalAcpHarnessAuth | undefined>;
  probeAgentConfigOptions?: (agent: DetectedAcpAgent) => Promise<unknown[]>;
  probeAgentSessionConfig?: (agent: DetectedAcpAgent) => Promise<{ configOptions?: unknown[]; modes?: unknown }>;
  authenticateAgent?: (agent: DetectedAcpAgent, options?: LocalAcpAuthenticateOptions) => Promise<AuthenticateAgentResult | void>;
  launchInteractiveAuth?: (options: InteractiveAuthLaunchOptions) => Promise<void>;
  probeCwd?: string;
  probeTimeoutMs?: number;
  listResumeSessions?: () => Promise<LocalAcpResumeSession[]>;
  listAgentSessions?: (agent: DetectedAcpAgent) => Promise<LocalAcpResumeSession[]>;
  createSessionId?: () => string;
  createSessionManager?: (send: SessionSender) => SessionManagerLike;
  harnessConfig?: LocalAcpHarnessConfigStore;
  agentCatalog?: KnownAgentEntry[];
  spawnEnv?: Record<string, string | undefined>;
  harnessDownloadDir?: string;
  fetch?: typeof fetch;
  hostname?: () => string;
  osTag?: () => string;
  nowSeconds?: () => number;
}

interface BrowserMessage {
  type?: string;
  turn_id?: string;
  config_id?: string;
  mode_id?: string;
  value?: string | boolean;
  text?: string;
  queue_mode?: string;
  turn_ids?: unknown[];
}

export interface InteractiveAuthLaunchOptions {
  label: string;
  command: string;
  args: string[];
  env?: Record<string, string | undefined>;
  cwd?: string | null;
}

interface LocalAcpSession {
  id: string;
  manager: SessionManagerLike;
  clients: Set<WebSocket>;
  backlog: unknown[];
  readyMessage?: unknown;
  configOptionsMessage?: unknown;
  modeMessage?: unknown;
  errorMessage?: unknown;
  messages: LocalAcpSessionMessage[];
  promptQueueMode: PromptQueueMode;
  queuedPrompts: QueuedPrompt[];
  scheduledPromptCount: number;
  activePromptTurnId: string | null;
  projectId?: string;
  agentMemberId?: string;
  persistQueue: Promise<void>;
  promptQueue: Promise<void>;
  disposePromise?: Promise<void>;
  disposedSent?: boolean;
  observers?: Set<(msg: unknown) => void>;
}

type PromptQueueMode = "single" | "flush";

interface QueuedPrompt {
  turnId: string;
  text: string;
  createdAt: number;
}

type UpgradeCapableServer = {
  on(event: "upgrade", listener: (request: IncomingMessage, socket: any, head: Buffer) => void): void;
};

const MAX_BACKLOG_MESSAGES = 200;
const DEFAULT_AGENT_PREFERENCE = [
  "codex-acp",
  "claude-acp",
  "gemini",
];

function extractAcpContentText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return null;
  const raw = value as {
    text?: unknown;
    delta?: unknown;
    content?: unknown;
  };
  if (typeof raw.text === "string") return raw.text;
  if (typeof raw.delta === "string") return raw.delta;
  if (typeof raw.content === "string") return raw.content;
  return extractAcpContentText(raw.content);
}

function isTransportDiagnosticText(text: string): boolean {
  return /^Falling back from WebSockets to HTTPS transport\./i.test(text.trim());
}

function isTransportDiagnosticManagerMessage(msg: unknown): boolean {
  if (!isSessionEventMessage(msg)) return false;
  const event = msg.event;
  if (!event || typeof event !== "object") return false;
  const outer = event as { sessionUpdate?: unknown; update?: unknown; type?: unknown; content?: unknown };
  const inner = (outer.update && typeof outer.update === "object" ? outer.update : outer) as {
    sessionUpdate?: unknown;
    type?: unknown;
    content?: unknown;
  };
  const update = typeof inner.sessionUpdate === "string"
    ? inner.sessionUpdate
    : typeof outer.sessionUpdate === "string"
      ? outer.sessionUpdate
      : typeof inner.type === "string"
        ? inner.type
        : "";
  if (update !== "agent_message_chunk") return false;
  const text = extractAcpContentText(inner.content);
  return typeof text === "string" && isTransportDiagnosticText(text);
}

function sessionIndexKey(projectId: string, agentMemberId: string): string {
  return `${projectId}\0${agentMemberId}`;
}

function defaultDetectAgents(env: Record<string, string | undefined> = process.env): Promise<DetectedAcpAgent[]> {
  return detectAll({ env: env as NodeJS.ProcessEnv }) as Promise<KnownAgentEntry[]>;
}

function normalizeEnabledHarnessIds(ids: string[], allowedIds: string[]): string[] {
  const requested = new Set(ids);
  return [...new Set(allowedIds)].filter((id) => requested.has(id));
}

function authBlocksAgent(auth: LocalAcpHarnessAuth | undefined): boolean {
  return auth?.status === "needs-auth" || auth?.status === "unknown";
}

function authEnvVarNamesFromText(text: string | undefined): string[] {
  if (!text || !/\benvironment variable\b|\benv(?:ironment)? var\b/i.test(text)) return [];
  return [...new Set([...text.matchAll(/\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b/g)].map((match) => match[1]))];
}

function isCredentialPromptAuthMethod(
  method: LocalAcpHarnessAuthMethod | undefined,
): boolean {
  if (!method) return false;
  return method.type === "env_var" || (method.type === "terminal" && authEnvVarNamesFromText(method.description).length > 0);
}

function authVariableNames(method: LocalAcpHarnessAuthMethod | undefined): string[] {
  const explicit = method?.vars?.map((variable) => variable.name).filter(Boolean) ?? [];
  return explicit.length > 0 ? explicit : authEnvVarNamesFromText(method?.description);
}

function envVarAuthMessage(agent: DetectedAcpAgent, method: LocalAcpHarnessAuthMethod): string {
  const names = authVariableNames(method);
  return names.length > 0
    ? `${agent.label} credentials must be configured before ACP auth. Set ${names.join(", ")} and check again.`
    : `${agent.label} credentials must be configured before ACP auth. Set the required environment variables and check again.`;
}

function normalizeTerminalLaunch(value: unknown): InteractiveAuthLaunchOptions | undefined {
  if (!value || typeof value !== "object") return undefined;
  const typed = value as {
    label?: unknown;
    command?: unknown;
    args?: unknown;
    env?: unknown;
    cwd?: unknown;
  };
  if (typeof typed.label !== "string" || typed.label.length === 0) return undefined;
  if (typeof typed.command !== "string" || typed.command.length === 0) return undefined;
  const args = Array.isArray(typed.args) ? typed.args.filter((item): item is string => typeof item === "string") : [];
  const env = typed.env && typeof typed.env === "object" && !Array.isArray(typed.env)
    ? Object.fromEntries(Object.entries(typed.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
    : undefined;
  return {
    label: typed.label,
    command: typed.command,
    args,
    ...(env && Object.keys(env).length > 0 ? { env } : {}),
    ...(typeof typed.cwd === "string" || typed.cwd === null ? { cwd: typed.cwd } : {}),
  };
}

function normalizeAuthEnvVars(value: unknown): LocalAcpHarnessAuthMethod["vars"] | undefined {
  if (!Array.isArray(value)) return undefined;
  const vars = value.flatMap((item): NonNullable<LocalAcpHarnessAuthMethod["vars"]> => {
    if (!item || typeof item !== "object") return [];
    const typed = item as { name?: unknown; label?: unknown; secret?: unknown; optional?: unknown };
    if (typeof typed.name !== "string" || typed.name.length === 0) return [];
    return [{
      name: typed.name,
      ...(typeof typed.label === "string" && typed.label.length > 0 ? { label: typed.label } : {}),
      ...(typeof typed.secret === "boolean" ? { secret: typed.secret } : {}),
      ...(typeof typed.optional === "boolean" ? { optional: typed.optional } : {}),
    }];
  });
  return vars.length > 0 ? vars : undefined;
}

function normalizeAuthMethods(methods: unknown): LocalAcpHarnessAuthMethod[] | undefined {
  if (!Array.isArray(methods)) return undefined;
  const normalized = methods.flatMap((method): LocalAcpHarnessAuthMethod[] => {
    if (!method || typeof method !== "object") return [];
    const typed = method as {
      id?: unknown;
      name?: unknown;
      description?: unknown;
      type?: unknown;
      vars?: unknown;
      link?: unknown;
      terminalLaunch?: unknown;
    };
    if (typeof typed.id !== "string" || typed.id.length === 0) return [];
    const terminalLaunch = normalizeTerminalLaunch(typed.terminalLaunch);
    const vars = normalizeAuthEnvVars(typed.vars);
    return [{
      id: typed.id,
      ...(typeof typed.name === "string" && typed.name.length > 0 ? { name: typed.name } : {}),
      ...(typeof typed.description === "string" && typed.description.length > 0 ? { description: typed.description } : {}),
      ...(typeof typed.type === "string" && typed.type.length > 0 ? { type: typed.type } : {}),
      ...(vars ? { vars } : {}),
      ...(typeof typed.link === "string" && typed.link.length > 0 ? { link: typed.link } : {}),
      ...(terminalLaunch ? { terminalLaunch } : {}),
    }];
  });
  return normalized.length > 0 ? normalized : undefined;
}

function publicAuthForResponse(auth: LocalAcpHarnessAuth | undefined): LocalAcpHarnessAuth | undefined {
  if (!auth) return undefined;
  return {
    ...auth,
    ...(auth.methods
      ? {
          methods: auth.methods.map((method) => ({
            id: method.id,
            ...(method.name ? { name: method.name } : {}),
            ...(method.description ? { description: method.description } : {}),
            ...(method.type ? { type: method.type } : {}),
            ...(method.vars ? { vars: method.vars } : {}),
            ...(method.link ? { link: method.link } : {}),
          })),
        }
      : {}),
  };
}

function authMethodFields(status: {
  methodId?: unknown;
  methodName?: unknown;
  methods?: unknown;
}): Pick<LocalAcpHarnessAuth, "methodId" | "methodName" | "methods"> {
  const methods = normalizeAuthMethods(status.methods);
  return {
    ...(typeof status.methodId === "string" && status.methodId.length > 0 ? { methodId: status.methodId } : {}),
    ...(typeof status.methodName === "string" && status.methodName.length > 0 ? { methodName: status.methodName } : {}),
    ...(methods ? { methods } : {}),
  };
}

function toHarnessEntry(agent: DetectedAcpAgent): KnownAgentEntry {
  return {
    id: agent.id,
    label: agent.label,
    spec: agent.spec,
  };
}

function registryShimName(id: string): string {
  return `clash-acp-${id}`;
}

const REGISTRY_AGENT_SPEC_OVERRIDES: Record<string, { args?: string[]; env?: Record<string, string> }> = {
  // Devin's registry binary is the CLI; ACP mode is a subcommand. Without this
  // the child prints interactive CLI text on stdout and breaks ACP JSON-RPC.
  devin: { args: ["acp"] },
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeAgentServersConfig(value: unknown): LocalAcpAgentServersConfig {
  if (!isPlainObject(value)) return {};
  const servers: LocalAcpAgentServersConfig = {};
  for (const [name, raw] of Object.entries(value)) {
    if (!isPlainObject(raw) || raw.type !== "custom" || typeof raw.command !== "string" || raw.command.trim() === "") {
      continue;
    }
    const args = Array.isArray(raw.args)
      ? raw.args.filter((arg): arg is string => typeof arg === "string")
      : [];
    const env: Record<string, string> = {};
    if (isPlainObject(raw.env)) {
      for (const [key, envValue] of Object.entries(raw.env)) {
        if (typeof envValue === "string") env[key] = envValue;
      }
    }
    servers[name] = {
      type: "custom",
      command: raw.command.trim(),
      ...(args.length > 0 ? { args } : {}),
      ...(Object.keys(env).length > 0 ? { env } : {}),
    };
  }
  return servers;
}

function sanitizeCustomAgentId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `custom-${slug || "agent"}`;
}

function customAgentEntries(servers: LocalAcpAgentServersConfig): KnownAgentEntry[] {
  const used = new Set<string>();
  return Object.entries(servers).map(([name, server]) => {
    let id = sanitizeCustomAgentId(name);
    let suffix = 2;
    while (used.has(id) || KNOWN_ACP_AGENTS.some((entry) => entry.id === id)) {
      id = `${sanitizeCustomAgentId(name)}-${suffix}`;
      suffix += 1;
    }
    used.add(id);
    return {
      id,
      label: name,
      custom: true,
      systemPath: true,
      spec: {
        command: server.command,
        ...(server.args ? { args: server.args } : {}),
        ...(server.env ? { env: server.env } : {}),
      },
    } satisfies KnownAgentEntry;
  });
}

function mergeAgentEntries(entries: KnownAgentEntry[]): KnownAgentEntry[] {
  const merged = new Map<string, KnownAgentEntry>();
  for (const entry of entries) {
    const existing = merged.get(entry.id);
    if (!existing) {
      merged.set(entry.id, entry);
      continue;
    }
    merged.set(entry.id, {
      ...entry,
      ...existing,
      registryVersion: existing.registryVersion ?? entry.registryVersion,
      registryId: existing.registryId ?? entry.registryId,
      installSource: existing.installSource ?? entry.installSource,
      homepage: existing.homepage ?? entry.homepage,
    });
  }
  return [...merged.values()];
}

function shouldEnableRegistryCatalog(options: LocalAcpAdapterOptions): boolean {
  if (!options.harnessDownloadDir) return false;
  if (options.agentCatalog === undefined) return true;
  return options.agentCatalog.some((entry) => entry.installSource === "registry");
}

const LOCAL_HARNESS_CONFIG_KEY = "local-harness-config";

async function readHarnessConfig(store: SqliteLocalConfigStore): Promise<Record<string, unknown>> {
  const parsed = await store.getJson<Record<string, unknown>>(LOCAL_HARNESS_CONFIG_KEY);
  return isPlainObject(parsed) ? parsed : {};
}

async function writeHarnessConfig(store: SqliteLocalConfigStore, value: Record<string, unknown>): Promise<void> {
  await store.setJson(LOCAL_HARNESS_CONFIG_KEY, value);
}

export function createLocalHarnessConfigStore(dataDir: string): LocalAcpHarnessConfigStore {
  const configStore = createSqliteLocalConfigStore(dataDir);
  return {
    async loadEnabledHarnessIds() {
      const parsed = await readHarnessConfig(configStore) as {
        enabled_harness_ids?: unknown;
        enabledHarnessIds?: unknown;
      };
      const ids = Array.isArray(parsed.enabled_harness_ids)
        ? parsed.enabled_harness_ids
        : Array.isArray(parsed.enabledHarnessIds)
          ? parsed.enabledHarnessIds
          : null;
      if (!ids) return null;
      return ids.filter((id): id is string => typeof id === "string");
    },
    async saveEnabledHarnessIds(ids) {
      const parsed = await readHarnessConfig(configStore);
      await writeHarnessConfig(configStore, { ...parsed, enabled_harness_ids: ids });
    },
    async loadAgentServers() {
      const parsed = await readHarnessConfig(configStore);
      const servers = normalizeAgentServersConfig(parsed.agent_servers);
      return Object.keys(servers).length > 0 ? servers : null;
    },
    async saveAgentServers(servers) {
      const parsed = await readHarnessConfig(configStore);
      await writeHarnessConfig(configStore, {
        ...parsed,
        agent_servers: normalizeAgentServersConfig(servers),
      });
    },
  };
}

function createDefaultSessionManager(send: SessionSender): SessionManagerLike {
  return new SessionManager(send);
}

function chooseDefaultAgent(agents: DetectedAcpAgent[]): DetectedAcpAgent | undefined {
  for (const id of DEFAULT_AGENT_PREFERENCE) {
    const match = agents.find((agent) => agent.id === id);
    if (match) return match;
  }
  return agents[0];
}

function defaultEnabledHarnessSet(agents: DetectedAcpAgent[]): Set<string> | null {
  if (!agents.some((agent) => agent.id === "codex-acp")) return null;
  return new Set(agents.map((agent) => agent.id));
}

function sendJson(ws: WebSocket, msg: unknown): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function isSessionEventMessage(msg: unknown): msg is {
  type: "session.event";
  turn_id: string;
  event: unknown;
} {
  return !!msg &&
    typeof msg === "object" &&
    (msg as { type?: unknown }).type === "session.event" &&
    typeof (msg as { turn_id?: unknown }).turn_id === "string";
}

function isSessionReadyMessage(msg: unknown): msg is {
  type: "session.ready";
  session_id: string;
  acp_session_id?: string;
  config_options?: unknown[];
  modes?: unknown;
  replay_events?: unknown[];
} {
  return !!msg &&
    typeof msg === "object" &&
    (msg as { type?: unknown }).type === "session.ready" &&
    typeof (msg as { session_id?: unknown }).session_id === "string" &&
    (
      (msg as { replay_events?: unknown }).replay_events === undefined ||
      Array.isArray((msg as { replay_events?: unknown }).replay_events)
    ) &&
    (
      (msg as { config_options?: unknown }).config_options === undefined ||
      Array.isArray((msg as { config_options?: unknown }).config_options)
    );
}

function isSessionConfigOptionsMessage(msg: unknown): msg is {
  type: "session.config_options";
  session_id: string;
  config_options: unknown[];
} {
  return !!msg &&
    typeof msg === "object" &&
    (msg as { type?: unknown }).type === "session.config_options" &&
    typeof (msg as { session_id?: unknown }).session_id === "string" &&
    Array.isArray((msg as { config_options?: unknown }).config_options);
}

function isSessionModeMessage(msg: unknown): msg is {
  type: "session.mode";
  session_id: string;
  modes: unknown;
} {
  return !!msg &&
    typeof msg === "object" &&
    (msg as { type?: unknown }).type === "session.mode" &&
    typeof (msg as { session_id?: unknown }).session_id === "string" &&
    (msg as { modes?: unknown }).modes !== undefined;
}

function isSessionErrorMessage(msg: unknown): msg is {
  type: "session.error";
  session_id: string;
  turn_id?: string;
  message: string;
} {
  return !!msg &&
    typeof msg === "object" &&
    (msg as { type?: unknown }).type === "session.error" &&
    typeof (msg as { session_id?: unknown }).session_id === "string" &&
    typeof (msg as { message?: unknown }).message === "string";
}

function isSessionCompleteMessage(msg: unknown): msg is {
  type: "session.complete";
  session_id: string;
  turn_id?: string;
} {
  return !!msg &&
    typeof msg === "object" &&
    (msg as { type?: unknown }).type === "session.complete" &&
    typeof (msg as { session_id?: unknown }).session_id === "string";
}

function agentTextFromSessionEvent(event: unknown): string | null {
  if (!event || typeof event !== "object") return null;
  const raw = event as { type?: unknown; text?: unknown; sessionUpdate?: unknown; content?: unknown; update?: unknown };
  if (raw.type === "text" && typeof raw.text === "string") return raw.text;
  const inner = raw.update && typeof raw.update === "object" ? raw.update as typeof raw : raw;
  const update = typeof inner.sessionUpdate === "string"
    ? inner.sessionUpdate
    : typeof raw.sessionUpdate === "string"
      ? raw.sessionUpdate
      : "";
  if (update !== "agent_message_chunk") return null;
  return extractAcpContentText(inner.content);
}

const NON_TRANSCRIPT_SESSION_UPDATES = new Set([
  "available_commands_update",
  "current_mode_update",
  "config_option_update",
  "session_info_update",
  "usage_update",
]);

function getSessionUpdateType(event: unknown): string | null {
  if (!event || typeof event !== "object") return null;
  const outer = event as { update?: unknown; sessionUpdate?: unknown; type?: unknown };
  const inner = outer.update && typeof outer.update === "object"
    ? outer.update as { sessionUpdate?: unknown; type?: unknown }
    : outer;
  if (typeof inner.sessionUpdate === "string") return inner.sessionUpdate;
  if (typeof outer.sessionUpdate === "string") return outer.sessionUpdate;
  if (typeof inner.type === "string") return inner.type;
  if (typeof outer.type === "string") return outer.type;
  return null;
}

function publicSessionMessage(msg: unknown): unknown {
  if (!isSessionReadyMessage(msg) || !("replay_events" in msg)) return msg;
  const { replay_events: _replayEvents, ...publicMsg } = msg;
  return publicMsg;
}

function shouldPersistSessionEvent(event: unknown): boolean {
  const update = getSessionUpdateType(event);
  return !update || !NON_TRANSCRIPT_SESSION_UPDATES.has(update);
}

function eventKey(event: unknown): string {
  try {
    return JSON.stringify(event);
  } catch {
    return String(event);
  }
}

function isPromptQueueMode(value: unknown): value is PromptQueueMode {
  return value === "single" || value === "flush";
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

function truthyEnvFlag(value: string | undefined): boolean {
  return value === "true";
}

function readJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function nestedString(value: Record<string, unknown> | null, path: string[]): string | null {
  let cursor: unknown = value;
  for (const part of path) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return null;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return typeof cursor === "string" && cursor.length > 0 ? cursor : null;
}

async function geminiAuthPreflight(env: Record<string, string | undefined>): Promise<NonNullable<LocalAcpHarness["auth"]>> {
  if (env.GEMINI_API_KEY) {
    return {
      status: "configured",
      message: "Gemini API key configured through GEMINI_API_KEY.",
    };
  }
  if (truthyEnvFlag(env.GOOGLE_GENAI_USE_VERTEXAI)) {
    return {
      status: "configured",
      message: "Vertex AI auth selected through GOOGLE_GENAI_USE_VERTEXAI.",
    };
  }
  if (truthyEnvFlag(env.GOOGLE_GENAI_USE_GCA)) {
    return {
      status: "configured",
      message: "Google Code Assist auth selected through GOOGLE_GENAI_USE_GCA.",
    };
  }

  const home = env.HOME || process.env.HOME;
  if (!home) {
    return {
      status: "unknown",
      message: "Cannot inspect Gemini auth because HOME is not set.",
    };
  }

  const settings = readJsonObject(await readFile(join(home, ".gemini", "settings.json"), "utf8").catch(() => ""));
  const selectedType = nestedString(settings, ["security", "auth", "selectedType"]);
  if (selectedType) {
    return {
      status: "configured",
      message: `Gemini auth method selected: ${selectedType}.`,
    };
  }

  const accounts = readJsonObject(await readFile(join(home, ".gemini", "google_accounts.json"), "utf8").catch(() => ""));
  const activeAccount = nestedString(accounts, ["active"]);
  const hadOldAccounts = Array.isArray(accounts?.old) && accounts.old.length > 0;
  return {
    status: "needs-auth",
    message: activeAccount
      ? "Gemini has an account file but no selected auth method for non-interactive ACP."
      : hadOldAccounts
        ? "Gemini has old accounts but no active auth method for ACP."
        : "Gemini has no auth method selected for ACP.",
    command: "gemini",
  };
}

function agentAuthRequiredMessage(agent: DetectedAcpAgent, auth: NonNullable<LocalAcpHarness["auth"]>): string {
  return [
    `${agent.label} needs authentication before ACP can start.`,
    auth.message,
    "Use the Authenticate button, then check again.",
  ].join(" ");
}

function mergedStringEnv(env: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function appleScriptString(value: string): string {
  return JSON.stringify(value);
}

function terminalAuthShellCommand(options: InteractiveAuthLaunchOptions): string {
  const parts: string[] = [];
  if (options.cwd) {
    parts.push("cd", shellQuote(options.cwd), "&&");
  }
  const envEntries = Object.entries(options.env ?? {})
    .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[0].length > 0);
  if (envEntries.length > 0) {
    parts.push("env");
    for (const [key, value] of envEntries) {
      parts.push(`${key}=${shellQuote(value)}`);
    }
  }
  parts.push(shellQuote(options.command), ...options.args.map(shellQuote));
  parts.push(";");
  parts.push("printf", shellQuote("\\nReturn to Clash and click Check again after authentication completes.\\n"));
  return parts.join(" ");
}

function spawnDetachedCommand(
  command: string,
  args: string[],
  options: { env?: Record<string, string | undefined> } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: {
        ...process.env,
        ...mergedStringEnv(options.env ?? {}),
      },
      detached: true,
      stdio: "ignore",
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

export async function launchInteractiveAuthCommand(options: InteractiveAuthLaunchOptions): Promise<void> {
  const shellCommand = terminalAuthShellCommand(options);
  if (process.platform === "darwin") {
    await spawnDetachedCommand("osascript", [
      "-e", `tell application "Terminal"`,
      "-e", "activate",
      "-e", `do script ${appleScriptString(shellCommand)}`,
      "-e", "end tell",
    ], {
      env: process.env,
    });
    return;
  }

  const terminal = process.platform === "win32"
    ? null
    : (process.env.TERMINAL || "x-terminal-emulator");
  if (!terminal) {
    throw new Error(`Interactive auth launch is not supported on ${process.platform}. Run ${[options.command, ...options.args].join(" ")} manually.`);
  }
  const child = spawn(terminal, ["-e", "sh", "-lc", shellCommand], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

export class LocalAcpRuntimeAdapter implements LocalAcpAdapter {
  private readonly detectAgents: () => Promise<DetectedAcpAgent[]>;
  private readonly probeAgentAuth: (agent: DetectedAcpAgent) => Promise<LocalAcpHarnessAuth | undefined>;
  private readonly probeAgentSessionConfig: (agent: DetectedAcpAgent) => Promise<{ configOptions?: unknown[]; modes?: unknown }>;
  private readonly authenticateAgent: (agent: DetectedAcpAgent, options?: LocalAcpAuthenticateOptions) => Promise<AuthenticateAgentResult | void>;
  private readonly launchInteractiveAuth: (options: InteractiveAuthLaunchOptions) => Promise<void>;
  private readonly probeCwd: string | null;
  private readonly probeTimeoutMs: number;
  private readonly listLocalSessions: () => Promise<LocalAcpResumeSession[]>;
  private readonly listAgentSessions: (agent: DetectedAcpAgent) => Promise<LocalAcpResumeSession[]>;
  private readonly createSessionId: () => string;
  private readonly createSessionManager: (send: SessionSender) => SessionManagerLike;
  private readonly harnessConfig: LocalAcpHarnessConfigStore | null;
  private readonly agentCatalog: KnownAgentEntry[];
  private readonly registryCatalogEnabled: boolean;
  private readonly spawnEnv: Record<string, string | undefined>;
  private readonly harnessDownloadDir: string | null;
  private readonly fetchImpl: typeof fetch;
  private readonly hostname: () => string;
  private readonly osTag: () => string;
  private readonly nowSeconds: () => number;
  private readonly sessions = new Map<string, LocalAcpSession>();
  private readonly sessionIndex = new Map<string, string>();
  private detectedAgentsCache: DetectedAcpAgent[] | null = null;
  private detectedAgentsCacheProbesAuth = false;
  private detectedAgentsCacheProbesConfigOptions = false;
  private detectedAgentsCacheProbeScope: DetectedAgentProbeScope | null = null;
  private detectedAgentsPromise: Promise<DetectedAcpAgent[]> | null = null;
  private detectedAgentsPromiseProbesAuth = false;
  private detectedAgentsPromiseProbesConfigOptions = false;
  private detectedAgentsPromiseProbeScope: DetectedAgentProbeScope | null = null;
  private registryAgentCatalogCache: KnownAgentEntry[] | null = null;
  private registryAgentCatalogPromise: Promise<KnownAgentEntry[]> | null = null;
  private sessionMessageStore: LocalAcpSessionMessageStore | null = null;

  constructor(options: LocalAcpAdapterOptions = {}) {
    this.spawnEnv = options.spawnEnv ?? {};
    this.probeCwd = options.probeCwd ?? null;
    this.probeTimeoutMs = options.probeTimeoutMs ?? 15_000;
    this.launchInteractiveAuth = options.launchInteractiveAuth ?? launchInteractiveAuthCommand;
    this.detectAgents = options.detectAgents ?? (() => defaultDetectAgents({ ...process.env, ...this.spawnEnv }));
    this.probeAgentAuth = options.probeAgentAuth ?? (async (agent) => {
      const env = {
        ...process.env,
        ...this.spawnEnv,
        ...(agent.spec.env ?? {}),
      };
      if (agent.id === "gemini") {
        return geminiAuthPreflight(env);
      }
      const status = await probeRuntimeAgentAuthStatus({
        agent: {
          ...agent.spec,
          env: {
            ...(agent.spec.env ?? {}),
            ...Object.fromEntries(Object.entries(this.spawnEnv).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
          },
        },
        ...(this.probeCwd ? { cwd: this.probeCwd } : {}),
        env: this.spawnEnv,
        timeoutMs: this.probeTimeoutMs,
      });
      if (status.status === "none") return undefined;
      const method = status.methodName ?? status.methodId;
      const methodFields = authMethodFields(status);
      if (status.status === "configured") {
        return {
          status: "configured",
          message: method
            ? `${agent.label} ACP auth is configured (${method}).`
            : `${agent.label} ACP auth is configured.`,
          command: agent.spec.command,
          ...methodFields,
        };
      }
      if (status.status === "needs-auth") {
        const prefix = method
          ? `${agent.label} requires ACP authentication (${method}).`
          : `${agent.label} requires ACP authentication.`;
        return {
          status: "needs-auth",
          message: status.message ? `${prefix} ${status.message}` : prefix,
          command: agent.spec.command,
          ...methodFields,
        };
      }
      return {
        status: "unknown",
        message: status.message
          ? `Could not verify ${agent.label} auth: ${status.message}`
          : `Could not verify ${agent.label} auth.`,
        command: agent.spec.command,
        ...methodFields,
      };
    });
    this.probeAgentSessionConfig = options.probeAgentSessionConfig ?? (
      options.probeAgentConfigOptions
        ? async (agent) => ({ configOptions: await options.probeAgentConfigOptions!(agent) })
        : (agent) => probeRuntimeAgentSessionConfig({
          agent: {
            ...agent.spec,
            env: {
              ...(agent.spec.env ?? {}),
              ...Object.fromEntries(Object.entries(this.spawnEnv).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
            },
          },
          ...(this.probeCwd ? { cwd: this.probeCwd } : {}),
          env: this.spawnEnv,
          timeoutMs: this.probeTimeoutMs,
        })
    );
    this.authenticateAgent = options.authenticateAgent ?? (async (agent, options) => {
      const methodId = options?.methodId ?? agent.auth?.methodId;
      const cachedMethod = methodId
        ? agent.auth?.methods?.find((method) => method.id === methodId)
        : agent.auth?.methods?.[0];
      if (cachedMethod && isCredentialPromptAuthMethod(cachedMethod)) {
        throw new Error(envVarAuthMessage(agent, cachedMethod));
      }
      if (cachedMethod?.terminalLaunch) {
        await this.launchInteractiveAuth(cachedMethod.terminalLaunch);
        return { status: "started" as const };
      }
      return await authenticateRuntimeAgent({
        agent: {
          ...agent.spec,
          env: {
            ...(agent.spec.env ?? {}),
            ...Object.fromEntries(Object.entries(this.spawnEnv).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
          },
        },
        ...(this.probeCwd ? { cwd: this.probeCwd } : {}),
        env: this.spawnEnv,
        timeoutMs: 120_000,
        agentAuthLaunchGraceMs: 2_000,
        backgroundAuthTimeoutMs: 10 * 60_000,
        methodId: options?.methodId,
        launchInteractiveAuth: (options) => this.launchInteractiveAuth({
          label: options.label,
          command: options.command,
          args: options.args,
          env: options.env,
          cwd: options.cwd ?? this.probeCwd,
        }),
      });
    });
    this.listLocalSessions = options.listResumeSessions ?? (() => listLocalCcSessions(20));
    this.listAgentSessions = options.listAgentSessions ?? ((agent) => listLocalAgentSessions({
      ...agent.spec,
      env: {
        ...(agent.spec.env ?? {}),
        ...Object.fromEntries(Object.entries(this.spawnEnv).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
      },
    }));
    this.createSessionId = options.createSessionId ?? randomUUID;
    this.createSessionManager = options.createSessionManager ?? createDefaultSessionManager;
    this.harnessConfig = options.harnessConfig ?? null;
    this.agentCatalog = options.agentCatalog ?? KNOWN_ACP_AGENTS;
    this.registryCatalogEnabled = shouldEnableRegistryCatalog(options);
    this.hostname = options.hostname ?? machineName;
    this.osTag = options.osTag ?? defaultOsTag;
    this.nowSeconds = options.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
    this.harnessDownloadDir = options.harnessDownloadDir ?? null;
    this.fetchImpl = options.fetch ?? fetch;
  }

  async warmup(): Promise<void> {
    await this.refreshDetectedAgents({
      probeAuth: true,
      probeConfigOptions: true,
      probeScope: "installed",
    });
  }

  setSessionMessageStore(store: LocalAcpSessionMessageStore): void {
    this.sessionMessageStore = store;
  }

  private async refreshDetectedAgents(opts: DetectedAgentListOptions = {}): Promise<DetectedAcpAgent[]> {
    this.detectedAgentsCache = null;
    this.detectedAgentsCacheProbesAuth = false;
    this.detectedAgentsCacheProbesConfigOptions = false;
    this.detectedAgentsCacheProbeScope = null;
    this.registryAgentCatalogCache = null;
    return this.getDetectedAgents(opts);
  }

  private async getDetectedAgents(opts: DetectedAgentListOptions = {}): Promise<DetectedAcpAgent[]> {
    const probeConfigOptions = opts.probeConfigOptions === true;
    const probeAuth = opts.probeAuth === true || probeConfigOptions;
    const probeScope = opts.probeScope ?? "enabled";
    if (opts.refresh) {
      this.detectedAgentsCache = null;
      this.detectedAgentsCacheProbesAuth = false;
      this.detectedAgentsCacheProbesConfigOptions = false;
      this.detectedAgentsCacheProbeScope = null;
      this.registryAgentCatalogCache = null;
    }
    const scopeSatisfiesRequest = (scope: DetectedAgentProbeScope | null) => (
      !probeAuth ||
      probeScope === "enabled" ||
      scope === "installed"
    );
    const cacheSatisfiesRequest =
      (!probeAuth || this.detectedAgentsCacheProbesAuth) &&
      (!probeConfigOptions || this.detectedAgentsCacheProbesConfigOptions) &&
      scopeSatisfiesRequest(this.detectedAgentsCacheProbeScope);
    if (this.detectedAgentsCache && cacheSatisfiesRequest) {
      return this.detectedAgentsCache;
    }
    if (this.detectedAgentsPromise) {
      const requestIsLightweight = !probeAuth && !probeConfigOptions;
      const pendingIsMetadataProbe = this.detectedAgentsPromiseProbesAuth || this.detectedAgentsPromiseProbesConfigOptions;
      if (requestIsLightweight && pendingIsMetadataProbe) {
        const agents = await this.detectAgentsWithProbes({ probeAuth: false, probeConfigOptions: false, probeScope });
        this.detectedAgentsCache = agents;
        this.detectedAgentsCacheProbesAuth = false;
        this.detectedAgentsCacheProbesConfigOptions = false;
        this.detectedAgentsCacheProbeScope = null;
        return agents;
      }
      const promiseSatisfiesRequest =
        (!probeAuth || this.detectedAgentsPromiseProbesAuth) &&
        (!probeConfigOptions || this.detectedAgentsPromiseProbesConfigOptions) &&
        scopeSatisfiesRequest(this.detectedAgentsPromiseProbeScope);
      if (promiseSatisfiesRequest) return this.detectedAgentsPromise;
      await this.detectedAgentsPromise.catch(() => undefined);
      this.detectedAgentsCache = null;
      this.detectedAgentsCacheProbesAuth = false;
      this.detectedAgentsCacheProbesConfigOptions = false;
      this.detectedAgentsCacheProbeScope = null;
    }
    this.detectedAgentsPromiseProbesAuth = probeAuth;
    this.detectedAgentsPromiseProbesConfigOptions = probeConfigOptions;
    this.detectedAgentsPromiseProbeScope = probeAuth ? probeScope : null;
    this.detectedAgentsPromise = this.detectAgentsWithProbes({ probeAuth, probeConfigOptions, probeScope }).then((agents) => {
      this.detectedAgentsCache = agents;
      this.detectedAgentsCacheProbesAuth = probeAuth;
      this.detectedAgentsCacheProbesConfigOptions = probeConfigOptions;
      this.detectedAgentsCacheProbeScope = probeAuth ? probeScope : null;
      return agents;
    }).finally(() => {
      this.detectedAgentsPromise = null;
      this.detectedAgentsPromiseProbesAuth = false;
      this.detectedAgentsPromiseProbesConfigOptions = false;
      this.detectedAgentsPromiseProbeScope = null;
    });
    return this.detectedAgentsPromise;
  }

  private async probeAgentMetadata(agent: DetectedAcpAgent, opts: { auth?: boolean; configOptions?: boolean }): Promise<DetectedAcpAgent> {
    const shouldProbeAuth = opts.auth || opts.configOptions;
    const auth = shouldProbeAuth ? await this.probeAgentAuth(agent).catch(() => undefined) : undefined;
    const withAuth = auth ? { ...agent, auth } : agent;
    if (!opts.configOptions || authBlocksAgent(auth)) return withAuth;
    let sessionConfig: { configOptions?: unknown[]; modes?: unknown } = {};
    try {
      sessionConfig = await this.probeAgentSessionConfig(withAuth);
    } catch {
      sessionConfig = {};
    }
    const configOptions = sessionConfig.configOptions ?? [];
    return {
      ...withAuth,
      ...(configOptions.length > 0 ? { configOptions } : {}),
      ...(sessionConfig.modes ? { sessionModes: sessionConfig.modes } : {}),
    };
  }

  private async configuredCustomAgentEntries(): Promise<KnownAgentEntry[]> {
    const servers = await this.harnessConfig?.loadAgentServers?.() ?? null;
    return servers ? customAgentEntries(servers) : [];
  }

  private async registryAgentEntries(): Promise<KnownAgentEntry[]> {
    if (!this.registryCatalogEnabled) return [];
    if (this.registryAgentCatalogCache) return this.registryAgentCatalogCache;
    if (!this.registryAgentCatalogPromise) {
      this.registryAgentCatalogPromise = listAcpRegistryCatalog({ fetchImpl: this.fetchImpl })
        .then((agents) => agents.map((agent) => {
          const override = REGISTRY_AGENT_SPEC_OVERRIDES[agent.id];
          const args = override?.args ?? agent.args;
          const env = {
            ...(agent.env ?? {}),
            ...(override?.env ?? {}),
          };
          return {
            id: agent.id,
            label: agent.name,
            spec: {
              command: registryShimName(agent.id),
              ...(args && args.length > 0 ? { args } : {}),
              ...(Object.keys(env).length > 0 ? { env } : {}),
            },
            registryId: agent.id,
            ...(agent.version ? { registryVersion: agent.version } : {}),
            installSource: "registry" as const,
            ...(agent.homepage ? { homepage: agent.homepage } : {}),
          } satisfies KnownAgentEntry;
        }))
        .catch(() => [])
        .finally(() => {
          this.registryAgentCatalogPromise = null;
        });
    }
    const entries = await this.registryAgentCatalogPromise;
    this.registryAgentCatalogCache = entries;
    return entries;
  }

  private async fullAgentCatalog(): Promise<KnownAgentEntry[]> {
    return mergeAgentEntries([
      ...this.agentCatalog,
      ...(await this.registryAgentEntries()),
      ...(await this.configuredCustomAgentEntries()),
    ]);
  }

  private async detectConfiguredAgents(): Promise<DetectedAcpAgent[]> {
    const agents = await this.detectAgents();
    const fullCatalog = await this.fullAgentCatalog();
    const env = { ...process.env, ...this.spawnEnv } as NodeJS.ProcessEnv;
    const knownIds = new Set(agents.map((agent) => agent.id));
    const baseCatalogIds = new Set(this.agentCatalog.map((entry) => entry.id));
    const entriesToProbe = fullCatalog.filter((entry) => (
      !knownIds.has(entry.id) &&
      (entry.custom || !baseCatalogIds.has(entry.id))
    ));
    if (entriesToProbe.length === 0) return agents;
    const extraDetected = await Promise.all(entriesToProbe.map((entry) => detectEntry(entry, {
      env,
      ...(this.probeCwd ? { cwd: this.probeCwd } : {}),
    })));
    const merged = new Map(agents.map((agent) => [agent.id, agent]));
    for (const entry of extraDetected) {
      if (!entry) continue;
      merged.set(entry.id, entry as DetectedAcpAgent);
    }
    return [...merged.values()];
  }

  private async detectAgentsWithProbes(opts: {
    probeAuth: boolean;
    probeConfigOptions: boolean;
    probeScope: DetectedAgentProbeScope;
  }): Promise<DetectedAcpAgent[]> {
    const agents = await this.detectConfiguredAgents();
    if (!opts.probeAuth && !opts.probeConfigOptions) return agents;
    const enabled = (await this.enabledHarnessSet()) ?? defaultEnabledHarnessSet(agents);
    const shouldProbe = (agent: DetectedAcpAgent) => (
      opts.probeScope === "installed" ||
      !enabled ||
      enabled.has(agent.id)
    );
    const probed = await Promise.all(agents.map(async (agent) => {
      if (!shouldProbe(agent)) return agent;
      return this.probeAgentMetadata(agent, { auth: opts.probeAuth, configOptions: opts.probeConfigOptions });
    }));
    return probed;
  }

  private updateCachedAgentConfigOptions(agentId: string, configOptions: unknown[]): void {
    if (!this.detectedAgentsCache) return;
    this.detectedAgentsCache = this.detectedAgentsCache.map((agent) => (
      agent.id === agentId ? { ...agent, configOptions } : agent
    ));
  }

  private updateCachedAgentSessionModes(agentId: string, sessionModes: unknown): void {
    if (!this.detectedAgentsCache) return;
    this.detectedAgentsCache = this.detectedAgentsCache.map((agent) => (
      agent.id === agentId ? { ...agent, sessionModes } : agent
    ));
  }

  private async enabledHarnessSet(): Promise<Set<string> | null> {
    const configured = await this.harnessConfig?.loadEnabledHarnessIds();
    return configured ? new Set(configured) : null;
  }

  private async detectEnabledAgents(opts: DetectedAgentListOptions = {}): Promise<DetectedAcpAgent[]> {
    const agents = await this.getDetectedAgents(opts);
    const enabled = (await this.enabledHarnessSet()) ?? defaultEnabledHarnessSet(agents);
    const enabledAgents = enabled ? agents.filter((agent) => enabled.has(agent.id)) : agents;
    return enabledAgents.filter((agent) => !authBlocksAgent(agent.auth));
  }

  private async detectRuntimeListAgents(opts: DetectedAgentListOptions = {}): Promise<DetectedAcpAgent[]> {
    const agents = await this.getDetectedAgents(opts);
    const enabled = (await this.enabledHarnessSet()) ?? defaultEnabledHarnessSet(agents);
    return enabled ? agents.filter((agent) => enabled.has(agent.id)) : agents;
  }

  private async managedInstallInfo(entry: KnownAgentEntry): Promise<{
    installed: boolean;
    installedVersion?: string;
    latestVersion?: string;
    updateAvailable?: boolean;
  }> {
    const latestVersion = entry.registryVersion;
    if (!this.harnessDownloadDir || !entry.installSource) {
      return {
        installed: false,
        ...(latestVersion ? { latestVersion } : {}),
      };
    }
    const shimPath = join(this.harnessDownloadDir, basename(entry.spec.command));
    const installed = await access(shimPath).then(() => true, () => false);
    if (!installed) {
      return {
        installed: false,
        ...(latestVersion ? { latestVersion } : {}),
      };
    }
    const metadata = entry.installSource === "registry" && entry.registryId
      ? await readAcpRegistryInstallMetadata({
        registryId: entry.registryId,
        binDir: this.harnessDownloadDir,
        installRoot: this.harnessDownloadDir,
      })
      : null;
    const installedVersion = metadata?.version;
    const updateAvailable = entry.installSource === "registry" && !!latestVersion && installedVersion !== latestVersion;
    return {
      installed: true,
      ...(installedVersion ? { installedVersion } : {}),
      ...(latestVersion ? { latestVersion } : {}),
      ...(updateAvailable ? { updateAvailable: true } : {}),
    };
  }

  private async buildHarnesses(opts: LocalAcpHarnessListOptions = {}): Promise<LocalAcpHarness[]> {
    const probeAuth = opts.probe === true || opts.probe === "auth" || opts.probe === "config";
    const probeConfigOptions = opts.probe === "config";
    const agents = await this.getDetectedAgents({
      probeAuth,
      probeConfigOptions,
      probeScope: "installed",
      refresh: opts.refresh === true,
    });
    const enabled = (await this.enabledHarnessSet()) ?? defaultEnabledHarnessSet(agents);
    const detectedById = new Map(agents.map((agent) => [agent.id, agent]));
    const fullCatalog = await this.fullAgentCatalog();
    const catalogById = new Map(fullCatalog.map((entry) => [entry.id, entry]));
    const orderedEntries: KnownAgentEntry[] = [];
    const seen = new Set<string>();

    for (const agent of agents) {
      const entry = catalogById.get(agent.id) ?? toHarnessEntry(agent);
      orderedEntries.push(entry);
      seen.add(agent.id);
    }
    for (const entry of fullCatalog) {
      if (!seen.has(entry.id)) orderedEntries.push(entry);
    }

    return Promise.all(orderedEntries.map(async (entry) => {
      const detected = detectedById.get(entry.id);
      const installInfo = await this.managedInstallInfo(entry);
      const enabledByConfig = enabled ? enabled.has(entry.id) : !!detected;
      return {
        id: entry.id,
        label: entry.label,
        binary: detected?.spec.command ?? entry.spec.command,
        enabled: enabledByConfig && !authBlocksAgent(detected?.auth),
        available: !!detected,
        ...(entry.custom ? { custom: true } : {}),
        ...(installInfo.installed ? { installed: true } : {}),
        ...(installInfo.installedVersion ? { installedVersion: installInfo.installedVersion } : {}),
        ...(installInfo.latestVersion ? { latestVersion: installInfo.latestVersion } : {}),
        ...(installInfo.updateAvailable ? { updateAvailable: true } : {}),
        ...(entry.installSource ? { installable: true, installSource: entry.installSource } : {}),
        ...(entry.downloadUrl ? { downloadUrl: entry.downloadUrl } : {}),
        ...(entry.downloadKind ? { downloadKind: entry.downloadKind } : {}),
        ...(entry.homepage ? { homepage: entry.homepage } : {}),
        ...(detected?.auth ? { auth: publicAuthForResponse(detected.auth) } : {}),
        ...(detected?.sessionModes ? { session_modes: detected.sessionModes } : {}),
      };
    }));
  }

  async listHarnesses(opts: LocalAcpHarnessListOptions = {}) {
    return { harnesses: await this.buildHarnesses(opts) };
  }

  async updateHarnesses(enabledIds: string[]) {
    const agents = await this.getDetectedAgents();
    const normalized = normalizeEnabledHarnessIds(enabledIds, [
      ...agents.map((agent) => agent.id),
    ]);
    const agentById = new Map(agents.map((agent) => [agent.id, agent]));
    const probedAgents = await Promise.all(normalized
      .map((id) => agentById.get(id))
      .filter((agent): agent is DetectedAcpAgent => !!agent)
      .map((agent) => this.probeAgentMetadata(agent, { auth: true, configOptions: false })));
    const blocked = probedAgents.find((agent) => authBlocksAgent(agent.auth));
    if (blocked?.auth) {
      const suffix = blocked.auth.message ? ` ${blocked.auth.message}` : "";
      throw new Error(`Authenticate ${blocked.label} before enabling.${suffix}`);
    }
    await this.harnessConfig?.saveEnabledHarnessIds(normalized);
    this.detectedAgentsCache = null;
    this.detectedAgentsCacheProbesAuth = false;
    this.detectedAgentsCacheProbesConfigOptions = false;
    this.detectedAgentsCacheProbeScope = null;
    return { harnesses: await this.buildHarnesses({ probe: "auth", refresh: true }) };
  }

  async listAgentServers() {
    return { agent_servers: await this.harnessConfig?.loadAgentServers?.() ?? {} };
  }

  async updateAgentServers(servers: LocalAcpAgentServersConfig) {
    if (!this.harnessConfig?.saveAgentServers) throw new Error("Custom agent server settings are not configured");
    const normalized = normalizeAgentServersConfig(servers);
    await this.harnessConfig.saveAgentServers(normalized);
    this.detectedAgentsCache = null;
    this.detectedAgentsCacheProbesAuth = false;
    this.detectedAgentsCacheProbesConfigOptions = false;
    this.detectedAgentsCacheProbeScope = null;
    return {
      agent_servers: normalized,
      harnesses: await this.buildHarnesses({ probe: true, refresh: true }),
    };
  }

  async installHarness(id: string) {
    const entry = (await this.fullAgentCatalog()).find((candidate) => candidate.id === id);
    if (!entry) throw new Error(`Unknown harness: ${id}`);
    if (!this.harnessDownloadDir) throw new Error("Harness download directory is not configured");

    if (entry.installSource === "registry") {
      if (!entry.registryId) throw new Error(`${entry.label} is missing an ACP registry id`);
      await installAcpRegistryAgent({
        registryId: entry.registryId,
        shimName: basename(entry.spec.command),
        binDir: this.harnessDownloadDir,
        installRoot: this.harnessDownloadDir,
        fetchImpl: this.fetchImpl,
        shimArgs: entry.spec.args,
        shimEnv: entry.spec.env,
        env: this.spawnEnv as NodeJS.ProcessEnv,
      });
    } else if (entry.installSource === "adapter" && entry.downloadUrl) {
      await installManagedAdapter({
        id: entry.id,
        label: entry.label,
        command: entry.spec.command,
        args: entry.spec.args,
        downloadUrl: entry.downloadUrl,
        binDir: this.harnessDownloadDir,
        fetchImpl: this.fetchImpl,
      });
    } else {
      throw new Error(`${entry.label} is not installable from Clash`);
    }

    this.detectedAgentsCache = null;
    this.detectedAgentsCacheProbesAuth = false;
    this.detectedAgentsCacheProbesConfigOptions = false;
    this.detectedAgentsCacheProbeScope = null;
    return { harnesses: await this.buildHarnesses({ probe: true, refresh: true }) };
  }

  async installHarnessAdapter(id: string) {
    return this.installHarness(id);
  }

  async upgradeHarness(id: string) {
    const entry = (await this.fullAgentCatalog()).find((candidate) => candidate.id === id);
    if (!entry) throw new Error(`Unknown harness: ${id}`);
    const installInfo = await this.managedInstallInfo(entry);
    if (!installInfo.installed) throw new Error(`${entry.label} is not installed by Clash`);
    return this.installHarness(id);
  }

  async uninstallHarness(id: string) {
    const entry = (await this.fullAgentCatalog()).find((candidate) => candidate.id === id);
    if (!entry) throw new Error(`Unknown harness: ${id}`);
    if (!this.harnessDownloadDir) throw new Error("Harness download directory is not configured");

    if (entry.installSource === "registry") {
      if (!entry.registryId) throw new Error(`${entry.label} is missing an ACP registry id`);
      await uninstallAcpRegistryAgent({
        registryId: entry.registryId,
        shimName: basename(entry.spec.command),
        binDir: this.harnessDownloadDir,
        installRoot: this.harnessDownloadDir,
      });
    } else if (entry.installSource === "adapter") {
      await uninstallManagedAdapter({
        command: entry.spec.command,
        binDir: this.harnessDownloadDir,
      });
    } else {
      throw new Error(`${entry.label} is not managed by Clash`);
    }

    const enabled = await this.harnessConfig?.loadEnabledHarnessIds();
    if (enabled) {
      await this.harnessConfig?.saveEnabledHarnessIds(enabled.filter((candidate) => candidate !== id));
    }
    this.detectedAgentsCache = null;
    this.detectedAgentsCacheProbesAuth = false;
    this.detectedAgentsCacheProbesConfigOptions = false;
    this.detectedAgentsCacheProbeScope = null;
    return { harnesses: await this.buildHarnesses({ probe: true, refresh: true }) };
  }

  async listRuntimes(opts: LocalAcpRuntimeListOptions = {}) {
    const probeAuth = opts.probe === true || opts.probe === "auth" || opts.probe === "config";
    const probeConfigOptions = opts.probe === true || opts.probe === "config";
    const agents = await this.detectRuntimeListAgents({
      probeAuth,
      probeConfigOptions,
      probeScope: probeConfigOptions ? "installed" : "enabled",
      refresh: opts.refresh === true,
    });
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
            label: agent.label,
            binary: agent.spec.command,
            ...(Array.isArray(agent.configOptions) && agent.configOptions.length > 0
              ? { config_options: agent.configOptions }
              : {}),
            ...(agent.sessionModes ? { session_modes: agent.sessionModes } : {}),
            ...(agent.auth ? { auth: publicAuthForResponse(agent.auth) } : {}),
          })),
          version: "desktop",
          status: "online" as const,
          last_heartbeat: now,
          created_at: now,
        },
      ],
    };
  }

  async authenticateHarness(id: string, options?: LocalAcpAuthenticateOptions) {
    const agents = await this.getDetectedAgents();
    const agent = agents.find((candidate) => candidate.id === id);
    if (!agent) throw new Error(`Local agent harness is not available: ${id}`);
    const result = await this.authenticateAgent(agent, options);
    const authStarted = result?.status === "started";
    return {
      harnesses: await this.buildHarnesses(authStarted
        ? { probe: false, refresh: false }
        : { probe: "auth", refresh: true }),
    };
  }

  async createSession(params: LocalAcpCreateSessionParams) {
    return this.startSession(params, params.sessionId ?? this.createSessionId());
  }

  async attachSession(params: LocalAcpAttachSessionParams) {
    if (this.sessions.has(params.sessionId)) {
      return { session_id: params.sessionId };
    }
    return this.startSession(params, params.sessionId);
  }

  private async startSession(params: LocalAcpCreateSessionParams, sessionId: string) {
    if (params.runtimeId !== DESKTOP_LOCAL_RUNTIME_ID) {
      throw new Error(`Unknown local runtime: ${params.runtimeId}`);
    }

    const agents = await this.detectEnabledAgents({ probeAuth: true, probeScope: "enabled" });
    let agent = params.agentId
      ? agents.find((candidate) => candidate.id === params.agentId)
      : chooseDefaultAgent(agents);
    if (!agent && params.agentId) {
      const detectedAgents = await this.getDetectedAgents({ probeAuth: true, probeScope: "enabled" });
      const requestedAgent = detectedAgents.find((candidate) => candidate.id === params.agentId);
      const enabled = (await this.enabledHarnessSet()) ?? defaultEnabledHarnessSet(detectedAgents);
      const enabledByConfig = enabled ? enabled.has(params.agentId) : true;
      if (requestedAgent?.auth && enabledByConfig && authBlocksAgent(requestedAgent.auth)) {
        throw new Error(agentAuthRequiredMessage(requestedAgent, requestedAgent.auth));
      }
      throw new Error(`Local agent harness is not enabled or unavailable: ${params.agentId}`);
    }
    if (!agent) throw new Error("No enabled local agent harness found");
    const agentIdForConfigUpdates = agent.id;

    let entry: LocalAcpSession;
    const send: SessionSender = (msg) => {
      if (isTransportDiagnosticManagerMessage(msg)) return;
      const persisted = this.persistManagerMessage(entry, msg);
      const publicMsg = publicSessionMessage(msg);
      if (isSessionReadyMessage(msg)) {
        entry.readyMessage = publicMsg;
        if (Array.isArray(msg.config_options)) {
          this.updateCachedAgentConfigOptions(agentIdForConfigUpdates, msg.config_options);
          entry.configOptionsMessage = {
            type: "session.config_options",
            session_id: sessionId,
            config_options: msg.config_options,
          };
        }
        if (msg.modes !== undefined) {
          this.updateCachedAgentSessionModes(agentIdForConfigUpdates, msg.modes);
          entry.modeMessage = {
            type: "session.mode",
            session_id: sessionId,
            modes: msg.modes,
          };
        }
        void params.onReady?.({
          sessionId,
          ...(msg.acp_session_id ? { acpSessionId: msg.acp_session_id } : {}),
        });
      } else if (isSessionConfigOptionsMessage(msg)) {
        this.updateCachedAgentConfigOptions(agentIdForConfigUpdates, msg.config_options);
        entry.configOptionsMessage = publicMsg;
      } else if (isSessionModeMessage(msg)) {
        this.updateCachedAgentSessionModes(agentIdForConfigUpdates, msg.modes);
        entry.modeMessage = publicMsg;
      } else if (isSessionErrorMessage(msg)) {
        entry.errorMessage = publicMsg;
        void params.onError?.({ sessionId, message: msg.message });
      }
      if (
        publicMsg &&
        typeof publicMsg === "object" &&
        (publicMsg as { type?: unknown }).type === "session.disposed"
      ) {
        entry.disposedSent = true;
      }
      this.sendToSession(entry, publicMsg);
      if (persisted) void persisted.catch(() => undefined);
    };
    entry = {
      id: sessionId,
      manager: this.createSessionManager(send),
      clients: new Set(),
      backlog: [],
      messages: [],
      promptQueueMode: "single",
      queuedPrompts: [],
      scheduledPromptCount: 0,
      activePromptTurnId: null,
      persistQueue: Promise.resolve(),
      promptQueue: Promise.resolve(),
      ...(params.projectId ? { projectId: params.projectId } : {}),
      ...(params.agentMemberId ? { agentMemberId: params.agentMemberId } : {}),
    };
    entry.manager.setSpawnEnv?.(this.spawnEnv);
    this.sessions.set(sessionId, entry);
    if (params.projectId && params.agentMemberId) {
      this.sessionIndex.set(sessionIndexKey(params.projectId, params.agentMemberId), sessionId);
    }

    agent = await this.probeAgentMetadata(agent, { auth: true, configOptions: false });
    if (agent.auth?.status === "needs-auth") {
      send({
        type: "session.error",
        session_id: sessionId,
        code: "auth_required",
        agent_id: agent.id,
        auth: publicAuthForResponse(agent.auth),
        message: agentAuthRequiredMessage(agent, agent.auth),
      } as SessionManagerOut);
      return { session_id: sessionId };
    }

    const startParams: SessionStartParamsLike = {
      session_id: sessionId,
      agent_template_id: params.agentTemplateId,
      agent_id: agent.id,
      agent_spec: agent.spec,
      ...(params.permissionMode ? { permission_mode: params.permissionMode } : {}),
      ...(params.agentMemberId ? { agent_member_id: params.agentMemberId } : {}),
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

  async pushRoomMention(
    projectId: string,
    agentMemberId: string,
    mention: Record<string, unknown>,
  ): Promise<boolean> {
    const sessionId = this.sessionIndex.get(sessionIndexKey(projectId, agentMemberId));
    if (!sessionId) return false;
    const entry = this.sessions.get(sessionId);
    if (!entry) return false;
    this.sendToSession(entry, { type: "room.mention", ...mention });
    return true;
  }

  async runTextTask(params: LocalAcpTextTaskParams): Promise<{ text: string; agentId?: string; sessionId: string }> {
    const sessionId = this.createSessionId();
    await this.startSession({
      runtimeId: DESKTOP_LOCAL_RUNTIME_ID,
      agentTemplateId: "text-generator",
      agentMemberId: "local-text-generator",
      projectId: params.projectId,
      agentId: params.agentId,
    }, sessionId);
    const entry = this.sessions.get(sessionId);
    if (!entry) throw new Error("Local ACP text session failed to start.");

    const turnId = `text-gen-${randomUUID().slice(0, 8)}`;
    const chunks: string[] = [];
    const prompt = [
      params.systemPrompt ? `System instructions:\n${params.systemPrompt}` : "",
      "Generate only the requested text. Do not edit the canvas or call tools unless strictly required for the text.",
      params.prompt,
    ].filter(Boolean).join("\n\n");

    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Local ACP text generation timed out."));
      }, params.timeoutMs ?? 5 * 60 * 1000);
      const observer = (msg: unknown) => {
        if (isSessionEventMessage(msg) && msg.turn_id === turnId) {
          const text = agentTextFromSessionEvent(msg.event);
          if (text) chunks.push(text);
          return;
        }
        if (isSessionErrorMessage(msg) && (!msg.turn_id || msg.turn_id === turnId)) {
          cleanup();
          reject(new Error(msg.message));
          return;
        }
        if (isSessionCompleteMessage(msg) && msg.turn_id === turnId) {
          cleanup();
          const text = chunks.join("").trim();
          if (!text) {
            reject(new Error("Local ACP text generation returned no text."));
            return;
          }
          resolve({ text, sessionId, agentId: params.agentId });
        }
      };
      const cleanup = () => {
        clearTimeout(timeout);
        entry.observers?.delete(observer);
        void this.disposeSession(sessionId);
      };
      entry.observers ??= new Set();
      entry.observers.add(observer);
      const modelId = params.modelId?.trim();
      Promise.resolve(
        modelId
          ? entry.manager.setConfigOption?.(sessionId, params.modelConfigId ?? "model", modelId)
          : undefined,
      )
        .then(() => this.schedulePrompt(entry, turnId, prompt))
        .catch((error) => {
          cleanup();
          reject(error);
        });
    });
  }

  async listSessionMessages(sessionId: string): Promise<{ messages: LocalAcpSessionMessage[] } | null> {
    const persisted = await this.sessionMessageStore?.listSessionMessages(sessionId);
    if (persisted) return persisted;
    const entry = this.sessions.get(sessionId);
    if (!entry) return null;
    return {
      messages: entry.messages.map((message) => ({
        ...message,
        events: structuredClone(message.events),
      })),
    };
  }

  private enqueuePersistence(entry: LocalAcpSession, task: () => Promise<void> | void): Promise<void> {
    entry.persistQueue = entry.persistQueue.then(
      () => Promise.resolve(task()),
      () => Promise.resolve(task()),
    );
    return entry.persistQueue;
  }

  private promptQueueSnapshot(entry: LocalAcpSession) {
    return entry.queuedPrompts.map((prompt) => ({
      turn_id: prompt.turnId,
      text: prompt.text,
      created_at: prompt.createdAt,
    }));
  }

  private sendPromptQueueUpdate(entry: LocalAcpSession): void {
    const msg = {
      type: "session.queue_update",
      session_id: entry.id,
      mode: entry.promptQueueMode,
      active_turn_id: entry.activePromptTurnId,
      queued: this.promptQueueSnapshot(entry),
    };
    for (const client of entry.clients) sendJson(client, msg);
  }

  private promptBusy(entry: LocalAcpSession): boolean {
    return entry.scheduledPromptCount > 0 || entry.activePromptTurnId !== null;
  }

  private schedulePrompt(
    entry: LocalAcpSession,
    turnId: string,
    text: string,
    opts: { persistUserPrompt?: boolean } = {},
  ): Promise<void> {
    entry.scheduledPromptCount += 1;
    this.sendPromptQueueUpdate(entry);
    const runPrompt = async () => {
      if (opts.persistUserPrompt) {
        const promptAfterPersist = this.appendUserPrompt(entry, turnId, text) ?? Promise.resolve();
        await promptAfterPersist;
      }
      entry.activePromptTurnId = turnId;
      this.sendPromptQueueUpdate(entry);
      try {
        await Promise.resolve(entry.manager.prompt({
          session_id: entry.id,
          turn_id: turnId,
          text,
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const errorAfterPersist = this.persistTurnError(entry, turnId, message) ?? Promise.resolve();
        await errorAfterPersist.finally(() =>
          this.sendToSession(entry, {
            type: "session.error",
            session_id: entry.id,
            turn_id: turnId,
            message,
          })
        );
      } finally {
        if (entry.activePromptTurnId === turnId) entry.activePromptTurnId = null;
        entry.scheduledPromptCount = Math.max(0, entry.scheduledPromptCount - 1);
        this.sendPromptQueueUpdate(entry);
        if (!this.promptBusy(entry)) this.drainQueuedPrompts(entry);
      }
    };
    entry.promptQueue = entry.promptQueue.then(runPrompt, runPrompt);
    return entry.promptQueue;
  }

  private queuePrompt(entry: LocalAcpSession, turnId: string, text: string): void {
    const existingIndex = entry.queuedPrompts.findIndex((prompt) => prompt.turnId === turnId);
    const existing = existingIndex >= 0 ? entry.queuedPrompts[existingIndex] : null;
    const nextPrompt = {
      turnId,
      text,
      createdAt: existing?.createdAt ?? this.nowSeconds(),
    };
    if (existingIndex >= 0) entry.queuedPrompts[existingIndex] = nextPrompt;
    else entry.queuedPrompts.push(nextPrompt);
    this.sendPromptQueueUpdate(entry);
  }

  private sendSteerPrompt(entry: LocalAcpSession, turnId: string, text: string): void {
    entry.queuedPrompts = entry.queuedPrompts.filter((prompt) => prompt.turnId !== turnId);
    this.appendUserPrompt(entry, turnId, text);
    entry.scheduledPromptCount += 1;
    this.sendPromptQueueUpdate(entry);

    void (async () => {
      try {
        await Promise.resolve(entry.manager.prompt({
          session_id: entry.id,
          turn_id: turnId,
          text,
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const errorAfterPersist = this.persistTurnError(entry, turnId, message) ?? Promise.resolve();
        await errorAfterPersist.finally(() =>
          this.sendToSession(entry, {
            type: "session.error",
            session_id: entry.id,
            turn_id: turnId,
            message,
          })
        );
      } finally {
        entry.scheduledPromptCount = Math.max(0, entry.scheduledPromptCount - 1);
        this.sendPromptQueueUpdate(entry);
        if (!this.promptBusy(entry)) this.drainQueuedPrompts(entry);
      }
    })();
  }

  private dispatchPrompt(
    entry: LocalAcpSession,
    turnId: string,
    text: string,
  ): Promise<void> | void {
    if (this.promptBusy(entry)) {
      this.queuePrompt(entry, turnId, text);
      return;
    }
    this.appendUserPrompt(entry, turnId, text);
    return this.schedulePrompt(entry, turnId, text);
  }

  private markPromptCancelled(entry: LocalAcpSession, turnId: string): void {
    if (entry.activePromptTurnId !== turnId) return;
    entry.activePromptTurnId = null;
    entry.scheduledPromptCount = Math.max(0, entry.scheduledPromptCount - 1);
    this.sendPromptQueueUpdate(entry);
  }

  private drainQueuedPrompts(entry: LocalAcpSession): boolean {
    if (entry.queuedPrompts.length === 0) return false;
    const toSend = entry.promptQueueMode === "single"
      ? entry.queuedPrompts.slice(0, 1)
      : entry.queuedPrompts;
    const toSendTurns = new Set(toSend.map((prompt) => prompt.turnId));
    entry.queuedPrompts = entry.queuedPrompts.filter((prompt) => !toSendTurns.has(prompt.turnId));
    this.sendPromptQueueUpdate(entry);
    for (const prompt of toSend) {
      this.schedulePrompt(entry, prompt.turnId, prompt.text, { persistUserPrompt: true });
    }
    return true;
  }

  private appendUserPrompt(entry: LocalAcpSession, turnId: string, text: string): Promise<void> | null {
    if (entry.messages.some((message) => message.id === `${turnId}-user`)) return this.sessionMessageStore ? entry.persistQueue : null;
    const message: LocalAcpSessionMessage = {
      id: `${turnId}-user`,
      sender_kind: "user",
      sender_id: "local-user",
      turn_id: turnId,
      events: [{ type: "text", text }],
      created_at: this.nowSeconds(),
    };
    entry.messages.push(message);
    return this.sessionMessageStore
      ? this.enqueuePersistence(entry, () => this.sessionMessageStore?.appendUserPrompt(entry.id, message))
      : null;
  }

  private appendAgentEvent(entry: LocalAcpSession, turnId: string, event: unknown): Promise<void> | null {
    const id = `${turnId}-agent`;
    let message = entry.messages.find((candidate) => candidate.id === id);
    if (!message) {
      message = {
        id,
        sender_kind: "agent",
        sender_id: entry.agentMemberId ?? "local-agent",
        turn_id: turnId,
        events: [],
        created_at: this.nowSeconds(),
      };
      entry.messages.push(message);
    }
    message.events.push(event);
    return this.sessionMessageStore
      ? this.enqueuePersistence(entry, () =>
          this.sessionMessageStore?.appendAgentEvent(entry.id, {
            ...message,
            events: structuredClone(message.events),
          })
        )
      : null;
  }

  private importReplayEvents(entry: LocalAcpSession, events: unknown[]): Promise<void> | null {
    const transcriptEvents = events.filter(shouldPersistSessionEvent);
    if (transcriptEvents.length === 0) return null;
    const importId = `${entry.id}-acp-replay`;
    const applyToMemory = () => {
      if (entry.messages.some((message) => message.id !== importId && message.events.length > 0)) return null;
      let message = entry.messages.find((candidate) => candidate.id === importId);
      if (!message) {
        message = {
          id: importId,
          sender_kind: "agent",
          sender_id: entry.agentMemberId ?? "local-agent",
          turn_id: null,
          events: [],
          created_at: this.nowSeconds(),
        };
        entry.messages.push(message);
      }
      const seen = new Set(message.events.map(eventKey));
      for (const event of transcriptEvents) {
        const key = eventKey(event);
        if (seen.has(key)) continue;
        message.events.push(event);
        seen.add(key);
      }
      return message.events.length > 0 ? message : null;
    };

    if (!this.sessionMessageStore) {
      applyToMemory();
      return null;
    }

    return this.enqueuePersistence(entry, async () => {
      const existing = await this.sessionMessageStore?.listSessionMessages(entry.id);
      const hasExistingTranscript = existing?.messages.some((message) =>
        message.id !== importId && message.events.length > 0
      );
      if (hasExistingTranscript) return;
      const message = applyToMemory();
      if (!message) return;
      await this.sessionMessageStore?.appendAgentEvent(entry.id, {
        ...message,
        events: structuredClone(message.events),
      });
    });
  }

  private persistTurnComplete(entry: LocalAcpSession, turnId: string): Promise<void> | null {
    return this.sessionMessageStore?.markTurnComplete
      ? this.enqueuePersistence(entry, () => this.sessionMessageStore?.markTurnComplete?.(entry.id, turnId))
      : null;
  }

  private persistTurnError(entry: LocalAcpSession, turnId: string | null, message: string): Promise<void> | null {
    return this.sessionMessageStore?.appendTurnError
      ? this.enqueuePersistence(entry, () => this.sessionMessageStore?.appendTurnError?.(entry.id, turnId, message))
      : null;
  }

  private persistManagerMessage(entry: LocalAcpSession, msg: unknown): Promise<void> | null {
    if (isSessionReadyMessage(msg) && Array.isArray(msg.replay_events)) {
      return this.importReplayEvents(entry, msg.replay_events);
    }
    if (isSessionEventMessage(msg)) {
      if (!shouldPersistSessionEvent(msg.event)) return null;
      return this.appendAgentEvent(entry, msg.turn_id, msg.event);
    }
    if (isSessionErrorMessage(msg)) {
      return this.persistTurnError(entry, msg.turn_id ?? null, msg.message);
    }
    if (isSessionCompleteMessage(msg) && msg.turn_id) {
      return this.persistTurnComplete(entry, msg.turn_id);
    }
    return null;
  }

  private sendToSession(entry: LocalAcpSession, msg: unknown): void {
    for (const observer of entry.observers ?? []) observer(msg);
    entry.backlog.push(msg);
    if (entry.backlog.length > MAX_BACKLOG_MESSAGES) {
      entry.backlog.splice(0, entry.backlog.length - MAX_BACKLOG_MESSAGES);
    }
    for (const client of entry.clients) sendJson(client, msg);
  }

  private removeSession(sessionId: string): void {
    const entry = this.sessions.get(sessionId);
    if (entry?.projectId && entry.agentMemberId) {
      const key = sessionIndexKey(entry.projectId, entry.agentMemberId);
      if (this.sessionIndex.get(key) === sessionId) this.sessionIndex.delete(key);
    }
    this.sessions.delete(sessionId);
  }

  private disposeSession(sessionId: string): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (!entry) return Promise.resolve();
    if (!entry.disposePromise) {
      entry.disposePromise = Promise.resolve(entry.manager.dispose(sessionId))
        .catch((error) => {
          this.sendToSession(entry, {
            type: "session.error",
            session_id: sessionId,
            message: error instanceof Error ? error.message : String(error),
          });
        })
        .finally(() => {
          if (!entry.disposedSent) {
            this.sendToSession(entry, {
              type: "session.disposed",
              session_id: sessionId,
            });
            entry.disposedSent = true;
          }
          this.removeSession(sessionId);
        });
    }
    return entry.disposePromise;
  }

  async listResumeSessions(runtimeId: string) {
    if (runtimeId !== DESKTOP_LOCAL_RUNTIME_ID) return { sessions: [] };
    const agents = await this.detectEnabledAgents();
    const listed = await Promise.allSettled(agents.map((agent) => this.listAgentSessions(agent)));
    const sessions = listed.flatMap((result) => result.status === "fulfilled" ? result.value : []);
    if (sessions.length > 0) {
      const seen = new Set<string>();
      return {
        sessions: sessions
          .filter((session) => {
            if (seen.has(session.id)) return false;
            seen.add(session.id);
            return true;
          })
          .sort((a, b) => b.modifiedAt - a.modifiedAt),
      };
    }
    return { sessions: await this.listLocalSessions() };
  }

  bindSessionSocket(sessionId: string, ws: WebSocket, opts: { replayBacklog?: boolean } = {}): void {
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
    if (this.promptBusy(entry) || entry.queuedPrompts.length > 0) this.sendPromptQueueUpdate(entry);
    if (opts.replayBacklog === false) {
      if (entry.readyMessage) sendJson(ws, entry.readyMessage);
      if (entry.configOptionsMessage) sendJson(ws, entry.configOptionsMessage);
      if (entry.modeMessage) sendJson(ws, entry.modeMessage);
      if (entry.errorMessage) sendJson(ws, entry.errorMessage);
    }
    if (opts.replayBacklog !== false) {
      for (const msg of entry.backlog) sendJson(ws, msg);
    }

    ws.on("message", (raw) => {
      const msg = parseBrowserMessage(raw);
      if (!msg?.type) return;
      switch (msg.type) {
        case "set_prompt_queue_mode":
          if (isPromptQueueMode(msg.queue_mode)) {
            entry.promptQueueMode = msg.queue_mode;
            this.sendPromptQueueUpdate(entry);
          }
          return;
        case "clear_prompt_queue":
          entry.queuedPrompts = [];
          this.sendPromptQueueUpdate(entry);
          return;
        case "steer_queued_prompt":
          if (msg.turn_id) {
            const queued = entry.queuedPrompts.find((prompt) => prompt.turnId === msg.turn_id);
            if (queued) this.sendSteerPrompt(entry, queued.turnId, queued.text);
          }
          return;
        case "update_queued_prompt":
          if (msg.turn_id && typeof msg.text === "string" && msg.text.trim()) {
            const text = msg.text.trim();
            entry.queuedPrompts = entry.queuedPrompts.map((prompt) => (
              prompt.turnId === msg.turn_id ? { ...prompt, text } : prompt
            ));
            this.sendPromptQueueUpdate(entry);
          }
          return;
        case "remove_queued_prompt":
          if (msg.turn_id) {
            entry.queuedPrompts = entry.queuedPrompts.filter((prompt) => prompt.turnId !== msg.turn_id);
            this.sendPromptQueueUpdate(entry);
          }
          return;
        case "reorder_prompt_queue":
          if (Array.isArray(msg.turn_ids)) {
            const order = new Map<string, number>();
            for (const [index, turnId] of msg.turn_ids.entries()) {
              if (typeof turnId === "string" && !order.has(turnId)) order.set(turnId, index);
            }
            entry.queuedPrompts = [...entry.queuedPrompts].sort((a, b) => {
              const aIndex = order.get(a.turnId);
              const bIndex = order.get(b.turnId);
              if (aIndex === undefined && bIndex === undefined) return a.createdAt - b.createdAt;
              if (aIndex === undefined) return 1;
              if (bIndex === undefined) return -1;
              return aIndex - bIndex;
            });
            this.sendPromptQueueUpdate(entry);
          }
          return;
        case "prompt":
          if (msg.turn_id && typeof msg.text === "string") {
            if (isPromptQueueMode(msg.queue_mode)) entry.promptQueueMode = msg.queue_mode;
            try {
              this.dispatchPrompt(entry, msg.turn_id, msg.text);
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              const errorAfterPersist = this.persistTurnError(entry, msg.turn_id ?? null, message) ?? Promise.resolve();
              void errorAfterPersist.finally(() =>
                this.sendToSession(entry, {
                  type: "session.error",
                  session_id: sessionId,
                  turn_id: msg.turn_id,
                  message,
                })
              );
            }
          }
          return;
        case "cancel":
          if (msg.turn_id) {
            this.markPromptCancelled(entry, msg.turn_id);
            entry.manager.cancel(sessionId, msg.turn_id);
          }
          return;
        case "set_config_option":
          if (msg.config_id && (typeof msg.value === "string" || typeof msg.value === "boolean")) {
            void Promise.resolve(entry.manager.setConfigOption?.(sessionId, msg.config_id, msg.value)).catch((error) => {
              sendJson(ws, {
                type: "session.error",
                session_id: sessionId,
                message: error instanceof Error ? error.message : String(error),
              });
            });
          }
          return;
        case "set_session_mode":
          if (typeof msg.mode_id === "string" && msg.mode_id.trim()) {
            void Promise.resolve(entry.manager.setMode?.(sessionId, msg.mode_id.trim())).catch((error) => {
              sendJson(ws, {
                type: "session.error",
                session_id: sessionId,
                message: error instanceof Error ? error.message : String(error),
              });
            });
          }
          return;
        case "dispose":
          void this.disposeSession(sessionId);
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
      adapter.bindSessionSocket(sessionId, ws, {
        replayBacklog: url.searchParams.get("replay") !== "0",
      });
    });
  });
}
