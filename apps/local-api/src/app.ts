import { chmod, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { basename, dirname, extname, join, resolve } from "node:path";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { LoroDoc } from "loro-crdt";
import {
  buildProjectRecoveryPolicy,
  buildProjectStatus,
  defaultRuntimeCapabilities,
  type ProjectRecoveryPolicy,
} from "@clash/shared-runtime";
import {
  agentReadToken,
  agentReadReceiptToken,
  assetReadToken,
  assetRefReadToken,
  Canvas,
  canvasBatchDeleteReadToken,
  canvasEdgeReadToken,
  canvasEdgesReadToken,
  canvasNodeReadToken,
  canvasDownstreamTargets,
  createMediaAssetCowNodeData,
  hostMutationRejected,
  hostMutationSucceeded,
  isMediaNodeType,
  invalidProviderModelFilters,
  listModelCatalogEntries,
  listProviderModelSupport,
  MOCK_MODEL_CARDS,
  MODEL_CARDS,
  MODEL_UPSTREAM_ROUTES,
  localConfigReadToken,
  normalizeModelId,
  projectReadToken,
  providerAccountReadToken,
  providerAccountsReadToken,
  providerOAuthReadToken,
  ProviderOAuthIdSchema,
  sessionReadToken,
  TextAppliedRevisionSchema,
  TimelineAppliedRevisionSchema,
  timelineDslFromYaml,
  validateCanvasBatchDelete,
  validateCanvasBatchDeleteReadProof,
  validateCanvasEdgeAdd,
  validateCanvasEdgeDelete,
  validateCanvasEdgePatch,
  validateCanvasEdgeReadProof,
  validateCanvasEdgesReadProof,
  validateCanvasReadProof,
  validateCanvasDelete,
  validateCanvasNodePatch,
  validateAgentReadProof,
  validateHostMutationEnvelope,
  type AgentReadReceiptProof,
  type CanvasReadProofEdgeLike,
  type CanvasUpdateEdgeLike,
  type CanvasUpdateNodeWithIdLike,
  type ProviderAccountAvailability,
  type ProviderOAuthId,
  type ModelUpstreamRoute,
  type ModelKind,
  type HostMutationRecord,
  type TextAppliedRevision,
  type TextRevisionContentDescriptor,
  type TextRevisionHistoryEntry,
  type TimelineAppliedRevision,
  type TimelineRevisionContentDescriptor,
  type TimelineRevisionHistoryEntry,
} from "@clash/shared-types";
import type { Asset, AssetKind } from "@clash/shared-types/assets";
import {
  createMockFalQueueService,
  handleFalMockHttpRequest,
  type FalMockQueueService,
} from "./fal-mock.js";
import { createMockExternalAigcService } from "./local-aigc.js";
import {
  createJsonlProviderTestRecorder,
  createProviderConformanceStubs,
  createProviderTestRecordingFetch,
  type ProviderConformanceStub,
} from "./provider-test-recorder.js";
import {
  createLocalAudioConfigStore,
  LocalAudioConfigError,
  type LocalAudioConfigReadState,
  type LocalAudioConfigStore,
} from "./audio-config.js";
import {
  createLocalSyncConfigStore,
  LocalSyncConfigError,
  type LocalSyncConfigReadState,
  type LocalSyncConfigStore,
} from "./sync-config.js";
import type { RemoteLoroPersistenceEnv } from "./sync.js";
import {
  normalizeProviderAccountInput,
  providerAccountKey,
  publicProviderAccounts,
  type LocalProviderAccountConfig,
  type LocalProviderOAuthRecord,
} from "./provider-accounts.js";
import {
  assetPathForDelete,
  assetPathForRead,
  assetPathForWrite,
  isLocalBlobStorageKey,
  normalizeAssetStorageKey,
  normalizeLocalBlobStorageKey,
} from "./local-asset-paths.js";
import { createLocalProviderStore } from "./local-provider-store.js";
import {
  planRoomMirror,
  roomMessageContentKey,
  type RemoteRoomMessage,
  type RemoteRoomMessageInput,
  type RoomMirrorConflict,
  type RoomMirrorPlan,
} from "./room-sync.js";
import {
  createLocalMetadataStore,
  type LocalMetadataAssetNodeRef,
  type LocalMetadataAgentMember as LocalAgentMember,
  type LocalMetadataDb,
  type LocalMutationAuditFilter,
  type LocalMutationAuditRecord,
  type LocalTimelineRevisionFilter,
  type LocalTextRevisionFilter,
  type LocalMetadataProject as LocalProject,
  type LocalMetadataProjectAsset as LocalProjectAsset,
  type LocalMetadataRoomMention as LocalRoomMention,
  type LocalMetadataRoomMessage as LocalRoomMessage,
  type LocalRoomSyncConflictResolution,
  type LocalMetadataSession as LocalSession,
  type LocalMetadataSessionMessage as PersistedLocalAcpSessionMessage,
} from "./local-metadata-store.js";
import { FileReplicaStore } from "./loro/file-replica-store.js";

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
  clashRoot?: string;
  userId?: string;
  localAcp?: LocalAcpAdapter;
  falMock?: FalMockQueueService;
  audioConfig?: LocalAudioConfigStore;
  syncConfig?: LocalSyncConfigStore;
  syncEnv?: RemoteLoroPersistenceEnv;
  providerOAuth?: Partial<Record<ProviderOAuthId, ProviderOAuthDriver>>;
  providerTestFetch?: typeof fetch;
  providerTestRecordingPath?: string;
  providerTestOpenAiBaseUrl?: string;
  providerTestAnthropicBaseUrl?: string;
  providerTestFalQueueBaseUrl?: string;
  providerTestGoogleAiStudioBaseUrl?: string;
  providerTestKieBaseUrl?: string;
  providerTestReplicateBaseUrl?: string;
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function textRevisionContentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

function textRevisionContentBlobPath(dataDir: string, contentHash: string): string {
  if (!/^[a-f0-9]{16}$/.test(contentHash)) {
    throw new Error("Invalid text revision content hash");
  }
  return join(dataDir, "text-revision-blobs", contentHash.slice(0, 2), `${contentHash}.md`);
}

function textRevisionContentUrl(revision: TextAppliedRevision): string {
  return `/api/v1/projects/${encodeURIComponent(revision.projectId)}/text-revisions/${encodeURIComponent(revision.revisionId)}/content`;
}

function textRevisionContentDescriptor(
  revision: TextAppliedRevision,
  options: { stored?: true } = {},
): TextRevisionContentDescriptor & { stored?: true } {
  return {
    kind: "text-revision-content",
    ...(options.stored ? { stored: true } : {}),
    contentHash: revision.contentHash,
    mediaType: "text/markdown",
    url: textRevisionContentUrl(revision),
    immutable: true,
    storage: {
      kind: "content-addressed-revision-blob",
      registry: "text_revisions",
      mediaAsset: false,
      agentWritable: false,
    },
  };
}

function stableJsonForTimelineHash(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJsonForTimelineHash).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value as object)
      .filter((key) => key !== "fromExpr")
      .sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stableJsonForTimelineHash((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function timelineRevisionSemanticHash(content: string): string {
  const parsed = timelineDslFromYaml(content);
  if (!parsed.ok) {
    throw new Error(`Invalid timeline revision content: ${parsed.error}`);
  }
  return createHash("sha256").update(stableJsonForTimelineHash(parsed.dsl)).digest("hex").slice(0, 16);
}

function timelineRevisionContentBlobPath(dataDir: string, timelineHash: string): string {
  if (!/^[a-f0-9]{16}$/.test(timelineHash)) {
    throw new Error("Invalid timeline revision hash");
  }
  return join(dataDir, "timeline-revision-blobs", timelineHash.slice(0, 2), `${timelineHash}.timeline.yaml`);
}

function timelineRevisionContentUrl(revision: TimelineAppliedRevision): string {
  return `/api/v1/projects/${encodeURIComponent(revision.projectId)}/timeline-revisions/${encodeURIComponent(revision.revisionId)}/content`;
}

function timelineRevisionContentDescriptor(
  revision: TimelineAppliedRevision,
  options: { stored?: true } = {},
): TimelineRevisionContentDescriptor & { stored?: true } {
  return {
    kind: "timeline-revision-content",
    ...(options.stored ? { stored: true } : {}),
    timelineHash: revision.timelineHash,
    mediaType: "application/yaml",
    url: timelineRevisionContentUrl(revision),
    immutable: true,
    storage: {
      kind: "content-addressed-revision-blob",
      registry: "timeline_revisions",
      mediaAsset: false,
      agentWritable: false,
    },
  };
}

async function storeTextRevisionContentBlob(
  dataDir: string,
  revision: TextAppliedRevision,
  content: string,
) {
  if (textRevisionContentHash(content) !== revision.contentHash) {
    throw new Error("text revision contentHash does not match content");
  }
  const path = textRevisionContentBlobPath(dataDir, revision.contentHash);
  const existing = await readFile(path, "utf8").catch((error: unknown) => {
    if (error && typeof error === "object" && (error as { code?: unknown }).code === "ENOENT") return null;
    throw error;
  });
  if (existing !== null) {
    if (existing !== content) {
      throw new Error("text revision content blob already exists with different content");
    }
    await chmod(path, 0o444).catch(() => undefined);
    return {
      ...textRevisionContentDescriptor(revision, { stored: true }),
    };
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, { encoding: "utf8", mode: 0o444 });
  await chmod(path, 0o444).catch(() => undefined);
  return {
    ...textRevisionContentDescriptor(revision, { stored: true }),
  };
}

async function withTextRevisionContentDescriptor(
  dataDir: string,
  revision: TextAppliedRevision,
): Promise<TextRevisionHistoryEntry> {
  const path = textRevisionContentBlobPath(dataDir, revision.contentHash);
  const fileStat = await stat(path).catch(() => null);
  if (!fileStat?.isFile()) return revision;
  return {
    ...revision,
    content: textRevisionContentDescriptor(revision, { stored: true }),
  };
}

async function storeTimelineRevisionContentBlob(
  dataDir: string,
  revision: TimelineAppliedRevision,
  content: string,
) {
  if (timelineRevisionSemanticHash(content) !== revision.timelineHash) {
    throw new Error("timeline revision timelineHash does not match content");
  }
  const path = timelineRevisionContentBlobPath(dataDir, revision.timelineHash);
  const existing = await readFile(path, "utf8").catch((error: unknown) => {
    if (error && typeof error === "object" && (error as { code?: unknown }).code === "ENOENT") return null;
    throw error;
  });
  if (existing !== null) {
    if (existing !== content) {
      throw new Error("timeline revision content blob already exists with different content");
    }
    await chmod(path, 0o444).catch(() => undefined);
    return {
      ...timelineRevisionContentDescriptor(revision, { stored: true }),
    };
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, { encoding: "utf8", mode: 0o444 });
  await chmod(path, 0o444).catch(() => undefined);
  return {
    ...timelineRevisionContentDescriptor(revision, { stored: true }),
  };
}

async function withTimelineRevisionContentDescriptor(
  dataDir: string,
  revision: TimelineAppliedRevision,
): Promise<TimelineRevisionHistoryEntry> {
  const path = timelineRevisionContentBlobPath(dataDir, revision.timelineHash);
  const fileStat = await stat(path).catch(() => null);
  if (!fileStat?.isFile()) return revision;
  return {
    ...revision,
    content: timelineRevisionContentDescriptor(revision, { stored: true }),
  };
}

function localMutationEnvelope(operation: string, kind: string, id: string) {
  return {
    operation,
    entity: { kind, id },
    forced: false,
  };
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

type LocalDb = LocalMetadataDb & {
  providerAccounts: LocalProviderAccountConfig[];
  providerOAuth: LocalProviderOAuthRecord[];
};

const LOCAL_API_READ_RECEIPT_SECRET = randomBytes(32).toString("hex");
const PROJECT_PURGE_DELAY_MS = 7 * 24 * 60 * 60 * 1000;

type ProjectCanvasAssetNodeRef = Pick<
  LocalMetadataAssetNodeRef,
  "assetId" | "projectId" | "nodeId" | "nodeType" | "fieldPath" | "referenceRole"
>;

function refreshAssetReferenceProjectionState(
  current: Pick<LocalDb, "assets" | "assetRefs" | "assetNodeRefs">,
  projectIds: string[],
  projectedCanvasAssetRefs: ProjectCanvasAssetNodeRef[],
): void {
  const observedAt = Math.floor(Date.now() / 1000);
  const currentAssetIds = new Set(current.assets.map((asset) => asset.id));
  const existingRefKeys = new Set(current.assetRefs.map((ref) => `${ref.assetId}\0${ref.projectId}`));
  const scannedProjectIds = new Set(projectIds);
  const nextAssetNodeRefs = new Map<string, LocalMetadataAssetNodeRef>();
  for (const ref of projectedCanvasAssetRefs) {
    const refKey = `${ref.assetId}\0${ref.projectId}`;
    if (!currentAssetIds.has(ref.assetId)) continue;
    if (!existingRefKeys.has(refKey)) {
      current.assetRefs.unshift({ assetId: ref.assetId, projectId: ref.projectId, importedAt: observedAt });
      existingRefKeys.add(refKey);
    }
    nextAssetNodeRefs.set(`${ref.projectId}\0${ref.nodeId}\0${ref.fieldPath}\0${ref.assetId}`, {
      ...ref,
      observedAt,
    });
  }
  current.assetNodeRefs = [
    ...nextAssetNodeRefs.values(),
    ...current.assetNodeRefs.filter((ref) => !scannedProjectIds.has(ref.projectId)),
  ];
}

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
    readToken: sessionReceiptReadToken(session),
  };
}

function publicRoomMessage(message: LocalRoomMessage) {
  return {
    id: message.id,
    project_id: message.project_id,
    sender_kind: message.sender_kind,
    sender_id: message.sender_id,
    sender_user_id: message.sender_user_id,
    mentions: message.mentions,
    text: message.text,
    at: message.created_at,
  };
}

type PublicRoomSyncStatus = "disabled" | "pending" | "imported" | "mirrored" | "failed";

function roomMessageContentHash(message: RemoteRoomMessage): string {
  return createHash("sha256").update(roomMessageContentKey(message)).digest("hex").slice(0, 16);
}

function publicRemoteRoomMessage(message: RemoteRoomMessage) {
  return {
    id: message.id,
    project_id: message.project_id,
    sender_kind: message.sender_kind,
    sender_id: message.sender_id,
    sender_user_id: message.sender_user_id,
    mentions: message.mentions,
    text: message.text,
    at: message.at,
    contentHash: roomMessageContentHash(message),
  };
}

function localRoomMessageToRemote(message: LocalRoomMessage): RemoteRoomMessage {
  return {
    id: message.id,
    project_id: message.project_id,
    sender_kind: message.sender_kind,
    sender_id: message.sender_id,
    sender_user_id: message.sender_user_id,
    mentions: message.mentions.map((mention) => ({
      ...(mention.user_id ? { user_id: mention.user_id } : {}),
      ...(mention.agent_member_id ? { agent_member_id: mention.agent_member_id } : {}),
    })),
    text: message.text,
    at: message.created_at,
  };
}

function remoteRoomMessageInput(message: RemoteRoomMessage): RemoteRoomMessageInput {
  return {
    id: message.id,
    sender_kind: message.sender_kind,
    sender_id: message.sender_id,
    sender_user_id: message.sender_user_id,
    text: message.text,
    mentions: message.mentions,
  };
}

function remoteRoomMessageToLocal(projectId: string, message: RemoteRoomMessage): LocalRoomMessage {
  return {
    id: message.id,
    project_id: projectId,
    sender_kind: message.sender_kind,
    sender_id: message.sender_id,
    sender_user_id: message.sender_user_id,
    mentions: message.mentions,
    text: message.text,
    created_at: message.at,
  };
}

function publicRoomMirrorPlan(plan: RoomMirrorPlan, resolvedConflictIds: string[] = []) {
  return {
    exportedIds: plan.exportToRemote.map((message) => message.id),
    importedIds: plan.importToLocal.map((message) => message.id),
    matchedIds: plan.matchedIds,
    conflicts: plan.conflicts.map((conflict) => ({
      id: conflict.id,
      reason: conflict.reason,
      local: publicRemoteRoomMessage(conflict.local),
      remote: publicRemoteRoomMessage(conflict.remote),
    })),
    resolvedConflictIds,
  };
}

function roomConflictEntityId(projectId: string, messageId: string): string {
  return `${projectId}:${messageId}`;
}

function roomConflictPairHash(localContentHash: string, remoteContentHash: string): string {
  return `${localContentHash}:${remoteContentHash}`;
}

function roomConflictMatchesResolution(
  conflict: RoomMirrorConflict,
  resolution: LocalRoomSyncConflictResolution,
): boolean {
  return resolution.messageId === conflict.id &&
    resolution.localContentHash === roomMessageContentHash(conflict.local) &&
    resolution.remoteContentHash === roomMessageContentHash(conflict.remote);
}

async function acceptedRoomConflictResolutions(
  db: ReturnType<typeof createDb>,
  projectId: string,
): Promise<LocalRoomSyncConflictResolution[]> {
  return db.listRoomSyncConflictResolutions({ projectId });
}

function splitRoomConflicts(
  conflicts: RoomMirrorConflict[],
  resolutions: LocalRoomSyncConflictResolution[],
) {
  const active: RoomMirrorConflict[] = [];
  const resolvedConflictIds: string[] = [];
  for (const conflict of conflicts) {
    const resolved = resolutions.some((resolution) => roomConflictMatchesResolution(conflict, resolution));
    if (resolved) {
      resolvedConflictIds.push(conflict.id);
    } else {
      active.push(conflict);
    }
  }
  return {
    active,
    resolvedConflictIds: resolvedConflictIds.sort(),
  };
}

type RoomSyncAdmissionReason = "remote-room-not-configured" | "room-sync-capability-not-ready";

function deniedRoomSyncAdmission(reason: RoomSyncAdmissionReason) {
  return {
    allowed: false,
    reason,
    requirements: reason === "remote-room-not-configured" ? ["enable-sync"] : ["room"],
  };
}

function allowedRoomSyncAdmission() {
  return {
    allowed: true,
    reason: null,
    requirements: [],
  };
}

async function publicRoomSyncMeta(
  syncConfig: LocalSyncConfigStore,
  override?: { status?: PublicRoomSyncStatus; error?: string },
) {
  const config = await syncConfig.getPublicConfig();
  const remoteConfigured = config.mode === "cloud-sync" && config.remote_loro.enabled;
  const status = remoteConfigured ? override?.status ?? "pending" : "disabled";
  const admission = !remoteConfigured
    ? deniedRoomSyncAdmission("remote-room-not-configured")
    : config.capabilities.room === true
      ? allowedRoomSyncAdmission()
      : deniedRoomSyncAdmission("room-sync-capability-not-ready");
  return {
    mode: config.mode,
    remote_room: {
      enabled: remoteConfigured,
      status,
      ...(override?.error ? { error: override.error } : {}),
    },
    admission,
  };
}

function roomSyncAdmissionError(reason: RoomSyncAdmissionReason | null | undefined): string {
  return reason === "room-sync-capability-not-ready"
    ? "room sync capability is not ready"
    : "remote room sync is not configured";
}

async function projectRecoveryPolicy(
  syncConfig: LocalSyncConfigStore,
  options: { localRestoreAllowed?: boolean } = {},
): Promise<ProjectRecoveryPolicy> {
  const sync = await syncConfig.getPublicConfig();
  return buildProjectRecoveryPolicy(
    buildProjectStatus(
      { projectId: "_project_recovery_policy", source: "explicit" },
      {
        clashRoot: "/clash",
        localApiDataDir: "/clash/local-api",
        marker: { sync: { mode: sync.mode, capabilities: sync.capabilities } },
      },
    ),
    options,
  );
}

async function localSyncReadState(syncConfig: LocalSyncConfigStore): Promise<LocalSyncConfigReadState> {
  if (syncConfig.getReadState) return syncConfig.getReadState();
  return {
    ...(await syncConfig.getPublicConfig()),
    updated_at: "unversioned",
  };
}

function publicLocalSyncConfig(readState: LocalSyncConfigReadState) {
  return {
    mode: readState.mode,
    remote_loro: readState.remote_loro,
    capabilities: readState.capabilities,
    readToken: localConfigReceiptReadToken({
      id: "sync",
      config: localSyncConfigReadProjection(readState),
      updatedAt: readState.updated_at,
    }),
  };
}

function localSyncConfigReadProjection(readState: LocalSyncConfigReadState) {
  return {
    mode: readState.mode,
    remote_loro: readState.remote_loro,
    capabilities: readState.capabilities,
  };
}

async function localAudioReadState(audioConfig: LocalAudioConfigStore): Promise<LocalAudioConfigReadState> {
  if (audioConfig.getReadState) return audioConfig.getReadState();
  return {
    ...(await audioConfig.getPublicConfig()),
    updated_at: "unversioned",
  };
}

function publicLocalAudioConfig(readState: LocalAudioConfigReadState) {
  return {
    asr: readState.asr,
    readToken: localAudioReceiptReadToken(readState),
  };
}

function localAudioReceiptReadToken(readState: LocalAudioConfigReadState): string {
  return localConfigReceiptReadToken({
    id: "audio",
    config: { asr: readState.asr },
    updatedAt: readState.updated_at,
  });
}

function inferClashRoot(dataDir: string, explicit?: string): string {
  if (explicit?.trim()) return resolve(explicit);
  const resolved = resolve(dataDir);
  return basename(resolved) === "local-api" ? dirname(resolved) : resolved;
}

function normalizeRoomMentions(value: unknown): LocalRoomMention[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): LocalRoomMention[] => {
    if (!item || typeof item !== "object") return [];
    const typed = item as Record<string, unknown>;
    const userId = typeof typed.user_id === "string" ? typed.user_id.trim() : "";
    const agentMemberId = typeof typed.agent_member_id === "string" && typed.agent_member_id.trim()
      ? typed.agent_member_id.trim()
      : undefined;
    const agentTemplateId = typeof typed.agent_template_id === "string" && typed.agent_template_id.trim()
      ? typed.agent_template_id.trim()
      : undefined;
    if (!userId && !agentMemberId && !agentTemplateId) return [];
    return [{
      ...(userId ? { user_id: userId } : {}),
      ...(agentMemberId ? { agent_member_id: agentMemberId } : {}),
      ...(agentTemplateId ? { agent_template_id: agentTemplateId } : {}),
    }];
  });
}

function roomMentionKey(mention: LocalRoomMention): string {
  return JSON.stringify({
    agent_member_id: mention.agent_member_id ?? "",
    agent_template_id: mention.agent_template_id ?? "",
    user_id: mention.user_id ?? "",
  });
}

function roomMentionsContentKey(mentions: LocalRoomMention[]): string {
  return JSON.stringify(mentions.map(roomMentionKey).sort());
}

function roomMessageCreateMatchesExisting(
  existing: LocalRoomMessage,
  incoming: Pick<LocalRoomMessage, "sender_kind" | "sender_id" | "sender_user_id" | "mentions" | "text">,
): boolean {
  return existing.sender_kind === incoming.sender_kind &&
    existing.sender_id === incoming.sender_id &&
    existing.sender_user_id === incoming.sender_user_id &&
    existing.text === incoming.text &&
    roomMentionsContentKey(existing.mentions) === roomMentionsContentKey(incoming.mentions);
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

function createDb(dataDir: string) {
  const metadataStore = createLocalMetadataStore(dataDir);
  const providerStore = createLocalProviderStore(dataDir);
  let writeQueue: Promise<unknown> = Promise.resolve();

  async function load(): Promise<LocalDb> {
    await writeQueue.catch(() => undefined);
    const [metadata, providerAccounts, providerOAuth] = await Promise.all([
      metadataStore.load(),
      providerStore.loadProviderAccounts(),
      providerStore.loadProviderOAuth(),
    ]);
    return {
      ...metadata,
      providerAccounts,
      providerOAuth,
    };
  }

  async function update<T>(mutate: (db: LocalDb) => T | Promise<T>): Promise<T> {
    const task = writeQueue.catch(() => undefined).then(async () => {
      const [metadata, providerAccounts, providerOAuth] = await Promise.all([
        metadataStore.load(),
        providerStore.loadProviderAccounts(),
        providerStore.loadProviderOAuth(),
      ]);
      const normalized: LocalDb = {
        ...metadata,
        providerAccounts,
        providerOAuth,
      };
      const result = await mutate(normalized);
      await metadataStore.save({
        projects: normalized.projects,
        assets: normalized.assets,
        assetRefs: normalized.assetRefs,
        assetNodeRefs: normalized.assetNodeRefs,
        sessions: normalized.sessions,
        agentMembers: normalized.agentMembers,
        sessionMessages: normalized.sessionMessages,
        roomMessages: normalized.roomMessages,
      });
      await providerStore.saveProviderAccounts(normalized.providerAccounts);
      await providerStore.saveProviderOAuth(normalized.providerOAuth);
      return result;
    });
    writeQueue = task.then(() => undefined, () => undefined);
    return task;
  }

  async function appendMutationAudit(record: LocalMutationAuditRecord): Promise<void> {
    const task = writeQueue.catch(() => undefined).then(() => metadataStore.appendMutationAudit(record));
    writeQueue = task.then(() => undefined, () => undefined);
    return task;
  }

  async function listMutationAudit(filter: LocalMutationAuditFilter = {}): Promise<LocalMutationAuditRecord[]> {
    await writeQueue.catch(() => undefined);
    return metadataStore.listMutationAudit(filter);
  }

  async function upsertRoomSyncConflictResolution(
    resolution: LocalRoomSyncConflictResolution,
  ): Promise<LocalRoomSyncConflictResolution> {
    const task = writeQueue.catch(() => undefined)
      .then(() => metadataStore.upsertRoomSyncConflictResolution(resolution));
    writeQueue = task.then(() => undefined, () => undefined);
    return task;
  }

  async function listRoomSyncConflictResolutions(
    filter: { projectId: string },
  ): Promise<LocalRoomSyncConflictResolution[]> {
    await writeQueue.catch(() => undefined);
    return metadataStore.listRoomSyncConflictResolutions(filter);
  }

  async function upsertTextRevision(revision: TextAppliedRevision): Promise<TextAppliedRevision> {
    const task = writeQueue.catch(() => undefined).then(() => metadataStore.upsertTextRevision(revision));
    writeQueue = task.then(() => undefined, () => undefined);
    return task;
  }

  async function listTextRevisions(filter: LocalTextRevisionFilter): Promise<TextAppliedRevision[]> {
    await writeQueue.catch(() => undefined);
    return metadataStore.listTextRevisions(filter);
  }

  async function getTextRevision(projectId: string, revisionId: string): Promise<TextAppliedRevision | null> {
    await writeQueue.catch(() => undefined);
    return metadataStore.getTextRevision(projectId, revisionId);
  }

  async function upsertTimelineRevision(revision: TimelineAppliedRevision): Promise<TimelineAppliedRevision> {
    const task = writeQueue.catch(() => undefined).then(() => metadataStore.upsertTimelineRevision(revision));
    writeQueue = task.then(() => undefined, () => undefined);
    return task;
  }

  async function listTimelineRevisions(filter: LocalTimelineRevisionFilter): Promise<TimelineAppliedRevision[]> {
    await writeQueue.catch(() => undefined);
    return metadataStore.listTimelineRevisions(filter);
  }

  async function getTimelineRevision(projectId: string, revisionId: string): Promise<TimelineAppliedRevision | null> {
    await writeQueue.catch(() => undefined);
    return metadataStore.getTimelineRevision(projectId, revisionId);
  }

  return {
    load,
    update,
    appendMutationAudit,
    listMutationAudit,
    upsertRoomSyncConflictResolution,
    listRoomSyncConflictResolutions,
    upsertTextRevision,
    listTextRevisions,
    getTextRevision,
    upsertTimelineRevision,
    listTimelineRevisions,
    getTimelineRevision,
  };
}

function sanitizeMutationForAudit(mutation: HostMutationRecord): Record<string, unknown> {
  const {
    expectedReadToken: _expectedReadToken,
    beforeReadToken: _beforeReadToken,
    afterReadToken: _afterReadToken,
    expectedHash: _expectedHash,
    beforeHash: _beforeHash,
    afterHash: _afterHash,
    ...safeMutation
  } = mutation;
  return safeMutation as Record<string, unknown>;
}

function mutationAuditRecord(options: {
  mutation: HostMutationRecord;
  actorClientType?: string;
  reason: string;
}): LocalMutationAuditRecord {
  return {
    id: randomUUID(),
    createdAt: Date.now(),
    operation: options.mutation.operation,
    entity: options.mutation.entity,
    actorClientType: options.actorClientType ?? null,
    forced: options.mutation.forced,
    accepted: options.mutation.accepted,
    reason: options.reason,
    resultEntityId: options.mutation.resultEntityId ?? null,
    error: options.mutation.error ?? null,
    mutation: sanitizeMutationForAudit(options.mutation),
  };
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

function isAssetKind(value: unknown): value is AssetKind {
  return value === "image" || value === "video" || value === "audio";
}

function optionalBodyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function isSafeProjectRelativePath(value: string): boolean {
  if (!value || value.startsWith("/") || /^[A-Za-z]:/.test(value) || value.includes("\\")) return false;
  const parts = value.split("/");
  return parts.every((part) => part.length > 0 && part !== "." && part !== "..");
}

function parseTextRevisionForIndex(value: unknown): { ok: true; revision: TextAppliedRevision } | { ok: false; error: string } {
  const parsed = TextAppliedRevisionSchema.safeParse(value);
  if (!parsed.success) return { ok: false, error: "Invalid text revision" };
  const revision = parsed.data;
  if (!/^[a-f0-9]{16}$/.test(revision.contentHash) || !/^[a-f0-9]{16}$/.test(revision.sourceFileHash)) {
    return { ok: false, error: "Text revision hashes must be sha256-64 hex strings" };
  }
  if (revision.sourceFileHash !== revision.contentHash) {
    return { ok: false, error: "Text revision source file hash must match content hash" };
  }
  if (!isSafeProjectRelativePath(revision.sourceFilePath)) {
    return { ok: false, error: "Text revision source file path must be project-relative" };
  }
  return { ok: true, revision };
}

function parseTimelineRevisionForIndex(value: unknown): { ok: true; revision: TimelineAppliedRevision } | { ok: false; error: string } {
  const parsed = TimelineAppliedRevisionSchema.safeParse(value);
  if (!parsed.success) return { ok: false, error: "Invalid timeline revision" };
  const revision = parsed.data;
  if (!/^[a-f0-9]{16}$/.test(revision.timelineHash) || !/^[a-f0-9]{16}$/.test(revision.sourceFileHash)) {
    return { ok: false, error: "Timeline revision hashes must be sha256-64 hex strings" };
  }
  if (revision.sourceFileHash !== revision.timelineHash) {
    return { ok: false, error: "Timeline revision source file hash must match timeline hash" };
  }
  if (!isSafeProjectRelativePath(revision.sourceFilePath)) {
    return { ok: false, error: "Timeline revision source file path must be project-relative" };
  }
  return { ok: true, revision };
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()))];
}

async function collectProjectCanvasAssetRefs(
  dataDir: string,
  projectIds: string[],
): Promise<ProjectCanvasAssetNodeRef[]> {
  if (projectIds.length === 0) return [];
  const store = new FileReplicaStore(join(dataDir, "projects"));
  const refs: ProjectCanvasAssetNodeRef[] = [];
  for (const projectId of projectIds) {
    const doc = await store.recover(projectId);
    const nodes = doc.getMap("nodes");
    for (const [nodeId, raw] of nodes.entries()) {
      collectAssetNodeRefsFromValue(raw, refs, {
        projectId,
        nodeId,
        nodeType: canvasNodeType(raw),
      });
    }
  }
  return refs.sort((left, right) => (
    left.projectId.localeCompare(right.projectId)
    || left.nodeId.localeCompare(right.nodeId)
    || left.fieldPath.localeCompare(right.fieldPath)
    || left.assetId.localeCompare(right.assetId)
  ));
}

function canvasNodeType(value: unknown): string {
  if (!value || typeof value !== "object") return "unknown";
  const type = (value as Record<string, unknown>).type;
  return typeof type === "string" && type.trim() ? type.trim() : "unknown";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function discoverProjectReplicaIds(dataDir: string): Promise<string[]> {
  try {
    const entries = await readdir(join(dataDir, "projects"), { withFileTypes: true, encoding: "utf8" });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        try {
          return decodeURIComponent(entry.name);
        } catch {
          return "";
        }
      })
      .filter((projectId) => projectId.length > 0)
      .sort();
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function collectAssetNodeRefsFromValue(
  value: unknown,
  refs: ProjectCanvasAssetNodeRef[],
  context: Pick<ProjectCanvasAssetNodeRef, "projectId" | "nodeId" | "nodeType">,
  fieldPath = "",
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      collectAssetNodeRefsFromValue(item, refs, context, `${fieldPath}[${index}]`);
    });
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const nestedPath = fieldPath ? `${fieldPath}.${key}` : key;
    if (isAssetReferenceKey(key) && typeof nested === "string" && nested.trim()) {
      refs.push({ ...context, assetId: nested.trim(), fieldPath: nestedPath, referenceRole: inferAssetReferenceRole(key) });
    } else if (isAssetReferenceListKey(key) && Array.isArray(nested)) {
      nested.forEach((item, index) => {
        if (typeof item === "string" && item.trim()) {
          refs.push({
            ...context,
            assetId: item.trim(),
            fieldPath: `${nestedPath}[${index}]`,
            referenceRole: inferAssetReferenceRole(key),
          });
        }
      });
    }
    collectAssetNodeRefsFromValue(nested, refs, context, nestedPath);
  }
}

function isAssetReferenceKey(key: string): boolean {
  return normalizeAssetReferenceKey(key).endsWith("assetid");
}

function isAssetReferenceListKey(key: string): boolean {
  return normalizeAssetReferenceKey(key).endsWith("assetids");
}

function normalizeAssetReferenceKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function inferAssetReferenceRole(key: string): string {
  const normalized = normalizeAssetReferenceKey(key);
  if (normalized.startsWith("requiredreferenceasset")) return "required-reference";
  if (normalized.startsWith("referenceasset")) return "reference";
  if (normalized.startsWith("sourceasset")) return "source";
  if (normalized.startsWith("derivedasset")) return "derived";
  if (normalized === "assetid" || normalized === "assetids") return "primary";
  return "asset";
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

function withProjectAssets(project: LocalProject, state: LocalDb): LocalProject & { readToken: string } {
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

  return { ...project, assets: previewAssets, readToken: projectReceiptReadToken(project) };
}

function isDeletedProject(project: LocalProject): boolean {
  return typeof project.deletedAt === "string" && project.deletedAt.length > 0;
}

function isActiveProject(project: LocalProject): boolean {
  return !isDeletedProject(project);
}

function activeProjects(state: LocalDb): LocalProject[] {
  return state.projects.filter(isActiveProject);
}

function findActiveProject(state: LocalDb, projectId: string, ownerId?: string): LocalProject | undefined {
  return state.projects.find((candidate) =>
    candidate.id === projectId &&
      (!ownerId || candidate.ownerId === ownerId) &&
      isActiveProject(candidate)
  );
}

function isDeletedKnownProject(state: LocalDb, projectId: string): boolean {
  return state.projects.some((candidate) => candidate.id === projectId && isDeletedProject(candidate));
}

function deleteProjectFromState(state: LocalDb, projectId: string): LocalProject | null {
  const project = findActiveProject(state, projectId);
  if (!project) return null;
  const deletedAt = nowIso();
  project.deletedAt = deletedAt;
  project.updatedAt = deletedAt;
  return project;
}

function restoreProjectInState(state: LocalDb, projectId: string): LocalProject | null {
  const project = state.projects.find((candidate) => candidate.id === projectId && isDeletedProject(candidate));
  if (!project) return null;
  project.deletedAt = null;
  project.updatedAt = nowIso();
  return project;
}

function projectPurgeAfter(project: LocalProject): string {
  const deletedAtMs = Date.parse(project.deletedAt ?? "");
  const base = Number.isFinite(deletedAtMs) ? deletedAtMs : Date.now();
  return new Date(base + PROJECT_PURGE_DELAY_MS).toISOString();
}

function canPurgeProject(project: LocalProject, nowMs = Date.now()): boolean {
  return Date.parse(projectPurgeAfter(project)) <= nowMs;
}

function purgeProjectFromState(state: LocalDb, projectId: string) {
  const project = state.projects.find((candidate) => candidate.id === projectId && isDeletedProject(candidate));
  if (!project) return null;
  const sessionIds = new Set(
    state.sessions
      .filter((session) => session.projectId === projectId)
      .map((session) => session.id),
  );
  const counts = {
    projects: 1,
    projectPreviewAssets: project.assets.length,
    sessions: sessionIds.size,
    sessionMessages: state.sessionMessages.filter((message) => sessionIds.has(message.session_id)).length,
    roomMessages: state.roomMessages.filter((message) => message.project_id === projectId).length,
    assetRowsUnlinked: state.assets.filter((asset) => asset.projectId === projectId).length,
    assetRefs: state.assetRefs.filter((ref) => ref.projectId === projectId).length,
    assetNodeRefs: state.assetNodeRefs.filter((ref) => ref.projectId === projectId).length,
  };
  state.projects = state.projects.filter((candidate) => candidate.id !== projectId);
  state.sessions = state.sessions.filter((session) => session.projectId !== projectId);
  state.sessionMessages = state.sessionMessages.filter((message) => !sessionIds.has(message.session_id));
  state.roomMessages = state.roomMessages.filter((message) => message.project_id !== projectId);
  state.assets = state.assets.map((asset) =>
    asset.projectId === projectId ? { ...asset, projectId: undefined } : asset,
  );
  state.assetRefs = state.assetRefs.filter((ref) => ref.projectId !== projectId);
  state.assetNodeRefs = state.assetNodeRefs.filter((ref) => ref.projectId !== projectId);
  return { project, counts };
}

function toV1Project(project: LocalProject) {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    created_at: isoToEpochSeconds(project.createdAt),
    updated_at: isoToEpochSeconds(project.updatedAt),
    ...(isDeletedProject(project) ? { deletedAt: project.deletedAt } : {}),
    readToken: projectReceiptReadToken(project),
  };
}

function localApiProjectReadReceipt(readToken: string): string {
  return createHmac("sha256", LOCAL_API_READ_RECEIPT_SECRET)
    .update(`project:${readToken}`)
    .digest("base64url");
}

function projectReceiptReadToken(project: LocalProject): string {
  const readToken = projectReadToken(project);
  return agentReadReceiptToken({
    readToken,
    receipt: localApiProjectReadReceipt(readToken),
  });
}

function verifyLocalApiProjectReadReceipt(proof: AgentReadReceiptProof): boolean {
  return proof.namespace === "project" &&
    proof.receipt === localApiProjectReadReceipt(proof.baseReadToken);
}

function localApiSessionReadReceipt(readToken: string): string {
  return createHmac("sha256", LOCAL_API_READ_RECEIPT_SECRET)
    .update(`session:${readToken}`)
    .digest("base64url");
}

function sessionReceiptReadToken(session: LocalSession): string {
  const readToken = sessionReadToken(session);
  return agentReadReceiptToken({
    readToken,
    receipt: localApiSessionReadReceipt(readToken),
  });
}

function verifyLocalApiSessionReadReceipt(proof: AgentReadReceiptProof): boolean {
  return proof.namespace === "session" &&
    proof.receipt === localApiSessionReadReceipt(proof.baseReadToken);
}

function localApiLocalConfigReadReceipt(readToken: string): string {
  return createHmac("sha256", LOCAL_API_READ_RECEIPT_SECRET)
    .update(`local-config:${readToken}`)
    .digest("base64url");
}

function localConfigReceiptReadToken(config: { id: string; config: unknown; updatedAt: string }): string {
  const readToken = localConfigReadToken({
    id: config.id,
    config: config.config,
    updatedAt: config.updatedAt,
  });
  return agentReadReceiptToken({
    readToken,
    receipt: localApiLocalConfigReadReceipt(readToken),
  });
}

function verifyLocalApiLocalConfigReadReceipt(proof: AgentReadReceiptProof): boolean {
  return proof.namespace === "local-config" &&
    proof.receipt === localApiLocalConfigReadReceipt(proof.baseReadToken);
}

const LOCAL_RUNTIME_CONFIG_READ_VERSION = "local-runtime-config-v1";

type LocalHarnessesResponse = { harnesses: LocalAcpHarness[] };
type LocalAgentServersResponse = { agent_servers: LocalAcpAgentServersConfig };

function localHarnessReadProjection(result: LocalHarnessesResponse) {
  return {
    harnesses: result.harnesses
      .map((harness) => ({
        id: harness.id,
        label: harness.label,
        binary: harness.binary,
        enabled: harness.enabled === true,
        available: harness.available === true,
        ...(harness.custom === true ? { custom: true } : {}),
        ...(harness.installed === true ? { installed: true } : {}),
        ...(harness.installable === true ? { installable: true } : {}),
        ...(harness.updateAvailable === true ? { updateAvailable: true } : {}),
        ...(harness.installedVersion ? { installedVersion: harness.installedVersion } : {}),
        ...(harness.latestVersion ? { latestVersion: harness.latestVersion } : {}),
        ...(harness.installSource ? { installSource: harness.installSource } : {}),
        ...(harness.downloadUrl ? { downloadUrl: harness.downloadUrl } : {}),
        ...(harness.downloadKind ? { downloadKind: harness.downloadKind } : {}),
        ...(harness.homepage ? { homepage: harness.homepage } : {}),
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function localHarnessesReceiptReadToken(result: LocalHarnessesResponse): string {
  return localConfigReceiptReadToken({
    id: "local-harnesses",
    config: localHarnessReadProjection(result),
    updatedAt: LOCAL_RUNTIME_CONFIG_READ_VERSION,
  });
}

function localAgentServersReceiptReadToken(result: LocalAgentServersResponse): string {
  return localConfigReceiptReadToken({
    id: "local-agent-servers",
    config: { agent_servers: result.agent_servers },
    updatedAt: LOCAL_RUNTIME_CONFIG_READ_VERSION,
  });
}

function localApiProviderAccountReadReceipt(readToken: string): string {
  return createHmac("sha256", LOCAL_API_READ_RECEIPT_SECRET)
    .update(`provider-account:${readToken}`)
    .digest("base64url");
}

function providerAccountReceiptReadToken(account: ProviderAccountAvailability): string {
  const readToken = providerAccountReadToken(account);
  return agentReadReceiptToken({
    readToken,
    receipt: localApiProviderAccountReadReceipt(readToken),
  });
}

function verifyLocalApiProviderAccountReadReceipt(proof: AgentReadReceiptProof): boolean {
  return proof.namespace === "provider-account" &&
    proof.receipt === localApiProviderAccountReadReceipt(proof.baseReadToken);
}

function localApiProviderAccountsReadReceipt(readToken: string): string {
  return createHmac("sha256", LOCAL_API_READ_RECEIPT_SECRET)
    .update(`provider-accounts:${readToken}`)
    .digest("base64url");
}

function providerAccountsReceiptReadToken(accounts: ProviderAccountAvailability[]): string {
  const readToken = providerAccountsReadToken(accounts);
  return agentReadReceiptToken({
    readToken,
    receipt: localApiProviderAccountsReadReceipt(readToken),
  });
}

function verifyLocalApiProviderAccountsReadReceipt(proof: AgentReadReceiptProof): boolean {
  return proof.namespace === "provider-accounts" &&
    proof.receipt === localApiProviderAccountsReadReceipt(proof.baseReadToken);
}

function providerOAuthBaseReadToken(record: LocalProviderOAuthRecord): string {
  return providerOAuthReadToken({
    ...publicProviderOAuth(record),
    updatedAt: record.updatedAt,
  });
}

function localApiProviderOAuthReadReceipt(readToken: string): string {
  return createHmac("sha256", LOCAL_API_READ_RECEIPT_SECRET)
    .update(`provider-oauth:${readToken}`)
    .digest("base64url");
}

function providerOAuthReceiptReadToken(record: LocalProviderOAuthRecord): string {
  const readToken = providerOAuthBaseReadToken(record);
  return agentReadReceiptToken({
    readToken,
    receipt: localApiProviderOAuthReadReceipt(readToken),
  });
}

function verifyLocalApiProviderOAuthReadReceipt(proof: AgentReadReceiptProof): boolean {
  return proof.namespace === "provider-oauth" &&
    proof.receipt === localApiProviderOAuthReadReceipt(proof.baseReadToken);
}

function publicProviderOAuthWithReadReceipt(record: LocalProviderOAuthRecord) {
  return {
    ...publicProviderOAuth(record),
    readToken: providerOAuthReceiptReadToken(record),
  };
}

function publicProviderAccountsWithReadReceipts(accounts: ProviderAccountAvailability[]): ProviderAccountAvailability[] {
  return accounts.map((account) => ({
    ...account,
    readToken: providerAccountReceiptReadToken(account),
  }));
}

function publicModelProvidersResponse(accounts: ProviderAccountAvailability[]): {
  providers: ProviderAccountAvailability[];
  readToken: string;
} {
  return {
    providers: publicProviderAccountsWithReadReceipts(accounts),
    readToken: providerAccountsReceiptReadToken(accounts),
  };
}

function localApiCanvasReadReceipt(readToken: string): string {
  return createHmac("sha256", LOCAL_API_READ_RECEIPT_SECRET)
    .update(`canvas-node:${readToken}`)
    .digest("base64url");
}

function localApiCanvasEdgeReadReceipt(readToken: string): string {
  return createHmac("sha256", LOCAL_API_READ_RECEIPT_SECRET)
    .update(`canvas-edge:${readToken}`)
    .digest("base64url");
}

function localApiCanvasEdgesReadReceipt(readToken: string): string {
  return createHmac("sha256", LOCAL_API_READ_RECEIPT_SECRET)
    .update(`canvas-edges:${readToken}`)
    .digest("base64url");
}

function localApiCanvasBatchDeleteReadReceipt(readToken: string): string {
  return createHmac("sha256", LOCAL_API_READ_RECEIPT_SECRET)
    .update(`canvas-batch-delete:${readToken}`)
    .digest("base64url");
}

function canvasNodeReceiptReadToken(node: Parameters<typeof canvasNodeReadToken>[0]): string {
  const readToken = canvasNodeReadToken(node);
  return agentReadReceiptToken({
    readToken,
    receipt: localApiCanvasReadReceipt(readToken),
  });
}

function verifyLocalApiCanvasReadReceipt(proof: AgentReadReceiptProof): boolean {
  return proof.namespace === "node" &&
    proof.receipt === localApiCanvasReadReceipt(proof.baseReadToken);
}

function canvasEdgeReceiptReadToken(edge: Parameters<typeof canvasEdgeReadToken>[0]): string {
  const readToken = canvasEdgeReadToken(edge);
  return agentReadReceiptToken({
    readToken,
    receipt: localApiCanvasEdgeReadReceipt(readToken),
  });
}

function canvasEdgesReceiptReadToken(edges: Iterable<CanvasReadProofEdgeLike>): string {
  const readToken = canvasEdgesReadToken(edges);
  return agentReadReceiptToken({
    readToken,
    receipt: localApiCanvasEdgesReadReceipt(readToken),
  });
}

function verifyLocalApiCanvasEdgeReadReceipt(proof: AgentReadReceiptProof): boolean {
  return proof.namespace === "edge" &&
    proof.receipt === localApiCanvasEdgeReadReceipt(proof.baseReadToken);
}

function verifyLocalApiCanvasEdgesReadReceipt(proof: AgentReadReceiptProof): boolean {
  return proof.namespace === "edges" &&
    proof.receipt === localApiCanvasEdgesReadReceipt(proof.baseReadToken);
}

function canvasBatchDeleteReceiptReadToken(options: Parameters<typeof canvasBatchDeleteReadToken>[0]): string {
  const readToken = canvasBatchDeleteReadToken(options);
  return agentReadReceiptToken({
    readToken,
    receipt: localApiCanvasBatchDeleteReadReceipt(readToken),
  });
}

function verifyLocalApiCanvasBatchDeleteReadReceipt(proof: AgentReadReceiptProof): boolean {
  return proof.namespace === "canvas-batch-delete" &&
    proof.receipt === localApiCanvasBatchDeleteReadReceipt(proof.baseReadToken);
}

function listCanvasReadProofEdges(doc: LoroDoc): CanvasReadProofEdgeLike[] {
  const edgesMap = doc.getMap("edges");
  const edges: CanvasReadProofEdgeLike[] = [];
  for (const [edgeId, rawEdge] of edgesMap.entries()) {
    if (!isRecord(rawEdge)) continue;
    edges.push({ ...rawEdge, id: edgeId });
  }
  return edges.sort((left, right) => left.id.localeCompare(right.id));
}

function listCanvasEdgesWithReadReceipts(doc: LoroDoc): {
  edges: Array<CanvasReadProofEdgeLike & { readToken: string }>;
  readToken: string;
} {
  const edges = listCanvasReadProofEdges(doc);
  return {
    edges: edges.map((edge) => ({ ...edge, readToken: canvasEdgeReceiptReadToken(edge) })),
    readToken: canvasEdgesReceiptReadToken(edges),
  };
}

function readCanvasEdge(doc: LoroDoc, edgeId: string): CanvasReadProofEdgeLike | null {
  const rawEdge = doc.getMap("edges").get(edgeId);
  if (!isRecord(rawEdge)) return null;
  return { ...rawEdge, id: edgeId };
}

function canvasEdgeResponse(edge: CanvasReadProofEdgeLike): CanvasReadProofEdgeLike & { readToken: string } {
  return { ...edge, readToken: canvasEdgeReceiptReadToken(edge) };
}

function normalizeCanvasBatchDeleteNodeIds(nodeIds: string[]): string[] {
  return [...new Set(nodeIds.map((nodeId) => nodeId.trim()).filter(Boolean))];
}

function readCanvasBatchDeletePlan(doc: LoroDoc, nodeIds: string[]):
  | { ok: true; nodeIds: string[]; nodes: NonNullable<ReturnType<Canvas["readNode"]>>[]; edges: CanvasReadProofEdgeLike[]; readToken: string }
  | { ok: false; error: string; status: 400 | 404 } {
  const uniqueNodeIds = normalizeCanvasBatchDeleteNodeIds(nodeIds);
  if (uniqueNodeIds.length === 0) return { ok: false, error: "delete batch requires at least one node id", status: 400 };
  const canvas = new Canvas(doc, () => {});
  const nodes: NonNullable<ReturnType<Canvas["readNode"]>>[] = [];
  const missing: string[] = [];
  for (const nodeId of uniqueNodeIds) {
    const node = canvas.readNode(nodeId);
    if (!node) missing.push(nodeId);
    else nodes.push(node);
  }
  if (missing.length > 0) return { ok: false, error: `Node(s) not found: ${missing.join(", ")}`, status: 404 };
  const edges = listCanvasReadProofEdges(doc);
  return {
    ok: true,
    nodeIds: uniqueNodeIds,
    nodes,
    edges,
    readToken: canvasBatchDeleteReceiptReadToken({ nodes, edges }),
  };
}

function readCanvasGuardrailNodes(doc: LoroDoc): CanvasUpdateNodeWithIdLike[] {
  const nodesMap = doc.getMap("nodes");
  const nodes: CanvasUpdateNodeWithIdLike[] = [];
  for (const [id, rawNode] of nodesMap.entries()) {
    if (!isRecord(rawNode)) continue;
    nodes.push({
      id,
      type: typeof rawNode.type === "string" ? rawNode.type : undefined,
      data: isRecord(rawNode.data) ? rawNode.data : undefined,
    });
  }
  return nodes;
}

function canvasGuardrailEdges(edges: Iterable<CanvasReadProofEdgeLike>): CanvasUpdateEdgeLike[] {
  return [...edges]
    .map((edge) => ({
      source: typeof edge.source === "string" ? edge.source : "",
      target: typeof edge.target === "string" ? edge.target : "",
    }))
    .filter((edge) => edge.source.length > 0 && edge.target.length > 0);
}

function canvasEdgePatchFromBody(body: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (
      key === "actorClientType" ||
      key === "ifMatch" ||
      key === "force" ||
      key === "id" ||
      key === "readToken"
    ) {
      continue;
    }
    if (value !== undefined) patch[key] = value;
  }
  return patch;
}

function canvasNodeDataPatchFromBody(body: Record<string, unknown>):
  | { ok: true; patch: Record<string, unknown> }
  | { ok: false; error: string } {
  const patch: Record<string, unknown> = {};
  const nestedData = body.data;
  if (nestedData !== undefined) {
    if (!isRecord(nestedData)) return { ok: false, error: "Invalid node data patch" };
    for (const [key, value] of Object.entries(nestedData)) {
      if (value !== undefined) patch[key] = value;
    }
  }

  for (const [key, value] of Object.entries(body)) {
    if (
      key === "actorClientType" ||
      key === "ifMatch" ||
      key === "force" ||
      key === "id" ||
      key === "nodeId" ||
      key === "projectId" ||
      key === "readToken" ||
      key === "data"
    ) {
      continue;
    }
    if (value !== undefined) patch[key] = value;
  }

  return { ok: true, patch };
}

function localApiAssetReadReceipt(readToken: string): string {
  return createHmac("sha256", LOCAL_API_READ_RECEIPT_SECRET)
    .update(`asset:${readToken}`)
    .digest("base64url");
}

function assetReceiptReadToken(asset: Asset): string {
  const readToken = assetReadToken(asset);
  return agentReadReceiptToken({
    readToken,
    receipt: localApiAssetReadReceipt(readToken),
  });
}

function verifyLocalApiAssetReadReceipt(proof: AgentReadReceiptProof): boolean {
  return proof.namespace === "asset" &&
    proof.receipt === localApiAssetReadReceipt(proof.baseReadToken);
}

type AssetRefReadTarget = {
  assetId: string;
  projectId: string;
  importedAt: number;
};

function localApiAssetRefReadReceipt(readToken: string): string {
  return createHmac("sha256", LOCAL_API_READ_RECEIPT_SECRET)
    .update(`asset-ref:${readToken}`)
    .digest("base64url");
}

function assetRefReceiptReadToken(ref: AssetRefReadTarget): string {
  const readToken = assetRefReadToken(ref);
  return agentReadReceiptToken({
    readToken,
    receipt: localApiAssetRefReadReceipt(readToken),
  });
}

function verifyLocalApiAssetRefReadReceipt(proof: AgentReadReceiptProof): boolean {
  return proof.namespace === "asset-ref" &&
    proof.receipt === localApiAssetRefReadReceipt(proof.baseReadToken);
}

type AssetGarbageCollectionScope = {
  explicitProtectedAssetIds: string[];
  protectedProjectIds: string[];
  canvasAssetRefs: ProjectCanvasAssetNodeRef[];
};

type AssetGarbageCollectionPlan = {
  deletedAssets: Array<{ id: string; srcR2Key: string }>;
  protectedAssets: string[];
  protectedProjectIds: string[];
  deletedBlobKeys: string[];
  orphanedIds: Set<string>;
  projectedCanvasAssetRefs: ProjectCanvasAssetNodeRef[];
};

function localApiAssetGcReadReceipt(readToken: string): string {
  return createHmac("sha256", LOCAL_API_READ_RECEIPT_SECRET)
    .update(`asset-gc:${readToken}`)
    .digest("base64url");
}

function assetGarbageCollectionReadToken(plan: Pick<
  AssetGarbageCollectionPlan,
  "deletedAssets" | "deletedBlobKeys" | "protectedAssets" | "protectedProjectIds"
>): string {
  return agentReadToken({
    namespace: "asset-gc",
    subject: {
      deletedAssets: plan.deletedAssets
        .map((asset) => ({ id: asset.id, srcR2Key: asset.srcR2Key }))
        .sort((left, right) => left.id.localeCompare(right.id) || left.srcR2Key.localeCompare(right.srcR2Key)),
      deletedBlobKeys: [...plan.deletedBlobKeys].sort(),
      protectedAssets: [...plan.protectedAssets].sort(),
      protectedProjectIds: [...plan.protectedProjectIds].sort(),
    },
  });
}

function assetGarbageCollectionReceiptReadToken(plan: AssetGarbageCollectionPlan): string {
  const readToken = assetGarbageCollectionReadToken(plan);
  return agentReadReceiptToken({
    readToken,
    receipt: localApiAssetGcReadReceipt(readToken),
  });
}

function verifyLocalApiAssetGcReadReceipt(proof: AgentReadReceiptProof): boolean {
  return proof.namespace === "asset-gc" &&
    proof.receipt === localApiAssetGcReadReceipt(proof.baseReadToken);
}

type ProjectWritePreconditions = {
  actorClientType?: string;
  expectedReadToken?: string;
  force: boolean;
};

type ProjectWriteBody = {
  actorClientType?: unknown;
  ifMatch?: unknown;
  force?: unknown;
};

type SnapshotWriteRouteResult = {
  status: 200 | 400 | 404 | 409;
  body: Record<string, unknown>;
  assetRef?: { assetId: string; projectId: string; importedAt: number };
};

function requestProjectWritePreconditions(
  c: { req: { header(name: string): string | undefined } },
  body: ProjectWriteBody = {},
): ProjectWritePreconditions {
  return {
    actorClientType: normalizeString(body.actorClientType) ??
      normalizeString(c.req.header("x-clash-client-type")) ??
      normalizeString(c.req.header("x-clash-actor-client-type")),
    expectedReadToken: normalizeString(body.ifMatch) ??
      normalizeIfMatchHeader(c.req.header("x-clash-if-match")) ??
      normalizeIfMatchHeader(c.req.header("if-match")),
    force: body.force === true || normalizeString(c.req.header("x-clash-force")) === "true",
  };
}

async function resolveAssetGarbageCollectionScope(
  dataDir: string,
  body: { protectedAssetIds?: unknown; projectIds?: unknown },
): Promise<AssetGarbageCollectionScope> {
  const requestedProjectIds = stringArray(body.projectIds).sort();
  const protectedProjectIds = requestedProjectIds.length > 0
    ? requestedProjectIds
    : await discoverProjectReplicaIds(dataDir);
  return {
    explicitProtectedAssetIds: stringArray(body.protectedAssetIds).sort(),
    protectedProjectIds,
    canvasAssetRefs: await collectProjectCanvasAssetRefs(dataDir, protectedProjectIds),
  };
}

function buildAssetGarbageCollectionPlan(
  state: Pick<LocalDb, "assets" | "assetRefs">,
  scope: AssetGarbageCollectionScope,
): AssetGarbageCollectionPlan {
  const referencedAssetIds = new Set(state.assetRefs.map((ref) => ref.assetId));
  const protectedAssetIds = new Set(scope.explicitProtectedAssetIds);
  const knownAssetIds = new Set(state.assets.map((asset) => asset.id));
  const projectedCanvasAssetRefs = scope.canvasAssetRefs.filter((ref) => knownAssetIds.has(ref.assetId));
  for (const ref of scope.canvasAssetRefs) {
    protectedAssetIds.add(ref.assetId);
  }
  const orphanedAssets = state.assets
    .filter((asset) => !referencedAssetIds.has(asset.id) && !protectedAssetIds.has(asset.id))
    .sort((left, right) => left.id.localeCompare(right.id) || left.srcR2Key.localeCompare(right.srcR2Key));
  const orphanedIds = new Set(orphanedAssets.map((asset) => asset.id));
  const liveStorageKeys = new Set(
    state.assets
      .filter((asset) => !orphanedIds.has(asset.id))
      .map((asset) => asset.srcR2Key),
  );
  const deletedBlobKeys = orphanedAssets
    .map((asset) => asset.srcR2Key)
    .filter((key) => isLocalBlobStorageKey(key) && !liveStorageKeys.has(key))
    .sort();
  return {
    deletedAssets: orphanedAssets.map((asset) => ({ id: asset.id, srcR2Key: asset.srcR2Key })),
    protectedAssets: [...protectedAssetIds].sort(),
    protectedProjectIds: scope.protectedProjectIds,
    deletedBlobKeys,
    orphanedIds,
    projectedCanvasAssetRefs,
  };
}

function validateAssetGarbageCollectionMutation(options: {
  plan: AssetGarbageCollectionPlan;
  preconditions: ProjectWritePreconditions;
}) {
  const currentReadToken = assetGarbageCollectionReadToken(options.plan);
  const guard = validateAgentReadProof({
    actorClientType: options.preconditions.actorClientType,
    operation: "asset garbage collection",
    currentReadToken,
    expectedReadToken: options.preconditions.expectedReadToken,
    requireReceipt: true,
    readReceiptVerifier: verifyLocalApiAssetGcReadReceipt,
    force: options.preconditions.force,
    readCommandHint:
      "Run `clash assets gc --dry-run --json` first and pass its `readToken` with --if-match, " +
      "or pass --force for an explicit overwrite.",
  });
  return validateHostMutationEnvelope({
    operation: "asset_gc",
    entity: { kind: "asset-store", id: "local" },
    expectedReadToken: options.preconditions.expectedReadToken,
    currentReadToken,
    force: options.preconditions.force,
    guard,
  });
}

function validateProjectReadMutation(options: {
  project: LocalProject;
  operation: "update" | "delete" | "restore" | "purge";
  preconditions: ProjectWritePreconditions;
}) {
  const currentReadToken = projectReadToken(options.project);
  const readCommand = options.operation === "restore" || options.operation === "purge"
    ? `clash project get --id ${options.project.id} --include-deleted --json`
    : `clash project get --id ${options.project.id} --json`;
  const guard = validateAgentReadProof({
    actorClientType: options.preconditions.actorClientType,
    operation: `project ${options.operation}`,
    currentReadToken,
    expectedReadToken: options.preconditions.expectedReadToken,
    requireReceipt: true,
    readReceiptVerifier: verifyLocalApiProjectReadReceipt,
    force: options.preconditions.force,
    readCommandHint:
      `Run \`${readCommand}\` first and pass its ` +
      "`readToken` with --if-match, or pass --force for an explicit overwrite.",
  });
  return validateHostMutationEnvelope({
    operation: `project_${options.operation}`,
    entity: { kind: "project", id: options.project.id },
    expectedReadToken: options.preconditions.expectedReadToken,
    currentReadToken,
    force: options.preconditions.force,
    guard,
  });
}

function validateSessionReadMutation(options: {
  session: LocalSession;
  operation: "delete" | "attach";
  mutationOperation?: string;
  readOperation?: string;
  preconditions: ProjectWritePreconditions;
}) {
  const currentReadToken = sessionReadToken(options.session);
  const readOperation = options.readOperation ?? `session ${options.operation}`;
  const guard = validateAgentReadProof({
    actorClientType: options.preconditions.actorClientType,
    operation: readOperation,
    currentReadToken,
    expectedReadToken: options.preconditions.expectedReadToken,
    requireReceipt: true,
    readReceiptVerifier: verifyLocalApiSessionReadReceipt,
    force: options.preconditions.force,
    readCommandHint:
      `Read /api/v1/sessions?projectId=${encodeURIComponent(options.session.projectId)} first and pass its ` +
      "`readToken` with --if-match, or pass --force for an explicit overwrite.",
  });
  return validateHostMutationEnvelope({
    operation: options.mutationOperation ?? `session_${options.operation}`,
    entity: { kind: "session", id: options.session.id },
    expectedReadToken: options.preconditions.expectedReadToken,
    currentReadToken,
    force: options.preconditions.force,
    guard,
  });
}

function validateLocalSyncConfigMutation(options: {
  readState: LocalSyncConfigReadState;
  preconditions: ProjectWritePreconditions;
}) {
  const currentReadToken = localConfigReadToken({
    id: "sync",
    config: localSyncConfigReadProjection(options.readState),
    updatedAt: options.readState.updated_at,
  });
  const guard = validateAgentReadProof({
    actorClientType: options.preconditions.actorClientType,
    operation: "local sync config update",
    currentReadToken,
    expectedReadToken: options.preconditions.expectedReadToken,
    requireReceipt: true,
    readReceiptVerifier: verifyLocalApiLocalConfigReadReceipt,
    force: options.preconditions.force,
    readCommandHint:
      "Read /api/v1/local/sync first and pass its `readToken` with --if-match, " +
      "or pass --force for an explicit overwrite.",
  });
  return validateHostMutationEnvelope({
    operation: "local_sync_config_update",
    entity: { kind: "local-config", id: "sync" },
    expectedReadToken: options.preconditions.expectedReadToken,
    currentReadToken,
    force: options.preconditions.force,
    guard,
  });
}

function validateLocalAudioConfigMutation(options: {
  readState: LocalAudioConfigReadState;
  preconditions: ProjectWritePreconditions;
}) {
  const currentReadToken = localConfigReadToken({
    id: "audio",
    config: {
      asr: options.readState.asr,
    },
    updatedAt: options.readState.updated_at,
  });
  const guard = validateAgentReadProof({
    actorClientType: options.preconditions.actorClientType,
    operation: "local audio config update",
    currentReadToken,
    expectedReadToken: options.preconditions.expectedReadToken,
    requireReceipt: true,
    readReceiptVerifier: verifyLocalApiLocalConfigReadReceipt,
    force: options.preconditions.force,
    readCommandHint:
      "Read /api/v1/local/audio first and pass its `readToken` with --if-match, " +
      "or pass --force for an explicit overwrite.",
  });
  return validateHostMutationEnvelope({
    operation: "local_audio_config_update",
    entity: { kind: "local-config", id: "audio" },
    expectedReadToken: options.preconditions.expectedReadToken,
    currentReadToken,
    force: options.preconditions.force,
    guard,
  });
}

function validateLocalAudioInstallMutation(options: {
  readState: LocalAudioConfigReadState;
  preconditions: ProjectWritePreconditions;
}) {
  const currentReadToken = localConfigReadToken({
    id: "audio",
    config: {
      asr: options.readState.asr,
    },
    updatedAt: options.readState.updated_at,
  });
  const guard = validateAgentReadProof({
    actorClientType: options.preconditions.actorClientType,
    operation: "local audio model install",
    currentReadToken,
    expectedReadToken: options.preconditions.expectedReadToken,
    requireReceipt: true,
    readReceiptVerifier: verifyLocalApiLocalConfigReadReceipt,
    force: options.preconditions.force,
    readCommandHint:
      "Read /api/v1/local/audio first and pass its `readToken` with --if-match, " +
      "or pass --force for an explicit overwrite.",
  });
  return validateHostMutationEnvelope({
    operation: "local_audio_model_install",
    entity: { kind: "local-config", id: "audio" },
    expectedReadToken: options.preconditions.expectedReadToken,
    currentReadToken,
    force: options.preconditions.force,
    guard,
  });
}

function validateLocalHarnessesConfigMutation(options: {
  result: LocalHarnessesResponse;
  preconditions: ProjectWritePreconditions;
}) {
  const currentReadToken = localConfigReadToken({
    id: "local-harnesses",
    config: localHarnessReadProjection(options.result),
    updatedAt: LOCAL_RUNTIME_CONFIG_READ_VERSION,
  });
  const guard = validateAgentReadProof({
    actorClientType: options.preconditions.actorClientType,
    operation: "local harness enablement update",
    currentReadToken,
    expectedReadToken: options.preconditions.expectedReadToken,
    requireReceipt: true,
    readReceiptVerifier: verifyLocalApiLocalConfigReadReceipt,
    force: options.preconditions.force,
    readCommandHint:
      "Read /api/v1/local/harnesses first and pass its `readToken` with --if-match, " +
      "or pass --force for an explicit overwrite.",
  });
  return validateHostMutationEnvelope({
    operation: "local_harness_enablement_update",
    entity: { kind: "local-harness-config", id: "enabled" },
    expectedReadToken: options.preconditions.expectedReadToken,
    currentReadToken,
    force: options.preconditions.force,
    guard,
  });
}

function validateLocalHarnessActionMutation(options: {
  result: LocalHarnessesResponse;
  preconditions: ProjectWritePreconditions;
  operation: string;
  harnessId: string;
  action: string;
}) {
  const currentReadToken = localConfigReadToken({
    id: "local-harnesses",
    config: localHarnessReadProjection(options.result),
    updatedAt: LOCAL_RUNTIME_CONFIG_READ_VERSION,
  });
  const guard = validateAgentReadProof({
    actorClientType: options.preconditions.actorClientType,
    operation: `local harness ${options.action}`,
    currentReadToken,
    expectedReadToken: options.preconditions.expectedReadToken,
    requireReceipt: true,
    readReceiptVerifier: verifyLocalApiLocalConfigReadReceipt,
    force: options.preconditions.force,
    readCommandHint:
      "Read /api/v1/local/harnesses first and pass its `readToken` with --if-match, " +
      "or pass --force for an explicit overwrite.",
  });
  return validateHostMutationEnvelope({
    operation: options.operation,
    entity: { kind: "local-harness", id: options.harnessId },
    expectedReadToken: options.preconditions.expectedReadToken,
    currentReadToken,
    force: options.preconditions.force,
    guard,
  });
}

function validateLocalAgentServersConfigMutation(options: {
  result: LocalAgentServersResponse;
  preconditions: ProjectWritePreconditions;
}) {
  const currentReadToken = localConfigReadToken({
    id: "local-agent-servers",
    config: { agent_servers: options.result.agent_servers },
    updatedAt: LOCAL_RUNTIME_CONFIG_READ_VERSION,
  });
  const guard = validateAgentReadProof({
    actorClientType: options.preconditions.actorClientType,
    operation: "local agent servers update",
    currentReadToken,
    expectedReadToken: options.preconditions.expectedReadToken,
    requireReceipt: true,
    readReceiptVerifier: verifyLocalApiLocalConfigReadReceipt,
    force: options.preconditions.force,
    readCommandHint:
      "Read /api/v1/local/agent-servers first and pass its `readToken` with --if-match, " +
      "or pass --force for an explicit overwrite.",
  });
  return validateHostMutationEnvelope({
    operation: "local_agent_servers_update",
    entity: { kind: "local-harness-config", id: "agent-servers" },
    expectedReadToken: options.preconditions.expectedReadToken,
    currentReadToken,
    force: options.preconditions.force,
    guard,
  });
}

function validateProviderAccountsReadMutation(options: {
  userId: string;
  accounts: ProviderAccountAvailability[];
  preconditions: ProjectWritePreconditions;
}) {
  const currentReadToken = providerAccountsReadToken(options.accounts);
  const guard = validateAgentReadProof({
    actorClientType: options.preconditions.actorClientType,
    operation: "provider accounts update",
    currentReadToken,
    expectedReadToken: options.preconditions.expectedReadToken,
    requireReceipt: true,
    readReceiptVerifier: verifyLocalApiProviderAccountsReadReceipt,
    force: options.preconditions.force,
    readCommandHint:
      "Read /api/v1/model-providers first and pass its top-level `readToken` with --if-match, " +
      "or pass --force for an explicit overwrite.",
  });
  return validateHostMutationEnvelope({
    operation: "provider_accounts_update",
    entity: { kind: "provider-accounts", id: options.userId },
    expectedReadToken: options.preconditions.expectedReadToken,
    currentReadToken,
    force: options.preconditions.force,
    guard,
  });
}

function validateProviderAccountReadMutation(options: {
  account: ProviderAccountAvailability;
  operation: "delete";
  preconditions: ProjectWritePreconditions;
}) {
  const accountId = options.account.id ?? providerAccountKey({
    providerId: options.account.providerId,
    upstreamId: options.account.upstreamId,
    region: options.account.region,
  });
  const currentReadToken = providerAccountReadToken(options.account);
  const guard = validateAgentReadProof({
    actorClientType: options.preconditions.actorClientType,
    operation: `provider account ${options.operation}`,
    currentReadToken,
    expectedReadToken: options.preconditions.expectedReadToken,
    requireReceipt: true,
    readReceiptVerifier: verifyLocalApiProviderAccountReadReceipt,
    force: options.preconditions.force,
    readCommandHint:
      "Read /api/v1/model-providers first and pass the provider's `readToken` with --if-match, " +
      "or pass --force for an explicit overwrite.",
  });
  return validateHostMutationEnvelope({
    operation: `provider_account_${options.operation}`,
    entity: { kind: "provider-account", id: accountId },
    expectedReadToken: options.preconditions.expectedReadToken,
    currentReadToken,
    force: options.preconditions.force,
    guard,
  });
}

function validateProviderOAuthReadMutation(options: {
  record: LocalProviderOAuthRecord;
  operation: "start" | "complete" | "delete";
  preconditions: ProjectWritePreconditions;
}) {
  const entityId = providerOAuthEntityId(options.record.providerId, options.record.accountId);
  const currentReadToken = providerOAuthBaseReadToken(options.record);
  const guard = validateAgentReadProof({
    actorClientType: options.preconditions.actorClientType,
    operation: `provider OAuth ${options.operation}`,
    currentReadToken,
    expectedReadToken: options.preconditions.expectedReadToken,
    requireReceipt: true,
    readReceiptVerifier: verifyLocalApiProviderOAuthReadReceipt,
    force: options.preconditions.force,
    readCommandHint:
      "Read /api/v1/provider-oauth first and pass the provider OAuth record's `readToken` with --if-match, " +
      "or pass --force for an explicit overwrite.",
  });
  return validateHostMutationEnvelope({
    operation: `provider_oauth_${options.operation}`,
    entity: { kind: "provider-oauth", id: entityId },
    expectedReadToken: options.preconditions.expectedReadToken,
    currentReadToken,
    force: options.preconditions.force,
    guard,
  });
}

function normalizeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeIfMatchHeader(value: unknown): string | undefined {
  const trimmed = normalizeString(value);
  if (!trimmed) return undefined;
  const withoutWeakPrefix = trimmed.startsWith("W/") ? trimmed.slice(2).trim() : trimmed;
  if (withoutWeakPrefix.startsWith('"') && withoutWeakPrefix.endsWith('"')) {
    return withoutWeakPrefix.slice(1, -1);
  }
  return withoutWeakPrefix;
}

function parseProviderOAuthId(value: unknown): ProviderOAuthId | null {
  const parsed = ProviderOAuthIdSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function publicProviderOAuth(record: LocalProviderOAuthRecord) {
  return {
    providerId: record.providerId,
    ...(record.accountId ? { accountId: record.accountId } : {}),
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

function providerOAuthEntityId(providerId: string, accountId?: string): string {
  return accountId ? `${providerId}:${accountId}` : providerId;
}

function upsertProviderOAuth(
  state: LocalDb,
  userId: string,
  providerId: ProviderOAuthId,
  patch: Partial<LocalProviderOAuthRecord>,
): LocalProviderOAuthRecord {
  const now = nowIso();
  const accountId = patch.accountId;
  const existing = state.providerOAuth.find((record) =>
    record.userId === userId &&
    record.providerId === providerId &&
    (record.accountId ?? "") === (accountId ?? "")
  );
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

function stringBodyField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function providerOAuthMatches(
  record: LocalProviderOAuthRecord,
  userId: string,
  providerId: ProviderOAuthId,
  accountId?: string,
): boolean {
  return record.userId === userId &&
    record.providerId === providerId &&
    (record.accountId ?? "") === (accountId ?? "");
}

function builtinLocalAgentMembers(userId: string, createdAt: number): LocalAgentMember[] {
  return BUILTIN_AGENT_TEMPLATES.map((template) => ({
    id: `local-${template.id}`,
    user_id: userId,
    template_id: template.id,
    runtime_id: LOCAL_RUNTIME_ID,
    agent_id: null,
    display_name: template.label,
    created_at: createdAt,
  }));
}

function localAgentMembersForRead(state: LocalDb, userId: string): LocalAgentMember[] {
  return state.agentMembers.length > 0 ? state.agentMembers : builtinLocalAgentMembers(userId, 0);
}

function seedLocalAgentMembers(state: LocalDb, userId: string): LocalAgentMember[] {
  if (state.agentMembers.length > 0) return state.agentMembers;
  state.agentMembers = builtinLocalAgentMembers(userId, Math.floor(Date.now() / 1000));
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

interface ModelProviderTestResult {
  ok: boolean;
  providerId: string;
  upstreamId?: string;
  region?: string;
  modelId: string;
  message: string;
  provider?: string;
  requestId?: string;
  modelEndpoint?: string;
  input?: ModelProviderTestInputSummary;
  output?: ModelProviderTestOutputSummary;
  disabled?: boolean;
  missingCredentials?: string[];
  missingOAuth?: string[];
  unsupported?: boolean;
  skipped?: boolean;
}

interface ModelProviderTestInputSummary {
  shape: ModelKind;
  model: string;
  prompt: string;
  aspectRatio?: string;
  duration?: number;
}

type ModelProviderTestOutputSummary =
  | {
    shape: "image";
    provider?: string;
    endpoint?: string;
    requestId?: string;
    url?: string;
    contentType: string;
    width?: number;
    height?: number;
  }
  | {
    shape: "video";
    provider?: string;
    endpoint?: string;
    requestId?: string;
    url?: string;
    contentType: string;
    width?: number;
    height?: number;
    durationMs?: number;
  }
  | {
    shape: "audio";
    provider?: string;
    endpoint?: string;
    requestId?: string;
    url?: string;
    contentType: string;
    durationMs?: number;
    transcript?: string;
  }
  | {
    shape: "text";
    provider?: string;
    endpoint?: string;
    text: string;
  }
  | {
    shape: "asr";
    provider?: string;
    endpoint?: string;
    transcript?: string;
  };

function providerTestInputSummary(input: ModelProviderTestInputSummary): ModelProviderTestInputSummary {
  return {
    shape: input.shape,
    model: input.model,
    prompt: input.prompt,
    ...(input.aspectRatio ? { aspectRatio: input.aspectRatio } : {}),
    ...(typeof input.duration === "number" ? { duration: input.duration } : {}),
  };
}

function providerTestMediaOutput(
  shape: "image" | "video" | "audio",
  result: Awaited<ReturnType<ReturnType<typeof createMockExternalAigcService>["generateImage"]>>,
): ModelProviderTestOutputSummary {
  return {
    shape,
    ...(result.provider ? { provider: result.provider } : {}),
    ...(result.modelEndpoint ? { endpoint: result.modelEndpoint } : {}),
    ...(result.requestId ? { requestId: result.requestId } : {}),
    ...(result.remoteUrl ? { url: result.remoteUrl } : {}),
    contentType: result.contentType,
    ...(typeof result.width === "number" ? { width: result.width } : {}),
    ...(typeof result.height === "number" ? { height: result.height } : {}),
    ...(typeof result.durationMs === "number" ? { durationMs: result.durationMs } : {}),
    ...(result.transcript ? { transcript: result.transcript } : {}),
  };
}

function displayModelName(modelId: string): string {
  return [...MODEL_CARDS, ...MOCK_MODEL_CARDS].find((model) => model.id === modelId)?.name ?? modelId;
}

function displayProviderName(account: Pick<LocalProviderAccountConfig, "providerId" | "upstreamId" | "region">): string {
  if (account.providerId === "mock") return "Mock provider";
  if (account.providerId === "official" && account.upstreamId) {
    if (account.upstreamId === "openai") return "OpenAI";
    if (account.upstreamId === "anthropic") return "Anthropic";
    if (account.upstreamId === "google-ai-studio") return "Google AI Studio";
    if (account.upstreamId === "google-agent-platform") return "Google Cloud Agent Platform";
    return account.upstreamId;
  }
  const names: Record<string, string> = {
    fal: "fal.ai",
    kie: "KIE",
    replicate: "Replicate",
    kling: "Kling",
    minimax: "MiniMax",
    jimeng: "Dreamina",
    volcengine: "Volcengine",
    elevenlabs: "ElevenLabs",
  };
  if (names[account.providerId]) return names[account.providerId];
  return account.upstreamId && account.upstreamId !== account.providerId
    ? `${account.providerId}/${account.upstreamId}`
    : account.providerId;
}

function configuredCredentialKeys(account: Pick<LocalProviderAccountConfig, "credentials">): Set<string> {
  return new Set(
    Object.entries(account.credentials ?? {})
      .filter(([, value]) => typeof value === "string" && value.trim().length > 0)
      .map(([key]) => key),
  );
}

function routeProviderId(route: ModelUpstreamRoute): string {
  if (route.providerId) return route.providerId;
  if (route.upstreamId === "local") return "local";
  if (
    route.upstreamId === "openai" ||
    route.upstreamId === "google-ai-studio" ||
    route.upstreamId === "google-agent-platform" ||
    route.upstreamId === "anthropic"
  ) {
    return "official";
  }
  if (route.upstreamId === "fal" || route.upstreamId === "kie" || route.upstreamId === "replicate" || route.upstreamId === "mock") {
    return route.upstreamId;
  }
  return "custom";
}

function modelRoutesForProviderAccount(
  account: Pick<LocalProviderAccountConfig, "providerId" | "upstreamId" | "region">,
  modelId: string,
): ModelUpstreamRoute[] {
  return MODEL_UPSTREAM_ROUTES.filter((route) =>
    route.modelCode === modelId &&
    routeProviderId(route) === account.providerId &&
    (!account.upstreamId || route.upstreamId === account.upstreamId) &&
    (route.region ?? "") === (account.region ?? "")
  );
}

function providerTestStubForAccount(
  account: Pick<LocalProviderAccountConfig, "providerId" | "upstreamId" | "region">,
  modelId: string,
  route?: ModelUpstreamRoute,
): ProviderConformanceStub | undefined {
  return createProviderConformanceStubs({ includeMock: account.providerId === "mock" }).find((stub) =>
    stub.providerId === account.providerId &&
    (!account.upstreamId || stub.upstreamId === account.upstreamId) &&
    (stub.region ?? "") === (account.region ?? "") &&
    stub.modelId === modelId &&
    (!route || stub.apiShape === route.apiShape)
  );
}

export function createLocalApiApp(options: LocalApiOptions): Hono {
  const userId = options.userId ?? "local-user";
  const db = createDb(options.dataDir);
  const localApiDataDir = resolve(options.dataDir);
  const clashRoot = inferClashRoot(options.dataDir, options.clashRoot);
  const replicaStore = new FileReplicaStore(join(options.dataDir, "projects"));
  const sessionMessageStore = createLocalSessionMessageStore(db);
  options.localAcp?.setSessionMessageStore?.(sessionMessageStore);
  const falMock = options.falMock ?? createMockFalQueueService();
  const providerTestAigc = createMockExternalAigcService({
    fal: falMock,
    origin: "http://local-provider-test",
  });
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
  app.get("/api/v1/model-providers", async (c) => {
    const state = await db.load();
    return c.json(publicModelProvidersResponse(
      publicProviderAccounts(state.providerAccounts, userId, state.providerOAuth),
    ));
  });
  app.patch("/api/v1/model-providers", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { providers?: unknown } & ProjectWriteBody;
    const incoming = Array.isArray(body.providers)
      ? body.providers.map(normalizeProviderAccountInput)
      : [];
    if (incoming.length === 0 || incoming.some((provider) => !provider)) {
      return c.json({
        error: "Invalid providers",
        mutation: hostMutationRejected({
          operation: "provider_accounts_update",
          entity: { kind: "provider-accounts", id: userId },
          forced: false,
        }, "Invalid providers"),
      }, 400);
    }
    const invalidProviders = invalidProviderModelFilters(incoming.filter((provider) => !!provider));
    if (invalidProviders.length > 0) {
      return c.json({
        error: "Invalid provider model filters",
        invalidProviders,
        mutation: hostMutationRejected({
          operation: "provider_accounts_update",
          entity: { kind: "provider-accounts", id: userId },
          forced: false,
        }, "Invalid provider model filters"),
      }, 400);
    }
    const envelope = {
      operation: "provider_accounts_update",
      entity: { kind: "provider-accounts", id: userId },
      forced: false,
    };
    const preconditions = requestProjectWritePreconditions(c, body);
    const needsReadProof =
      !!preconditions.actorClientType || !!preconditions.expectedReadToken || preconditions.force;
    const beforeState = needsReadProof ? await db.load() : null;
    const beforeProviders = beforeState
      ? publicProviderAccounts(beforeState.providerAccounts, userId, beforeState.providerOAuth)
      : [];
    const hostMutation = needsReadProof
      ? validateProviderAccountsReadMutation({ userId, accounts: beforeProviders, preconditions })
      : null;
    if (hostMutation && !hostMutation.ok) {
      return c.json({
        error: hostMutation.error,
        mutation: hostMutation.mutation,
      }, 409);
    }
    const providers = await db.update((state) => {
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
      return publicProviderAccounts(state.providerAccounts, userId, state.providerOAuth);
    });
    const response = publicModelProvidersResponse(providers);
    return c.json({
      ...response,
      mutation: hostMutationSucceeded(hostMutation?.envelope ?? envelope, {
        resultEntityId: userId,
        ...(hostMutation ? { afterReadToken: response.readToken } : {}),
      }),
    });
  });
  app.delete("/api/v1/model-providers/:accountId", async (c) => {
    const accountId = stringBodyField(c.req.param("accountId"));
    if (!accountId) {
      return c.json({
        error: "Provider account not found",
        mutation: hostMutationRejected({
          operation: "provider_account_delete",
          entity: { kind: "provider-account", id: "" },
          forced: false,
        }, "Provider account not found"),
      }, 404);
    }
    const preconditions = requestProjectWritePreconditions(c);
    const beforeState = await db.load();
    const beforeProviders = publicProviderAccounts(beforeState.providerAccounts, userId, beforeState.providerOAuth);
    const beforeAccount = beforeProviders.find((account) => account.id === accountId);
    if (!beforeAccount) {
      return c.json({
        error: "Provider account not found",
        mutation: hostMutationRejected({
          operation: "provider_account_delete",
          entity: { kind: "provider-account", id: accountId },
          forced: false,
        }, "Provider account not found"),
      }, 404);
    }
    const needsReadProof =
      !!preconditions.actorClientType || !!preconditions.expectedReadToken || preconditions.force;
    const hostMutation = needsReadProof
      ? validateProviderAccountReadMutation({ account: beforeAccount, operation: "delete", preconditions })
      : null;
    if (hostMutation && !hostMutation.ok) {
      return c.json({
        error: hostMutation.error,
        mutation: hostMutation.mutation,
      }, 409);
    }
    const deleted = await db.update((state) => {
      const beforeAccounts = state.providerAccounts.length;
      const beforeOAuth = state.providerOAuth.length;
      state.providerAccounts = state.providerAccounts.filter((account) =>
        !((account.userId ?? userId) === userId && account.id === accountId)
      );
      state.providerOAuth = state.providerOAuth.filter((record) =>
        !((record.userId ?? userId) === userId && record.accountId === accountId)
      );
      return state.providerAccounts.length !== beforeAccounts || state.providerOAuth.length !== beforeOAuth;
    });
    if (!deleted) {
      return c.json({
        error: "Provider account not found",
        mutation: hostMutationRejected({
          operation: "provider_account_delete",
          entity: { kind: "provider-account", id: accountId },
          forced: false,
        }, "Provider account not found"),
      }, 404);
    }
    const mutation = hostMutationSucceeded(hostMutation?.envelope ?? {
      operation: "provider_account_delete",
      entity: { kind: "provider-account", id: accountId },
      forced: false,
    }, {
      resultEntityId: accountId,
    });
    await db.appendMutationAudit(mutationAuditRecord({
      mutation,
      actorClientType: preconditions.actorClientType,
      reason: "provider account delete",
    }));
    return c.json({
      ok: true,
      mutation,
    });
  });
  app.post("/api/v1/model-providers/test", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { provider?: unknown; modelId?: unknown; live?: unknown };
    const provider = normalizeProviderAccountInput(body.provider);
    const rawProvider = body.provider && typeof body.provider === "object"
      ? body.provider as Record<string, unknown>
      : {};
    const rawModelId = typeof body.modelId === "string" && body.modelId.trim() ? body.modelId.trim() : "";
    const modelId = normalizeModelId(rawModelId) ?? rawModelId;
    if (!provider || !modelId) {
      const message = "provider and modelId are required";
      const envelope = localMutationEnvelope("provider_model_test", "provider-test", "unknown");
      return c.json({
        error: message,
        mutation: hostMutationRejected(envelope, message),
      }, 400);
    }

    const state = await db.load();
    const stored = state.providerAccounts.find((account) =>
      account.userId === userId && providerAccountKey(account) === providerAccountKey(provider)
    );
    const enabled = rawProvider.enabled === false ? false : stored?.enabled ?? provider.enabled;
    const account: LocalProviderAccountConfig = {
      ...provider,
      ...stored,
      enabled,
      credentials: {
        ...(stored?.credentials ?? {}),
        ...(provider.credentials ?? {}),
      },
      userId,
    };
    const providerSupports = listProviderModelSupport({ includeMock: account.providerId === "mock" });
    const support = providerSupports.find((row) =>
      row.providerId === account.providerId &&
      (!account.upstreamId || row.upstreamId === account.upstreamId) &&
      (row.region ?? "") === (account.region ?? "")
    );
    const modelName = displayModelName(modelId);
    const live = body.live === true;
    const baseResult = {
      providerId: account.providerId,
      ...(account.upstreamId ? { upstreamId: account.upstreamId } : {}),
      ...(account.region ? { region: account.region } : {}),
      modelId,
    };
    const envelope = localMutationEnvelope(
      "provider_model_test",
      "provider-test",
      `${account.providerId}:${modelId}`,
    );
    const providerTestResponse = (result: ModelProviderTestResult) => c.json({
      ...result,
      mutation: hostMutationSucceeded(envelope, { resultEntityId: envelope.entity.id }),
    });
    if (account.enabled === false) {
      return providerTestResponse({
        ok: false,
        ...baseResult,
        disabled: true,
        message: `${displayProviderName(account)} is disabled for ${modelName}.`,
      } satisfies ModelProviderTestResult);
    }
    const supportedModelEntries = support?.models.filter((model) => model.id === modelId) ?? [];
    if (!support || supportedModelEntries.length === 0) {
      return providerTestResponse({
        ok: false,
        ...baseResult,
        unsupported: true,
        message: `${displayProviderName(account)} does not support ${modelName}.`,
      } satisfies ModelProviderTestResult);
    }
    if (
      account.supportedModelIds?.length &&
      !account.supportedModelIds.map((id) => normalizeModelId(id) ?? id.trim()).includes(modelId)
    ) {
      return providerTestResponse({
        ok: false,
        ...baseResult,
        unsupported: true,
        message: `${displayProviderName(account)} is not enabled for ${modelName}.`,
      } satisfies ModelProviderTestResult);
    }

    const credentialKeys = configuredCredentialKeys(account);
    const routeRequirements = modelRoutesForProviderAccount(account, modelId);
    const requirementCandidates = routeRequirements.length > 0
      ? routeRequirements.map((route) => ({
        requiredCredentials: route.requiredCredentials ?? [],
        requiredOAuth: route.requiredOAuth ?? [],
      }))
      : supportedModelEntries.map((model) => ({
        requiredCredentials: "requiredCredentials" in model ? model.requiredCredentials : support.requiredCredentials,
        requiredOAuth: "requiredOAuth" in model ? model.requiredOAuth : support.requiredOAuth,
      }));
    const credentialChecks = requirementCandidates.map((candidate) => ({
      candidate,
      missingCredentials: candidate.requiredCredentials.filter((credential) => !credentialKeys.has(credential)),
    }));
    const credentialReadyChecks = credentialChecks.filter((check) => check.missingCredentials.length === 0);
    if (credentialReadyChecks.length === 0) {
      const bestCredentialCheck = [...credentialChecks].sort((a, b) =>
        a.missingCredentials.length - b.missingCredentials.length
      )[0];
      return providerTestResponse({
        ok: false,
        ...baseResult,
        missingCredentials: bestCredentialCheck?.missingCredentials ?? [],
        message: `${displayProviderName(account)} is missing required credentials for ${modelName}.`,
      } satisfies ModelProviderTestResult);
    }

    const testedAccount = publicProviderAccounts([account], userId, state.providerOAuth)
      .find((candidate) => providerAccountKey(candidate) === providerAccountKey(account));
    const availableOAuth = new Set(testedAccount?.availableOAuth ?? []);
    const oauthChecks = credentialReadyChecks.map((check) => ({
      ...check,
      missingOAuth: check.candidate.requiredOAuth.filter((providerId) => !availableOAuth.has(providerId)),
    }));
    const oauthReadyCheck = oauthChecks.find((check) => check.missingOAuth.length === 0);
    if (!oauthReadyCheck) {
      const bestOAuthCheck = [...oauthChecks].sort((a, b) => a.missingOAuth.length - b.missingOAuth.length)[0];
      return providerTestResponse({
        ok: false,
        ...baseResult,
        missingOAuth: bestOAuthCheck?.missingOAuth ?? [],
        message: `${displayProviderName(account)} needs authorization before testing ${modelName}.`,
      } satisfies ModelProviderTestResult);
    }

    if (account.providerId === "mock" || live) {
      const model = [...MODEL_CARDS, ...MOCK_MODEL_CARDS].find((candidate) => candidate.id === modelId);
      const taskId = `provider-test-${modelId}`;
      const prompt = `Provider test for ${modelName}`;
      const shape = model?.kind ?? supportedModelEntries[0]?.kind ?? "image";
      if (shape === "asr") {
        return providerTestResponse({
          ok: false,
          ...baseResult,
          unsupported: true,
          message: `${displayProviderName(account)} live tests do not support ASR models yet.`,
        } satisfies ModelProviderTestResult);
      }
      const testInput = providerTestInputSummary({
        shape,
        model: modelId,
        prompt,
        ...(shape === "image" || shape === "video" ? { aspectRatio: "16:9" } : {}),
        ...(shape === "video" || shape === "audio" ? { duration: shape === "video" ? 4 : 5 } : {}),
      });
      const readyRoute = routeRequirements.find((route) =>
        (route.requiredCredentials ?? []).every((credential) => credentialKeys.has(credential)) &&
        (route.requiredOAuth ?? []).every((providerId) => availableOAuth.has(providerId))
      );
      const recorder = options.providerTestRecordingPath
        ? await createJsonlProviderTestRecorder(options.providerTestRecordingPath)
        : undefined;
      const recordingStub = recorder
        ? providerTestStubForAccount(account, modelId, readyRoute)
        : undefined;
      const liveFetch = recorder && recordingStub
        ? createProviderTestRecordingFetch({
          fetch: options.providerTestFetch ?? fetch,
          recorder,
          stub: recordingStub,
        })
        : options.providerTestFetch ?? fetch;
      const testAigc = account.providerId === "mock"
        ? providerTestAigc
        : createMockExternalAigcService({
          fal: falMock,
          origin: "http://local-provider-test",
          providerAccounts: async () => [{
            ...account,
            configuredCredentials: [...credentialKeys],
            availableOAuth: [...availableOAuth],
            weight: account.weight ?? 10_000,
          }],
          fetch: liveFetch,
          openAiBaseUrl: options.providerTestOpenAiBaseUrl ?? process.env.OPENAI_BASE_URL,
          anthropicBaseUrl: options.providerTestAnthropicBaseUrl ?? process.env.ANTHROPIC_BASE_URL,
          falQueueBaseUrl: options.providerTestFalQueueBaseUrl ?? process.env.CLASH_FAL_QUEUE_URL,
          googleAiStudioBaseUrl: options.providerTestGoogleAiStudioBaseUrl,
          kieBaseUrl: options.providerTestKieBaseUrl,
          replicateBaseUrl: options.providerTestReplicateBaseUrl,
        });
      const providerName = displayProviderName(account);
      try {
        if (shape === "text") {
          const result = await testAigc.generateText({ taskId, prompt, model: modelId });
          const output: ModelProviderTestOutputSummary = {
            shape: "text",
            ...(result.provider ? { provider: result.provider } : {}),
            ...(result.modelEndpoint ? { endpoint: result.modelEndpoint } : {}),
            text: result.text,
          };
          return providerTestResponse({
            ok: true,
            ...baseResult,
            ...(result.provider ? { provider: result.provider } : {}),
            ...(result.modelEndpoint ? { modelEndpoint: result.modelEndpoint } : {}),
            input: testInput,
            output,
            message: result.modelEndpoint
              ? `${providerName} ran ${modelName} through ${result.modelEndpoint}.`
              : `${providerName} ran ${modelName}.`,
          } satisfies ModelProviderTestResult);
        }

        const mediaShape = shape === "video" || shape === "audio" ? shape : "image";
        const result = mediaShape === "video"
          ? await testAigc.generateVideo({ taskId, prompt, model: modelId, aspectRatio: testInput.aspectRatio, duration: testInput.duration })
          : mediaShape === "audio"
            ? await testAigc.generateAudio({ taskId, prompt, model: modelId, duration: testInput.duration })
            : await testAigc.generateImage({ taskId, prompt, model: modelId, aspectRatio: testInput.aspectRatio });
        const output = providerTestMediaOutput(mediaShape, result);
        return providerTestResponse({
          ok: true,
          ...baseResult,
          ...(result.provider ? { provider: result.provider } : {}),
          ...("requestId" in result && result.requestId ? { requestId: result.requestId } : {}),
          ...(result.modelEndpoint ? { modelEndpoint: result.modelEndpoint } : {}),
          input: testInput,
          output,
          message: result.modelEndpoint
            ? `${providerName} ran ${modelName} through ${result.modelEndpoint}.`
            : `${providerName} ran ${modelName}.`,
        } satisfies ModelProviderTestResult);
      } catch (err) {
        return providerTestResponse({
          ok: false,
          ...baseResult,
          message: `${providerName} test failed for ${modelName}: ${err instanceof Error ? err.message : String(err)}`,
        } satisfies ModelProviderTestResult);
      }
    }

    const providerName = displayProviderName(account);
    return providerTestResponse({
      ok: true,
      ...baseResult,
      message: `${providerName} configuration is ready for ${modelName}.`,
    } satisfies ModelProviderTestResult);
  });
  app.get("/api/v1/provider-oauth", async (c) => {
    const state = await db.load();
    return c.json({
      providers: state.providerOAuth
        .filter((record) => record.userId === userId)
        .sort((a, b) => (
          a.providerId.localeCompare(b.providerId) ||
          (a.accountId ?? "").localeCompare(b.accountId ?? "")
        ))
        .map(publicProviderOAuthWithReadReceipt),
    });
  });
  app.post("/api/v1/provider-oauth/:providerId/start", async (c) => {
    const rawProviderId = c.req.param("providerId");
    const providerId = parseProviderOAuthId(rawProviderId);
    if (!providerId) {
      return c.json({
        error: "Unsupported OAuth provider",
        mutation: hostMutationRejected({
          operation: "provider_oauth_start",
          entity: { kind: "provider-oauth", id: providerOAuthEntityId(rawProviderId) },
          forced: false,
        }, "Unsupported OAuth provider"),
      }, 404);
    }
    const driver = options.providerOAuth?.[providerId];
    if (!driver) {
      return c.json({
        error: "OAuth provider is not configured",
        mutation: hostMutationRejected({
          operation: "provider_oauth_start",
          entity: { kind: "provider-oauth", id: providerOAuthEntityId(providerId) },
          forced: false,
        }, "OAuth provider is not configured"),
      }, 501);
    }
    const body = (await c.req.json().catch(() => ({}))) as {
      accountId?: unknown;
      accountLabel?: unknown;
    } & ProjectWriteBody;
    const accountId = stringBodyField(body.accountId);
    const accountLabel = stringBodyField(body.accountLabel);
    const preconditions = requestProjectWritePreconditions(c, body);
    const beforeState = await db.load();
    const beforeRecord = beforeState.providerOAuth.find((record) =>
      providerOAuthMatches(record, userId, providerId, accountId)
    );
    const needsReadProof =
      !!preconditions.actorClientType || !!preconditions.expectedReadToken || preconditions.force;
    const hostMutation = beforeRecord && needsReadProof
      ? validateProviderOAuthReadMutation({ record: beforeRecord, operation: "start", preconditions })
      : null;
    if (hostMutation && !hostMutation.ok) {
      return c.json({
        error: hostMutation.error,
        mutation: hostMutation.mutation,
      }, 409);
    }
    if (!beforeRecord && preconditions.expectedReadToken && !preconditions.force) {
      const message =
        "Provider OAuth record not found. Read /api/v1/provider-oauth first and pass the provider OAuth record's `readToken` with --if-match, " +
        "or pass --force for an explicit overwrite.";
      return c.json({
        error: message,
        mutation: hostMutationRejected({
          operation: "provider_oauth_start",
          entity: { kind: "provider-oauth", id: providerOAuthEntityId(providerId, accountId) },
          expectedReadToken: preconditions.expectedReadToken,
          forced: preconditions.force,
        }, message),
      }, 409);
    }
    const started = await driver.start();
    const record = await db.update((state) => {
      return upsertProviderOAuth(state, userId, providerId, {
        ...(accountId ? { accountId } : {}),
        status: "pending",
        verificationUri: started.verificationUri,
        userCode: started.userCode,
        deviceCode: started.deviceCode,
        expiresAt: started.expiresAt,
        intervalSeconds: started.intervalSeconds,
        accessToken: undefined,
        refreshToken: undefined,
        tokenType: undefined,
        accountLabel,
        error: undefined,
      });
    });
    return c.json({
      ...publicProviderOAuth(record),
      ...(hostMutation ? { readToken: providerOAuthReceiptReadToken(record) } : {}),
      mutation: hostMutationSucceeded(hostMutation?.envelope ?? {
        operation: "provider_oauth_start",
        entity: { kind: "provider-oauth", id: providerOAuthEntityId(providerId, accountId) },
        forced: preconditions.force,
      }, {
        resultEntityId: providerOAuthEntityId(providerId, accountId),
        ...(hostMutation ? { afterReadToken: providerOAuthReceiptReadToken(record) } : {}),
      }),
    });
  });
  app.post("/api/v1/provider-oauth/:providerId/complete", async (c) => {
    const rawProviderId = c.req.param("providerId");
    const providerId = parseProviderOAuthId(rawProviderId);
    if (!providerId) {
      return c.json({
        error: "Unsupported OAuth provider",
        mutation: hostMutationRejected({
          operation: "provider_oauth_complete",
          entity: { kind: "provider-oauth", id: providerOAuthEntityId(rawProviderId) },
          forced: false,
        }, "Unsupported OAuth provider"),
      }, 404);
    }
    const driver = options.providerOAuth?.[providerId];
    if (!driver) {
      return c.json({
        error: "OAuth provider is not configured",
        mutation: hostMutationRejected({
          operation: "provider_oauth_complete",
          entity: { kind: "provider-oauth", id: providerOAuthEntityId(providerId) },
          forced: false,
        }, "OAuth provider is not configured"),
      }, 501);
    }
    const body = (await c.req.json().catch(() => ({}))) as {
      accountId?: unknown;
      deviceCode?: unknown;
    } & ProjectWriteBody;
    const accountId = stringBodyField(body.accountId);
    const preconditions = requestProjectWritePreconditions(c, body);
    const initialState = await db.load();
    const existing = initialState.providerOAuth.find((record) => providerOAuthMatches(record, userId, providerId, accountId));
    const needsReadProof =
      !!preconditions.actorClientType || !!preconditions.expectedReadToken || preconditions.force;
    const hostMutation = existing && needsReadProof
      ? validateProviderOAuthReadMutation({
        record: existing,
        operation: "complete",
        preconditions,
      })
      : null;
    if (hostMutation && !hostMutation.ok) {
      return c.json({
        error: hostMutation.error,
        mutation: hostMutation.mutation,
      }, 409);
    }
    if (!existing && needsReadProof && !preconditions.force) {
      const message =
        "Provider OAuth record not found. Read /api/v1/provider-oauth first and pass the provider OAuth record's `readToken` with --if-match, " +
        "or pass --force for an explicit overwrite.";
      return c.json({
        error: message,
        mutation: hostMutationRejected({
          operation: "provider_oauth_complete",
          entity: { kind: "provider-oauth", id: providerOAuthEntityId(providerId, accountId) },
          expectedReadToken: preconditions.expectedReadToken,
          forced: preconditions.force,
        }, message),
      }, 409);
    }
    const deviceCode = typeof body.deviceCode === "string" && body.deviceCode.trim()
      ? body.deviceCode.trim()
      : existing?.deviceCode;
    if (!deviceCode) {
      return c.json({
        error: "deviceCode is required",
        mutation: hostMutationRejected({
          operation: "provider_oauth_complete",
          entity: { kind: "provider-oauth", id: providerOAuthEntityId(providerId, accountId) },
          forced: false,
        }, "deviceCode is required"),
      }, 400);
    }
    let completed: ProviderOAuthTokenResult;
    try {
      completed = await driver.complete({ deviceCode });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const record = await db.update((state) => {
        return upsertProviderOAuth(state, userId, providerId, {
          ...(accountId ? { accountId } : {}),
          status: "error",
          accessToken: undefined,
          refreshToken: undefined,
          tokenType: undefined,
          error: message,
        });
      });
      return c.json({
        error: message,
        mutation: hostMutationSucceeded(hostMutation?.envelope ?? {
          operation: "provider_oauth_complete",
          entity: { kind: "provider-oauth", id: providerOAuthEntityId(providerId, accountId) },
          forced: preconditions.force,
        }, {
          resultEntityId: providerOAuthEntityId(providerId, accountId),
          ...(hostMutation ? { afterReadToken: providerOAuthReceiptReadToken(record) } : {}),
        }),
      }, 502);
    }
    const record = await db.update((state) => {
      return upsertProviderOAuth(state, userId, providerId, {
        ...(accountId ? { accountId } : {}),
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
    });
    return c.json({
      ...publicProviderOAuth(record),
      ...(hostMutation ? { readToken: providerOAuthReceiptReadToken(record) } : {}),
      mutation: hostMutationSucceeded(hostMutation?.envelope ?? {
        operation: "provider_oauth_complete",
        entity: { kind: "provider-oauth", id: providerOAuthEntityId(providerId, accountId) },
        forced: preconditions.force,
      }, {
        resultEntityId: providerOAuthEntityId(providerId, accountId),
        ...(hostMutation ? { afterReadToken: providerOAuthReceiptReadToken(record) } : {}),
      }),
    });
  });
  app.delete("/api/v1/provider-oauth/:providerId", async (c) => {
    const rawProviderId = c.req.param("providerId");
    const providerId = parseProviderOAuthId(rawProviderId);
    if (!providerId) {
      return c.json({
        error: "Unsupported OAuth provider",
        mutation: hostMutationRejected({
          operation: "provider_oauth_delete",
          entity: { kind: "provider-oauth", id: providerOAuthEntityId(rawProviderId) },
          forced: false,
        }, "Unsupported OAuth provider"),
      }, 404);
    }
    const accountId = stringBodyField(c.req.query("accountId"));
    const preconditions = requestProjectWritePreconditions(c);
    const beforeState = await db.load();
    const beforeRecord = beforeState.providerOAuth.find((record) =>
      providerOAuthMatches(record, userId, providerId, accountId)
    );
    const needsReadProof =
      !!preconditions.actorClientType || !!preconditions.expectedReadToken || preconditions.force;
    const hostMutation = beforeRecord && needsReadProof
      ? validateProviderOAuthReadMutation({ record: beforeRecord, operation: "delete", preconditions })
      : null;
    if (hostMutation && !hostMutation.ok) {
      return c.json({
        error: hostMutation.error,
        mutation: hostMutation.mutation,
      }, 409);
    }
    if (!beforeRecord && needsReadProof && !preconditions.force) {
      const message =
        "Provider OAuth record not found. Read /api/v1/provider-oauth first and pass the provider OAuth record's `readToken` with --if-match, " +
        "or pass --force for an explicit overwrite.";
      return c.json({
        error: message,
        mutation: hostMutationRejected({
          operation: "provider_oauth_delete",
          entity: { kind: "provider-oauth", id: providerOAuthEntityId(providerId, accountId) },
          expectedReadToken: preconditions.expectedReadToken,
          forced: preconditions.force,
        }, message),
      }, 409);
    }
    await db.update((state) => {
      state.providerOAuth = state.providerOAuth.filter((record) => !providerOAuthMatches(record, userId, providerId, accountId));
    });
    const mutation = hostMutationSucceeded(hostMutation?.envelope ?? {
      operation: "provider_oauth_delete",
      entity: { kind: "provider-oauth", id: providerOAuthEntityId(providerId, accountId) },
      forced: false,
    }, {
      resultEntityId: providerOAuthEntityId(providerId, accountId),
    });
    await db.appendMutationAudit(mutationAuditRecord({
      mutation,
      actorClientType: preconditions.actorClientType,
      reason: "provider OAuth delete",
    }));
    return c.json({
      ok: true,
      mutation,
    });
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
  app.get("/api/v1/local/sync", async (c) => c.json(publicLocalSyncConfig(await localSyncReadState(syncConfig))));
  app.patch("/api/v1/local/sync", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const envelope = {
      operation: "local_sync_config_update",
      entity: { kind: "local-config", id: "sync" },
      forced: false,
    };
    const preconditions = requestProjectWritePreconditions(c, body);
    const beforeReadState = await localSyncReadState(syncConfig);
    const needsReadProof =
      !!preconditions.actorClientType || !!preconditions.expectedReadToken || preconditions.force;
    const hostMutation = needsReadProof
      ? validateLocalSyncConfigMutation({ readState: beforeReadState, preconditions })
      : null;
    if (hostMutation && !hostMutation.ok) {
      return c.json({
        error: hostMutation.error,
        mutation: hostMutation.mutation,
      }, 409);
    }
    try {
      await syncConfig.updateFromRequest(body);
      const readState = await localSyncReadState(syncConfig);
      return c.json({
        ...publicLocalSyncConfig(readState),
        mutation: hostMutationSucceeded(hostMutation?.envelope ?? envelope, {
          resultEntityId: "sync",
          ...(hostMutation
            ? {
                afterReadToken: localConfigReceiptReadToken({
                  id: "sync",
                  config: localSyncConfigReadProjection(readState),
                  updatedAt: readState.updated_at,
                }),
              }
            : {}),
        }),
      });
    } catch (error) {
      if (error instanceof LocalSyncConfigError) {
        return c.json({
          error: error.message,
          mutation: hostMutationRejected(hostMutation?.envelope ?? envelope, error.message),
        }, error.status as 400);
      }
      throw error;
    }
  });
  app.get("/api/v1/local/audio", async (c) => c.json(publicLocalAudioConfig(await localAudioReadState(audioConfig))));
  app.patch("/api/v1/local/audio", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const envelope = {
      operation: "local_audio_config_update",
      entity: { kind: "local-config", id: "audio" },
      forced: false,
    };
    const preconditions = requestProjectWritePreconditions(c, body);
    const beforeReadState = await localAudioReadState(audioConfig);
    const needsReadProof =
      !!preconditions.actorClientType || !!preconditions.expectedReadToken || preconditions.force;
    const hostMutation = needsReadProof
      ? validateLocalAudioConfigMutation({ readState: beforeReadState, preconditions })
      : null;
    if (hostMutation && !hostMutation.ok) {
      return c.json({
        error: hostMutation.error,
        mutation: hostMutation.mutation,
      }, 409);
    }
    try {
      await audioConfig.updateFromRequest(body);
      const readState = await localAudioReadState(audioConfig);
      return c.json({
        ...publicLocalAudioConfig(readState),
        mutation: hostMutationSucceeded(hostMutation?.envelope ?? envelope, {
          resultEntityId: "audio",
          ...(hostMutation
	            ? {
	                afterReadToken: localAudioReceiptReadToken(readState),
	              }
	            : {}),
        }),
      });
    } catch (error) {
      if (error instanceof LocalAudioConfigError) {
        return c.json({
          error: error.message,
          mutation: hostMutationRejected(hostMutation?.envelope ?? envelope, error.message),
        }, error.status as 400);
      }
      throw error;
    }
  });
  app.post("/api/v1/local/audio/install", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown> & ProjectWriteBody;
    const envelope = {
      operation: "local_audio_model_install",
      entity: { kind: "local-config", id: "audio" },
      forced: false,
    };
    const preconditions = requestProjectWritePreconditions(c, body);
    const beforeReadState = await localAudioReadState(audioConfig);
    const needsReadProof =
      !!preconditions.actorClientType || !!preconditions.expectedReadToken || preconditions.force;
    const hostMutation = needsReadProof
      ? validateLocalAudioInstallMutation({ readState: beforeReadState, preconditions })
      : null;
    if (hostMutation && !hostMutation.ok) {
      return c.json({
        error: hostMutation.error,
        mutation: hostMutation.mutation,
      }, 409);
    }
    try {
      await audioConfig.installBuiltin({ model: body.asr_model });
      const readState = await localAudioReadState(audioConfig);
      const readToken = localAudioReceiptReadToken(readState);
      return c.json({
        ...publicLocalAudioConfig(readState),
        mutation: hostMutationSucceeded(hostMutation?.envelope ?? envelope, {
          resultEntityId: "audio",
          ...(hostMutation ? { afterReadToken: readToken } : {}),
        }),
      });
    } catch (error) {
      if (error instanceof LocalAudioConfigError) {
        return c.json({
          error: error.message,
          mutation: hostMutationRejected(hostMutation?.envelope ?? envelope, error.message),
        }, error.status as 400);
      }
      throw error;
    }
  });
  app.post("/api/v1/local/audio/transcriptions", async (c) => {
    const envelope = localMutationEnvelope("local_audio_transcription", "local-action", "audio-transcription");
    const form = await c.req.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") {
      return c.json({
        error: "Missing file",
        mutation: hostMutationRejected(envelope, "Missing file"),
      }, 400);
    }
    const language = form.get("language");
    try {
      const result = await audioConfig.transcribe({
        file,
        language: typeof language === "string" ? language : null,
      });
      return c.json({
        ...result,
        mutation: hostMutationSucceeded(envelope, { resultEntityId: "audio-transcription" }),
      });
    } catch (error) {
      if (error instanceof LocalAudioConfigError) {
        return c.json({
          error: error.message,
          mutation: hostMutationRejected(envelope, error.message),
        }, error.status as 400);
      }
      throw error;
    }
  });
  app.get("/api/v1/agents", async (c) => {
    const agentMembers = localAgentMembersForRead(await db.load(), userId);

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
    if (!options.localAcp?.listHarnesses) {
      const result = { harnesses: [] };
      return c.json({ ...result, readToken: localHarnessesReceiptReadToken(result) });
    }
    const rawProbe = c.req.query("probe");
    const probe = rawProbe === "1" || rawProbe === "true"
      ? "auth"
      : rawProbe === "auth" || rawProbe === "config" || rawProbe === "none"
        ? rawProbe
        : false;
    const refresh = c.req.query("refresh") === "1" || c.req.query("refresh") === "true";
    const result = await options.localAcp.listHarnesses({ probe, refresh });
    return c.json({ ...result, readToken: localHarnessesReceiptReadToken(result) });
  });

  app.put("/api/v1/local/harnesses", async (c) => {
    const envelope = localMutationEnvelope("local_harness_enablement_update", "local-harness-config", "enabled");
    if (!options.localAcp?.updateHarnesses) {
      return c.json({
        error: "Local harness settings unavailable",
        mutation: hostMutationRejected(envelope, "Local harness settings unavailable"),
      }, 404);
    }
    const body = (await c.req.json().catch(() => ({}))) as {
      enabled_harness_ids?: unknown;
      enabledHarnessIds?: unknown;
    } & ProjectWriteBody;
    const preconditions = requestProjectWritePreconditions(c, body);
    const needsReadProof =
      !!preconditions.actorClientType || !!preconditions.expectedReadToken || preconditions.force;
    const beforeResult = needsReadProof && options.localAcp.listHarnesses
      ? await options.localAcp.listHarnesses()
      : { harnesses: [] };
    const hostMutation = needsReadProof
      ? validateLocalHarnessesConfigMutation({ result: beforeResult, preconditions })
      : null;
    if (hostMutation && !hostMutation.ok) {
      return c.json({
        error: hostMutation.error,
        mutation: hostMutation.mutation,
      }, 409);
    }
    const rawIds = Array.isArray(body.enabled_harness_ids)
      ? body.enabled_harness_ids
      : Array.isArray(body.enabledHarnessIds)
        ? body.enabledHarnessIds
        : [];
    const enabledIds = rawIds.filter((id): id is string => typeof id === "string");
    try {
      const result = await options.localAcp.updateHarnesses(enabledIds);
      return c.json({
        ...result,
        readToken: localHarnessesReceiptReadToken(result),
        mutation: hostMutationSucceeded(hostMutation?.envelope ?? envelope, {
          resultEntityId: "enabled",
          ...(hostMutation ? { afterReadToken: localHarnessesReceiptReadToken(result) } : {}),
        }),
      });
    } catch (error) {
      const message = errorMessage(error);
      return c.json({
        error: message,
        mutation: hostMutationRejected(hostMutation?.envelope ?? envelope, message),
      }, 400);
    }
  });

  app.get("/api/v1/local/agent-servers", async (c) => {
    if (!options.localAcp?.listAgentServers) {
      const result = { agent_servers: {} };
      return c.json({ ...result, readToken: localAgentServersReceiptReadToken(result) });
    }
    const result = await options.localAcp.listAgentServers();
    return c.json({ ...result, readToken: localAgentServersReceiptReadToken(result) });
  });

  app.put("/api/v1/local/agent-servers", async (c) => {
    const envelope = localMutationEnvelope("local_agent_servers_update", "local-harness-config", "agent-servers");
    if (!options.localAcp?.updateAgentServers) {
      return c.json({
        error: "Custom agent server settings unavailable",
        mutation: hostMutationRejected(envelope, "Custom agent server settings unavailable"),
      }, 404);
    }
    const body = (await c.req.json().catch(() => ({}))) as {
      agent_servers?: unknown;
      agentServers?: unknown;
    } & ProjectWriteBody;
    const rawServers = body.agent_servers ?? body.agentServers ?? {};
    const preconditions = requestProjectWritePreconditions(c, body);
    const needsReadProof =
      !!preconditions.actorClientType || !!preconditions.expectedReadToken || preconditions.force;
    const beforeResult = needsReadProof && options.localAcp.listAgentServers
      ? await options.localAcp.listAgentServers()
      : { agent_servers: {} };
    const hostMutation = needsReadProof
      ? validateLocalAgentServersConfigMutation({ result: beforeResult, preconditions })
      : null;
    if (hostMutation && !hostMutation.ok) {
      return c.json({
        error: hostMutation.error,
        mutation: hostMutation.mutation,
      }, 409);
    }
    try {
      const result = await options.localAcp.updateAgentServers(rawServers as LocalAcpAgentServersConfig);
      return c.json({
        ...result,
        readToken: localAgentServersReceiptReadToken(result),
        mutation: hostMutationSucceeded(hostMutation?.envelope ?? envelope, {
          resultEntityId: "agent-servers",
          ...(hostMutation ? { afterReadToken: localAgentServersReceiptReadToken(result) } : {}),
        }),
      });
    } catch (error) {
      const message = errorMessage(error);
      return c.json({
        error: message,
        mutation: hostMutationRejected(hostMutation?.envelope ?? envelope, message),
      }, 400);
    }
  });

  app.post("/api/v1/local/harnesses/:harnessId/install", async (c) => {
    const harnessId = c.req.param("harnessId");
    const envelope = localMutationEnvelope("local_harness_install", "local-harness", harnessId);
    if (!options.localAcp?.installHarness && !options.localAcp?.installHarnessAdapter) {
      return c.json({
        error: "Local agent install unavailable",
        mutation: hostMutationRejected(envelope, "Local agent install unavailable"),
      }, 404);
    }
    const body = (await c.req.json().catch(() => ({}))) as ProjectWriteBody;
    const preconditions = requestProjectWritePreconditions(c, body);
    const needsReadProof =
      !!preconditions.actorClientType || !!preconditions.expectedReadToken || preconditions.force;
    const beforeResult = needsReadProof && options.localAcp.listHarnesses
      ? await options.localAcp.listHarnesses()
      : { harnesses: [] };
    const hostMutation = needsReadProof
      ? validateLocalHarnessActionMutation({
        result: beforeResult,
        preconditions,
        operation: "local_harness_install",
        harnessId,
        action: "install",
      })
      : null;
    if (hostMutation && !hostMutation.ok) {
      return c.json({
        error: hostMutation.error,
        mutation: hostMutation.mutation,
      }, 409);
    }
    try {
      const result = options.localAcp.installHarness
        ? await options.localAcp.installHarness(harnessId)
        : await options.localAcp.installHarnessAdapter!(harnessId);
      const afterReadToken = localHarnessesReceiptReadToken(result);
      return c.json({
        ...result,
        readToken: afterReadToken,
        mutation: hostMutationSucceeded(hostMutation?.envelope ?? envelope, {
          resultEntityId: harnessId,
          ...(hostMutation ? { afterReadToken } : {}),
        }),
      });
    } catch (error) {
      const message = errorMessage(error);
      return c.json({
        error: message,
        mutation: hostMutationRejected(hostMutation?.envelope ?? envelope, message),
      }, 400);
    }
  });

  app.post("/api/v1/local/harnesses/:harnessId/install-adapter", async (c) => {
    const harnessId = c.req.param("harnessId");
    const envelope = localMutationEnvelope("local_harness_install", "local-harness", harnessId);
    if (!options.localAcp?.installHarness && !options.localAcp?.installHarnessAdapter) {
      return c.json({
        error: "Local agent install unavailable",
        mutation: hostMutationRejected(envelope, "Local agent install unavailable"),
      }, 404);
    }
    const body = (await c.req.json().catch(() => ({}))) as ProjectWriteBody;
    const preconditions = requestProjectWritePreconditions(c, body);
    const needsReadProof =
      !!preconditions.actorClientType || !!preconditions.expectedReadToken || preconditions.force;
    const beforeResult = needsReadProof && options.localAcp.listHarnesses
      ? await options.localAcp.listHarnesses()
      : { harnesses: [] };
    const hostMutation = needsReadProof
      ? validateLocalHarnessActionMutation({
        result: beforeResult,
        preconditions,
        operation: "local_harness_install",
        harnessId,
        action: "install",
      })
      : null;
    if (hostMutation && !hostMutation.ok) {
      return c.json({
        error: hostMutation.error,
        mutation: hostMutation.mutation,
      }, 409);
    }
    try {
      const result = options.localAcp.installHarness
        ? await options.localAcp.installHarness(harnessId)
        : await options.localAcp.installHarnessAdapter!(harnessId);
      const afterReadToken = localHarnessesReceiptReadToken(result);
      return c.json({
        ...result,
        readToken: afterReadToken,
        mutation: hostMutationSucceeded(hostMutation?.envelope ?? envelope, {
          resultEntityId: harnessId,
          ...(hostMutation ? { afterReadToken } : {}),
        }),
      });
    } catch (error) {
      const message = errorMessage(error);
      return c.json({
        error: message,
        mutation: hostMutationRejected(hostMutation?.envelope ?? envelope, message),
      }, 400);
    }
  });

  app.post("/api/v1/local/harnesses/:harnessId/upgrade", async (c) => {
    const harnessId = c.req.param("harnessId");
    const envelope = localMutationEnvelope("local_harness_upgrade", "local-harness", harnessId);
    if (!options.localAcp?.upgradeHarness) {
      return c.json({
        error: "Local agent upgrade unavailable",
        mutation: hostMutationRejected(envelope, "Local agent upgrade unavailable"),
      }, 404);
    }
    const body = (await c.req.json().catch(() => ({}))) as ProjectWriteBody;
    const preconditions = requestProjectWritePreconditions(c, body);
    const needsReadProof =
      !!preconditions.actorClientType || !!preconditions.expectedReadToken || preconditions.force;
    const beforeResult = needsReadProof && options.localAcp.listHarnesses
      ? await options.localAcp.listHarnesses()
      : { harnesses: [] };
    const hostMutation = needsReadProof
      ? validateLocalHarnessActionMutation({
        result: beforeResult,
        preconditions,
        operation: "local_harness_upgrade",
        harnessId,
        action: "upgrade",
      })
      : null;
    if (hostMutation && !hostMutation.ok) {
      return c.json({
        error: hostMutation.error,
        mutation: hostMutation.mutation,
      }, 409);
    }
    try {
      const result = await options.localAcp.upgradeHarness(harnessId);
      const afterReadToken = localHarnessesReceiptReadToken(result);
      return c.json({
        ...result,
        readToken: afterReadToken,
        mutation: hostMutationSucceeded(hostMutation?.envelope ?? envelope, {
          resultEntityId: harnessId,
          ...(hostMutation ? { afterReadToken } : {}),
        }),
      });
    } catch (error) {
      const message = errorMessage(error);
      return c.json({
        error: message,
        mutation: hostMutationRejected(hostMutation?.envelope ?? envelope, message),
      }, 400);
    }
  });

  app.delete("/api/v1/local/harnesses/:harnessId/install", async (c) => {
    const harnessId = c.req.param("harnessId");
    const envelope = localMutationEnvelope("local_harness_uninstall", "local-harness", harnessId);
    if (!options.localAcp?.uninstallHarness) {
      return c.json({
        error: "Local agent uninstall unavailable",
        mutation: hostMutationRejected(envelope, "Local agent uninstall unavailable"),
      }, 404);
    }
    const body = (await c.req.json().catch(() => ({}))) as ProjectWriteBody;
    const preconditions = requestProjectWritePreconditions(c, body);
    const needsReadProof =
      !!preconditions.actorClientType || !!preconditions.expectedReadToken || preconditions.force;
    const beforeResult = needsReadProof && options.localAcp.listHarnesses
      ? await options.localAcp.listHarnesses()
      : { harnesses: [] };
    const hostMutation = needsReadProof
      ? validateLocalHarnessActionMutation({
        result: beforeResult,
        preconditions,
        operation: "local_harness_uninstall",
        harnessId,
        action: "uninstall",
      })
      : null;
    if (hostMutation && !hostMutation.ok) {
      return c.json({
        error: hostMutation.error,
        mutation: hostMutation.mutation,
      }, 409);
    }
    try {
      const result = await options.localAcp.uninstallHarness(harnessId);
      const afterReadToken = localHarnessesReceiptReadToken(result);
      return c.json({
        ...result,
        readToken: afterReadToken,
        mutation: hostMutationSucceeded(hostMutation?.envelope ?? envelope, {
          resultEntityId: harnessId,
          ...(hostMutation ? { afterReadToken } : {}),
        }),
      });
    } catch (error) {
      const message = errorMessage(error);
      return c.json({
        error: message,
        mutation: hostMutationRejected(hostMutation?.envelope ?? envelope, message),
      }, 400);
    }
  });

  app.post("/api/v1/local/harnesses/:harnessId/authenticate", async (c) => {
    const harnessId = c.req.param("harnessId");
    const envelope = localMutationEnvelope("local_harness_authenticate", "local-harness", harnessId);
    if (!options.localAcp?.authenticateHarness) {
      return c.json({
        error: "Local harness auth unavailable",
        mutation: hostMutationRejected(envelope, "Local harness auth unavailable"),
      }, 404);
    }
    try {
      const body = (await c.req.json().catch(() => ({}))) as {
        method_id?: unknown;
        methodId?: unknown;
      } & ProjectWriteBody;
      const preconditions = requestProjectWritePreconditions(c, body);
      const needsReadProof =
        !!preconditions.actorClientType || !!preconditions.expectedReadToken || preconditions.force;
      const beforeResult = needsReadProof && options.localAcp.listHarnesses
        ? await options.localAcp.listHarnesses()
        : { harnesses: [] };
      const hostMutation = needsReadProof
        ? validateLocalHarnessActionMutation({
          result: beforeResult,
          preconditions,
          operation: "local_harness_authenticate",
          harnessId,
          action: "authenticate",
        })
        : null;
      if (hostMutation && !hostMutation.ok) {
        return c.json({
          error: hostMutation.error,
          mutation: hostMutation.mutation,
        }, 409);
      }
      const methodId = typeof body.method_id === "string" && body.method_id.length > 0
        ? body.method_id
        : typeof body.methodId === "string" && body.methodId.length > 0
          ? body.methodId
          : undefined;
      const result = await options.localAcp.authenticateHarness(
        harnessId,
        methodId ? { methodId } : undefined,
      );
      const afterReadToken = localHarnessesReceiptReadToken(result);
      return c.json({
        ...result,
        readToken: afterReadToken,
        mutation: hostMutationSucceeded(hostMutation?.envelope ?? envelope, {
          resultEntityId: harnessId,
          ...(hostMutation ? { afterReadToken } : {}),
        }),
      });
    } catch (error) {
      const message = errorMessage(error);
      return c.json({
        error: message,
        mutation: hostMutationRejected(envelope, message),
      }, 500);
    }
  });

  app.post("/api/v1/runtimes/:runtimeId/sessions", async (c) => {
    if (!options.localAcp) {
      return c.json({
        error: "Local agent runtime unavailable",
        mutation: hostMutationRejected({
          operation: "runtime_session_create",
          entity: { kind: "session", id: "" },
          forced: false,
        }, "Local agent runtime unavailable"),
      }, 404);
    }
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
      const agentMembers = await db.update((state) => seedLocalAgentMembers(state, userId));
      const member = agentMembers.find((row) => row.id === agentMemberId);
      if (!member) {
        return c.json({
          error: "agent member not found",
          mutation: hostMutationRejected({
            operation: "runtime_session_create",
            entity: { kind: "session", id: "" },
            forced: false,
          }, "agent member not found"),
        }, 404);
      }
      if (member.runtime_id !== c.req.param("runtimeId")) {
        return c.json({
          error: "agent member belongs to a different runtime",
          mutation: hostMutationRejected({
            operation: "runtime_session_create",
            entity: { kind: "session", id: "" },
            forced: false,
          }, "agent member belongs to a different runtime"),
        }, 400);
      }
      agentTemplateId = member.template_id;
      agentId = requestedAgentId ?? member.agent_id ?? undefined;
    }
    if (!agentTemplateId && !agentId) {
      return c.json({
        error: "Missing agent_id",
        mutation: hostMutationRejected({
          operation: "runtime_session_create",
          entity: { kind: "session", id: "" },
          forced: false,
        }, "Missing agent_id"),
      }, 400);
    }
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
      return c.json({
        ...created,
        mutation: hostMutationSucceeded({
          operation: "runtime_session_create",
          entity: { kind: "session", id: created.session_id },
          forced: false,
        }, {
          resultEntityId: created.session_id,
        }),
      });
    } catch (error) {
      const message = formatLocalAcpSessionError(error);
      if (localSessionId) {
        await sessionMessageStore.appendTurnError?.(localSessionId, null, message);
      }
      console.error("[local-api] local ACP session create failed:", message);
      const envelope = {
        operation: "runtime_session_create",
        entity: { kind: "session", id: localSessionId ?? "" },
        forced: false,
      };
      if (localSessionId) {
        return c.json({
          error: message,
          session_id: localSessionId,
          mutation: hostMutationSucceeded(envelope, { resultEntityId: localSessionId }),
        }, 503);
      }
      return c.json({
        error: message,
        mutation: hostMutationRejected(envelope, message),
      }, 503);
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
		    const sessionId = c.req.param("sessionId");
		    const body = (await c.req.json().catch(() => ({}))) as ProjectWriteBody;
		    const preconditions = requestProjectWritePreconditions(c, body);
		    if (!options.localAcp?.attachSession) {
		      return c.json({
		        error: "local ACP attach is not available",
        mutation: hostMutationRejected({
          operation: "runtime_session_attach",
          entity: { kind: "session", id: sessionId },
          forced: false,
        }, "local ACP attach is not available"),
      }, 501);
    }
    const state = await db.load();
    const session = state.sessions.find((candidate) => candidate.id === sessionId);
    if (!session || (session.type ?? "cloud") !== "runtime") {
      return c.json({
        error: "runtime session not found",
        mutation: hostMutationRejected({
          operation: "runtime_session_attach",
          entity: { kind: "session", id: sessionId },
          forced: false,
        }, "runtime session not found"),
      }, 404);
    }
    if (!session.runtimeId) {
      return c.json({
        error: "runtime session is missing runtimeId",
        mutation: hostMutationRejected({
          operation: "runtime_session_attach",
          entity: { kind: "session", id: sessionId },
          forced: false,
        }, "runtime session is missing runtimeId"),
      }, 409);
    }
		    if (!session.agentId && !session.agentTemplateId) {
		      return c.json({
		        error: "runtime session is missing agent identity",
        mutation: hostMutationRejected({
          operation: "runtime_session_attach",
          entity: { kind: "session", id: sessionId },
          forced: false,
        }, "runtime session is missing agent identity"),
		      }, 409);
		    }

		    const requiresReadProofEnvelope = preconditions.actorClientType === "agent" ||
		      Boolean(preconditions.expectedReadToken) ||
		      preconditions.force;
		    const hostMutation = requiresReadProofEnvelope
		      ? validateSessionReadMutation({
		          session,
		          operation: "attach",
		          mutationOperation: "runtime_session_attach",
		          readOperation: "runtime session attach",
		          preconditions,
		        })
		      : null;
		    if (hostMutation && !hostMutation.ok) {
		      return c.json({
		        error: hostMutation.error,
		        mutation: hostMutation.mutation,
		      }, 409);
		    }
		    const attachEnvelope = hostMutation?.envelope ?? {
		      operation: "runtime_session_attach",
		      entity: { kind: "session", id: sessionId },
		      forced: false,
		    };

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
		      const afterSession = hostMutation
		        ? (await db.load()).sessions.find((candidate) => candidate.id === sessionId)
		        : undefined;
		      const afterReadToken = afterSession ? sessionReceiptReadToken(afterSession) : undefined;
		      return c.json({
		        ...attached,
		        mutation: hostMutationSucceeded(attachEnvelope, {
		          resultEntityId: attached.session_id,
		          afterReadToken,
		        }),
		      });
		    } catch (error) {
		      const message = formatLocalAcpSessionError(error);
		      console.error("[local-api] local ACP session attach failed:", message);
		      await rememberRuntimeSessionPatch({ status: "error" });
		      const afterSession = hostMutation
		        ? (await db.load()).sessions.find((candidate) => candidate.id === sessionId)
		        : undefined;
		      const afterReadToken = afterSession ? sessionReceiptReadToken(afterSession) : undefined;
		      return c.json({
		        error: message,
		        session_id: sessionId,
		        mutation: hostMutationSucceeded(attachEnvelope, {
		          resultEntityId: sessionId,
		          afterReadToken,
		        }),
		      }, 503);
		    }
  });

	  app.get("/api/v1/projects", async (c) => {
	    const state = await db.load();
	    return c.json({
	      projects: activeProjects(state).map(toV1Project),
	    });
	  });

  app.post("/api/v1/projects", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      name?: string;
      description?: string;
    };
    const name = body.name?.trim();
    if (!name) return c.json({ error: "name is required" }, 400);

    const project = await db.update((state) => {
      const createdAt = nowIso();
      const next: LocalProject = {
        id: crypto.randomUUID(),
        ownerId: userId,
        name,
        description: body.description?.trim() || null,
        createdAt,
        updatedAt: createdAt,
        assets: [],
      };
      state.projects.unshift(next);
      return next;
    });
    const readToken = projectReceiptReadToken(project);
    return c.json({
      id: project.id,
      name: project.name,
      description: project.description,
      readToken,
      mutation: hostMutationSucceeded({
        operation: "project_create",
        entity: { kind: "project", id: project.id },
        forced: false,
      }, {
        resultEntityId: project.id,
        afterReadToken: readToken,
      }),
    }, 201);
  });

	  app.get("/api/v1/projects/:id/status", async (c) => {
	    const projectId = c.req.param("id");
	    const state = await db.load();
	    const project = findActiveProject(state, projectId, userId);
	    if (!project) return c.json({ error: "not found" }, 404);
    const sync = await syncConfig.getPublicConfig();
    return c.json(buildProjectStatus(
      { projectId, source: "explicit" },
      {
        clashRoot,
        localApiDataDir,
        marker: { sync: { mode: sync.mode, capabilities: sync.capabilities } },
      },
    ));
  });

	  app.get("/api/v1/projects/:id/room/messages", async (c) => {
	    const projectId = c.req.param("id");
	    const state = await db.load();
	    const project = findActiveProject(state, projectId, userId);
	    if (!project) return c.json({ error: "not found" }, 404);

    const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 50) || 50, 1), 200);
    const before = c.req.query("before");
    let messages = state.roomMessages
      .filter((message) => message.project_id === projectId)
      .sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id));

    if (before) {
      const beforeMessage = messages.find((message) => message.id === before);
      messages = beforeMessage
        ? messages.filter((message) =>
            message.created_at < beforeMessage.created_at ||
            (message.created_at === beforeMessage.created_at && message.id.localeCompare(beforeMessage.id) < 0)
          )
        : [];
    }

    return c.json({
      sync: await publicRoomSyncMeta(syncConfig),
      messages: messages.slice(0, limit).map(publicRoomMessage),
    });
  });

  app.post("/api/v1/projects/:id/room/sync", async (c) => {
    const projectId = c.req.param("id");
    const envelope = localMutationEnvelope("room_sync", "room", projectId);
    const state = await db.load();
    const project = findActiveProject(state, projectId, userId);
    if (!project) {
      return c.json({
        error: "not found",
        mutation: hostMutationRejected(envelope, "not found"),
      }, 404);
    }
    const admissionMeta = await publicRoomSyncMeta(syncConfig);
    if (!admissionMeta.admission.allowed) {
      const error = roomSyncAdmissionError(admissionMeta.admission.reason);
      return c.json({
        error,
        admission: admissionMeta.admission,
        sync: await publicRoomSyncMeta(syncConfig, { error }),
        mutation: hostMutationRejected(envelope, error),
      }, 409);
    }
    const remoteRoom = await syncConfig.resolveRemoteRoomSync();
    if (!remoteRoom) {
      const error = "remote room sync is not configured";
      return c.json({
        error,
        admission: deniedRoomSyncAdmission("remote-room-not-configured"),
        sync: await publicRoomSyncMeta(syncConfig, { error }),
        mutation: hostMutationRejected(envelope, error),
      }, 409);
    }

    const localMessages = state.roomMessages
      .filter((message) => message.project_id === projectId)
      .map(localRoomMessageToRemote);

    let remoteMessages: RemoteRoomMessage[];
    try {
      remoteMessages = (await remoteRoom.listMessages(projectId))
        .map((message) => ({ ...message, project_id: projectId }));
    } catch (error) {
      const message = `room sync failed: ${errorMessage(error)}`;
      return c.json({
        error: message,
        sync: await publicRoomSyncMeta(syncConfig, { status: "failed", error: message }),
        mutation: hostMutationRejected(envelope, message),
      }, 502);
    }

    const plan = planRoomMirror({ localMessages, remoteMessages });
    const resolutions = await acceptedRoomConflictResolutions(db, projectId);
    const { active: activeConflicts, resolvedConflictIds } = splitRoomConflicts(plan.conflicts, resolutions);
    const effectivePlan = { ...plan, conflicts: activeConflicts };
    const publicPlan = publicRoomMirrorPlan(effectivePlan, resolvedConflictIds);
    if (activeConflicts.length > 0) {
      const error = "room sync conflict";
      return c.json({
        error,
        sync: await publicRoomSyncMeta(syncConfig, { status: "failed", error }),
        plan: publicPlan,
        mutation: hostMutationRejected(envelope, error),
      }, 409);
    }

    try {
      for (const message of effectivePlan.exportToRemote) {
        await remoteRoom.postMessage(projectId, remoteRoomMessageInput(message));
      }
    } catch (error) {
      const message = `room sync failed: ${errorMessage(error)}`;
      return c.json({
        error: message,
        sync: await publicRoomSyncMeta(syncConfig, { status: "failed", error: message }),
        plan: publicPlan,
        mutation: hostMutationRejected(envelope, message),
      }, 502);
    }

    const imported = await db.update((current) => {
      const activeProject = findActiveProject(current, projectId, userId);
      if (!activeProject) return null;
      const importedRows: LocalRoomMessage[] = [];
      for (const remoteMessage of effectivePlan.importToLocal) {
        const existing = current.roomMessages.find((candidate) => candidate.id === remoteMessage.id);
        if (existing) {
          if (existing.project_id === projectId && roomMessageCreateMatchesExisting(existing, {
            sender_kind: remoteMessage.sender_kind,
            sender_id: remoteMessage.sender_id,
            sender_user_id: remoteMessage.sender_user_id,
            mentions: remoteMessage.mentions,
            text: remoteMessage.text,
          })) {
            continue;
          }
          return { error: "room sync conflict" } as const;
        }
        const next = remoteRoomMessageToLocal(projectId, remoteMessage);
        current.roomMessages.unshift(next);
        importedRows.push(next);
      }
      return importedRows;
    });

    if (!imported) {
      return c.json({
        error: "not found",
        sync: await publicRoomSyncMeta(syncConfig, { status: "failed", error: "not found" }),
        plan: publicPlan,
        mutation: hostMutationRejected(envelope, "not found"),
      }, 404);
    }
    if ("error" in imported) {
      return c.json({
        error: imported.error,
        sync: await publicRoomSyncMeta(syncConfig, { status: "failed", error: imported.error }),
        plan: publicPlan,
        mutation: hostMutationRejected(envelope, imported.error),
      }, 409);
    }

    return c.json({
      sync: await publicRoomSyncMeta(syncConfig, { status: "mirrored" }),
      plan: publicPlan,
      mutation: hostMutationSucceeded(envelope, { resultEntityId: projectId }),
    });
  });

  app.post("/api/v1/projects/:id/room/sync/conflicts/:messageId/resolve", async (c) => {
    const projectId = c.req.param("id");
    const messageId = c.req.param("messageId");
    const body = (await c.req.json().catch(() => ({}))) as {
      resolution?: unknown;
      localContentHash?: unknown;
      remoteContentHash?: unknown;
    };
    const strategy = body.resolution === "accept-divergence" ? "accept-divergence" as const : null;
    const localContentHash = typeof body.localContentHash === "string" ? body.localContentHash.trim() : "";
    const remoteContentHash = typeof body.remoteContentHash === "string" ? body.remoteContentHash.trim() : "";
    const pairHash = roomConflictPairHash(localContentHash, remoteContentHash);
    const envelope = {
      ...localMutationEnvelope(
        "room_sync_conflict_resolve",
        "room-message-conflict",
        roomConflictEntityId(projectId, messageId),
      ),
      actor: {
        strategy: strategy ?? body.resolution,
        project_id: projectId,
        message_id: messageId,
        localContentHash,
        remoteContentHash,
      },
      expectedHash: pairHash,
    };

    if (!strategy) {
      const error = "unsupported room sync conflict resolution";
      return c.json({ error, mutation: hostMutationRejected(envelope, error) }, 400);
    }
    if (!localContentHash || !remoteContentHash) {
      const error = "localContentHash and remoteContentHash required";
      return c.json({ error, mutation: hostMutationRejected(envelope, error) }, 400);
    }

    const state = await db.load();
    const project = findActiveProject(state, projectId, userId);
    if (!project) {
      return c.json({
        error: "not found",
        mutation: hostMutationRejected(envelope, "not found"),
      }, 404);
    }
    const admissionMeta = await publicRoomSyncMeta(syncConfig);
    if (!admissionMeta.admission.allowed) {
      const error = roomSyncAdmissionError(admissionMeta.admission.reason);
      return c.json({
        error,
        admission: admissionMeta.admission,
        sync: await publicRoomSyncMeta(syncConfig, { error }),
        mutation: hostMutationRejected(envelope, error),
      }, 409);
    }
    const remoteRoom = await syncConfig.resolveRemoteRoomSync();
    if (!remoteRoom) {
      const error = "remote room sync is not configured";
      return c.json({
        error,
        admission: deniedRoomSyncAdmission("remote-room-not-configured"),
        sync: await publicRoomSyncMeta(syncConfig, { error }),
        mutation: hostMutationRejected(envelope, error),
      }, 409);
    }

    const localMessages = state.roomMessages
      .filter((message) => message.project_id === projectId)
      .map(localRoomMessageToRemote);
    let remoteMessages: RemoteRoomMessage[];
    try {
      remoteMessages = (await remoteRoom.listMessages(projectId))
        .map((message) => ({ ...message, project_id: projectId }));
    } catch (error) {
      const message = `room sync failed: ${errorMessage(error)}`;
      return c.json({
        error: message,
        sync: await publicRoomSyncMeta(syncConfig, { status: "failed", error: message }),
        mutation: hostMutationRejected(envelope, message),
      }, 502);
    }

    const plan = planRoomMirror({ localMessages, remoteMessages });
    const conflict = plan.conflicts.find((candidate) => candidate.id === messageId);
    if (!conflict) {
      const error = "room sync conflict not found";
      return c.json({
        error,
        sync: await publicRoomSyncMeta(syncConfig),
        mutation: hostMutationRejected(envelope, error),
      }, 404);
    }

    const currentLocalHash = roomMessageContentHash(conflict.local);
    const currentRemoteHash = roomMessageContentHash(conflict.remote);
    if (currentLocalHash !== localContentHash || currentRemoteHash !== remoteContentHash) {
      const error = "stale room sync conflict resolution";
      return c.json({
        error,
        conflict: {
          id: conflict.id,
          reason: conflict.reason,
          local: publicRemoteRoomMessage(conflict.local),
          remote: publicRemoteRoomMessage(conflict.remote),
        },
        mutation: hostMutationRejected({ ...envelope, beforeHash: roomConflictPairHash(currentLocalHash, currentRemoteHash) }, error),
      }, 409);
    }

    const mutation = hostMutationSucceeded(
      { ...envelope, beforeHash: pairHash },
      { resultEntityId: messageId, afterHash: pairHash },
    );
    const auditRecord = mutationAuditRecord({
      mutation,
      reason: "room sync conflict accepted as divergence",
    });
    await db.upsertRoomSyncConflictResolution({
      projectId,
      messageId,
      strategy,
      localContentHash,
      remoteContentHash,
      resolvedAt: Date.now(),
      mutationId: auditRecord.id,
    });
    await db.appendMutationAudit(auditRecord);

    return c.json({
      resolution: {
        strategy,
        project_id: projectId,
        message_id: messageId,
        localContentHash,
        remoteContentHash,
      },
      sync: await publicRoomSyncMeta(syncConfig, { status: "pending" }),
      mutation,
    });
  });

  app.post("/api/v1/projects/:id/room/messages", async (c) => {
    const projectId = c.req.param("id");
    const body = (await c.req.json().catch(() => ({}))) as {
      id?: unknown;
      text?: unknown;
      mentions?: unknown;
      sender_kind?: unknown;
      sender_id?: unknown;
    };
    const clientId = typeof body.id === "string" ? body.id.trim() : "";
    const messageId = clientId || crypto.randomUUID();
    const envelope = localMutationEnvelope("room_message_create", "room-message", messageId);
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) {
      return c.json({
        error: "text required",
        mutation: hostMutationRejected(envelope, "text required"),
      }, 400);
    }

    const senderKind = body.sender_kind === "agent" ? "agent" as const : "user" as const;
    const requestedSenderId = typeof body.sender_id === "string" ? body.sender_id.trim() : "";
    if (senderKind === "agent" && !requestedSenderId) {
      return c.json({
        error: "sender_id required for agent sender",
        mutation: hostMutationRejected(envelope, "sender_id required for agent sender"),
      }, 400);
    }
    const senderId = senderKind === "agent" ? requestedSenderId : userId;
    const mentions = normalizeRoomMentions(body.mentions);
    const createdAt = Math.floor(Date.now() / 1000);

    const message = await db.update((state) => {
      const project = findActiveProject(state, projectId, userId);
      if (!project) return null;
      if (senderKind === "agent") {
        const agentMembers = seedLocalAgentMembers(state, userId);
        const ownsSender = agentMembers.some((member) => member.id === senderId && member.user_id === userId);
        if (!ownsSender) return { error: "sender_id is not an agent_member you own" } as const;
      }

	      const existing = state.roomMessages.find((candidate) => candidate.id === messageId);
	      if (existing && existing.project_id !== projectId) {
	        return { error: "room message id already exists", status: 409 } as const;
	      }
	      if (existing) {
	        if (roomMessageCreateMatchesExisting(existing, {
	          sender_kind: senderKind,
	          sender_id: senderId,
	          sender_user_id: userId,
	          mentions,
	          text,
	        })) {
	          return existing;
	        }
	        return { error: "room message id already exists with different content", status: 409 } as const;
	      }
	      const next: LocalRoomMessage = {
        id: messageId,
        project_id: projectId,
        sender_kind: senderKind,
        sender_id: senderId,
        sender_user_id: userId,
        mentions,
        text,
        created_at: createdAt,
      };
      state.roomMessages.unshift(next);
      return next;
    });

    if (!message) {
      return c.json({
        error: "not found",
        mutation: hostMutationRejected(envelope, "not found"),
      }, 404);
    }
    if ("error" in message) {
      return c.json({
        error: message.error,
        mutation: hostMutationRejected(envelope, message.error),
      }, message.status ?? 403);
    }
    const payload = publicRoomMessage(message);

    for (const mention of mentions) {
      if (!mention.agent_member_id || !options.localAcp?.pushRoomMention) continue;
      void options.localAcp.pushRoomMention(projectId, mention.agent_member_id, {
        message_id: payload.id,
        from_kind: payload.sender_kind,
        from_id: payload.sender_id,
        from_user_id: payload.sender_user_id,
        text: payload.text,
      }).catch(() => undefined);
    }

    return c.json({
      ...payload,
      sync: await publicRoomSyncMeta(syncConfig),
      mutation: hostMutationSucceeded(envelope, { resultEntityId: payload.id }),
    });
  });

  app.post("/api/v1/text-revisions", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { revision?: unknown; content?: unknown };
    const parsed = parseTextRevisionForIndex(body.revision);
    const envelope = {
      operation: "text_revision_index",
      entity: { kind: "text", id: parsed.ok ? `${parsed.revision.projectId}:${parsed.revision.nodeId}` : "" },
      forced: false,
    };
    if (!parsed.ok) {
      return c.json({
        error: parsed.error,
        mutation: hostMutationRejected(envelope, parsed.error),
      }, 400);
    }
    const content = typeof body.content === "string" ? body.content : undefined;
    let contentRecord: Awaited<ReturnType<typeof storeTextRevisionContentBlob>> | undefined;
    if (content !== undefined) {
      try {
        contentRecord = await storeTextRevisionContentBlob(options.dataDir, parsed.revision, content);
      } catch (error) {
        const message = errorMessage(error);
        return c.json({
          error: message,
          mutation: hostMutationRejected(envelope, message),
        }, message.includes("already exists with different content") ? 409 : 400);
      }
    }

    try {
      const revision = await db.upsertTextRevision(parsed.revision);
      const mutation = hostMutationSucceeded(envelope, { resultEntityId: revision.revisionId });
      await db.appendMutationAudit(mutationAuditRecord({
        mutation,
        reason: "text revision indexed",
      }));
      return c.json({
        revision,
        ...(contentRecord ? { content: contentRecord } : {}),
        mutation,
      });
    } catch (error) {
      const message = errorMessage(error);
      return c.json({
        error: message,
        mutation: hostMutationRejected(envelope, message),
      }, message.includes("already exists with different metadata") ? 409 : 500);
    }
  });

  app.get("/api/v1/projects/:projectId/text-revisions", async (c) => {
    const limit = Number(c.req.query("limit"));
    const revisions = await db.listTextRevisions({
      projectId: c.req.param("projectId"),
      nodeId: normalizeString(c.req.query("nodeId")),
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    const entries = await Promise.all(
      revisions.map((revision) => withTextRevisionContentDescriptor(options.dataDir, revision)),
    );
    return c.json({ revisions: entries });
  });

  app.get("/api/v1/projects/:projectId/text-revisions/:revisionId/content", async (c) => {
    const revision = await db.getTextRevision(c.req.param("projectId"), c.req.param("revisionId"));
    if (!revision) return c.json({ error: "text revision not found" }, 404);
    let content: string;
    try {
      content = await readFile(textRevisionContentBlobPath(options.dataDir, revision.contentHash), "utf8");
    } catch {
      return c.json({ error: "text revision content not found" }, 404);
    }
    if (textRevisionContentHash(content) !== revision.contentHash) {
      return c.json({ error: "text revision content blob hash mismatch" }, 409);
    }
    return new Response(content, {
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "cache-control": "public, max-age=31536000, immutable",
        "x-clash-content-hash": revision.contentHash,
      },
    });
  });

  app.post("/api/v1/timeline-revisions", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { revision?: unknown; content?: unknown };
    const parsed = parseTimelineRevisionForIndex(body.revision);
    const envelope = {
      operation: "timeline_revision_index",
      entity: { kind: "timeline", id: parsed.ok ? `${parsed.revision.projectId}:${parsed.revision.nodeId}` : "" },
      forced: false,
    };
    if (!parsed.ok) {
      return c.json({
        error: parsed.error,
        mutation: hostMutationRejected(envelope, parsed.error),
      }, 400);
    }
    const content = typeof body.content === "string" ? body.content : undefined;
    let contentRecord: Awaited<ReturnType<typeof storeTimelineRevisionContentBlob>> | undefined;
    if (content !== undefined) {
      try {
        contentRecord = await storeTimelineRevisionContentBlob(options.dataDir, parsed.revision, content);
      } catch (error) {
        const message = errorMessage(error);
        return c.json({
          error: message,
          mutation: hostMutationRejected(envelope, message),
        }, message.includes("already exists with different content") ? 409 : 400);
      }
    }

    try {
      const revision = await db.upsertTimelineRevision(parsed.revision);
      const mutation = hostMutationSucceeded(envelope, { resultEntityId: revision.revisionId });
      await db.appendMutationAudit(mutationAuditRecord({
        mutation,
        reason: "timeline revision indexed",
      }));
      return c.json({
        revision,
        ...(contentRecord ? { content: contentRecord } : {}),
        mutation,
      });
    } catch (error) {
      const message = errorMessage(error);
      return c.json({
        error: message,
        mutation: hostMutationRejected(envelope, message),
      }, message.includes("already exists with different metadata") ? 409 : 500);
    }
  });

  app.get("/api/v1/projects/:projectId/timeline-revisions", async (c) => {
    const limit = Number(c.req.query("limit"));
    const revisions = await db.listTimelineRevisions({
      projectId: c.req.param("projectId"),
      nodeId: normalizeString(c.req.query("nodeId")),
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    const entries = await Promise.all(
      revisions.map((revision) => withTimelineRevisionContentDescriptor(options.dataDir, revision)),
    );
    return c.json({ revisions: entries });
  });

  app.get("/api/v1/projects/:projectId/timeline-revisions/:revisionId/content", async (c) => {
    const revision = await db.getTimelineRevision(c.req.param("projectId"), c.req.param("revisionId"));
    if (!revision) return c.json({ error: "timeline revision not found" }, 404);
    let content: string;
    try {
      content = await readFile(timelineRevisionContentBlobPath(options.dataDir, revision.timelineHash), "utf8");
    } catch {
      return c.json({ error: "timeline revision content not found" }, 404);
    }
    if (timelineRevisionSemanticHash(content) !== revision.timelineHash) {
      return c.json({ error: "timeline revision content blob hash mismatch" }, 409);
    }
    return new Response(content, {
      headers: {
        "content-type": "application/yaml; charset=utf-8",
        "cache-control": "public, max-age=31536000, immutable",
        "x-clash-timeline-hash": revision.timelineHash,
      },
    });
  });

  app.get("/api/v1/projects/:id", async (c) => {
    const state = await db.load();
    const includeDeleted = normalizeString(c.req.query("includeDeleted")) === "true";
    const project = includeDeleted
      ? state.projects.find((candidate) => candidate.id === c.req.param("id"))
      : findActiveProject(state, c.req.param("id"));
    return project ? c.json(toV1Project(project)) : c.json({ error: "Project not found" }, 404);
  });

  app.get("/api/v1/projects/:projectId/canvas/nodes/:nodeId", async (c) => {
    const projectId = c.req.param("projectId");
    const nodeId = c.req.param("nodeId");
    const doc = await replicaStore.recover(projectId);
    const canvas = new Canvas(doc, () => {});
    const node = canvas.readNode(nodeId);
    if (!node) {
      return c.json({ error: `Node not found: ${nodeId}` }, 404);
    }
    return c.json({
      projectId,
      node,
      readToken: canvasNodeReceiptReadToken(node),
    });
  });

  app.patch("/api/v1/projects/:projectId/canvas/nodes/:nodeId", async (c) => {
    const projectId = c.req.param("projectId");
    const nodeId = c.req.param("nodeId");
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown> & ProjectWriteBody;
    const preconditions = requestProjectWritePreconditions(c, body);
    const envelope = {
      operation: "canvas_update",
      entity: { kind: "canvas-node", id: nodeId },
      expectedReadToken: preconditions.expectedReadToken,
      forced: preconditions.force,
    };
    const parsedPatch = canvasNodeDataPatchFromBody(body);
    if (!parsedPatch.ok) {
      return c.json({
        error: parsedPatch.error,
        mutation: hostMutationRejected(envelope, parsedPatch.error),
      }, 400);
    }
    const patch = parsedPatch.patch;
    if (Object.keys(patch).length === 0) {
      const message = "Provide at least one node data field to update";
      return c.json({
        error: message,
        mutation: hostMutationRejected(envelope, message),
      }, 400);
    }

    const result = await replicaStore.updateSnapshotAtomic<SnapshotWriteRouteResult>(projectId, async (doc) => {
      const canvas = new Canvas(doc, () => {});
      const node = canvas.readNode(nodeId);
      if (!node) {
        const message = `Node not found: ${nodeId}`;
        return {
          save: false,
          value: {
            status: 404 as const,
            body: {
              error: message,
              mutation: hostMutationRejected(envelope, message),
            },
          },
        };
      }

      const currentReadToken = canvasNodeReadToken(node);
      const readProof = validateCanvasReadProof({
        operation: "update",
        actorClientType: preconditions.actorClientType,
        node,
        expectedReadToken: preconditions.expectedReadToken,
        requireReceipt: true,
        readReceiptVerifier: verifyLocalApiCanvasReadReceipt,
        force: preconditions.force,
      });
      const edges = canvasGuardrailEdges(listCanvasReadProofEdges(doc));
      const patchGuard = validateCanvasNodePatch({
        nodeId,
        node: { type: node.type, data: node.data as Record<string, unknown> },
        nodes: readCanvasGuardrailNodes(doc),
        edges,
        patch,
      });
      const hostMutation = validateHostMutationEnvelope({
        operation: "canvas_update",
        entity: { kind: "canvas-node", id: nodeId },
        expectedReadToken: preconditions.expectedReadToken,
        currentReadToken,
        force: preconditions.force,
        guard: readProof.ok ? patchGuard : readProof,
      });
      if (!hostMutation.ok) {
        return {
          save: false,
          value: {
            status: 409 as const,
            body: {
              error: hostMutation.error,
              mutation: hostMutation.mutation,
            },
          },
        };
      }

      const ok = canvas.updateNode(nodeId, patch);
      if (!ok) {
        const message = `Node not found: ${nodeId}`;
        return {
          save: false,
          value: {
            status: 404 as const,
            body: {
              error: message,
              mutation: hostMutationRejected(hostMutation.envelope, message),
            },
          },
        };
      }
      const updatedNode = canvas.readNode(nodeId);
      const afterReadToken = updatedNode ? canvasNodeReceiptReadToken(updatedNode) : undefined;
      return {
        value: {
          status: 200 as const,
          body: {
            updated: true,
            nodeId,
            ...(updatedNode ? { node: updatedNode } : {}),
            ...(afterReadToken ? { readToken: afterReadToken } : {}),
            mutation: hostMutationSucceeded(hostMutation.envelope, {
              resultEntityId: nodeId,
              afterReadToken,
            }),
            ...(preconditions.force ? { forced: true } : {}),
          },
        },
      };
    });
    if (result.status === 200) {
      const mutation = result.body.mutation as HostMutationRecord | undefined;
      if (mutation?.accepted === true) {
        await db.appendMutationAudit(mutationAuditRecord({
          mutation,
          actorClientType: preconditions.actorClientType,
          reason: "canvas node update",
        }));
      }
    }
    return c.json(result.body, result.status);
  });

  app.delete("/api/v1/projects/:projectId/canvas/nodes/:nodeId", async (c) => {
    const projectId = c.req.param("projectId");
    const nodeId = c.req.param("nodeId");
    const body = (await c.req.json().catch(() => ({}))) as ProjectWriteBody;
    const preconditions = requestProjectWritePreconditions(c, body);
    const envelope = {
      operation: "canvas_delete",
      entity: { kind: "canvas-node", id: nodeId },
      expectedReadToken: preconditions.expectedReadToken,
      forced: preconditions.force,
    };
    const result = await replicaStore.updateSnapshotAtomic<SnapshotWriteRouteResult>(projectId, async (doc) => {
      const canvas = new Canvas(doc, () => {});
      const node = canvas.readNode(nodeId);
      if (!node) {
        const message = `Node not found: ${nodeId}`;
        return {
          save: false,
          value: {
            status: 404 as const,
            body: {
              error: message,
              mutation: hostMutationRejected(envelope, message),
            },
          },
        };
      }

      const currentReadToken = canvasNodeReadToken(node);
      const readProof = validateCanvasReadProof({
        operation: "delete",
        actorClientType: preconditions.actorClientType,
        node,
        expectedReadToken: preconditions.expectedReadToken,
        requireReceipt: true,
        readReceiptVerifier: verifyLocalApiCanvasReadReceipt,
        force: preconditions.force,
      });
      const edges = canvasGuardrailEdges(listCanvasReadProofEdges(doc));
      const deleteGuard = validateCanvasDelete({
        nodeId,
        edges,
        force: preconditions.force,
      });
      const hostMutation = validateHostMutationEnvelope({
        operation: "canvas_delete",
        entity: { kind: "canvas-node", id: nodeId },
        expectedReadToken: preconditions.expectedReadToken,
        currentReadToken,
        force: preconditions.force,
        guard: readProof.ok ? deleteGuard : readProof,
      });
      if (!hostMutation.ok) {
        return {
          save: false,
          value: {
            status: 409 as const,
            body: {
              error: hostMutation.error,
              mutation: hostMutation.mutation,
            },
          },
        };
      }

      const orphanedReferences = canvasDownstreamTargets(nodeId, edges);
      const ok = canvas.deleteNode(nodeId);
      if (!ok) {
        const message = `Node not found: ${nodeId}`;
        return {
          save: false,
          value: {
            status: 404 as const,
            body: {
              error: message,
              mutation: hostMutationRejected(hostMutation.envelope, message),
            },
          },
        };
      }
      return {
        value: {
          status: 200 as const,
          body: {
            deleted: true,
            nodeId,
            mutation: hostMutationSucceeded(hostMutation.envelope, {
              resultEntityId: nodeId,
            }),
            ...(preconditions.force ? { forced: true, orphanedReferences } : {}),
          },
        },
      };
    });
    if (result.status === 200) {
      const mutation = result.body.mutation as HostMutationRecord | undefined;
      if (mutation?.accepted === true) {
        await db.appendMutationAudit(mutationAuditRecord({
          mutation,
          actorClientType: preconditions.actorClientType,
          reason: "canvas node delete",
        }));
      }
    }
    return c.json(result.body, result.status);
  });

  app.post("/api/v1/projects/:projectId/canvas/delete-plan", async (c) => {
    const projectId = c.req.param("projectId");
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const nodeIds = stringArray(body.nodeIds);
    const doc = await replicaStore.recover(projectId);
    const plan = readCanvasBatchDeletePlan(doc, nodeIds);
    if (!plan.ok) return c.json({ error: plan.error }, plan.status);
    return c.json({
      projectId,
      nodeIds: plan.nodeIds,
      nodes: plan.nodes,
      edges: plan.edges,
      readToken: plan.readToken,
    });
  });

  app.post("/api/v1/projects/:projectId/canvas/delete-batch", async (c) => {
    const projectId = c.req.param("projectId");
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown> & ProjectWriteBody;
    const nodeIds = normalizeCanvasBatchDeleteNodeIds(stringArray(body.nodeIds));
    const batchId = nodeIds.join(",");
    const preconditions = requestProjectWritePreconditions(c, body);
    const envelope = {
      operation: "canvas_batch_delete",
      entity: { kind: "canvas-node-batch", id: batchId },
      expectedReadToken: preconditions.expectedReadToken,
      forced: preconditions.force,
    };
    if (nodeIds.length === 0) {
      const message = "delete batch requires at least one node id";
      return c.json({
        error: message,
        mutation: hostMutationRejected(envelope, message),
      }, 400);
    }

    const result = await replicaStore.updateSnapshotAtomic<SnapshotWriteRouteResult>(projectId, async (doc) => {
      const plan = readCanvasBatchDeletePlan(doc, nodeIds);
      if (!plan.ok) {
        return {
          save: false,
          value: {
            status: plan.status,
            body: {
              error: plan.error,
              mutation: hostMutationRejected(envelope, plan.error),
            },
          },
        };
      }
      const currentReadToken = canvasBatchDeleteReadToken({ nodes: plan.nodes, edges: plan.edges });
      const readProof = validateCanvasBatchDeleteReadProof({
        actorClientType: preconditions.actorClientType,
        nodes: plan.nodes,
        edges: plan.edges,
        expectedReadToken: preconditions.expectedReadToken,
        requireReceipt: true,
        readReceiptVerifier: verifyLocalApiCanvasBatchDeleteReadReceipt,
        force: preconditions.force,
      });
      const guardrailEdges = canvasGuardrailEdges(plan.edges);
      const deleteGuard = validateCanvasBatchDelete({
        nodeIds: plan.nodeIds,
        edges: guardrailEdges,
        force: preconditions.force,
      });
      const hostMutation = validateHostMutationEnvelope({
        operation: "canvas_batch_delete",
        entity: { kind: "canvas-node-batch", id: batchId },
        expectedReadToken: preconditions.expectedReadToken,
        currentReadToken,
        force: preconditions.force,
        guard: readProof.ok ? deleteGuard : readProof,
      });
      if (!hostMutation.ok) {
        return {
          save: false,
          value: {
            status: 409 as const,
            body: {
              error: hostMutation.error,
              mutation: hostMutation.mutation,
            },
          },
        };
      }

      const orphanedReferences = plan.nodeIds.flatMap((nodeId) => canvasDownstreamTargets(nodeId, guardrailEdges));
      const canvas = new Canvas(doc, () => {});
      const deleteResult = canvas.deleteNodes(plan.nodeIds);
      if (deleteResult.deletedNodeIds.length === 0) {
        const message = `Node(s) not found: ${plan.nodeIds.join(", ")}`;
        return {
          save: false,
          value: {
            status: 404 as const,
            body: {
              error: message,
              mutation: hostMutationRejected(hostMutation.envelope, message),
            },
          },
        };
      }
      return {
        value: {
          status: 200 as const,
          body: {
            deleted: true,
            nodeIds: plan.nodeIds,
            deletedNodeIds: [...deleteResult.deletedNodeIds].sort(),
            deletedEdgeIds: [...deleteResult.deletedEdgeIds].sort(),
            mutation: hostMutationSucceeded(hostMutation.envelope, {
              resultEntityId: batchId,
            }),
            ...(preconditions.force ? { forced: true, orphanedReferences } : {}),
          },
        },
      };
    });
    if (result.status === 200) {
      const mutation = result.body.mutation as HostMutationRecord | undefined;
      if (mutation?.accepted === true) {
        await db.appendMutationAudit(mutationAuditRecord({
          mutation,
          actorClientType: preconditions.actorClientType,
          reason: "canvas batch delete",
        }));
      }
    }
    return c.json(result.body, result.status);
  });

  app.get("/api/v1/projects/:projectId/canvas/edges", async (c) => {
    const projectId = c.req.param("projectId");
    const doc = await replicaStore.recover(projectId);
    return c.json({
      projectId,
      ...listCanvasEdgesWithReadReceipts(doc),
    });
  });

  app.post("/api/v1/projects/:projectId/canvas/edges/:edgeId", async (c) => {
    const projectId = c.req.param("projectId");
    const edgeId = c.req.param("edgeId");
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown> & ProjectWriteBody;
    const preconditions = requestProjectWritePreconditions(c, body);
    const envelope = {
      operation: "canvas_add_edge",
      entity: { kind: "canvas-edge", id: edgeId },
      expectedReadToken: preconditions.expectedReadToken,
      forced: preconditions.force,
    };
    const patch = canvasEdgePatchFromBody(body);
    const source = normalizeString(patch.source);
    const target = normalizeString(patch.target);
    if (!source || !target) {
      return c.json({
        error: "Missing edge source or target",
        mutation: hostMutationRejected(envelope, "Missing edge source or target"),
      }, 400);
    }

    const result = await replicaStore.updateSnapshotAtomic<SnapshotWriteRouteResult>(projectId, async (doc) => {
      const existing = readCanvasEdge(doc, edgeId);
      const currentEdges = listCanvasReadProofEdges(doc);
      const currentReadToken = canvasEdgesReadToken(currentEdges);
      if (existing && !preconditions.force) {
        const message = `Edge already exists: ${edgeId}`;
        return {
          save: false,
          value: {
            status: 409 as const,
            body: {
              error: message,
              mutation: hostMutationRejected({
                ...envelope,
                beforeReadToken: currentReadToken,
              }, message),
            },
          },
        };
      }

      const readProof = validateCanvasEdgesReadProof({
        operation: "add",
        actorClientType: preconditions.actorClientType,
        edges: currentEdges,
        expectedReadToken: preconditions.expectedReadToken,
        requireReceipt: true,
        readReceiptVerifier: verifyLocalApiCanvasEdgesReadReceipt,
        force: preconditions.force,
      });
      const edgeGuard = validateCanvasEdgeAdd({
        edge: { source, target },
        nodes: readCanvasGuardrailNodes(doc),
        edges: canvasGuardrailEdges(currentEdges),
        force: preconditions.force,
      });
      const hostMutation = validateHostMutationEnvelope({
        operation: "canvas_add_edge",
        entity: { kind: "canvas-edge", id: edgeId },
        expectedReadToken: preconditions.expectedReadToken,
        currentReadToken,
        force: preconditions.force,
        guard: readProof.ok ? edgeGuard : readProof,
      });
      if (!hostMutation.ok) {
        return {
          save: false,
          value: {
            status: 409 as const,
            body: {
              error: hostMutation.error,
              mutation: hostMutation.mutation,
            },
          },
        };
      }

      doc.getMap("edges").set(edgeId, { ...patch, source, target });
      const edge = readCanvasEdge(doc, edgeId);
      const afterReadToken = canvasEdgesReceiptReadToken(listCanvasReadProofEdges(doc));
      return {
        value: {
          status: 200 as const,
          body: {
            edge: edge ? canvasEdgeResponse(edge) : undefined,
            readToken: afterReadToken,
            mutation: hostMutationSucceeded(hostMutation.envelope, {
              resultEntityId: edgeId,
              afterReadToken,
            }),
            ...(preconditions.force ? { forced: true } : {}),
          },
        },
      };
    });
    return c.json(result.body, result.status);
  });

  app.patch("/api/v1/projects/:projectId/canvas/edges/:edgeId", async (c) => {
    const projectId = c.req.param("projectId");
    const edgeId = c.req.param("edgeId");
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown> & ProjectWriteBody;
    const preconditions = requestProjectWritePreconditions(c, body);
    const envelope = {
      operation: "canvas_update_edge",
      entity: { kind: "canvas-edge", id: edgeId },
      expectedReadToken: preconditions.expectedReadToken,
      forced: preconditions.force,
    };
    const patch = canvasEdgePatchFromBody(body);
    if (Object.prototype.hasOwnProperty.call(patch, "source") && !normalizeString(patch.source)) {
      return c.json({
        error: "Invalid edge source",
        mutation: hostMutationRejected(envelope, "Invalid edge source"),
      }, 400);
    }
    if (Object.prototype.hasOwnProperty.call(patch, "target") && !normalizeString(patch.target)) {
      return c.json({
        error: "Invalid edge target",
        mutation: hostMutationRejected(envelope, "Invalid edge target"),
      }, 400);
    }

    const result = await replicaStore.updateSnapshotAtomic<SnapshotWriteRouteResult>(projectId, async (doc) => {
      const existing = readCanvasEdge(doc, edgeId);
      if (!existing) {
        const message = `Edge not found: ${edgeId}`;
        return {
          save: false,
          value: {
            status: 404 as const,
            body: {
              error: message,
              mutation: hostMutationRejected(envelope, message),
            },
          },
        };
      }
      const currentReadToken = canvasEdgeReadToken(existing);
      const currentEdges = listCanvasReadProofEdges(doc);
      const readProof = validateCanvasEdgeReadProof({
        operation: "update",
        actorClientType: preconditions.actorClientType,
        edge: existing,
        expectedReadToken: preconditions.expectedReadToken,
        requireReceipt: true,
        readReceiptVerifier: verifyLocalApiCanvasEdgeReadReceipt,
        force: preconditions.force,
      });
      const existingEndpoint = typeof existing.source === "string" && typeof existing.target === "string"
        ? { source: existing.source, target: existing.target }
        : null;
      const edgeGuard = validateCanvasEdgePatch({
        existingEdge: existingEndpoint,
        patch,
        nodes: readCanvasGuardrailNodes(doc),
        edges: canvasGuardrailEdges(currentEdges),
        force: preconditions.force,
      });
      const hostMutation = validateHostMutationEnvelope({
        operation: "canvas_update_edge",
        entity: { kind: "canvas-edge", id: edgeId },
        expectedReadToken: preconditions.expectedReadToken,
        currentReadToken,
        force: preconditions.force,
        guard: readProof.ok ? edgeGuard : readProof,
      });
      if (!hostMutation.ok) {
        return {
          save: false,
          value: {
            status: 409 as const,
            body: {
              error: hostMutation.error,
              mutation: hostMutation.mutation,
            },
          },
        };
      }

      const { id: _id, readToken: _readToken, ...persistedExisting } = existing as Record<string, unknown>;
      doc.getMap("edges").set(edgeId, {
        ...persistedExisting,
        ...patch,
        ...(Object.prototype.hasOwnProperty.call(patch, "source") ? { source: normalizeString(patch.source) } : {}),
        ...(Object.prototype.hasOwnProperty.call(patch, "target") ? { target: normalizeString(patch.target) } : {}),
      });
      const updated = readCanvasEdge(doc, edgeId);
      const afterReadToken = updated ? canvasEdgeReceiptReadToken(updated) : undefined;
      return {
        value: {
          status: 200 as const,
          body: {
            edge: updated ? canvasEdgeResponse(updated) : undefined,
            ...(afterReadToken ? { readToken: afterReadToken } : {}),
            mutation: hostMutationSucceeded(hostMutation.envelope, {
              resultEntityId: edgeId,
              afterReadToken,
            }),
            ...(preconditions.force ? { forced: true } : {}),
          },
        },
      };
    });
    return c.json(result.body, result.status);
  });

  app.delete("/api/v1/projects/:projectId/canvas/edges/:edgeId", async (c) => {
    const projectId = c.req.param("projectId");
    const edgeId = c.req.param("edgeId");
    const body = (await c.req.json().catch(() => ({}))) as ProjectWriteBody;
    const preconditions = requestProjectWritePreconditions(c, body);
    const envelope = {
      operation: "canvas_delete_edge",
      entity: { kind: "canvas-edge", id: edgeId },
      expectedReadToken: preconditions.expectedReadToken,
      forced: preconditions.force,
    };
    const result = await replicaStore.updateSnapshotAtomic<SnapshotWriteRouteResult>(projectId, async (doc) => {
      const existing = readCanvasEdge(doc, edgeId);
      if (!existing) {
        const message = `Edge not found: ${edgeId}`;
        return {
          save: false,
          value: {
            status: 404 as const,
            body: {
              error: message,
              mutation: hostMutationRejected(envelope, message),
            },
          },
        };
      }

      const currentReadToken = canvasEdgeReadToken(existing);
      const currentEdges = listCanvasReadProofEdges(doc);
      const readProof = validateCanvasEdgeReadProof({
        operation: "delete",
        actorClientType: preconditions.actorClientType,
        edge: existing,
        expectedReadToken: preconditions.expectedReadToken,
        requireReceipt: true,
        readReceiptVerifier: verifyLocalApiCanvasEdgeReadReceipt,
        force: preconditions.force,
      });
      const existingEndpoint = typeof existing.source === "string" && typeof existing.target === "string"
        ? { source: existing.source, target: existing.target }
        : { source: "", target: "" };
      const deleteGuard = validateCanvasEdgeDelete({
        edge: existingEndpoint,
        nodes: readCanvasGuardrailNodes(doc),
        edges: canvasGuardrailEdges(currentEdges),
        force: preconditions.force,
      });
      const hostMutation = validateHostMutationEnvelope({
        operation: "canvas_delete_edge",
        entity: { kind: "canvas-edge", id: edgeId },
        expectedReadToken: preconditions.expectedReadToken,
        currentReadToken,
        force: preconditions.force,
        guard: readProof.ok ? deleteGuard : readProof,
      });
      if (!hostMutation.ok) {
        return {
          save: false,
          value: {
            status: 409 as const,
            body: {
              error: hostMutation.error,
              mutation: hostMutation.mutation,
            },
          },
        };
      }

      doc.getMap("edges").delete(edgeId);
      const afterReadToken = canvasEdgesReceiptReadToken(listCanvasReadProofEdges(doc));
      return {
        value: {
          status: 200 as const,
          body: {
            deleted: true,
            edgeId,
            readToken: afterReadToken,
            mutation: hostMutationSucceeded(hostMutation.envelope, {
              resultEntityId: edgeId,
              afterReadToken,
            }),
            ...(preconditions.force ? { forced: true } : {}),
          },
        },
      };
    });
    if (result.status === 200) {
      const mutation = result.body.mutation as HostMutationRecord | undefined;
      if (mutation?.accepted === true) {
        await db.appendMutationAudit(mutationAuditRecord({
          mutation,
          actorClientType: preconditions.actorClientType,
          reason: "canvas edge delete",
        }));
      }
    }
    return c.json(result.body, result.status);
  });

  app.delete("/api/v1/projects/:id", async (c) => {
    const projectId = c.req.param("id");
    const body = (await c.req.json().catch(() => ({}))) as ProjectWriteBody;
    const preconditions = requestProjectWritePreconditions(c, body);
    const recoveryPolicy = await projectRecoveryPolicy(syncConfig);
    const result = await db.update((state) => {
      const project = findActiveProject(state, projectId);
      if (!project) {
        return {
          status: 404 as const,
          body: {
            error: "Project not found",
            mutation: hostMutationRejected({
              operation: "project_delete",
              entity: { kind: "project", id: projectId },
              expectedReadToken: preconditions.expectedReadToken,
              forced: preconditions.force,
            }, "Project not found"),
          },
        };
      }
      const hostMutation = validateProjectReadMutation({
        project,
        operation: "delete",
        preconditions,
      });
      if (!hostMutation.ok) {
        return {
          status: 409 as const,
          body: { error: hostMutation.error, mutation: hostMutation.mutation },
        };
      }
      const deleted = deleteProjectFromState(state, projectId);
      if (!deleted) {
        return {
          status: 404 as const,
          body: {
            error: "Project not found",
            mutation: hostMutationRejected(hostMutation.envelope, "Project not found"),
          },
        };
      }
      const readToken = projectReceiptReadToken(deleted);
      return {
        status: 200 as const,
        body: {
          deleted: true,
          recoverable: true,
          id: deleted.id,
          deletedAt: deleted.deletedAt,
          readToken,
          recoveryPolicy,
          mutation: hostMutationSucceeded(hostMutation.envelope, {
            resultEntityId: deleted.id,
            afterReadToken: readToken,
          }),
        },
      };
    });
    if (result.status === 200) {
      const mutation = result.body.mutation as HostMutationRecord | undefined;
      if (mutation?.accepted === true) {
        await db.appendMutationAudit(mutationAuditRecord({
          mutation,
          actorClientType: preconditions.actorClientType,
          reason: "project soft delete",
        }));
      }
    }
    return c.json(result.body, result.status);
  });

  app.post("/api/v1/projects/:id/restore", async (c) => {
    const projectId = c.req.param("id");
    const body = (await c.req.json().catch(() => ({}))) as ProjectWriteBody;
    const preconditions = requestProjectWritePreconditions(c, body);
    const recoveryPolicy = await projectRecoveryPolicy(syncConfig);
    const result = await db.update((state) => {
      const project = state.projects.find((candidate) => candidate.id === projectId && isDeletedProject(candidate));
      if (!project) {
        return {
          status: 404 as const,
          body: {
            error: "Project recovery point not found",
            mutation: hostMutationRejected({
              operation: "project_restore",
              entity: { kind: "project", id: projectId },
              expectedReadToken: preconditions.expectedReadToken,
              forced: preconditions.force,
            }, "Project recovery point not found"),
          },
        };
      }
      const hostMutation = validateProjectReadMutation({
        project,
        operation: "restore",
        preconditions,
      });
      if (!hostMutation.ok) {
        return {
          status: 409 as const,
          body: { error: hostMutation.error, mutation: hostMutation.mutation },
        };
      }
      const restored = restoreProjectInState(state, projectId);
      if (!restored) {
        return {
          status: 404 as const,
          body: {
            error: "Project recovery point not found",
            mutation: hostMutationRejected(hostMutation.envelope, "Project recovery point not found"),
          },
        };
      }
      const readToken = projectReceiptReadToken(restored);
      return {
        status: 200 as const,
        body: {
          restored: true,
          id: restored.id,
          readToken,
          recoveryPolicy,
          mutation: hostMutationSucceeded(hostMutation.envelope, {
            resultEntityId: restored.id,
            afterReadToken: readToken,
          }),
        },
      };
    });
    if (result.status === 200) {
      const mutation = result.body.mutation as HostMutationRecord | undefined;
      if (mutation?.accepted === true) {
        await db.appendMutationAudit(mutationAuditRecord({
          mutation,
          actorClientType: preconditions.actorClientType,
          reason: "project restore",
        }));
      }
    }
    return c.json(result.body, result.status);
  });

  app.delete("/api/v1/projects/:id/purge", async (c) => {
    const projectId = c.req.param("id");
    const body = (await c.req.json().catch(() => ({}))) as ProjectWriteBody & { confirm?: unknown };
    const preconditions = requestProjectWritePreconditions(c, body);
    const recoveryPolicy = await projectRecoveryPolicy(syncConfig);
    const purgedRecoveryPolicy = { ...recoveryPolicy, localRestoreAllowed: false };
    if (body.confirm !== "purge") {
      return c.json({
        error: "confirm must be \"purge\"",
        mutation: hostMutationRejected({
          operation: "project_purge",
          entity: { kind: "project", id: projectId },
          expectedReadToken: preconditions.expectedReadToken,
          forced: preconditions.force,
        }, "confirm must be \"purge\""),
      }, 400);
    }

    const result = await db.update((state) => {
      const project = state.projects.find((candidate) => candidate.id === projectId);
      if (!project) {
        return {
          status: 404 as const,
          body: {
            error: "Project recovery point not found",
            mutation: hostMutationRejected({
              operation: "project_purge",
              entity: { kind: "project", id: projectId },
              expectedReadToken: preconditions.expectedReadToken,
              forced: preconditions.force,
            }, "Project recovery point not found"),
          },
        };
      }
      if (!isDeletedProject(project)) {
        return {
          status: 409 as const,
          body: {
            error: "Project must be deleted before purge",
            mutation: hostMutationRejected({
              operation: "project_purge",
              entity: { kind: "project", id: projectId },
              expectedReadToken: preconditions.expectedReadToken,
              forced: preconditions.force,
            }, "Project must be deleted before purge"),
          },
        };
      }
      const hostMutation = validateProjectReadMutation({
        project,
        operation: "purge",
        preconditions,
      });
      if (!hostMutation.ok) {
        return {
          status: 409 as const,
          body: { error: hostMutation.error, mutation: hostMutation.mutation },
        };
      }
      const purgeAfter = projectPurgeAfter(project);
      if (!preconditions.force && !canPurgeProject(project)) {
        const message = `Project purge is delayed until ${purgeAfter}; pass force for an explicit admin purge.`;
        return {
          status: 409 as const,
          body: {
            error: message,
            recoverable: true,
            purgeAfter,
            recoveryPolicy,
            mutation: hostMutationRejected(hostMutation.envelope, message),
          },
        };
      }
      const purged = purgeProjectFromState(state, projectId);
      if (!purged) {
        return {
          status: 404 as const,
          body: {
            error: "Project recovery point not found",
            mutation: hostMutationRejected(hostMutation.envelope, "Project recovery point not found"),
          },
        };
      }
      return {
        status: 200 as const,
        body: {
          purged: true,
          recoverable: false,
          id: purged.project.id,
          deletedAt: purged.project.deletedAt,
          purgeAfter,
          removed: purged.counts,
          recoveryPolicy: purgedRecoveryPolicy,
          mutation: hostMutationSucceeded(hostMutation.envelope, {
            resultEntityId: purged.project.id,
          }),
        },
      };
    });
    if (result.status === 200) {
      await replicaStore.deleteReplica(projectId);
      const mutation = result.body.mutation as HostMutationRecord | undefined;
      if (mutation?.accepted === true) {
        await db.appendMutationAudit(mutationAuditRecord({
          mutation,
          actorClientType: preconditions.actorClientType,
          reason: "project purge",
        }));
      }
      return c.json({ ...result.body, replicaDeleted: true }, result.status);
    }
    return c.json(result.body, result.status);
  });

  app.get("/api/v1/mutation-audit", async (c) => {
    const limit = Number(c.req.query("limit"));
    const records = await db.listMutationAudit({
      operation: normalizeString(c.req.query("operation")),
      entityId: normalizeString(c.req.query("entityId")),
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    return c.json({ records });
  });

  app.get("/api/projects", async (c) => {
    const state = await db.load();
    return c.json(activeProjects(state).map((project) => withProjectAssets(project, state)));
  });

  app.post("/api/projects", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      prompt?: string;
      name?: string;
      description?: string;
    };
    const prompt = (body.prompt ?? body.name ?? "Untitled project").trim();
    if (!prompt) {
      return c.json({
        error: "Missing prompt",
        mutation: hostMutationRejected({
          operation: "project_create",
          entity: { kind: "project", id: "" },
          forced: false,
        }, "Missing prompt"),
      }, 400);
    }

    const project = await db.update((state) => {
      const createdAt = nowIso();
      const next: LocalProject = {
        id: crypto.randomUUID(),
        ownerId: userId,
        name: truncateProjectName(prompt),
        description: body.description ?? prompt,
        createdAt,
        updatedAt: createdAt,
        assets: [],
      };
      state.projects.unshift(next);
      return next;
    });
    const readToken = projectReceiptReadToken(project);
    return c.json({
      id: project.id,
      readToken,
      mutation: hostMutationSucceeded({
        operation: "project_create",
        entity: { kind: "project", id: project.id },
        forced: false,
      }, {
        resultEntityId: project.id,
        afterReadToken: readToken,
      }),
    });
  });

  app.get("/api/projects/:id", async (c) => {
    const state = await db.load();
    const project = findActiveProject(state, c.req.param("id"));
    return project ? c.json(withProjectAssets(project, state)) : c.json({ error: "Not found" }, 404);
  });

  app.patch("/api/projects/:id", async (c) => {
    const projectId = c.req.param("id");
    const body = (await c.req.json().catch(() => ({}))) as { name?: string } & ProjectWriteBody;
    const preconditions = requestProjectWritePreconditions(c, body);
    const name = body.name?.trim();
    if (!name) {
      return c.json({
        error: "Missing name",
        mutation: hostMutationRejected({
          operation: "project_update",
          entity: { kind: "project", id: projectId },
          expectedReadToken: preconditions.expectedReadToken,
          forced: preconditions.force,
        }, "Missing name"),
      }, 400);
    }
    const result = await db.update((state) => {
      const project = findActiveProject(state, projectId);
      if (!project) {
        return {
          status: 404 as const,
          body: {
            error: "Not found",
            mutation: hostMutationRejected({
              operation: "project_update",
              entity: { kind: "project", id: projectId },
              expectedReadToken: preconditions.expectedReadToken,
              forced: preconditions.force,
            }, "Not found"),
          },
        };
      }
      const hostMutation = validateProjectReadMutation({
        project,
        operation: "update",
        preconditions,
      });
      if (!hostMutation.ok) {
        return {
          status: 409 as const,
          body: { error: hostMutation.error, mutation: hostMutation.mutation },
        };
      }
      project.name = name;
      project.updatedAt = nowIso();
      const readToken = projectReceiptReadToken(project);
      return {
        status: 200 as const,
        body: {
          ok: true,
          id: project.id,
          readToken,
          mutation: hostMutationSucceeded(hostMutation.envelope, {
            resultEntityId: project.id,
            afterReadToken: readToken,
          }),
        },
      };
    });
    return c.json(result.body, result.status);
  });

  app.delete("/api/projects/:id", async (c) => {
    const projectId = c.req.param("id");
    const body = (await c.req.json().catch(() => ({}))) as ProjectWriteBody;
    const preconditions = requestProjectWritePreconditions(c, body);
    const recoveryPolicy = await projectRecoveryPolicy(syncConfig);
    const result = await db.update((state) => {
      const project = findActiveProject(state, projectId);
      if (!project) {
        return {
          status: 404 as const,
          body: {
            error: "Not found",
            mutation: hostMutationRejected({
              operation: "project_delete",
              entity: { kind: "project", id: projectId },
              expectedReadToken: preconditions.expectedReadToken,
              forced: preconditions.force,
            }, "Not found"),
          },
        };
      }
      const hostMutation = validateProjectReadMutation({
        project,
        operation: "delete",
        preconditions,
      });
      if (!hostMutation.ok) {
        return {
          status: 409 as const,
          body: { error: hostMutation.error, mutation: hostMutation.mutation },
        };
      }
      const deleted = deleteProjectFromState(state, projectId);
      if (!deleted) {
        return {
          status: 404 as const,
          body: {
            error: "Not found",
            mutation: hostMutationRejected(hostMutation.envelope, "Not found"),
          },
        };
      }
      const readToken = projectReceiptReadToken(deleted);
      return {
        status: 200 as const,
        body: {
          deleted: true,
          recoverable: true,
          id: deleted.id,
          deletedAt: deleted.deletedAt,
          readToken,
          recoveryPolicy,
          mutation: hostMutationSucceeded(hostMutation.envelope, {
            resultEntityId: deleted.id,
            afterReadToken: readToken,
          }),
        },
      };
    });
    if (result.status === 200) {
      const mutation = result.body.mutation as HostMutationRecord | undefined;
      if (mutation?.accepted === true) {
        await db.appendMutationAudit(mutationAuditRecord({
          mutation,
          actorClientType: preconditions.actorClientType,
          reason: "legacy project soft delete",
        }));
      }
    }
    return c.json(result.body, result.status);
  });

  app.get("/api/v1/sessions", async (c) => {
    const state = await db.load();
    const projectId = c.req.query("projectId");
    const activeProjectIds = new Set(activeProjects(state).map((project) => project.id));
    return c.json({
      sessions: projectId
        ? (
            isDeletedKnownProject(state, projectId)
              ? []
              : state.sessions.filter((s) => s.projectId === projectId)
          ).map(publicLocalSession)
        : state.sessions
            .filter((session) => !isDeletedKnownProject(state, session.projectId) || activeProjectIds.has(session.projectId))
            .map(publicLocalSession),
    });
  });

  app.post("/api/v1/sessions", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { projectId?: string; title?: string };
    if (!body.projectId) {
      return c.json({
        error: "Missing projectId",
        mutation: hostMutationRejected({
          operation: "session_create",
          entity: { kind: "session", id: "" },
          forced: false,
        }, "Missing projectId"),
      }, 400);
    }
    const created = await db.update((state) => {
      if (isDeletedKnownProject(state, body.projectId!)) {
        return {
          ok: false as const,
          error: "Project is deleted; restore it before creating sessions",
        };
      }
      const at = nowIso();
      const session: LocalSession = {
        id: crypto.randomUUID(),
        projectId: body.projectId!,
        title: body.title?.trim() || "Session",
        type: "cloud",
        createdAt: at,
        updatedAt: at,
      };
      state.sessions.unshift(session);
      return { ok: true as const, session };
    });
    if (!created.ok) {
      return c.json({
        error: created.error,
        mutation: hostMutationRejected({
          operation: "session_create",
          entity: { kind: "session", id: "" },
          forced: false,
        }, created.error),
      }, 409);
    }
    return c.json({
      threadId: created.session.id,
      title: created.session.title,
      mutation: hostMutationSucceeded({
        operation: "session_create",
        entity: { kind: "session", id: created.session.id },
        forced: false,
      }, {
        resultEntityId: created.session.id,
      }),
    });
  });

  app.delete("/api/v1/sessions", async (c) => {
    const threadId = c.req.query("threadId");
    if (!threadId) {
      return c.json({
        error: "Missing threadId",
        mutation: hostMutationRejected({
          operation: "session_delete",
          entity: { kind: "session", id: "" },
          forced: false,
        }, "Missing threadId"),
      }, 400);
    }

    const preconditions = requestProjectWritePreconditions(c);
    const result = await db.update((state) => {
      const session = state.sessions.find((candidate) => candidate.id === threadId);
      if (!session) {
        return {
          status: 404 as const,
          body: {
            error: "Not found",
            mutation: hostMutationRejected({
              operation: "session_delete",
              entity: { kind: "session", id: threadId },
              forced: false,
            }, "Not found"),
          },
        };
      }
      if (!preconditions.actorClientType && !preconditions.expectedReadToken && !preconditions.force) {
        state.sessions = state.sessions.filter((session) => session.id !== threadId);
        state.sessionMessages = state.sessionMessages.filter((message) => message.session_id !== threadId);
        return {
          status: 200 as const,
          body: {
            ok: true,
            mutation: hostMutationSucceeded({
              operation: "session_delete",
              entity: { kind: "session", id: threadId },
              forced: false,
            }, {
              resultEntityId: threadId,
            }),
          },
        };
      }
      const hostMutation = validateSessionReadMutation({
        session,
        operation: "delete",
        preconditions,
      });
      if (!hostMutation.ok) {
        return {
          status: 409 as const,
          body: {
            error: hostMutation.error,
            mutation: hostMutation.mutation,
          },
        };
      }
      state.sessions = state.sessions.filter((session) => session.id !== threadId);
      state.sessionMessages = state.sessionMessages.filter((message) => message.session_id !== threadId);
      return {
        status: 200 as const,
        body: {
          ok: true,
          mutation: hostMutationSucceeded(hostMutation.envelope, {
            resultEntityId: threadId,
          }),
        },
      };
    });
    if (result.status === 200) {
      const mutation = result.body.mutation as HostMutationRecord | undefined;
      if (mutation?.accepted === true) {
        await db.appendMutationAudit(mutationAuditRecord({
          mutation,
          actorClientType: preconditions.actorClientType,
          reason: "session delete",
        }));
      }
    }
    return c.json(result.body, result.status);
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
    const actorClientType = normalizeString(c.req.header("x-clash-client-type")) ??
      normalizeString(c.req.header("x-clash-actor-client-type")) ??
      normalizeString(form.get("actorClientType"));
    const projectId = String(form.get("projectId") ?? "");
    const taskId = String(form.get("taskId") ?? "");
    const nodeId = String(form.get("nodeId") ?? "");
    const outputType = String(form.get("outputType") ?? "image");
    const outputIndexRaw = form.get("outputIndex");
    const outputIndex = outputIndexRaw == null ? 0 : Number.parseInt(String(outputIndexRaw), 10) || 0;
    const indexSuffix = outputIndex > 0 ? `-${outputIndex}` : "";
    const resultId = taskId ? `${taskId}${indexSuffix}` : "";
    const envelope = localMutationEnvelope("custom_action_upload", "custom-action-result", resultId);
    if (!projectId || !taskId || !nodeId) {
      return c.json({
        error: "Missing required fields: projectId, taskId, nodeId",
        mutation: hostMutationRejected(envelope, "Missing required fields: projectId, taskId, nodeId"),
      }, 400);
    }

    if (outputType === "text") {
      const mutation = hostMutationSucceeded(envelope, { resultEntityId: resultId });
      await db.appendMutationAudit(mutationAuditRecord({
        mutation,
        actorClientType,
        reason: "custom action upload",
      }));
      return c.json({
        success: true,
        storageKey: null,
        content: String(form.get("content") ?? ""),
        mutation,
      });
    }

    const file = form.get("file");
    if (!file || typeof file === "string") {
      return c.json({
        error: "Missing file for image/video/audio output",
        mutation: hostMutationRejected(envelope, "Missing file for image/video/audio output"),
      }, 400);
    }

    const kind = outputType === "video" ? "video" : outputType === "audio" ? "audio" : "image";
    const ext = kind === "video" ? ".mp4" : kind === "audio" ? ".mp3" : ".png";
    const storageKey = `projects/${sanitizeFileName(projectId)}/custom/${sanitizeFileName(taskId)}${indexSuffix}${ext}`;
    let path: string;
    try {
      path = await assetPathForWrite(options.dataDir, storageKey);
    } catch (error) {
      const message = errorMessage(error);
      return c.json({
        error: message,
        mutation: hostMutationRejected(envelope, message),
      }, 400);
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const contentHash = sha256Hex(bytes);
    const assetId = outputIndex > 0 ? `${taskId}${indexSuffix}` : taskId;
    const existingState = await db.load();
    const existingAsset = existingState.assets.find((item) => item.id === assetId);
    if (existingAsset) {
      const metadata = existingAsset.metadata && typeof existingAsset.metadata === "object" && !Array.isArray(existingAsset.metadata)
        ? existingAsset.metadata as Record<string, unknown>
        : {};
      const existingContentHash = typeof metadata.contentHash === "string" ? metadata.contentHash : undefined;
      const checkpointConflict = existingAsset.kind !== kind ||
        existingAsset.srcR2Key !== storageKey ||
        existingContentHash !== contentHash;
      if (checkpointConflict) {
        const message = "Custom action output already exists with different checkpoint content. Use a new task id/output index or create an explicit replacement.";
        return c.json({
          error: message,
          mutation: hostMutationRejected(envelope, message),
        }, 409);
      }
    }
    await writeFile(path, bytes);

    const at = Math.floor(Date.now() / 1000);
    const exp = signedUrlExp();
    const asset: Asset = {
      id: assetId,
      userId: String(form.get("actorUserId") ?? "") || userId,
      kind,
      srcR2Key: storageKey,
      coverR2Key: null,
      metadata: { bytes: bytes.byteLength, contentType: file.type || contentTypeForPath(storageKey), contentHash },
      sourceModel: "custom-action",
      sourcePrompt: null,
      sourceTaskId: taskId,
      sources: null,
      signedUrl: localAssetUrl(c, storageKey),
      signedUrlExp: exp,
      createdAt: at,
      updatedAt: at,
    };
    await db.update((state) => {
      state.assets = [
        { ...asset, projectId },
        ...state.assets.filter((item) => item.id !== asset.id),
      ];
      state.assetRefs = [
        { assetId: asset.id, projectId, importedAt: at },
        ...state.assetRefs.filter((ref) => !(ref.assetId === asset.id && ref.projectId === projectId)),
      ];
    });
    const mutation = hostMutationSucceeded(envelope, { resultEntityId: assetId });
    await db.appendMutationAudit(mutationAuditRecord({
      mutation,
      actorClientType,
      reason: "custom action upload",
    }));
    return c.json({
      success: true,
      storageKey,
      assetId,
      mutation,
    });
  });

  app.post("/upload", async (c) => {
    const form = await c.req.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") {
      const envelope = localMutationEnvelope("asset_blob_upload", "asset-blob", "");
      return c.json({
        error: "Missing file",
        mutation: hostMutationRejected(envelope, "Missing file"),
      }, 400);
    }

    const storageKey = `uploads/${crypto.randomUUID().slice(0, 8)}-${sanitizeFileName(file.name)}`;
    const envelope = localMutationEnvelope("asset_blob_upload", "asset-blob", storageKey);
    let path: string;
    try {
      path = await assetPathForWrite(options.dataDir, storageKey);
    } catch (error) {
      const message = errorMessage(error);
      return c.json({
        error: message,
        mutation: hostMutationRejected(envelope, message),
      }, 400);
    }
    await writeFile(path, new Uint8Array(await file.arrayBuffer()));
    return c.json({
      storageKey,
      mutation: hostMutationSucceeded(envelope, { resultEntityId: storageKey }),
    });
  });

  app.get("/assets/*", async (c) => {
    const storageKey = c.req.path.slice("/assets/".length);
    if (!storageKey || storageKey === "sign" || storageKey === "sign-batch") {
      return c.text("Not found", 404);
    }
    try {
      const bytes = await readFile(await assetPathForRead(options.dataDir, storageKey, clashRoot));
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
    } & ProjectWriteBody;
    const actorClientType = optionalBodyString(body.actorClientType) ??
      normalizeString(c.req.header("x-clash-client-type")) ??
      normalizeString(c.req.header("x-clash-actor-client-type"));
    if (!body.projectId || !body.kind || typeof body.srcR2Key !== "string" || !body.srcR2Key) {
      return c.json({
        error: "Missing projectId, kind, or srcR2Key",
        mutation: hostMutationRejected({
          operation: "asset_create",
          entity: { kind: "asset", id: "" },
          forced: false,
        }, "Missing projectId, kind, or srcR2Key"),
      }, 400);
    }
    let srcR2Key: string;
    let coverR2Key: string | null;
    try {
      srcR2Key = normalizeAssetStorageKey(body.srcR2Key);
      coverR2Key = body.coverR2Key ? normalizeAssetStorageKey(body.coverR2Key) : null;
    } catch (error) {
      const message = errorMessage(error);
      return c.json({
        error: message,
        mutation: hostMutationRejected({
          operation: "asset_create",
          entity: { kind: "asset", id: "" },
          forced: false,
        }, message),
      }, 400);
    }
    const projectId = body.projectId;
    const at = Math.floor(Date.now() / 1000);
    const exp = signedUrlExp();
    const asset: Asset = {
      id: crypto.randomUUID(),
      userId,
      kind: body.kind,
      srcR2Key,
      coverR2Key,
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
    await db.update((state) => {
      state.assets.unshift(asset);
      state.assetRefs.unshift({
        assetId: asset.id,
        projectId,
        importedAt: at,
      });
    });
    const mutation = hostMutationSucceeded({
      operation: "asset_create",
      entity: { kind: "asset", id: asset.id },
      forced: false,
    }, {
      resultEntityId: asset.id,
    });
    await db.appendMutationAudit(mutationAuditRecord({
      mutation,
      actorClientType,
      reason: "asset create",
    }));
    return c.json({
      id: asset.id,
      srcR2Key: asset.srcR2Key,
      coverR2Key: asset.coverR2Key,
      signedUrl: asset.signedUrl,
      signedUrlExp: asset.signedUrlExp,
      mutation,
    });
  });

  app.post("/api/v1/assets/import", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      projectId?: unknown;
      kind?: unknown;
      assetId?: unknown;
      contentHash?: unknown;
      localBlobKey?: unknown;
      bytes?: unknown;
      contentType?: unknown;
      originalName?: unknown;
    } & ProjectWriteBody;
    const actorClientType = optionalBodyString(body.actorClientType) ??
      normalizeString(c.req.header("x-clash-client-type")) ??
      normalizeString(c.req.header("x-clash-actor-client-type"));
    const projectId = optionalBodyString(body.projectId);
    const contentHash = optionalBodyString(body.contentHash);
    const localBlobKey = optionalBodyString(body.localBlobKey);
    if (!projectId || !isAssetKind(body.kind) || !contentHash || !localBlobKey) {
      return c.json({
        error: "Missing projectId, kind, contentHash, or localBlobKey",
        mutation: hostMutationRejected({
          operation: "asset_import",
          entity: { kind: "asset", id: "" },
          forced: false,
        }, "Missing projectId, kind, contentHash, or localBlobKey"),
      }, 400);
    }
    if (!/^[a-f0-9]{64}$/.test(contentHash)) {
      return c.json({
        error: "Invalid contentHash",
        mutation: hostMutationRejected({
          operation: "asset_import",
          entity: { kind: "asset", id: "" },
          forced: false,
        }, "Invalid contentHash"),
      }, 400);
    }

    let srcR2Key: string;
    try {
      srcR2Key = normalizeLocalBlobStorageKey(localBlobKey);
    } catch (error) {
      const message = errorMessage(error);
      return c.json({
        error: message,
        mutation: hostMutationRejected({
          operation: "asset_import",
          entity: { kind: "asset", id: "" },
          forced: false,
        }, message),
      }, 400);
    }

    const assetId = optionalBodyString(body.assetId) ?? `local:sha256:${contentHash}`;
    const envelope = {
      operation: "asset_import",
      entity: { kind: "asset", id: assetId },
      forced: false,
    };
    let fileInfo: Awaited<ReturnType<typeof stat>>;
    try {
      fileInfo = await stat(await assetPathForRead(options.dataDir, srcR2Key, clashRoot));
      if (!fileInfo.isFile()) throw new Error("Local blob is not a file");
    } catch {
      return c.json({
        error: "Local blob not found",
        mutation: hostMutationRejected(envelope, "Local blob not found"),
      }, 404);
    }

    const at = Math.floor(Date.now() / 1000);
    const exp = signedUrlExp();
    const asset: Asset = {
      id: assetId,
      userId,
      kind: body.kind,
      srcR2Key,
      coverR2Key: null,
      metadata: {
        bytes: typeof body.bytes === "number" && Number.isFinite(body.bytes) ? Math.floor(body.bytes) : fileInfo.size,
        contentType: optionalBodyString(body.contentType) ?? contentTypeForPath(srcR2Key),
        contentHash,
        localBlobKey,
        ...(optionalBodyString(body.originalName) ? { originalName: optionalBodyString(body.originalName) } : {}),
      },
      sourceModel: "local-import",
      sourcePrompt: null,
      sourceTaskId: null,
      sources: null,
      signedUrl: localAssetUrl(c, srcR2Key),
      signedUrlExp: exp,
      createdAt: at,
      updatedAt: at,
    };

    const importResult = await db.update((state) => {
      const existing = state.assets.find((item) => item.id === asset.id);
      if (existing) {
        const metadata = existing.metadata && typeof existing.metadata === "object" && !Array.isArray(existing.metadata)
          ? existing.metadata as Record<string, unknown>
          : {};
        const existingContentHash = typeof metadata.contentHash === "string" ? metadata.contentHash : undefined;
        const existingLocalBlobKey = typeof metadata.localBlobKey === "string" ? metadata.localBlobKey : undefined;
        const immutableConflict = existing.kind !== asset.kind ||
          existing.srcR2Key !== asset.srcR2Key ||
          (existingContentHash !== undefined && existingContentHash !== contentHash) ||
          (existingLocalBlobKey !== undefined && existingLocalBlobKey !== localBlobKey);
        if (immutableConflict) {
          return { status: "conflict" as const };
        }
      } else {
        state.assets = [asset, ...state.assets];
      }
      state.assetRefs = [
        { assetId: asset.id, projectId, importedAt: at },
        ...state.assetRefs.filter((ref) => !(ref.assetId === asset.id && ref.projectId === projectId)),
      ];
      return { status: "ok" as const, asset: existing ?? asset };
    });
    if (importResult.status === "conflict") {
      const message = "Asset id already exists with different immutable content. Import the new blob as a new asset id and use copy-on-write replacement.";
      return c.json({
        error: message,
        mutation: hostMutationRejected(envelope, message),
      }, 409);
    }

    const mutation = hostMutationSucceeded(envelope, {
      resultEntityId: asset.id,
    });
    await db.appendMutationAudit(mutationAuditRecord({
      mutation,
      actorClientType,
      reason: "asset import",
    }));
    return c.json({
      id: importResult.asset.id,
      srcR2Key: importResult.asset.srcR2Key,
      signedUrl: localAssetUrl(c, importResult.asset.srcR2Key),
      signedUrlExp: asset.signedUrlExp,
      mutation,
    });
  });

  app.post("/api/v1/assets/replace", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      projectId?: unknown;
      nodeId?: unknown;
      assetId?: unknown;
      ifMatch?: unknown;
      actorClientType?: unknown;
      newNodeId?: unknown;
      label?: unknown;
      force?: unknown;
    };
    const projectId = optionalBodyString(body.projectId);
    const nodeId = optionalBodyString(body.nodeId);
    const assetId = optionalBodyString(body.assetId);
    const force = body.force === true || normalizeString(c.req.header("x-clash-force")) === "true";
    const expectedReadToken = optionalBodyString(body.ifMatch) ??
      normalizeIfMatchHeader(c.req.header("x-clash-if-match")) ??
      normalizeIfMatchHeader(c.req.header("if-match"));
    const actorClientType = optionalBodyString(body.actorClientType) ??
      normalizeString(c.req.header("x-clash-client-type")) ??
      normalizeString(c.req.header("x-clash-actor-client-type"));
    const envelope = {
      operation: "asset_cow_replace",
      entity: { kind: "media-node", id: nodeId ?? "" },
      expectedReadToken,
      forced: force,
    };

    if (!projectId || !nodeId || !assetId) {
      return c.json({
        error: "Missing projectId, nodeId, or assetId",
        mutation: hostMutationRejected(envelope, "Missing projectId, nodeId, or assetId"),
      }, 400);
    }

    const state = await db.load();
    const asset = state.assets.find((item) => item.id === assetId);
    if (!asset) {
      return c.json({
        error: "asset not found",
        mutation: hostMutationRejected(envelope, "asset not found"),
      }, 404);
    }

    const result = await replicaStore.updateSnapshotAtomic<SnapshotWriteRouteResult>(projectId, async (doc) => {
      const canvas = new Canvas(doc, () => {});
      const node = canvas.readNode(nodeId);
      if (!node) {
        return {
          save: false,
          value: {
            status: 404 as const,
            body: {
              error: `Node not found: ${nodeId}`,
              mutation: hostMutationRejected(envelope, `Node not found: ${nodeId}`),
            },
          },
        };
      }
      if (!isMediaNodeType(node.type)) {
        const message = `Node ${nodeId} has type "${node.type}", expected image, video, or audio`;
        return {
          save: false,
          value: {
            status: 400 as const,
            body: {
              error: message,
              mutation: hostMutationRejected(envelope, message),
            },
          },
        };
      }
      if (asset.kind !== node.type) {
        const message = `Asset ${assetId} has kind "${asset.kind}", expected ${node.type}`;
        return {
          save: false,
          value: {
            status: 400 as const,
            body: {
              error: message,
              mutation: hostMutationRejected(envelope, message),
            },
          },
        };
      }

      const currentReadToken = canvasNodeReadToken(node);
      const readProof = validateCanvasReadProof({
        operation: "update",
        actorClientType,
        node,
        expectedReadToken,
        requireReceipt: true,
        readReceiptVerifier: verifyLocalApiCanvasReadReceipt,
        force,
      });
      const hostMutation = validateHostMutationEnvelope({
        operation: "asset_cow_replace",
        entity: { kind: "media-node", id: nodeId },
        expectedReadToken,
        currentReadToken,
        force,
        guard: readProof,
      });
      if (!hostMutation.ok) {
        return {
          save: false,
          value: {
            status: 409 as const,
            body: {
              error: hostMutation.error,
              mutation: hostMutation.mutation,
            },
          },
        };
      }

      const newNodeId = optionalBodyString(body.newNodeId) ?? crypto.randomUUID().slice(0, 8);
      const sourceAssetId = typeof node.data?.assetId === "string" ? node.data.assetId : undefined;
      const data = createMediaAssetCowNodeData({
        sourceNodeId: nodeId,
        sourceLabel: typeof node.data?.label === "string" ? node.data.label : undefined,
        sourceAssetId,
        assetId,
        label: optionalBodyString(body.label),
      });

      try {
        canvas.createLinkedNode({
          nodeId: newNodeId,
          nodeType: node.type,
          data,
          parentId: node.parent_id ?? null,
          sourceNodeId: nodeId,
          edgeId: `${nodeId}-${newNodeId}`,
          edgeType: "copy-on-write",
        });
      } catch (error) {
        const message = errorMessage(error);
        return {
          save: false,
          value: {
            status: 409 as const,
            body: {
              error: message,
              mutation: hostMutationRejected(hostMutation.envelope, message),
            },
          },
        };
      }

      const newNode = canvas.readNode(newNodeId);
      const afterReadToken = newNode ? canvasNodeReceiptReadToken(newNode) : undefined;
      const importedAt = Math.floor(Date.now() / 1000);
      return {
        value: {
          status: 200 as const,
          assetRef: { assetId, projectId, importedAt },
          body: {
            replaced: true,
            copyOnWrite: true,
            sourceNodeId: nodeId,
            newNodeId,
            nodeId: newNodeId,
            sourceAssetId,
            assetId,
            lineageEdge: { source: nodeId, target: newNodeId, type: "copy-on-write" },
            ...(afterReadToken ? { readToken: afterReadToken } : {}),
            mutation: hostMutationSucceeded(hostMutation.envelope, {
              resultEntityId: newNodeId,
              afterReadToken,
            }),
            ...(force ? { forced: true } : {}),
          },
        },
      };
    });
    if (result.status === 200 && result.assetRef) {
      const assetRef = result.assetRef;
      await db.update((current) => {
        current.assetRefs = [
          assetRef,
          ...current.assetRefs.filter((ref) => !(ref.assetId === assetId && ref.projectId === projectId)),
        ];
      });
    }
    return c.json(result.body, result.status);
  });

  app.post("/api/v1/assets/gc", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      dryRun?: unknown;
      protectedAssetIds?: unknown;
      projectIds?: unknown;
    } & ProjectWriteBody;
    const dryRun = body.dryRun !== false;
    const scope = await resolveAssetGarbageCollectionScope(options.dataDir, body);

    if (dryRun) {
      const plan = buildAssetGarbageCollectionPlan(await db.load(), scope);
      return c.json({
        dryRun,
        deletedAssets: plan.deletedAssets,
        protectedAssets: plan.protectedAssets,
        protectedProjectIds: plan.protectedProjectIds,
        deletedBlobKeys: plan.deletedBlobKeys,
        readToken: assetGarbageCollectionReceiptReadToken(plan),
        mutation: hostMutationSucceeded({
          operation: "asset_gc",
          entity: { kind: "asset-store", id: "local" },
          forced: false,
        }, {
          resultEntityId: "local",
        }),
      });
    }

    const preconditions = requestProjectWritePreconditions(c, body);
    const result = await db.update((current) => {
      const plan = buildAssetGarbageCollectionPlan(current, scope);
      const hostMutation = validateAssetGarbageCollectionMutation({ plan, preconditions });
      if (!hostMutation.ok) {
        return {
          status: 409 as const,
          blobKeys: [] as string[],
          body: { error: hostMutation.error, mutation: hostMutation.mutation },
        };
      }
      refreshAssetReferenceProjectionState(current, plan.protectedProjectIds, plan.projectedCanvasAssetRefs);
      current.assets = current.assets.filter((asset) => !plan.orphanedIds.has(asset.id));
      return {
        status: 200 as const,
        blobKeys: plan.deletedBlobKeys,
        body: {
          dryRun,
          deletedAssets: plan.deletedAssets,
          protectedAssets: plan.protectedAssets,
          protectedProjectIds: plan.protectedProjectIds,
          deletedBlobKeys: plan.deletedBlobKeys,
          mutation: hostMutationSucceeded(hostMutation.envelope, {
            resultEntityId: "local",
          }),
        },
      };
    });
    if (result.status === 200) {
      for (const key of result.blobKeys) {
        await rm(await assetPathForDelete(options.dataDir, key, clashRoot), { force: true });
      }
      const mutation = result.body.mutation as HostMutationRecord | undefined;
      if (mutation?.accepted === true) {
        await db.appendMutationAudit(mutationAuditRecord({
          mutation,
          actorClientType: preconditions.actorClientType,
          reason: "asset garbage collection",
        }));
      }
    }
    return c.json(result.body, result.status);
  });

  app.get("/api/v1/assets/:id", async (c) => {
    const state = await db.load();
    const asset = state.assets.find((a) => a.id === c.req.param("id"));
    return asset
      ? c.json({ ...withSignedAssetUrls(c, asset), readToken: assetReceiptReadToken(asset) })
      : c.json({ error: "not found" }, 404);
  });

  app.get("/api/v1/assets/:id/references", async (c) => {
    const assetId = c.req.param("id");
    const projectId = c.req.query("projectId");
    const state = await db.load();
    const references = state.assetNodeRefs
      .filter((ref) => ref.assetId === assetId && (!projectId || ref.projectId === projectId))
      .sort((left, right) => (
        left.projectId.localeCompare(right.projectId)
        || left.nodeId.localeCompare(right.nodeId)
        || left.fieldPath.localeCompare(right.fieldPath)
      ))
      .map((ref) => ({
        assetId: ref.assetId,
        projectId: ref.projectId,
        nodeId: ref.nodeId,
        nodeType: ref.nodeType,
        fieldPath: ref.fieldPath,
        referenceRole: ref.referenceRole,
      }));
    return c.json({ assetId, references });
  });

  app.post("/api/v1/assets/:id/references/refresh", async (c) => {
    const assetId = c.req.param("id");
    const body = (await c.req.json().catch(() => ({}))) as { projectIds?: unknown } & ProjectWriteBody;
    const actorClientType = optionalBodyString(body.actorClientType) ??
      normalizeString(c.req.header("x-clash-client-type")) ??
      normalizeString(c.req.header("x-clash-actor-client-type"));
    const requestedProjectIds = stringArray(body.projectIds);
    const protectedProjectIds = requestedProjectIds.length > 0
      ? requestedProjectIds
      : await discoverProjectReplicaIds(options.dataDir);
    const state = await db.load();
    const knownAssetIds = new Set(state.assets.map((asset) => asset.id));
    const canvasAssetRefs = await collectProjectCanvasAssetRefs(options.dataDir, protectedProjectIds);
    const projectedCanvasAssetRefs = canvasAssetRefs.filter((ref) => knownAssetIds.has(ref.assetId));
    await db.update((current) => {
      refreshAssetReferenceProjectionState(current, protectedProjectIds, projectedCanvasAssetRefs);
    });
    const refreshed = await db.load();
    const projectFilter = new Set(protectedProjectIds);
    const references = refreshed.assetNodeRefs
      .filter((ref) => ref.assetId === assetId && projectFilter.has(ref.projectId))
      .sort((left, right) => (
        left.projectId.localeCompare(right.projectId)
        || left.nodeId.localeCompare(right.nodeId)
        || left.fieldPath.localeCompare(right.fieldPath)
      ))
      .map((ref) => ({
        assetId: ref.assetId,
        projectId: ref.projectId,
        nodeId: ref.nodeId,
        nodeType: ref.nodeType,
        fieldPath: ref.fieldPath,
        referenceRole: ref.referenceRole,
      }));
    const mutation = hostMutationSucceeded({
      operation: "asset_references_refresh",
      entity: { kind: "asset", id: assetId },
      forced: false,
    }, {
      resultEntityId: assetId,
    });
    await db.appendMutationAudit(mutationAuditRecord({
      mutation,
      actorClientType,
      reason: "asset reference refresh",
    }));
    return c.json({
      assetId,
      refreshed: true,
      protectedProjectIds,
      references,
      mutation,
    });
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

  app.get("/api/v1/assets/:id/ref", async (c) => {
    const assetId = c.req.param("id");
    const projectId = c.req.query("projectId");
    if (!projectId) {
      return c.json({ error: "Missing projectId" }, 400);
    }
    const state = await db.load();
    const ref = state.assetRefs.find((candidate) => candidate.assetId === assetId && candidate.projectId === projectId);
    if (!ref) {
      return c.json({ error: "asset ref not found" }, 404);
    }
    return c.json({
      assetId: ref.assetId,
      projectId: ref.projectId,
      importedAt: ref.importedAt,
      readToken: assetRefReceiptReadToken(ref),
    });
  });

  app.delete("/api/v1/assets/:id/ref", async (c) => {
    const assetId = c.req.param("id");
    const projectId = c.req.query("projectId");
    const body = (await c.req.json().catch(() => ({}))) as ProjectWriteBody;
    const preconditions = requestProjectWritePreconditions(c, body);
    if (!projectId) {
      return c.json({
        error: "Missing projectId",
        mutation: hostMutationRejected({
          operation: "asset_ref_delete",
          entity: { kind: "asset-ref", id: `${assetId}:` },
          expectedReadToken: preconditions.expectedReadToken,
          forced: preconditions.force,
        }, "Missing projectId"),
      }, 400);
    }
    const result = await db.update((state) => {
      const ref = state.assetRefs.find((candidate) => candidate.assetId === assetId && candidate.projectId === projectId);
      if (!ref) {
        return {
          status: 404 as const,
          body: {
            error: "asset ref not found",
            mutation: hostMutationRejected({
              operation: "asset_ref_delete",
              entity: { kind: "asset-ref", id: `${assetId}:${projectId}` },
              expectedReadToken: preconditions.expectedReadToken,
              forced: preconditions.force,
            }, "asset ref not found"),
          },
        };
      }
      const currentReadToken = assetRefReadToken(ref);
      const guard = validateAgentReadProof({
        actorClientType: preconditions.actorClientType,
        operation: "asset-ref delete",
        currentReadToken,
        expectedReadToken: preconditions.expectedReadToken,
        requireReceipt: true,
        readReceiptVerifier: verifyLocalApiAssetRefReadReceipt,
        force: preconditions.force,
        readCommandHint:
          `Run \`clash asset ref get --asset ${assetId} --project ${projectId} --json\` first and pass its ` +
          "`readToken` with --if-match, or pass --force for an explicit overwrite.",
      });
      const hostMutation = validateHostMutationEnvelope({
        operation: "asset_ref_delete",
        entity: { kind: "asset-ref", id: `${assetId}:${projectId}` },
        expectedReadToken: preconditions.expectedReadToken,
        currentReadToken,
        force: preconditions.force,
        guard,
      });
      if (!hostMutation.ok) {
        return {
          status: 409 as const,
          body: { error: hostMutation.error, mutation: hostMutation.mutation },
        };
      }
      state.assetRefs = state.assetRefs.filter((ref) => {
        if (ref.assetId !== assetId) return true;
        return ref.projectId !== projectId;
      });
      return {
        status: 200 as const,
        body: {
          deleted: true,
          mutation: hostMutationSucceeded(hostMutation.envelope, {
            resultEntityId: `${assetId}:${projectId}`,
          }),
        },
      };
    });
    if (result.status === 200) {
      const mutation = result.body.mutation as HostMutationRecord | undefined;
      if (mutation?.accepted === true) {
        await db.appendMutationAudit(mutationAuditRecord({
          mutation,
          actorClientType: preconditions.actorClientType,
          reason: "asset ref delete",
        }));
      }
    }
    return c.json(result.body, result.status);
  });

  app.patch("/api/v1/assets/:id/cover", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { coverR2Key?: string } & ProjectWriteBody;
    const assetId = c.req.param("id");
    const preconditions = requestProjectWritePreconditions(c, body);
    if (!body.coverR2Key) {
      return c.json({
        error: "Missing coverR2Key",
        mutation: hostMutationRejected({
          operation: "asset_cover_update",
          entity: { kind: "asset", id: assetId },
          expectedReadToken: preconditions.expectedReadToken,
          forced: preconditions.force,
        }, "Missing coverR2Key"),
      }, 400);
    }
    let coverR2Key: string;
    try {
      coverR2Key = normalizeAssetStorageKey(body.coverR2Key);
    } catch (error) {
      const message = errorMessage(error);
      return c.json({
        error: message,
        mutation: hostMutationRejected({
          operation: "asset_cover_update",
          entity: { kind: "asset", id: assetId },
          expectedReadToken: preconditions.expectedReadToken,
          forced: preconditions.force,
        }, message),
      }, 400);
    }
    const result = await db.update((state) => {
      const asset = state.assets.find((a) => a.id === assetId);
      if (!asset) {
        return {
          status: 404 as const,
          body: {
            error: "not found",
            mutation: hostMutationRejected({
              operation: "asset_cover_update",
              entity: { kind: "asset", id: assetId },
              expectedReadToken: preconditions.expectedReadToken,
              forced: preconditions.force,
            }, "not found"),
          },
        };
      }
      const currentReadToken = assetReadToken(asset);
      const guard = validateAgentReadProof({
        actorClientType: preconditions.actorClientType,
        operation: "asset update",
        currentReadToken,
        expectedReadToken: preconditions.expectedReadToken,
        requireReceipt: true,
        readReceiptVerifier: verifyLocalApiAssetReadReceipt,
        force: preconditions.force,
        readCommandHint:
          `Run \`clash asset get --asset ${assetId} --json\` first and pass its ` +
          "`readToken` with --if-match, or pass --force for an explicit overwrite.",
      });
      const hostMutation = validateHostMutationEnvelope({
        operation: "asset_cover_update",
        entity: { kind: "asset", id: assetId },
        expectedReadToken: preconditions.expectedReadToken,
        currentReadToken,
        force: preconditions.force,
        guard,
      });
      if (!hostMutation.ok) {
        return {
          status: 409 as const,
          body: { error: hostMutation.error, mutation: hostMutation.mutation },
        };
      }
      asset.coverR2Key = coverR2Key;
      asset.updatedAt = Math.floor(Date.now() / 1000);
      const readToken = assetReceiptReadToken(asset);
      return {
        status: 200 as const,
        body: {
          ok: true,
          readToken,
          mutation: hostMutationSucceeded(hostMutation.envelope, {
            resultEntityId: assetId,
            afterReadToken: readToken,
          }),
        },
      };
    });
    if (result.status === 200) {
      const mutation = result.body.mutation as HostMutationRecord | undefined;
      if (mutation?.accepted === true) {
        await db.appendMutationAudit(mutationAuditRecord({
          mutation,
          actorClientType: preconditions.actorClientType,
          reason: "asset cover update",
        }));
      }
    }
    return c.json(result.body, result.status);
  });

  return app;
}
