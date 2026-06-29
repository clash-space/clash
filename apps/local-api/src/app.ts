import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { extname, join, normalize, relative } from "node:path";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { defaultRuntimeCapabilities } from "@clash/shared-runtime";
import { listModelCatalogEntries, ProviderOAuthIdSchema, type ProviderOAuthId } from "@clash/shared-types";
import type { Asset, AssetKind, AssetRefRow } from "@clash/shared-types/assets";
import {
  createMockFalQueueService,
  handleFalMockHttpRequest,
  type FalMockQueueService,
} from "./fal-mock.js";
import {
  createLocalAudioConfigStore,
  LocalAudioConfigError,
  type LocalAudioConfigStore,
} from "./audio-config.js";
import {
  createLocalSyncConfigStore,
  LocalSyncConfigError,
  type PublicLocalSyncConfig,
  type LocalSyncConfigStore,
} from "./sync-config.js";
import type { RemoteRoomMessage } from "./room-sync.js";
import type { RemoteLoroPersistenceEnv } from "./sync.js";
import {
  normalizeProviderAccountInput,
  providerAccountKey,
  publicProviderAccounts,
  type LocalProviderAccountConfig,
  type LocalProviderOAuthRecord,
} from "./provider-accounts.js";

export interface ProviderOAuthDeviceFlowStart {
  verificationUri: string;
  userCode: string;
  deviceCode: string;
  expiresAt?: string;
  intervalSeconds?: number;
}

export interface ProviderOAuthTokenResult {
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  expiresAt?: string;
  accountLabel?: string;
}

export interface ProviderOAuthDriver {
  start(): Promise<ProviderOAuthDeviceFlowStart>;
  complete(input: { deviceCode: string }): Promise<ProviderOAuthTokenResult>;
}

export interface LocalApiOptions {
  dataDir: string;
  userId?: string;
  localAcp?: LocalAcpAdapter;
  falMock?: FalMockQueueService;
  audioConfig?: LocalAudioConfigStore;
  syncConfig?: LocalSyncConfigStore;
  syncEnv?: RemoteLoroPersistenceEnv;
  providerOAuth?: Partial<Record<ProviderOAuthId, ProviderOAuthDriver>>;
}

export type LocalAcpRuntimeStatus = "online" | "offline";

export interface LocalAcpHarnessAuth {
  status: "configured" | "needs-auth" | "unknown";
  message: string;
  command?: string;
  methodId?: string;
  methodName?: string;
  methods?: Array<{
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
  }>;
}

export interface LocalAcpRuntimeAgent {
  id: string;
  label?: string;
  binary?: string;
  version?: string;
  config_options?: unknown[];
  auth?: LocalAcpHarnessAuth;
}

export interface LocalAcpRuntime {
  id: string;
  machine_id: string;
  hostname: string;
  os: string;
  agents: LocalAcpRuntimeAgent[];
  version: string;
  status: LocalAcpRuntimeStatus;
  last_heartbeat: number | null;
  created_at: number;
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
}

export interface LocalAcpCustomAgentServer {
  type: "custom";
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export type LocalAcpAgentServersConfig = Record<string, LocalAcpCustomAgentServer>;

export interface LocalAcpResumeSession {
  id: string;
  title: string;
  cwd: string;
  modifiedAt: number;
}

export interface LocalAcpSessionMessage {
  id: string;
  sender_kind: "user" | "agent";
  sender_id: string;
  turn_id: string | null;
  events: unknown[];
  created_at: number;
}

export interface LocalAcpSessionMessageStore {
  appendUserPrompt(sessionId: string, message: LocalAcpSessionMessage): Promise<void> | void;
  appendAgentEvent(sessionId: string, message: LocalAcpSessionMessage): Promise<void> | void;
  markTurnComplete?(sessionId: string, turnId: string): Promise<void> | void;
  appendTurnError?(sessionId: string, turnId: string | null, message: string): Promise<void> | void;
  listSessionMessages(sessionId: string): Promise<{ messages: LocalAcpSessionMessage[] } | null>;
}

export interface LocalAcpCreateSessionParams {
  sessionId?: string;
  runtimeId: string;
  agentTemplateId?: string;
  agentMemberId?: string;
  agentId?: string;
  permissionMode?: string;
  projectId?: string;
  resumeAcpSessionId?: string;
  onReady?: (event: { sessionId: string; acpSessionId?: string }) => Promise<void> | void;
  onError?: (event: { sessionId: string; message: string }) => Promise<void> | void;
}

export interface LocalAcpAttachSessionParams extends LocalAcpCreateSessionParams {
  sessionId: string;
}

export interface LocalAcpAdapter {
  warmup?(): Promise<void> | void;
  listRuntimes(opts?: { probe?: boolean | "auth" | "config" | "none"; refresh?: boolean }): Promise<{ runtimes: LocalAcpRuntime[] }>;
  createSession(params: LocalAcpCreateSessionParams): Promise<{ session_id: string }>;
  attachSession?(params: LocalAcpAttachSessionParams): Promise<{ session_id: string }>;
  listResumeSessions(runtimeId: string): Promise<{ sessions: LocalAcpResumeSession[] }>;
  listHarnesses?(opts?: { probe?: boolean | "auth" | "config" | "none"; refresh?: boolean }): Promise<{ harnesses: LocalAcpHarness[] }>;
  updateHarnesses?(enabledIds: string[]): Promise<{ harnesses: LocalAcpHarness[] }>;
  listAgentServers?(): Promise<{ agent_servers: LocalAcpAgentServersConfig }>;
  updateAgentServers?(servers: LocalAcpAgentServersConfig): Promise<{
    agent_servers: LocalAcpAgentServersConfig;
    harnesses: LocalAcpHarness[];
  }>;
  installHarness?(id: string): Promise<{ harnesses: LocalAcpHarness[] }>;
  installHarnessAdapter?(id: string): Promise<{ harnesses: LocalAcpHarness[] }>;
  upgradeHarness?(id: string): Promise<{ harnesses: LocalAcpHarness[] }>;
  uninstallHarness?(id: string): Promise<{ harnesses: LocalAcpHarness[] }>;
  authenticateHarness?(id: string, options?: { methodId?: string }): Promise<{ harnesses: LocalAcpHarness[] }>;
  listSessionMessages?(sessionId: string): Promise<{ messages: LocalAcpSessionMessage[] } | null>;
  setSessionMessageStore?(store: LocalAcpSessionMessageStore): void;
  pushRoomMention?(
    projectId: string,
    agentMemberId: string,
    mention: Record<string, unknown>,
  ): Promise<boolean>;
  runTextTask?(params: {
    projectId: string;
    prompt: string;
    agentId?: string;
    modelId?: string;
    modelConfigId?: string;
    systemPrompt?: string;
    timeoutMs?: number;
  }): Promise<{ text: string; agentId?: string; sessionId: string }>;
}

function formatLocalAcpSessionError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message === "No local ACP agent found on PATH") {
    return "No local agent found. Install or enable an agent in Settings > Runtimes, then retry.";
  }
  if (message === "No enabled local agent harness found") {
    return "No enabled local agent found. Enable an agent in Settings > Runtimes, or install one from Clash.";
  }
  if (message.startsWith("Local agent harness is not enabled or unavailable:")) {
    const id = message.slice("Local agent harness is not enabled or unavailable:".length).trim();
    return `Local agent ${id} is not enabled or available. Enable it in Settings > Runtimes, install it, or choose another agent.`;
  }
  return message || "Failed to create local session";
}

interface LocalProjectAsset {
  id: string;
  url: string;
  type: "image" | "video";
  storageKey: string;
  createdAt: string | null;
}

interface LocalProject {
  id: string;
  ownerId: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  assets: LocalProjectAsset[];
}

type LocalSessionType = "cloud" | "runtime";
type LocalSessionStatus = "starting" | "active" | "closed" | "error";

interface LocalSession {
  id: string;
  projectId: string;
  title: string;
  type?: LocalSessionType;
  runtimeId?: string;
  agentId?: string;
  agentTemplateId?: string;
  permissionMode?: string;
  acpSessionId?: string;
  status?: LocalSessionStatus;
  createdAt: string;
  updatedAt: string;
}

interface PersistedLocalAcpSessionMessage extends LocalAcpSessionMessage {
  session_id: string;
}

interface LocalAgentMember {
  id: string;
  user_id: string;
  template_id: string;
  runtime_id: string;
  agent_id: string | null;
  display_name: string;
  created_at: number;
}

interface LocalRoomMention {
  user_id: string;
  agent_member_id?: string;
}

interface LocalRoomMessage {
  id: string;
  project_id: string;
  sender_kind: "user" | "agent";
  sender_id: string;
  sender_user_id: string;
  mentions: LocalRoomMention[];
  text: string;
  at: number;
}

interface LocalUserVariable {
  id: string;
  userId: string;
  key: string;
  value: string;
  createdAt: string;
  updatedAt: string;
}

type RemoteRoomStatus = "disabled" | "imported" | "mirrored" | "failed";

interface RoomSyncMeta {
  mode: "local-only" | "cloud-sync";
  remote_room: {
    enabled: boolean;
    status: RemoteRoomStatus;
    error?: string;
  };
}

interface LocalDb {
  projects: LocalProject[];
  assets: Array<Asset & { projectId?: string }>;
  assetRefs: AssetRefRow[];
  sessions: LocalSession[];
  agentMembers: LocalAgentMember[];
  roomMessages: LocalRoomMessage[];
  sessionMessages: PersistedLocalAcpSessionMessage[];
  variables: LocalUserVariable[];
  providerAccounts: LocalProviderAccountConfig[];
  providerOAuth: LocalProviderOAuthRecord[];
}

const DEFAULT_DB: LocalDb = {
  projects: [],
  assets: [],
  assetRefs: [],
  sessions: [],
  agentMembers: [],
  roomMessages: [],
  sessionMessages: [],
  variables: [],
  providerAccounts: [],
  providerOAuth: [],
};

const LOCAL_RUNTIME_ID = "desktop-local";
const DEFAULT_RUNTIME_SESSION_CONTEXT_ID = "master-clash";
const DEFAULT_RUNTIME_SESSION_TITLE = "New session";

const BUILTIN_AGENT_TEMPLATES: Array<{ id: string; label: string }> = [
  { id: "master-clash", label: "Master Clash" },
];

function truncateProjectName(prompt: string): string {
  return prompt.length > 20 ? `${prompt.slice(0, 20)}...` : prompt;
}

function agentTemplateTitle(agentTemplateId: string): string {
  return BUILTIN_AGENT_TEMPLATES.find((template) => template.id === agentTemplateId)?.label ?? agentTemplateId;
}

function initialRuntimeSessionTitle(agentTemplateId?: string): string {
  return agentTemplateId ? agentTemplateTitle(agentTemplateId) : DEFAULT_RUNTIME_SESSION_TITLE;
}

function publicLocalSession(session: LocalSession) {
  return {
    id: session.id,
    threadId: session.id,
    projectId: session.projectId,
    title: session.title,
    type: session.type ?? "cloud",
    ...(session.runtimeId ? { runtimeId: session.runtimeId } : {}),
    ...(session.agentId ? { agentId: session.agentId } : {}),
    ...(session.agentTemplateId ? { agentTemplateId: session.agentTemplateId } : {}),
    ...(session.permissionMode ? { permissionMode: session.permissionMode } : {}),
    ...(session.acpSessionId ? { acpSessionId: session.acpSessionId } : {}),
    ...(session.status ? { status: session.status } : {}),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

async function updateRuntimeSession(
  db: ReturnType<typeof createDb>,
  sessionId: string,
  patch: Partial<Pick<LocalSession, "acpSessionId" | "status" | "title">>,
) {
  await db.update((state) => {
    const session = state.sessions.find((candidate) => candidate.id === sessionId);
    if (!session) return;
    Object.assign(session, patch, { updatedAt: nowIso() });
  });
}

async function precreateRuntimeSession(
  db: ReturnType<typeof createDb>,
  session: LocalSession,
): Promise<void> {
  await db.update((state) => {
    state.sessions = [
      session,
      ...state.sessions.filter((candidate) => candidate.id !== session.id),
    ];
  });
}

async function finalizeRuntimeSessionId(
  db: ReturnType<typeof createDb>,
  temporarySessionId: string,
  finalSessionId: string,
  patch?: Partial<Pick<LocalSession, "acpSessionId" | "status" | "title">>,
): Promise<void> {
  await db.update((state) => {
    const session = state.sessions.find((candidate) => candidate.id === temporarySessionId);
    if (!session) return;
    session.id = finalSessionId;
    Object.assign(session, patch ?? {}, { updatedAt: nowIso() });
    state.sessionMessages = state.sessionMessages.map((message) =>
      message.session_id === temporarySessionId ? { ...message, session_id: finalSessionId } : message
    );
  });
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function contentTypeForPath(path: string): string {
  const ext = extname(path).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".txt") return "text/plain";
  return "application/octet-stream";
}

function nowIso(): string {
  return new Date().toISOString();
}

function isoToEpochSeconds(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
}

function epochSecondsToIso(value: number | null | undefined): string | null {
  if (!value) return null;
  return new Date(value * 1000).toISOString();
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return structuredClone(fallback);
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  const tmpPath = `${path}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  await writeFile(tmpPath, JSON.stringify(value, null, 2), "utf8");
  await rename(tmpPath, path);
}

function createDb(dataDir: string) {
  const dbPath = join(dataDir, "db.json");
  let writeQueue: Promise<unknown> = Promise.resolve();

  async function load(): Promise<LocalDb> {
    await writeQueue.catch(() => undefined);
    const db = await readJson<LocalDb>(dbPath, DEFAULT_DB);
    return {
      projects: db.projects ?? [],
      assets: db.assets ?? [],
      assetRefs: db.assetRefs ?? [],
      sessions: db.sessions ?? [],
      agentMembers: db.agentMembers ?? [],
      roomMessages: db.roomMessages ?? [],
      sessionMessages: db.sessionMessages ?? [],
      variables: db.variables ?? [],
      providerAccounts: db.providerAccounts ?? [],
      providerOAuth: db.providerOAuth ?? [],
    };
  }

  async function save(db: LocalDb): Promise<void> {
    const task = writeQueue.catch(() => undefined).then(() => writeJson(dbPath, db));
    writeQueue = task.then(() => undefined, () => undefined);
    await task;
  }

  async function update<T>(mutate: (db: LocalDb) => T | Promise<T>): Promise<T> {
    const task = writeQueue.catch(() => undefined).then(async () => {
      const db = await readJson<LocalDb>(dbPath, DEFAULT_DB);
      const normalized: LocalDb = {
        projects: db.projects ?? [],
        assets: db.assets ?? [],
        assetRefs: db.assetRefs ?? [],
        sessions: db.sessions ?? [],
        agentMembers: db.agentMembers ?? [],
        roomMessages: db.roomMessages ?? [],
        sessionMessages: db.sessionMessages ?? [],
        variables: db.variables ?? [],
        providerAccounts: db.providerAccounts ?? [],
        providerOAuth: db.providerOAuth ?? [],
      };
      const result = await mutate(normalized);
      await writeJson(dbPath, normalized);
      return result;
    });
    writeQueue = task.then(() => undefined, () => undefined);
    return task;
  }

  return { load, save, update };
}

function eventKey(event: unknown): string {
  try {
    return JSON.stringify(event);
  } catch {
    return String(event);
  }
}

function appendPersistedSessionMessage(
  state: LocalDb,
  sessionId: string,
  incoming: LocalAcpSessionMessage,
): void {
  const existing = state.sessionMessages.find(
    (message) => message.session_id === sessionId && message.id === incoming.id,
  );
  if (!existing) {
    state.sessionMessages.push({
      session_id: sessionId,
      ...structuredClone(incoming),
    });
    return;
  }

  const seen = new Set(existing.events.map(eventKey));
  for (const event of incoming.events) {
    const key = eventKey(event);
    if (seen.has(key)) continue;
    existing.events.push(structuredClone(event));
    seen.add(key);
  }
}

function extractUserPromptTitle(message: LocalAcpSessionMessage): string | null {
  if (message.sender_kind !== "user") return null;
  for (const event of message.events) {
    if (
      event &&
      typeof event === "object" &&
      (event as { type?: unknown }).type === "text" &&
      typeof (event as { text?: unknown }).text === "string"
    ) {
      const text = (event as { text: string }).text.trim();
      return text ? truncateProjectName(text) : null;
    }
  }
  return null;
}

function extractSessionInfoTitle(message: LocalAcpSessionMessage): string | null {
  for (const event of message.events) {
    if (!event || typeof event !== "object") continue;
    const typed = event as {
      type?: unknown;
      sessionUpdate?: unknown;
      title?: unknown;
      sessionInfo?: { title?: unknown };
    };
    if (typed.type !== "session_info_update" && typed.sessionUpdate !== "session_info_update") continue;
    const title = typeof typed.title === "string"
      ? typed.title
      : typeof typed.sessionInfo?.title === "string"
        ? typed.sessionInfo.title
        : "";
    const trimmed = title.trim();
    if (trimmed) return truncateProjectName(trimmed);
  }
  return null;
}

function patchSessionAfterMessage(
  state: LocalDb,
  sessionId: string,
  message: LocalAcpSessionMessage,
): void {
  const session = state.sessions.find((candidate) => candidate.id === sessionId);
  if (!session) return;
  const sessionInfoTitle = extractSessionInfoTitle(message);
  const promptTitle = extractUserPromptTitle(message);
  if (sessionInfoTitle) {
    session.title = sessionInfoTitle;
  } else if (
    promptTitle &&
    (
      !session.title ||
      session.title === DEFAULT_RUNTIME_SESSION_TITLE ||
      (!!session.agentTemplateId && session.title === agentTemplateTitle(session.agentTemplateId))
    )
  ) {
    session.title = promptTitle;
  }
  session.updatedAt = nowIso();
}

async function listPersistedLocalSessionMessages(
  db: ReturnType<typeof createDb>,
  sessionId: string,
): Promise<{ messages: LocalAcpSessionMessage[] } | null> {
  const state = await db.load();
  const rows = state.sessionMessages
    .filter((message) => message.session_id === sessionId)
    .sort((a, b) => a.created_at - b.created_at);
  if (rows.length === 0 && !state.sessions.some((session) => session.id === sessionId)) return null;
  return {
    messages: rows.map(({ session_id: _sessionId, ...message }) => ({
      ...message,
      events: structuredClone(message.events),
    })),
  };
}

function createLocalSessionMessageStore(
  db: ReturnType<typeof createDb>,
): LocalAcpSessionMessageStore {
  async function append(sessionId: string, message: LocalAcpSessionMessage): Promise<void> {
    await db.update((state) => {
      appendPersistedSessionMessage(state, sessionId, message);
      patchSessionAfterMessage(state, sessionId, message);
    });
  }

  async function touch(sessionId: string, patch?: Partial<Pick<LocalSession, "status">>): Promise<void> {
    await db.update((state) => {
      const session = state.sessions.find((candidate) => candidate.id === sessionId);
      if (session) Object.assign(session, patch ?? {}, { updatedAt: nowIso() });
    });
  }

  return {
    appendUserPrompt: append,
    appendAgentEvent: append,
    async markTurnComplete(sessionId) {
      await touch(sessionId);
    },
    async appendTurnError(sessionId, turnId, message) {
      await db.update((state) => {
        const at = Math.floor(Date.now() / 1000);
        appendPersistedSessionMessage(state, sessionId, {
          id: `${turnId ?? `error-${at}`}-agent`,
          sender_kind: "agent",
          sender_id: "local-agent",
          turn_id: turnId,
          events: [{ type: "promptError", error: message }],
          created_at: at,
        });
        const session = state.sessions.find((candidate) => candidate.id === sessionId);
        if (session) Object.assign(session, { status: "error" as const, updatedAt: nowIso() });
      });
    },
    listSessionMessages(sessionId) {
      return listPersistedLocalSessionMessages(db, sessionId);
    },
  };
}

function assetRoot(dataDir: string): string {
  return join(dataDir, "assets");
}

function assetPath(dataDir: string, storageKey: string): string {
  const root = assetRoot(dataDir);
  const resolved = normalize(join(root, storageKey));
  const rel = relative(root, resolved);
  if (rel.startsWith("..") || rel === "..") {
    throw new Error("Invalid asset path");
  }
  return resolved;
}

function json(data: unknown, status = 200): Response {
  const body = JSON.stringify(data).replace(/[\u007f-\uffff]/g, (char) => (
    `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`
  ));
  return new Response(body, {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function toProjectAsset(
  asset: Asset,
  importedAt?: number,
): LocalProjectAsset | null {
  if (asset.kind !== "image" && asset.kind !== "video") return null;
  if (asset.kind === "video" && !asset.coverR2Key) return null;

  const previewKey = asset.kind === "video" ? asset.coverR2Key! : asset.srcR2Key;
  return {
    id: asset.id,
    url: `/assets/${previewKey}`,
    type: asset.kind,
    storageKey: asset.srcR2Key,
    createdAt: epochSecondsToIso(asset.createdAt || importedAt),
  };
}

function requestOrigin(c: { req: { url: string } }): string {
  return new URL(c.req.url).origin;
}

function localAssetUrl(c: { req: { url: string } }, storageKey: string): string {
  return `${requestOrigin(c)}/assets/${storageKey}`;
}

function signedUrlExp(): number {
  return Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
}

function withSignedAssetUrls<T extends Asset>(
  c: { req: { url: string } },
  asset: T,
): T {
  const exp = signedUrlExp();
  return {
    ...asset,
    signedUrl: localAssetUrl(c, asset.srcR2Key),
    signedUrlExp: exp,
    ...(asset.coverR2Key
      ? {
          signedCoverUrl: localAssetUrl(c, asset.coverR2Key),
          signedCoverUrlExp: exp,
        }
      : {}),
  };
}

function withProjectAssets(project: LocalProject, state: LocalDb): LocalProject {
  const assetsById = new Map(state.assets.map((asset) => [asset.id, asset]));
  const refs = [
    ...state.assetRefs.filter((ref) => ref.projectId === project.id),
    ...state.assets
      .filter((asset) => asset.projectId === project.id)
      .map((asset) => ({
        assetId: asset.id,
        projectId: project.id,
        importedAt: asset.createdAt,
      })),
  ]
    .sort((a, b) => b.importedAt - a.importedAt)
    .slice(0, 12);

  const seenAssetIds = new Set<string>();
  const seenPreviewKeys = new Set<string>();
  const previewAssets: LocalProjectAsset[] = [];

  for (const ref of refs) {
    if (previewAssets.length >= 4 || seenAssetIds.has(ref.assetId)) continue;
    const asset = assetsById.get(ref.assetId);
    if (!asset) continue;
    const preview = toProjectAsset(asset, ref.importedAt);
    if (!preview || seenPreviewKeys.has(preview.url)) continue;
    seenAssetIds.add(ref.assetId);
    seenPreviewKeys.add(preview.url);
    previewAssets.push(preview);
  }

  return { ...project, assets: previewAssets };
}

function toV1Project(project: LocalProject) {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    created_at: isoToEpochSeconds(project.createdAt),
    updated_at: isoToEpochSeconds(project.updatedAt),
  };
}

function roomSyncMeta(
  config: PublicLocalSyncConfig,
  status: RemoteRoomStatus,
  error?: unknown,
): RoomSyncMeta {
  return {
    mode: config.mode,
    remote_room: {
      enabled: config.remote_loro.enabled,
      status: config.remote_loro.enabled ? status : "disabled",
      ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}),
    },
  };
}

function normalizeVariableKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const key = value.trim().toUpperCase();
  if (!/^[A-Z0-9_]+$/.test(key)) return null;
  return key;
}

function publicVariable(variable: LocalUserVariable) {
  return {
    id: variable.id,
    key: variable.key,
    createdAt: variable.createdAt,
    updatedAt: variable.updatedAt,
  };
}

function publicV1Variable(variable: LocalUserVariable) {
  return {
    key: variable.key,
    createdAt: isoToEpochSeconds(variable.createdAt) || null,
  };
}

function parseProviderOAuthId(value: unknown): ProviderOAuthId | null {
  const parsed = ProviderOAuthIdSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function publicProviderOAuth(record: LocalProviderOAuthRecord) {
  return {
    providerId: record.providerId,
    status: record.status,
    ...(record.verificationUri ? { verificationUri: record.verificationUri } : {}),
    ...(record.userCode ? { userCode: record.userCode } : {}),
    ...(record.deviceCode ? { deviceCode: record.deviceCode } : {}),
    ...(record.expiresAt ? { expiresAt: record.expiresAt } : {}),
    ...(record.intervalSeconds !== undefined ? { intervalSeconds: record.intervalSeconds } : {}),
    ...(record.accountLabel ? { accountLabel: record.accountLabel } : {}),
    ...(record.error ? { error: record.error } : {}),
    hasAccessToken: typeof record.accessToken === "string" && record.accessToken.trim().length > 0,
  };
}

function upsertProviderOAuth(
  state: LocalDb,
  userId: string,
  providerId: ProviderOAuthId,
  patch: Partial<LocalProviderOAuthRecord>,
): LocalProviderOAuthRecord {
  const now = nowIso();
  const existing = state.providerOAuth.find((record) => record.userId === userId && record.providerId === providerId);
  if (existing) {
    Object.assign(existing, patch, { updatedAt: now });
    return existing;
  }
  const record: LocalProviderOAuthRecord = {
    userId,
    providerId,
    status: patch.status ?? "pending",
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
  state.providerOAuth.unshift(record);
  return record;
}

function upsertVariable(
  state: LocalDb,
  userId: string,
  key: string,
  value: string,
): LocalUserVariable {
  const now = nowIso();
  const existing = state.variables.find((variable) => variable.userId === userId && variable.key === key);
  if (existing) {
    existing.value = value;
    existing.updatedAt = now;
    return existing;
  }
  const variable: LocalUserVariable = {
    id: crypto.randomUUID(),
    userId,
    key,
    value,
    createdAt: now,
    updatedAt: now,
  };
  state.variables.unshift(variable);
  return variable;
}

function normalizeLocalRoomMention(mention: RemoteRoomMessage["mentions"][number]): LocalRoomMention {
  return {
    user_id: mention.user_id,
    ...(mention.agent_member_id ? { agent_member_id: mention.agent_member_id } : {}),
  };
}

function toLocalRoomMessage(message: RemoteRoomMessage): LocalRoomMessage {
  return {
    id: message.id,
    project_id: message.project_id,
    sender_kind: message.sender_kind,
    sender_id: message.sender_id,
    sender_user_id: message.sender_user_id,
    mentions: message.mentions.map(normalizeLocalRoomMention),
    text: message.text,
    at: message.at,
  };
}

function upsertRoomMessages(state: LocalDb, incoming: LocalRoomMessage[]): void {
  if (incoming.length === 0) return;
  const byId = new Map(state.roomMessages.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  state.roomMessages = [...byId.values()];
}

function seedLocalAgentMembers(state: LocalDb, userId: string): LocalAgentMember[] {
  if (state.agentMembers.length > 0) return state.agentMembers;
  const createdAt = Math.floor(Date.now() / 1000);
  state.agentMembers = BUILTIN_AGENT_TEMPLATES.map((template) => ({
    id: `local-${template.id}`,
    user_id: userId,
    template_id: template.id,
    runtime_id: LOCAL_RUNTIME_ID,
    agent_id: null,
    display_name: template.label,
    created_at: createdAt,
  }));
  return state.agentMembers;
}

async function localRuntimeSummary(options: LocalApiOptions): Promise<{
  label: string;
  status: LocalAcpRuntimeStatus;
  agents: LocalAcpRuntimeAgent[];
}> {
  if (!options.localAcp) {
    return { label: "Local Desktop", status: "online", agents: [] };
  }
  try {
    const { runtimes } = await options.localAcp.listRuntimes();
    const runtime = runtimes.find((row) => row.id === LOCAL_RUNTIME_ID) ?? runtimes[0];
    return {
      label: runtime?.hostname ?? "Local Desktop",
      status: runtime?.status ?? "offline",
      agents: runtime?.agents ?? [],
    };
  } catch {
    return { label: "Local Desktop", status: "offline", agents: [] };
  }
}

export function createLocalApiApp(options: LocalApiOptions): Hono {
  const userId = options.userId ?? "local-user";
  const db = createDb(options.dataDir);
  const sessionMessageStore = createLocalSessionMessageStore(db);
  options.localAcp?.setSessionMessageStore?.(sessionMessageStore);
  const falMock = options.falMock ?? createMockFalQueueService();
  const syncConfig = options.syncConfig ?? createLocalSyncConfigStore({
    dataDir: options.dataDir,
    env: options.syncEnv ?? process.env,
  });
  const audioConfig = options.audioConfig ?? createLocalAudioConfigStore({
    dataDir: options.dataDir,
  });
  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: (origin) => origin || "http://127.0.0.1",
      credentials: true,
      allowHeaders: ["content-type", "authorization"],
      allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    }),
  );

  app.get("/health", (c) =>
    c.json({
      ok: true,
      mode: "local",
      runtime: {
        mode: "local",
        capabilities: defaultRuntimeCapabilities("local"),
      },
    }),
  );

  app.get("/api/better-auth/get-session", (c) =>
    c.json({
      user: { id: userId, name: "Local User", email: "local@clash.local" },
    }),
  );
  app.get("/api/v1/me", (c) => c.json({ id: userId }));

  app.get("/api/settings/actions", (c) => c.json([]));
  app.get("/api/settings/skills", (c) => c.json([]));
  app.get("/api/settings/tokens", (c) => c.json([]));
  app.get("/api/settings/variables", async (c) => {
    const state = await db.load();
    return c.json(
      state.variables
        .filter((variable) => variable.userId === userId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map(publicVariable),
    );
  });
  app.post("/api/settings/variables", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { key?: unknown; value?: unknown };
    const key = normalizeVariableKey(body.key);
    if (!key || typeof body.value !== "string") {
      return c.json({ error: "Missing key/value" }, 400);
    }
    const state = await db.load();
    const variable = upsertVariable(state, userId, key, body.value);
    await db.save(state);
    return c.json(publicVariable(variable));
  });
  app.delete("/api/settings/variables/:id", async (c) => {
    const state = await db.load();
    const id = c.req.param("id");
    const before = state.variables.length;
    state.variables = state.variables.filter((variable) => !(variable.userId === userId && variable.id === id));
    if (state.variables.length === before) return c.json({ error: "Not found" }, 404);
    await db.save(state);
    return new Response(null, { status: 204 });
  });
  app.get("/api/v1/vars", async (c) => {
    const state = await db.load();
    return c.json({
      variables: state.variables
        .filter((variable) => variable.userId === userId)
        .sort((a, b) => a.key.localeCompare(b.key))
        .map(publicV1Variable),
    });
  });
  app.put("/api/v1/vars/:key", async (c) => {
    const key = normalizeVariableKey(c.req.param("key"));
    const body = (await c.req.json().catch(() => ({}))) as { value?: unknown };
    if (!key || typeof body.value !== "string" || !body.value) {
      return c.json({ error: "Missing value" }, 400);
    }
    const state = await db.load();
    upsertVariable(state, userId, key, body.value);
    await db.save(state);
    return c.json({ ok: true, key });
  });
  app.delete("/api/v1/vars/:key", async (c) => {
    const key = normalizeVariableKey(c.req.param("key"));
    if (!key) return c.json({ error: "Variable not found" }, 404);
    const state = await db.load();
    const before = state.variables.length;
    state.variables = state.variables.filter((variable) => !(variable.userId === userId && variable.key === key));
    if (state.variables.length === before) return c.json({ error: "Variable not found" }, 404);
    await db.save(state);
    return c.json({ ok: true, key });
  });
  app.get("/api/v1/model-providers", async (c) => {
    const state = await db.load();
    return c.json({
      providers: publicProviderAccounts(state.providerAccounts, userId, state.providerOAuth),
    });
  });
  app.patch("/api/v1/model-providers", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { providers?: unknown };
    const incoming = Array.isArray(body.providers)
      ? body.providers.map(normalizeProviderAccountInput)
      : [];
    if (incoming.length === 0 || incoming.some((provider) => !provider)) {
      return c.json({ error: "Invalid providers" }, 400);
    }
    const state = await db.load();
    const now = nowIso();
    const existing = new Map(
      state.providerAccounts
        .filter((account) => account.userId === userId)
        .map((account) => [providerAccountKey(account), account]),
    );
    for (const provider of incoming) {
      if (!provider) continue;
      const key = providerAccountKey(provider);
      const previous = existing.get(key);
      existing.set(key, {
        ...previous,
        ...provider,
        credentials: provider.credentials
          ? { ...(previous?.credentials ?? {}), ...provider.credentials }
          : previous?.credentials,
        userId,
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
      });
    }
    state.providerAccounts = [
      ...state.providerAccounts.filter((account) => account.userId !== userId),
      ...existing.values(),
    ];
    await db.save(state);
    return c.json({
      providers: publicProviderAccounts(state.providerAccounts, userId, state.providerOAuth),
    });
  });
  app.get("/api/v1/provider-oauth", async (c) => {
    const state = await db.load();
    return c.json({
      providers: state.providerOAuth
        .filter((record) => record.userId === userId)
        .sort((a, b) => a.providerId.localeCompare(b.providerId))
        .map(publicProviderOAuth),
    });
  });
  app.post("/api/v1/provider-oauth/:providerId/start", async (c) => {
    const providerId = parseProviderOAuthId(c.req.param("providerId"));
    if (!providerId) return c.json({ error: "Unsupported OAuth provider" }, 404);
    const driver = options.providerOAuth?.[providerId];
    if (!driver) return c.json({ error: "OAuth provider is not configured" }, 501);
    const started = await driver.start();
    const state = await db.load();
    const record = upsertProviderOAuth(state, userId, providerId, {
      status: "pending",
      verificationUri: started.verificationUri,
      userCode: started.userCode,
      deviceCode: started.deviceCode,
      expiresAt: started.expiresAt,
      intervalSeconds: started.intervalSeconds,
      accessToken: undefined,
      refreshToken: undefined,
      tokenType: undefined,
      accountLabel: undefined,
      error: undefined,
    });
    await db.save(state);
    return c.json(publicProviderOAuth(record));
  });
  app.post("/api/v1/provider-oauth/:providerId/complete", async (c) => {
    const providerId = parseProviderOAuthId(c.req.param("providerId"));
    if (!providerId) return c.json({ error: "Unsupported OAuth provider" }, 404);
    const driver = options.providerOAuth?.[providerId];
    if (!driver) return c.json({ error: "OAuth provider is not configured" }, 501);
    const body = (await c.req.json().catch(() => ({}))) as { deviceCode?: unknown };
    const state = await db.load();
    const existing = state.providerOAuth.find((record) => record.userId === userId && record.providerId === providerId);
    const deviceCode = typeof body.deviceCode === "string" && body.deviceCode.trim()
      ? body.deviceCode.trim()
      : existing?.deviceCode;
    if (!deviceCode) return c.json({ error: "deviceCode is required" }, 400);
    const completed = await driver.complete({ deviceCode });
    const record = upsertProviderOAuth(state, userId, providerId, {
      status: "authorized",
      accessToken: completed.accessToken,
      refreshToken: completed.refreshToken,
      tokenType: completed.tokenType,
      expiresAt: completed.expiresAt,
      accountLabel: completed.accountLabel,
      verificationUri: undefined,
      userCode: undefined,
      deviceCode: undefined,
      intervalSeconds: undefined,
      error: undefined,
    });
    await db.save(state);
    return c.json(publicProviderOAuth(record));
  });
  app.delete("/api/v1/provider-oauth/:providerId", async (c) => {
    const providerId = parseProviderOAuthId(c.req.param("providerId"));
    if (!providerId) return c.json({ error: "Unsupported OAuth provider" }, 404);
    const state = await db.load();
    state.providerOAuth = state.providerOAuth.filter((record) => !(record.userId === userId && record.providerId === providerId));
    await db.save(state);
    return new Response(null, { status: 204 });
  });
  app.get("/api/v1/models/catalog", async (c) => {
    const state = await db.load();
    return c.json({
      models: listModelCatalogEntries({
        configuredProviders: publicProviderAccounts(state.providerAccounts, userId, state.providerOAuth),
      }),
    });
  });
  app.get("/api/marketplace/registry", (c) => c.json({ version: 1, actions: [], skills: [] }));
  app.get("/api/v1/local/sync", async (c) => c.json(await syncConfig.getPublicConfig()));
  app.patch("/api/v1/local/sync", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    try {
      return c.json(await syncConfig.updateFromRequest(body));
    } catch (error) {
      if (error instanceof LocalSyncConfigError) {
        return c.json({ error: error.message }, error.status as 400);
      }
      throw error;
    }
  });
  app.get("/api/v1/local/audio", async (c) => c.json(await audioConfig.getPublicConfig()));
  app.patch("/api/v1/local/audio", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    try {
      return c.json(await audioConfig.updateFromRequest(body));
    } catch (error) {
      if (error instanceof LocalAudioConfigError) {
        return c.json({ error: error.message }, error.status as 400);
      }
      throw error;
    }
  });
  app.post("/api/v1/local/audio/install", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    try {
      return c.json(await audioConfig.installBuiltin({ model: body.asr_model }));
    } catch (error) {
      if (error instanceof LocalAudioConfigError) {
        return c.json({ error: error.message }, error.status as 400);
      }
      throw error;
    }
  });
  app.post("/api/v1/local/audio/transcriptions", async (c) => {
    const form = await c.req.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") return c.json({ error: "Missing file" }, 400);
    const language = form.get("language");
    try {
      return c.json(await audioConfig.transcribe({
        file,
        language: typeof language === "string" ? language : null,
      }));
    } catch (error) {
      if (error instanceof LocalAudioConfigError) {
        return c.json({ error: error.message }, error.status as 400);
      }
      throw error;
    }
  });
  app.get("/api/v1/agents", async (c) => {
    const state = await db.load();
    const hadAgents = state.agentMembers.length > 0;
    const agentMembers = seedLocalAgentMembers(state, userId);
    if (!hadAgents) await db.save(state);

    const runtime = await localRuntimeSummary(options);
    return c.json({
      agents: agentMembers.map((member) => ({
        id: member.id,
        user_id: member.user_id,
        template_id: member.template_id,
        runtime_id: member.runtime_id,
        agent_id: member.agent_id,
        display_name: member.display_name,
        created_at: member.created_at,
        runtime_label: runtime.label,
        runtime_status: runtime.status,
        runtime_agents: runtime.agents,
        budget_credits: null,
        budget_period: "unlimited",
        budget_used: 0,
        budget_reset_at: null,
      })),
    });
  });
  app.all("/fal/*", (c) => handleFalMockHttpRequest(falMock, c.req.raw));
  app.get("/api/v1/runtimes", async (c) => {
    if (!options.localAcp) return json({ runtimes: [] });
    const rawProbe = c.req.query("probe");
    const probe = rawProbe === "1" || rawProbe === "true"
      ? true
      : rawProbe === "auth" || rawProbe === "config" || rawProbe === "none"
        ? rawProbe
        : false;
    const refresh = c.req.query("refresh") === "1" || c.req.query("refresh") === "true";
    return json(await options.localAcp.listRuntimes({ probe, refresh }));
  });

  app.get("/api/v1/local/harnesses", async (c) => {
    if (!options.localAcp?.listHarnesses) return c.json({ harnesses: [] });
    const rawProbe = c.req.query("probe");
    const probe = rawProbe === "1" || rawProbe === "true"
      ? "auth"
      : rawProbe === "auth" || rawProbe === "config" || rawProbe === "none"
        ? rawProbe
        : false;
    const refresh = c.req.query("refresh") === "1" || c.req.query("refresh") === "true";
    return c.json(await options.localAcp.listHarnesses({ probe, refresh }));
  });

  app.put("/api/v1/local/harnesses", async (c) => {
    if (!options.localAcp?.updateHarnesses) return c.json({ error: "Local harness settings unavailable" }, 404);
    const body = (await c.req.json().catch(() => ({}))) as {
      enabled_harness_ids?: unknown;
      enabledHarnessIds?: unknown;
    };
    const rawIds = Array.isArray(body.enabled_harness_ids)
      ? body.enabled_harness_ids
      : Array.isArray(body.enabledHarnessIds)
        ? body.enabledHarnessIds
        : [];
    const enabledIds = rawIds.filter((id): id is string => typeof id === "string");
    try {
      return c.json(await options.localAcp.updateHarnesses(enabledIds));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.get("/api/v1/local/agent-servers", async (c) => {
    if (!options.localAcp?.listAgentServers) return c.json({ agent_servers: {} });
    return c.json(await options.localAcp.listAgentServers());
  });

  app.put("/api/v1/local/agent-servers", async (c) => {
    if (!options.localAcp?.updateAgentServers) return c.json({ error: "Custom agent server settings unavailable" }, 404);
    const body = (await c.req.json().catch(() => ({}))) as {
      agent_servers?: unknown;
      agentServers?: unknown;
    };
    const rawServers = body.agent_servers ?? body.agentServers ?? {};
    try {
      return c.json(await options.localAcp.updateAgentServers(rawServers as LocalAcpAgentServersConfig));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.post("/api/v1/local/harnesses/:harnessId/install", async (c) => {
    if (!options.localAcp?.installHarness && !options.localAcp?.installHarnessAdapter) {
      return c.json({ error: "Local agent install unavailable" }, 404);
    }
    try {
      return c.json(options.localAcp.installHarness
        ? await options.localAcp.installHarness(c.req.param("harnessId"))
        : await options.localAcp.installHarnessAdapter!(c.req.param("harnessId")));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.post("/api/v1/local/harnesses/:harnessId/install-adapter", async (c) => {
    if (!options.localAcp?.installHarness && !options.localAcp?.installHarnessAdapter) {
      return c.json({ error: "Local agent install unavailable" }, 404);
    }
    try {
      return c.json(options.localAcp.installHarness
        ? await options.localAcp.installHarness(c.req.param("harnessId"))
        : await options.localAcp.installHarnessAdapter!(c.req.param("harnessId")));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.post("/api/v1/local/harnesses/:harnessId/upgrade", async (c) => {
    if (!options.localAcp?.upgradeHarness) return c.json({ error: "Local agent upgrade unavailable" }, 404);
    try {
      return c.json(await options.localAcp.upgradeHarness(c.req.param("harnessId")));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.delete("/api/v1/local/harnesses/:harnessId/install", async (c) => {
    if (!options.localAcp?.uninstallHarness) return c.json({ error: "Local agent uninstall unavailable" }, 404);
    try {
      return c.json(await options.localAcp.uninstallHarness(c.req.param("harnessId")));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.post("/api/v1/local/harnesses/:harnessId/authenticate", async (c) => {
    if (!options.localAcp?.authenticateHarness) return c.json({ error: "Local harness auth unavailable" }, 404);
    try {
      const body = (await c.req.json().catch(() => ({}))) as { method_id?: unknown; methodId?: unknown };
      const methodId = typeof body.method_id === "string" && body.method_id.length > 0
        ? body.method_id
        : typeof body.methodId === "string" && body.methodId.length > 0
          ? body.methodId
          : undefined;
      return c.json(await options.localAcp.authenticateHarness(
        c.req.param("harnessId"),
        methodId ? { methodId } : undefined,
      ));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  app.post("/api/v1/runtimes/:runtimeId/sessions", async (c) => {
    if (!options.localAcp) return c.json({ error: "Local agent runtime unavailable" }, 404);
    const body = (await c.req.json().catch(() => ({}))) as {
      agent_template_id?: string;
      agent_member_id?: string;
      agent_id?: string;
      permission_mode?: string;
      project_id?: string;
      resume_session_id?: string;
    };
    let agentTemplateId = body.agent_template_id?.trim() || undefined;
    let agentMemberId = body.agent_member_id?.trim() || undefined;
    const requestedAgentId = body.agent_id?.trim() || undefined;
    const permissionMode = body.permission_mode?.trim() || undefined;
    let agentId: string | undefined = requestedAgentId;
    if (agentMemberId) {
      const state = await db.load();
      const agentMembers = seedLocalAgentMembers(state, userId);
      const member = agentMembers.find((row) => row.id === agentMemberId);
      if (!member) return c.json({ error: "agent member not found" }, 404);
      if (member.runtime_id !== c.req.param("runtimeId")) {
        return c.json({ error: "agent member belongs to a different runtime" }, 400);
      }
      agentTemplateId = member.template_id;
      agentId = requestedAgentId ?? member.agent_id ?? undefined;
    }
    if (!agentTemplateId && !agentId) return c.json({ error: "Missing agent_id" }, 400);
    const sessionContextId = agentTemplateId ?? DEFAULT_RUNTIME_SESSION_CONTEXT_ID;

    const localSessionId = body.project_id ? crypto.randomUUID() : undefined;
    if (body.project_id && localSessionId) {
      const at = nowIso();
      await precreateRuntimeSession(db, {
        id: localSessionId,
        projectId: body.project_id,
        title: initialRuntimeSessionTitle(agentTemplateId),
        type: "runtime",
        runtimeId: c.req.param("runtimeId"),
        ...(agentId ? { agentId } : {}),
        ...(agentTemplateId ? { agentTemplateId } : {}),
        ...(permissionMode ? { permissionMode } : {}),
        status: "starting",
        createdAt: at,
        updatedAt: at,
      });
    }

    try {
      const pendingSessionPatches = new Map<string, Partial<Pick<LocalSession, "acpSessionId" | "status" | "title">>>();
      const rememberRuntimeSessionPatch = async (
        sessionId: string,
        patch: Partial<Pick<LocalSession, "acpSessionId" | "status" | "title">>,
      ) => {
        pendingSessionPatches.set(sessionId, {
          ...pendingSessionPatches.get(sessionId),
          ...patch,
        });
        await updateRuntimeSession(db, sessionId, patch);
      };
      const created = await options.localAcp.createSession({
        ...(localSessionId ? { sessionId: localSessionId } : {}),
        runtimeId: c.req.param("runtimeId"),
        agentTemplateId: sessionContextId,
        ...(agentMemberId ? { agentMemberId } : {}),
        ...(agentId ? { agentId } : {}),
        ...(permissionMode ? { permissionMode } : {}),
        ...(body.project_id ? { projectId: body.project_id } : {}),
        ...(body.resume_session_id ? { resumeAcpSessionId: body.resume_session_id } : {}),
        ...(body.project_id
          ? {
              onReady: async (event: { sessionId: string; acpSessionId?: string }) => {
                await rememberRuntimeSessionPatch(event.sessionId, {
                  ...(event.acpSessionId ? { acpSessionId: event.acpSessionId } : {}),
                  status: "active",
                });
              },
              onError: async (event: { sessionId: string }) => {
                await rememberRuntimeSessionPatch(event.sessionId, { status: "error" });
              },
            }
          : {}),
      });
      if (body.project_id && localSessionId) {
        await finalizeRuntimeSessionId(
          db,
          localSessionId,
          created.session_id,
          {
            ...pendingSessionPatches.get(localSessionId),
            ...pendingSessionPatches.get(created.session_id),
          },
        );
      }
      return c.json(created);
    } catch (error) {
      const message = formatLocalAcpSessionError(error);
      if (localSessionId) {
        await sessionMessageStore.appendTurnError?.(localSessionId, null, message);
      }
      console.error("[local-api] local ACP session create failed:", message);
      return c.text(message, 503);
    }
  });

  app.get("/api/v1/runtimes/:runtimeId/local-sessions/scan", async (c) => {
    if (!options.localAcp) return c.json({ sessions: [] });
    return c.json(await options.localAcp.listResumeSessions(c.req.param("runtimeId")));
  });

  app.get("/api/v1/local-sessions/:sessionId/messages", async (c) => {
    const sessionId = c.req.param("sessionId");
    const persisted = await sessionMessageStore.listSessionMessages(sessionId);
    if (persisted) return c.json(persisted);
    if (!options.localAcp?.listSessionMessages) return c.json({ error: "not found" }, 404);
    const history = await options.localAcp.listSessionMessages(sessionId);
    return history ? c.json(history) : c.json({ error: "not found" }, 404);
  });

  app.post("/api/v1/local-sessions/:sessionId/_attach", async (c) => {
    if (!options.localAcp?.attachSession) return c.json({ error: "local ACP attach is not available" }, 501);
    const sessionId = c.req.param("sessionId");
    const state = await db.load();
    const session = state.sessions.find((candidate) => candidate.id === sessionId);
    if (!session || (session.type ?? "cloud") !== "runtime") return c.json({ error: "runtime session not found" }, 404);
    if (!session.runtimeId) return c.json({ error: "runtime session is missing runtimeId" }, 409);
    if (!session.agentId && !session.agentTemplateId) return c.json({ error: "runtime session is missing agent identity" }, 409);

    const rememberRuntimeSessionPatch = async (
      patch: Partial<Pick<LocalSession, "acpSessionId" | "status" | "title">>,
    ) => {
      await updateRuntimeSession(db, sessionId, patch);
    };

    try {
      await rememberRuntimeSessionPatch({ status: "starting" });
      const attached = await options.localAcp.attachSession({
        sessionId,
        runtimeId: session.runtimeId,
        ...(session.agentTemplateId ? { agentTemplateId: session.agentTemplateId } : {}),
        ...(session.agentId ? { agentId: session.agentId } : {}),
        ...(session.permissionMode ? { permissionMode: session.permissionMode } : {}),
        projectId: session.projectId,
        ...(session.acpSessionId ? { resumeAcpSessionId: session.acpSessionId } : {}),
        onReady: async (event: { acpSessionId?: string }) => {
          await rememberRuntimeSessionPatch({
            ...(event.acpSessionId ? { acpSessionId: event.acpSessionId } : {}),
            status: "active",
          });
        },
        onError: async () => {
          await rememberRuntimeSessionPatch({ status: "error" });
        },
      });
      return c.json(attached);
    } catch (error) {
      const message = formatLocalAcpSessionError(error);
      console.error("[local-api] local ACP session attach failed:", message);
      await rememberRuntimeSessionPatch({ status: "error" });
      return c.text(message, 503);
    }
  });

  app.get("/api/v1/projects", async (c) => {
    const state = await db.load();
    return c.json({
      projects: state.projects.map(toV1Project),
    });
  });

  app.post("/api/v1/projects", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      name?: string;
      description?: string;
    };
    const name = body.name?.trim();
    if (!name) return c.json({ error: "name is required" }, 400);

    const state = await db.load();
    const createdAt = nowIso();
    const project: LocalProject = {
      id: crypto.randomUUID(),
      ownerId: userId,
      name,
      description: body.description?.trim() || null,
      createdAt,
      updatedAt: createdAt,
      assets: [],
    };
    state.projects.unshift(project);
    await db.save(state);
    return c.json({
      id: project.id,
      name: project.name,
      description: project.description,
    }, 201);
  });

  app.get("/api/v1/projects/:id", async (c) => {
    const state = await db.load();
    const project = state.projects.find((p) => p.id === c.req.param("id"));
    return project ? c.json(toV1Project(project)) : c.json({ error: "Project not found" }, 404);
  });

  app.delete("/api/v1/projects/:id", async (c) => {
    const state = await db.load();
    const before = state.projects.length;
    const projectId = c.req.param("id");
    state.projects = state.projects.filter((p) => p.id !== projectId);
    if (state.projects.length === before) return c.json({ error: "Project not found" }, 404);
    state.assetRefs = state.assetRefs.filter((ref) => ref.projectId !== projectId);
    state.roomMessages = state.roomMessages.filter((message) => message.project_id !== projectId);
    await db.save(state);
    return c.json({ deleted: true });
  });

  app.get("/api/projects", async (c) => {
    const state = await db.load();
    return c.json(state.projects.map((project) => withProjectAssets(project, state)));
  });

  app.post("/api/projects", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      prompt?: string;
      name?: string;
      description?: string;
    };
    const prompt = (body.prompt ?? body.name ?? "Untitled project").trim();
    if (!prompt) return c.json({ error: "Missing prompt" }, 400);

    const state = await db.load();
    const createdAt = nowIso();
    const project: LocalProject = {
      id: crypto.randomUUID(),
      ownerId: userId,
      name: truncateProjectName(prompt),
      description: body.description ?? prompt,
      createdAt,
      updatedAt: createdAt,
      assets: [],
    };
    state.projects.unshift(project);
    await db.save(state);
    return c.json({ id: project.id });
  });

  app.get("/api/projects/:id", async (c) => {
    const state = await db.load();
    const project = state.projects.find((p) => p.id === c.req.param("id"));
    return project ? c.json(withProjectAssets(project, state)) : c.json({ error: "Not found" }, 404);
  });

  app.patch("/api/projects/:id", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { name?: string };
    if (!body.name?.trim()) return c.json({ error: "Missing name" }, 400);
    const state = await db.load();
    const project = state.projects.find((p) => p.id === c.req.param("id"));
    if (!project) return c.json({ error: "Not found" }, 404);
    project.name = body.name.trim();
    project.updatedAt = nowIso();
    await db.save(state);
    return c.json({ ok: true });
  });

  app.delete("/api/projects/:id", async (c) => {
    const state = await db.load();
    const before = state.projects.length;
    state.projects = state.projects.filter((p) => p.id !== c.req.param("id"));
    if (state.projects.length === before) return c.json({ error: "Not found" }, 404);
    state.assetRefs = state.assetRefs.filter((ref) => ref.projectId !== c.req.param("id"));
    state.roomMessages = state.roomMessages.filter((message) => message.project_id !== c.req.param("id"));
    await db.save(state);
    return new Response(null, { status: 204 });
  });

  app.get("/api/v1/sessions", async (c) => {
    const state = await db.load();
    const projectId = c.req.query("projectId");
    return c.json({
      sessions: projectId
        ? state.sessions.filter((s) => s.projectId === projectId).map(publicLocalSession)
        : state.sessions.map(publicLocalSession),
    });
  });

  app.post("/api/v1/sessions", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { projectId?: string; title?: string };
    if (!body.projectId) return c.json({ error: "Missing projectId" }, 400);
    const state = await db.load();
    const at = nowIso();
    const session: LocalSession = {
      id: crypto.randomUUID(),
      projectId: body.projectId,
      title: body.title?.trim() || "Session",
      type: "cloud",
      createdAt: at,
      updatedAt: at,
    };
    state.sessions.unshift(session);
    await db.save(state);
    return c.json({ threadId: session.id, title: session.title });
  });

  app.delete("/api/v1/sessions", async (c) => {
    const threadId = c.req.query("threadId");
    if (!threadId) return c.json({ error: "Missing threadId" }, 400);

    const state = await db.load();
    const before = state.sessions.length;
    state.sessions = state.sessions.filter((session) => session.id !== threadId);
    state.sessionMessages = state.sessionMessages.filter((message) => message.session_id !== threadId);
    if (state.sessions.length === before) return c.json({ error: "Not found" }, 404);

    await db.save(state);
    return new Response(null, { status: 204 });
  });

  app.get("/assets/sign", (c) => {
    const key = c.req.query("key");
    if (!key) return c.json({ error: "Missing key" }, 400);
    return c.json({
      url: localAssetUrl(c, key),
      exp: signedUrlExp(),
    });
  });

  app.post("/assets/sign-batch", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { keys?: unknown };
    const keys = Array.isArray(body.keys)
      ? body.keys.filter((key): key is string => typeof key === "string" && key.length > 0)
      : [];
    const exp = signedUrlExp();
    return c.json({ urls: keys.map((key) => ({ key, url: localAssetUrl(c, key), exp })) });
  });

  app.post("/api/custom-action/upload", async (c) => {
    const form = await c.req.formData();
    const projectId = String(form.get("projectId") ?? "");
    const taskId = String(form.get("taskId") ?? "");
    const nodeId = String(form.get("nodeId") ?? "");
    const outputType = String(form.get("outputType") ?? "image");
    const outputIndexRaw = form.get("outputIndex");
    const outputIndex = outputIndexRaw == null ? 0 : Number.parseInt(String(outputIndexRaw), 10) || 0;
    if (!projectId || !taskId || !nodeId) {
      return c.json({ error: "Missing required fields: projectId, taskId, nodeId" }, 400);
    }

    if (outputType === "text") {
      return c.json({ success: true, storageKey: null, content: String(form.get("content") ?? "") });
    }

    const file = form.get("file");
    if (!file || typeof file === "string") {
      return c.json({ error: "Missing file for image/video/audio output" }, 400);
    }

    const kind = outputType === "video" ? "video" : outputType === "audio" ? "audio" : "image";
    const ext = kind === "video" ? ".mp4" : kind === "audio" ? ".mp3" : ".png";
    const indexSuffix = outputIndex > 0 ? `-${outputIndex}` : "";
    const storageKey = `projects/${sanitizeFileName(projectId)}/custom/${sanitizeFileName(taskId)}${indexSuffix}${ext}`;
    const path = assetPath(options.dataDir, storageKey);
    const bytes = new Uint8Array(await file.arrayBuffer());
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, bytes);

    const state = await db.load();
    const at = Math.floor(Date.now() / 1000);
    const exp = signedUrlExp();
    const assetId = outputIndex > 0 ? `${taskId}${indexSuffix}` : taskId;
    const asset: Asset = {
      id: assetId,
      userId: String(form.get("actorUserId") ?? "") || userId,
      kind,
      srcR2Key: storageKey,
      coverR2Key: null,
      metadata: { bytes: bytes.byteLength, contentType: file.type || contentTypeForPath(storageKey) },
      sourceModel: "custom-action",
      sourcePrompt: null,
      sourceTaskId: taskId,
      sources: null,
      signedUrl: localAssetUrl(c, storageKey),
      signedUrlExp: exp,
      createdAt: at,
      updatedAt: at,
    };
    state.assets = [
      { ...asset, projectId },
      ...state.assets.filter((item) => item.id !== asset.id),
    ];
    state.assetRefs = [
      { assetId: asset.id, projectId, importedAt: at },
      ...state.assetRefs.filter((ref) => !(ref.assetId === asset.id && ref.projectId === projectId)),
    ];
    await db.save(state);
    return c.json({ success: true, storageKey, assetId });
  });

  app.post("/upload", async (c) => {
    const form = await c.req.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") return c.json({ error: "Missing file" }, 400);

    const storageKey = `uploads/${crypto.randomUUID().slice(0, 8)}-${sanitizeFileName(file.name)}`;
    const path = assetPath(options.dataDir, storageKey);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, new Uint8Array(await file.arrayBuffer()));
    return c.json({ storageKey });
  });

  app.get("/assets/*", async (c) => {
    const storageKey = c.req.path.slice("/assets/".length);
    if (!storageKey || storageKey === "sign" || storageKey === "sign-batch") {
      return c.text("Not found", 404);
    }
    try {
      const bytes = await readFile(assetPath(options.dataDir, storageKey));
      return new Response(bytes, {
        headers: {
          "content-type": contentTypeForPath(storageKey),
          "content-length": String(bytes.byteLength),
          "cache-control": "public, max-age=31536000, immutable",
        },
      });
    } catch {
      return c.text("Asset not found", 404);
    }
  });

  app.post("/api/v1/assets", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      projectId?: string;
      kind?: AssetKind;
      srcR2Key?: string;
      coverR2Key?: string | null;
    };
    if (!body.projectId || !body.kind || !body.srcR2Key) {
      return c.json({ error: "Missing projectId, kind, or srcR2Key" }, 400);
    }
    const state = await db.load();
    const at = Math.floor(Date.now() / 1000);
    const exp = signedUrlExp();
    const asset: Asset = {
      id: crypto.randomUUID(),
      userId,
      kind: body.kind,
      srcR2Key: body.srcR2Key,
      coverR2Key: body.coverR2Key ?? null,
      metadata: null,
      sourceModel: null,
      sourcePrompt: null,
      sourceTaskId: null,
      sources: null,
      signedUrl: localAssetUrl(c, body.srcR2Key),
      signedUrlExp: exp,
      createdAt: at,
      updatedAt: at,
    };
    state.assets.unshift(asset);
    state.assetRefs.unshift({
      assetId: asset.id,
      projectId: body.projectId,
      importedAt: at,
    });
    await db.save(state);
    return c.json({
      id: asset.id,
      srcR2Key: asset.srcR2Key,
      coverR2Key: asset.coverR2Key,
      signedUrl: asset.signedUrl,
      signedUrlExp: asset.signedUrlExp,
    });
  });

  app.get("/api/v1/assets/:id", async (c) => {
    const state = await db.load();
    const asset = state.assets.find((a) => a.id === c.req.param("id"));
    return asset ? c.json(withSignedAssetUrls(c, asset)) : c.json({ error: "not found" }, 404);
  });

  app.post("/api/v1/assets/batch", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { ids?: unknown };
    const ids = Array.isArray(body.ids)
      ? new Set(body.ids.filter((id): id is string => typeof id === "string"))
      : new Set<string>();
    const state = await db.load();
    return c.json({
      assets: state.assets
        .filter((asset) => ids.has(asset.id))
        .map((asset) => withSignedAssetUrls(c, asset)),
    });
  });

  app.delete("/api/v1/assets/:id/ref", async (c) => {
    const state = await db.load();
    const assetId = c.req.param("id");
    const projectId = c.req.query("projectId");
    state.assetRefs = state.assetRefs.filter((ref) => {
      if (ref.assetId !== assetId) return true;
      return projectId ? ref.projectId !== projectId : false;
    });
    await db.save(state);
    return c.json({ deleted: true });
  });

  app.patch("/api/v1/assets/:id/cover", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { coverR2Key?: string };
    if (!body.coverR2Key) return c.json({ error: "Missing coverR2Key" }, 400);
    const state = await db.load();
    const asset = state.assets.find((a) => a.id === c.req.param("id"));
    if (!asset) return c.json({ error: "not found" }, 404);
    asset.coverR2Key = body.coverR2Key;
    asset.updatedAt = Math.floor(Date.now() / 1000);
    await db.save(state);
    return c.json({ ok: true });
  });

  app.get("/api/v1/projects/:pid/room/messages", async (c) => {
    const state = await db.load();
    const projectId = c.req.param("pid");
    const publicSyncConfig = await syncConfig.getPublicConfig();
    let sync = roomSyncMeta(publicSyncConfig, "disabled");
    const remoteRoom = await syncConfig.resolveRemoteRoomSync();
    if (remoteRoom) {
      try {
        const remoteMessages = await remoteRoom.listMessages(projectId);
        upsertRoomMessages(state, remoteMessages.map(toLocalRoomMessage));
        await db.save(state);
        sync = roomSyncMeta(publicSyncConfig, "imported");
      } catch (error) {
        sync = roomSyncMeta(publicSyncConfig, "failed", error);
      }
    }
    const messages = state.roomMessages
      .filter((message) => message.project_id === projectId)
      .sort((a, b) => b.at - a.at);
    return c.json({ messages, sync });
  });
  app.post("/api/v1/projects/:pid/room/messages", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      text?: string;
      mentions?: unknown[];
      sender_kind?: "user" | "agent";
      sender_id?: string;
    };
    const text = body.text?.trim();
    if (!text) return c.json({ error: "text required" }, 400);
    const senderKind = body.sender_kind === "agent" ? "agent" : "user";
    const senderId = senderKind === "agent" ? body.sender_id?.trim() ?? "" : userId;
    if (senderKind === "agent" && !senderId) {
      return c.json({ error: "sender_id required for agent sender" }, 400);
    }
    const mentions: LocalRoomMention[] = Array.isArray(body.mentions)
      ? body.mentions
          .filter((mention): mention is Record<string, unknown> => !!mention && typeof mention === "object")
          .map((mention) => ({
            user_id: typeof mention.user_id === "string" ? mention.user_id : userId,
            ...(typeof mention.agent_member_id === "string" ? { agent_member_id: mention.agent_member_id } : {}),
          }))
      : [];
    const message: LocalRoomMessage = {
      id: crypto.randomUUID(),
      project_id: c.req.param("pid"),
      sender_kind: senderKind,
      sender_id: senderId,
      sender_user_id: userId,
      mentions,
      text,
      at: Math.floor(Date.now() / 1000),
    };
    const state = await db.load();
    state.roomMessages.unshift(message);
    await db.save(state);
    const publicSyncConfig = await syncConfig.getPublicConfig();
    let sync = roomSyncMeta(publicSyncConfig, "disabled");
    const remoteRoom = await syncConfig.resolveRemoteRoomSync();
    if (remoteRoom) {
      try {
        await remoteRoom.postMessage(message.project_id, {
          id: message.id,
          text: message.text,
          mentions: message.mentions,
          sender_kind: message.sender_kind,
          sender_id: message.sender_id,
        });
        sync = roomSyncMeta(publicSyncConfig, "mirrored");
      } catch (error) {
        sync = roomSyncMeta(publicSyncConfig, "failed", error);
      }
    }
    if (options.localAcp?.pushRoomMention) {
      const mentionPayload = {
        message_id: message.id,
        from_kind: message.sender_kind,
        from_id: message.sender_id,
        from_user_id: message.sender_user_id,
        text: message.text,
      };
      await Promise.all(
        mentions
          .filter((mention): mention is LocalRoomMention & { agent_member_id: string } =>
            typeof mention.agent_member_id === "string" && mention.agent_member_id.length > 0
          )
          .map((mention) =>
            options.localAcp!.pushRoomMention!(
              message.project_id,
              mention.agent_member_id,
              mentionPayload,
            ).catch(() => false)
          ),
      );
    }
    return c.json({ type: "room.message", ...message, sync }, 201);
  });

  return app;
}
