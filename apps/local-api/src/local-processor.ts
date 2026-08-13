import { createHash, randomUUID } from "node:crypto";
import type { LoroDoc } from "loro-crdt";
import { createBoundedRetryPolicy } from "@clash/shared-runtime";
import {
  extractPromptText,
  ensureActionAssetBinding,
  ExecutablePluginBindingSchema,
  hostMutationSucceeded,
  listProjectAssets,
  MODEL_CARDS,
  normalizeModelId,
  parsePromptParts,
  ProjectAssetEntrySchema,
  readProjectAsset,
  validateReferenceMedia,
  validateRefs,
} from "@clash/shared-types";
import type {
  ExecutablePluginJsonValue,
  ExecutablePluginReference,
  ActionAssetBinding,
  ModelCard,
  ProjectAssetEntry,
  ReferenceMediaMetadata,
  TextAppliedRevision,
} from "@clash/shared-types";
import type { AssetKind } from "@clash/shared-types/assets";
import {
  createMockExternalAigcService,
  downloadProviderMedia,
  type ExternalAigcService,
  type ProviderPluginExecutor,
  type ProviderPluginExecutorMedia,
} from "./local-aigc.js";
import {
  createLocalDurableRunCoordinator,
  DEFAULT_LOCAL_PROVIDER_RUN_DEADLINE_MS,
  type FrozenLocalProviderExecutorInput,
} from "./durable-run-coordinator.js";
import { createSqliteDurableRunJournal } from "./durable-run-journal.js";
import { createProviderExecutionHandoffStore } from "./provider-execution-handoff.js";
import { createLocalMetadataStore } from "./local-metadata-store.js";
import {
  createLocalProjectAssetService,
  publishLocalProjectAssetWithBindings,
  type LocalProjectAssetService,
} from "./local-project-assets.js";
import type { LocalResourceProjection } from "./local-resource-store.js";
import { createLocalPluginAssetStagingStore } from "./local-plugin-asset-staging.js";
import { storeTextRevisionContentBlob } from "./text-revision-content.js";
import type { ExecutablePluginActionInvoker } from "./plugin-action-runtime.js";

export interface LocalWorkflowProcessorInput {
  doc: LoroDoc;
  projectId: string;
  broadcastJson?: (msg: Record<string, unknown>) => void;
  /** Persist mutations that must survive before an external side effect starts. */
  checkpoint?: () => Promise<void>;
}

export interface LocalWorkflowProcessor {
  process(input: LocalWorkflowProcessorInput): Promise<boolean>;
  /** Earliest owner-private durable wake time; Project Loro is never scanned for scheduling. */
  nextWakeAt?(projectId?: string): Promise<number | undefined>;
  /** Test replay override; production rooms retain their one-second busy-loop floor. */
  minimumPollDelayMs?: number;
}

export interface LocalWorkflowProcessorOptions {
  dataDir: string;
  userId?: string;
  mediaBaseUrl?: string | (() => string);
  timelineRenderer?: LocalTimelineRenderer;
  aigc?: ExternalAigcService;
  modelCards?: () => Promise<ModelCard[]>;
  executablePluginAction?: ExecutablePluginActionInvoker;
  durableProviderRuns?: {
    ownerId: string;
    providerPluginExecutor: ProviderPluginExecutor;
    fetch?: typeof fetch;
    now?: () => number;
  };
  /** Host-owned lifetime for the whole generation run, never a plugin HTTP-call timeout. */
  providerGenerationDeadlineMs?: number;
  /** Replay harness only: compress wall-clock waits while preserving provider responses and deadline. */
  providerPollDelayCapMs?: number;
  textAgent?: {
    generate(input: {
      projectId: string;
      prompt: string;
      modelId?: string;
      modelParams?: Record<string, unknown>;
      actorAgentId?: string;
    }): Promise<{ text: string; provider?: string; modelEndpoint?: string }>;
  };
}

export interface LocalTimelineRenderer {
  render(input: {
    projectId: string;
    taskId: string;
    timelineDsl: Record<string, any>;
  }): Promise<{
    bytes: Uint8Array;
    contentType?: string;
    width?: number;
    height?: number;
    durationMs?: number;
  }>;
}

type ProcessableKind = Extract<AssetKind, "image" | "video" | "audio">;
type ProcessableNodeKind = ProcessableKind | "text";

function sanitizeStorageSegment(value: string): string {
  return (
    value.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/^-+|-+$/g, "") || "item"
  );
}

function modelParams(data: Record<string, unknown>): Record<string, unknown> {
  const params = data.modelParams;
  if (!params || typeof params !== "object" || Array.isArray(params)) return {};
  const projectVisibleParams = { ...(params as Record<string, unknown>) };
  // Concrete provider/account routing is owner-private execution state. A legacy replica may still
  // contain this field, but it must never regain authority over a new run.
  delete projectVisibleParams.provider_id;
  return projectVisibleParams;
}

function stringParam(
  data: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = data[key] ?? modelParams(data)[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberParam(
  data: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = data[key] ?? modelParams(data)[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value.replace(/s$/i, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function authoredPromptFromData(
  data: Record<string, unknown>,
  fallback: string,
): string {
  return typeof data.prompt === "string" && data.prompt.trim()
    ? data.prompt
    : typeof data.label === "string" && data.label.trim()
      ? data.label
      : fallback;
}

/** Flat local adapters consume plain text plus separate reference arrays. Keep
 * authored @-mentions on the node and collapse them only at this boundary. */
function providerPromptFromData(
  data: Record<string, unknown>,
  fallback: string,
): string {
  const authoredPrompt = authoredPromptFromData(data, fallback);
  return extractPromptText(parsePromptParts(authoredPrompt));
}

function modelFromData(
  data: Record<string, unknown>,
  fallback: string,
): string {
  return typeof data.modelId === "string" && data.modelId.trim()
    ? data.modelId
    : typeof data.model === "string" && data.model.trim()
      ? data.model
      : fallback;
}

function aspectRatioFromData(
  data: Record<string, unknown>,
): string | undefined {
  return stringParam(data, "aspectRatio") ?? stringParam(data, "aspect_ratio");
}

/**
 * The duration to use when nothing asked for one.
 *
 * Reads the Card rather than naming a number: `defaultParams` first, then the parameter's
 * own `defaultValue`, then the first candidate on the menu. A house constant looks safe
 * because most models accept it, but any model whose menu omits it fails validation before
 * a request is ever made -- `seedance-2-fast-startend` offers [auto, 4, 6, 8, 10, 15] and
 * was handed 5.
 */
/** Submit, provider wait, and ordinary polls share this one absolute budget. */
function providerGenerationDeadlineMs(value: number | undefined): number {
  const deadlineMs = value ?? DEFAULT_LOCAL_PROVIDER_RUN_DEADLINE_MS;
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0) {
    throw new TypeError(
      "providerGenerationDeadlineMs must be a positive safe integer",
    );
  }
  return deadlineMs;
}

function providerGenerationTimeoutMessage(deadlineMs: number): string {
  return `Provider did not reach a final state within ${deadlineMs}ms after submission.`;
}

/** One-way cleanup for replicas authored by the pre-journal implementation. */
const LEGACY_PRIVATE_PROVIDER_NODE_FIELDS = [
  "providerPollState",
  "providerPollAt",
  "providerAcceptedAt",
  "providerStartedAt",
  "providerDeadlineAt",
  "providerFinalPolledAt",
  "providerAccountId",
  "provider_id",
] as const;

function durableProviderNodeData(
  data: Record<string, unknown>,
  updates: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...data, ...updates };
  for (const field of LEGACY_PRIVATE_PROVIDER_NODE_FIELDS) delete next[field];
  if (
    next.modelParams &&
    typeof next.modelParams === "object" &&
    !Array.isArray(next.modelParams)
  ) {
    const params = { ...(next.modelParams as Record<string, unknown>) };
    delete params.provider_id;
    next.modelParams = params;
  }
  delete next.pendingTask;
  delete next.pendingTaskAt;
  if (updates.status !== "failed") {
    delete next.error;
    delete next.failureCode;
  }
  return next;
}

function durableProviderIdentity(
  projectId: string,
  nodeId: string,
  kind: ProcessableNodeKind,
): { actionRunId: string; outputSlot: string } {
  return {
    actionRunId: `project:${projectId}:node:${nodeId}`,
    outputSlot: kind === "text" ? "text" : "media",
  };
}

function durableActionOwner(
  frozen: FrozenLocalProviderExecutorInput,
  actionRunId: string,
): {
  kind: "run";
  actionId: string;
  actionRevisionId: string;
  actionRunId: string;
} {
  const actionId =
    frozen.delivery?.actionId ?? `node:${frozen.nodeId ?? "project"}`;
  const publicRevision = {
    binding: frozen.binding,
    kind: frozen.kind,
    projectId: frozen.projectId,
    ...(frozen.nodeId ? { nodeId: frozen.nodeId } : {}),
    ...(frozen.delivery ? { delivery: frozen.delivery } : {}),
    ...(frozen.provider ? { provider: frozen.provider } : {}),
    ...(frozen.modelEndpoint ? { modelEndpoint: frozen.modelEndpoint } : {}),
    input: frozen.input,
  };
  const digest = createHash("sha256")
    .update(JSON.stringify(publicRevision))
    .digest("hex");
  return {
    kind: "run",
    actionId,
    actionRevisionId: `sha256:${digest}`,
    actionRunId,
  };
}

function nodeActionOwner(input: {
  projectId: string;
  nodeId: string;
  actionRunId: string;
  kind: ProcessableKind;
  nodeData: Record<string, unknown>;
}): ActionAssetBinding["owner"] {
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        projectId: input.projectId,
        nodeId: input.nodeId,
        kind: input.kind,
        model: modelFromData(input.nodeData, `mock-${input.kind}`),
        prompt: providerPromptFromData(input.nodeData, `Mock ${input.kind}`),
        modelParams: modelParams(input.nodeData),
      }),
    )
    .digest("hex");
  return {
    kind: "run",
    actionId: `node:${input.nodeId}`,
    actionRevisionId: `sha256:${digest}`,
    actionRunId: input.actionRunId,
  };
}

function frozenExecutorInput(run: {
  executorInput: unknown;
}): FrozenLocalProviderExecutorInput {
  return run.executorInput as FrozenLocalProviderExecutorInput;
}

async function beforeProviderGenerationDeadline<T>(
  operation: Promise<T>,
  deadlineAt: number,
  deadlineMs: number,
): Promise<T> {
  const remainingMs = deadlineAt - Date.now();
  if (remainingMs <= 0) {
    throw new Error(providerGenerationTimeoutMessage(deadlineMs));
  }
  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(providerGenerationTimeoutMessage(deadlineMs))),
      remainingMs,
    );
    timer.unref?.();
    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function cardDurationFallback(
  card: ModelCard,
): number | string | undefined {
  const declared = card.defaultParams?.duration;
  if (declared !== undefined) return declared as number | string;
  const parameter = card.parameters.find(
    (candidate) => candidate.id === "duration",
  );
  if (!parameter) return undefined;
  if (parameter.defaultValue !== undefined)
    return parameter.defaultValue as number | string;
  return parameter.options?.[0]?.value as number | string | undefined;
}

export function durationFromData(
  data: Record<string, unknown>,
  card: ModelCard | undefined,
): number | string | undefined {
  const requested = numberParam(data, "duration");
  if (requested !== undefined) return Math.max(1, Math.min(30, requested));
  return card ? cardDurationFallback(card) : undefined;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string => typeof item === "string" && item.length > 0,
      )
    : [];
}

function assetReference(
  asset: ProjectAssetEntry,
  slot: string,
  index: number,
): ExecutablePluginReference {
  return {
    slot,
    index,
    asset: {
      assetId: asset.id,
      uri: `clash-asset://${asset.id}`,
      kind: asset.kind,
      ...(asset.metadata.contentType
        ? { mediaType: asset.metadata.contentType }
        : {}),
    },
  };
}

type ProviderMediaReference = {
  asset: ProjectAssetEntry;
  kind: ProcessableKind;
};

/**
 * Preserve authored mixed-content order while treating the global reference arrays as a
 * multiset. One inline placement consumes one matching global occurrence; duplicate global
 * occurrences remain visible, and duplicate inline placements of the same immutable Asset remain
 * distinct positions as well.
 */
function mixedContentReferences(input: {
  nodeId: string;
  promptParts: ReturnType<typeof parsePromptParts>;
  globalReferences: ProviderMediaReference[];
  resolveMention(nodeId: string):
    | { assetId: string; kind: ProcessableKind }
    | undefined;
}): ExecutablePluginReference[] {
  const keyOf = (kind: ProcessableKind, assetId: string) =>
    `${kind}\u0000${assetId}`;
  const firstAssetByKey = new Map<string, ProjectAssetEntry>();
  const globalCountByKey = new Map<string, number>();
  for (const reference of input.globalReferences) {
    const key = keyOf(reference.kind, reference.asset.id);
    if (!firstAssetByKey.has(key)) firstAssetByKey.set(key, reference.asset);
    globalCountByKey.set(key, (globalCountByKey.get(key) ?? 0) + 1);
  }

  const consumedGlobalByKey = new Map<string, number>();
  const ordered: Array<
    | { text: { nodeId: string; value: string } }
    | { asset: ProjectAssetEntry }
  > = [];
  for (const [partIndex, part] of input.promptParts.entries()) {
    if (part.type === "text") {
      if (part.text) {
        ordered.push({
          text: {
            nodeId: `${input.nodeId}:prompt:${partIndex}`,
            value: part.text,
          },
        });
      }
      continue;
    }
    if (!part.nodeId) continue;
    const mention = input.resolveMention(part.nodeId);
    if (!mention) continue;
    const key = keyOf(mention.kind, mention.assetId);
    const asset = firstAssetByKey.get(key);
    if (!asset) continue;
    ordered.push({ asset });
    const globallyAvailable = globalCountByKey.get(key) ?? 0;
    const alreadyConsumed = consumedGlobalByKey.get(key) ?? 0;
    if (alreadyConsumed < globallyAvailable) {
      consumedGlobalByKey.set(key, alreadyConsumed + 1);
    }
  }

  const remainingInlineConsumption = new Map(consumedGlobalByKey);
  for (const reference of input.globalReferences) {
    const key = keyOf(reference.kind, reference.asset.id);
    const consume = remainingInlineConsumption.get(key) ?? 0;
    if (consume > 0) {
      remainingInlineConsumption.set(key, consume - 1);
      continue;
    }
    ordered.push({ asset: reference.asset });
  }

  return ordered.map((entry, index) =>
    "text" in entry
      ? { slot: "content", index, text: entry.text }
      : assetReference(entry.asset, "content", index),
  );
}

function textHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

function textRevisionActor(
  nodeData: Record<string, unknown>,
  userId: string,
): TextAppliedRevision["actor"] | undefined {
  if (nodeData.actorType !== "user" && nodeData.actorType !== "agent")
    return undefined;
  return {
    actorType: nodeData.actorType,
    actorUserId:
      typeof nodeData.actorUserId === "string" && nodeData.actorUserId
        ? nodeData.actorUserId
        : userId,
    ...(typeof nodeData.actorAgentId === "string" && nodeData.actorAgentId
      ? { actorAgentId: nodeData.actorAgentId }
      : {}),
  };
}

function generatedTextRevision(options: {
  projectId: string;
  nodeId: string;
  content: string;
  nodeData: Record<string, unknown>;
  userId: string;
  createdAt?: string;
}): TextAppliedRevision {
  const contentHash = textHash(options.content);
  const createdAt = options.createdAt ?? new Date().toISOString();
  const actor = textRevisionActor(options.nodeData, options.userId);
  const textId = `text:${options.projectId}:${options.nodeId}`;
  const sourceFilePath = `workflow/${sanitizeStorageSegment(options.nodeId)}.md`;
  const seed = JSON.stringify({
    textId,
    contentHash,
    createdAt,
    actor: actor ?? null,
  });
  const suffix = createHash("sha256").update(seed).digest("hex").slice(0, 12);
  return {
    schemaVersion: 1,
    kind: "clash.text.revision",
    textId,
    revisionId: `txrev-${contentHash}-${suffix}`,
    projectId: options.projectId,
    nodeId: options.nodeId,
    createdAt,
    contentHash,
    hashAlgorithm: "sha256-64",
    sourceFilePath,
    sourceFileHash: contentHash,
    ...(actor ? { actor } : {}),
  };
}

async function recordGeneratedTextRevision(options: {
  dataDir: string;
  userId: string;
  projectId: string;
  nodeId: string;
  nodeData: Record<string, unknown>;
  content: string;
  createdAt?: string;
  auditId?: string;
}): Promise<TextAppliedRevision> {
  const revision = generatedTextRevision(options);
  const metadataStore = createLocalMetadataStore(options.dataDir);
  const existing = await metadataStore.getTextRevision(
    options.projectId,
    revision.revisionId,
  );
  if (existing) return existing;
  const mutation = hostMutationSucceeded(
    {
      operation: "text_generate",
      entity: { kind: "text-revision", id: revision.revisionId },
    },
    { resultEntityId: revision.revisionId },
  );
  await storeTextRevisionContentBlob(
    options.dataDir,
    revision,
    options.content,
  );
  await metadataStore.upsertTextRevision(revision, {
    id: options.auditId ?? randomUUID(),
    createdAt: Date.now(),
    operation: mutation.operation,
    entity: mutation.entity,
    actorClientType: options.nodeData.actorType === "agent" ? "agent" : null,
    accepted: mutation.accepted,
    reason: "workflow generated text",
    resultEntityId: mutation.resultEntityId ?? null,
    error: mutation.error ?? null,
    mutation,
  });
  return revision;
}

function pendingCustomNode(node: Record<string, any>): {
  actionId: string;
  outputType: ProcessableKind | "text";
} | null {
  const data = node.data;
  if (!data || typeof data !== "object") return null;
  if (
    typeof data.actionType !== "string" ||
    !data.actionType.startsWith("custom:")
  )
    return null;
  if (data.status !== "pending") return null;
  if (data.pendingTask) return null;
  const actionId =
    typeof data.customActionId === "string" && data.customActionId
      ? data.customActionId
      : data.actionType.slice("custom:".length);
  const outputType =
    data.outputType === "video" ||
    data.outputType === "audio" ||
    data.outputType === "text"
      ? data.outputType
      : "image";
  return { actionId, outputType };
}

function pendingKindForNode(
  node: Record<string, any>,
): ProcessableNodeKind | null {
  if (
    node.type !== "image" &&
    node.type !== "video" &&
    node.type !== "audio" &&
    node.type !== "text"
  )
    return null;
  const data = node.data;
  if (!data || typeof data !== "object") return null;
  if (data.assetId) return null;
  if (data.status !== "pending" && data.status !== "generating") return null;

  const kind = node.type as ProcessableNodeKind;
  const expectedActionType = `${kind}-gen`;
  if (data.actionType && data.actionType !== expectedActionType) return null;
  return kind;
}

function extensionForContentType(contentType: string): string {
  if (contentType.includes("image/svg")) return ".svg";
  if (contentType.includes("image/png")) return ".png";
  if (contentType.includes("image/jpeg")) return ".jpg";
  if (contentType.includes("image/webp")) return ".webp";
  if (contentType.includes("video/mp4")) return ".mp4";
  if (contentType.includes("video/webm")) return ".webm";
  if (contentType.includes("audio/wav")) return ".wav";
  if (contentType.includes("audio/mpeg")) return ".mp3";
  if (
    contentType.includes("model/gltf-binary") ||
    contentType.includes("application/octet-stream+gltf")
  )
    return ".glb";
  return ".bin";
}

function ownedProjectAssetEntry(options: {
  projectAssetId?: string;
  projectId: string;
  taskId: string;
  actionRunId?: string;
  kind: AssetKind;
  nodeData?: Record<string, unknown>;
  name?: string;
  prompt?: string;
  projection: LocalResourceProjection;
  width?: number;
  height?: number;
  durationMs?: number;
  waveform?: number[];
  transcript?: string;
  requestId?: string;
  provider?: string;
  modelEndpoint?: string;
  remoteUrl?: string;
}): ProjectAssetEntry {
  const assetId =
    options.projectAssetId ??
    `local-asset-${sanitizeStorageSegment(options.taskId)}`;
  const model = options.nodeData
    ? modelFromData(options.nodeData, `mock-${options.kind}`)
    : options.modelEndpoint ?? options.kind;
  const prompt =
    options.prompt ??
    (options.nodeData
      ? providerPromptFromData(options.nodeData, `Mock ${options.kind}`)
      : `Generate ${options.kind}`);
  const name =
    options.name ??
    `${assetId}${extensionForContentType(options.projection.resource.contentType ?? "")}`;
  return ProjectAssetEntrySchema.parse({
    id: assetId,
    kind: options.kind,
    source: { kind: "owned", resourceId: options.projection.resource.id },
    lifecycle: { state: "active" },
    name,
    metadata: {
      ...(options.width === undefined ? {} : { width: options.width }),
      ...(options.height === undefined ? {} : { height: options.height }),
      ...(options.durationMs === undefined
        ? {}
        : { durationMs: options.durationMs }),
      ...(options.waveform ? { waveform: options.waveform } : {}),
      bytes: options.projection.resource.byteLength,
      ...(options.projection.resource.contentType
        ? { contentType: options.projection.resource.contentType }
        : {}),
      ...(options.name ? { originalName: name } : {}),
    },
    provenance: {
      kind: options.provider === "local-render" ? "render" : "generation",
      // The product lineage belongs to the Host ActionRun. A Provider request id is
      // transport state and must not replace the durable run identity exposed to Project Loro.
      actionRunId: options.actionRunId ?? options.requestId ?? options.taskId,
      model: options.modelEndpoint ?? model,
      prompt,
    },
  });
}

async function saveAsset(options: {
  doc: LoroDoc;
  projectAssets: LocalProjectAssetService;
  projectId: string;
  nodeId: string;
  taskId: string;
  kind: ProcessableKind;
  nodeData: Record<string, unknown>;
  bytes: Uint8Array;
  contentType: string;
  width?: number;
  height?: number;
  durationMs?: number;
  waveform?: number[];
  transcript?: string;
  requestId?: string;
  provider?: string;
  modelEndpoint?: string;
  remoteUrl?: string;
}): Promise<ProjectAssetEntry> {
  const assetId = `local-asset-${sanitizeStorageSegment(options.taskId)}`;
  const projection = await options.projectAssets.stageOwned({
    kind: options.kind,
    bytes: options.bytes,
    contentType: options.contentType,
    name: `${assetId}${extensionForContentType(options.contentType)}`,
  });
  const entry = ownedProjectAssetEntry({ ...options, projection });
  return publishLocalProjectAssetWithBindings(options.doc, entry, [
    {
      id: `action-asset:${options.taskId}:output`,
      owner: nodeActionOwner({
        projectId: options.projectId,
        nodeId: options.nodeId,
        actionRunId: options.taskId,
        kind: options.kind,
        nodeData: options.nodeData,
      }),
      direction: "output",
      slot: options.provider === "local-render" ? "render:output" : "media",
      projectAssetId: entry.id,
    },
  ]).entry;
}

export async function resolveLocalTimelineDslReferences(options: {
  dataDir: string;
  doc: LoroDoc;
  projectId: string;
  mediaBaseUrl?: string | (() => string);
  timelineDsl: Record<string, any>;
}): Promise<Record<string, any>> {
  const resolved = structuredClone(options.timelineDsl);
  const projectAssets = createLocalProjectAssetService({
    dataDir: options.dataDir,
    projectionOrigin: () => {
      if (!options.mediaBaseUrl) return "http://127.0.0.1";
      return typeof options.mediaBaseUrl === "function"
        ? options.mediaBaseUrl()
        : options.mediaBaseUrl;
    },
  });
  await projectAssets.materializeDoc(options.projectId, options.doc);
  const nodes = options.doc.getMap("nodes");

  for (const track of resolved.tracks ?? []) {
    for (const item of track.items ?? []) {
      if (item.type === "composition" && item.runtime === "remotion") {
        const sourceNodeId =
          typeof item.sourceNodeId === "string" ? item.sourceNodeId.trim() : "";
        if (!sourceNodeId) {
          throw new Error(
            `Timeline Remotion item ${String(item.id ?? "unknown")} requires sourceNodeId`,
          );
        }
        const sourceNode = nodes.get(sourceNodeId) as
          Record<string, any> | undefined;
        if (!sourceNode || sourceNode.type !== "remotion-component") {
          throw new Error(
            `Timeline Remotion item ${String(item.id ?? "unknown")} must reference a remotion-component Canvas node`,
          );
        }
        const sourceData =
          sourceNode.data && typeof sourceNode.data === "object"
            ? (sourceNode.data as Record<string, any>)
            : {};
        if (
          typeof sourceData.content !== "string" ||
          !sourceData.content.trim()
        ) {
          throw new Error(
            `Remotion Canvas node ${sourceNodeId} has no executable TSX content`,
          );
        }
        // This field exists only in the cloned render input. Timeline state
        // keeps the stable sourceNodeId and resolves the latest code anew for
        // every preview/export start.
        item.componentSource = sourceData.content;
        if (
          typeof sourceData.componentId === "string" &&
          sourceData.componentId.trim()
        ) {
          item.compositionId = sourceData.componentId.trim();
        }
        continue;
      }
      if (
        item.type !== "video" &&
        item.type !== "image" &&
        item.type !== "audio"
      )
        continue;
      const lookupIds = [item.assetId, item.sourceNodeId].filter(
        (value): value is string =>
          typeof value === "string" && value.length > 0,
      );
      if (
        typeof item.sourceNodeId === "string" &&
        item.sourceNodeId.startsWith("timeline-asset:")
      ) {
        lookupIds.push(item.sourceNodeId.slice("timeline-asset:".length));
      }
      let asset = lookupIds
        .map((id) => readProjectAsset(options.doc, id))
        .find((candidate) => candidate?.lifecycle.state === "active");
      if (!asset) {
        for (const id of lookupIds) {
          const node = nodes.get(id) as Record<string, any> | undefined;
          const nodeProjectAssetId =
            typeof node?.data?.assetId === "string"
              ? node.data.assetId
              : undefined;
          const backing = nodeProjectAssetId
            ? readProjectAsset(options.doc, nodeProjectAssetId)
            : null;
          if (backing?.lifecycle.state === "active") {
            asset = backing;
            break;
          }
        }
      }
      if (!asset) {
        throw new Error(
          `Timeline render cannot resolve media item ${String(item.id ?? "unknown")}`,
        );
      }
      const resolvedAsset = await projectAssets.readFromDoc(
        options.doc,
        options.projectId,
        asset.id,
      );
      if (!options.mediaBaseUrl) {
        throw new Error("Timeline rendering requires a local media base URL");
      }
      if (
        !resolvedAsset ||
        resolvedAsset.status !== "ready" ||
        !resolvedAsset.url
      ) {
        throw new Error(
          `Timeline render cannot read Project Asset ${asset.id} from this Host`,
        );
      }
      item.src = resolvedAsset.url;
    }
  }
  return resolved;
}

export function createLocalWorkflowProcessor(
  options: LocalWorkflowProcessorOptions,
): LocalWorkflowProcessor {
  const generationDeadlineMs = providerGenerationDeadlineMs(
    options.providerGenerationDeadlineMs,
  );
  const aigc = options.aigc ?? createMockExternalAigcService();
  const userId = options.userId ?? "local-user";
  const durableJournal = options.durableProviderRuns
    ? createSqliteDurableRunJournal(options.dataDir)
    : undefined;
  const providerExecutionHandoffs = createProviderExecutionHandoffStore(
    options.dataDir,
  );
  const projectAssets = createLocalProjectAssetService({
    dataDir: options.dataDir,
    projectionOrigin: () => {
      if (!options.mediaBaseUrl) return "http://127.0.0.1";
      return typeof options.mediaBaseUrl === "function"
        ? options.mediaBaseUrl()
        : options.mediaBaseUrl;
    },
  });
  const pluginAssetStaging = createLocalPluginAssetStagingStore({
    dataDir: options.dataDir,
  });

  return {
    ...(options.providerPollDelayCapMs === undefined
      ? {}
      : { minimumPollDelayMs: options.providerPollDelayCapMs }),
    async nextWakeAt(projectId) {
      if (!durableJournal || !options.durableProviderRuns) return undefined;
      return durableJournal.nextWakeAt(
        options.durableProviderRuns.ownerId,
        projectId,
      );
    },

    async process(input) {
      const { doc, projectId } = input;
      const nodes = doc.getMap("nodes");
      const modelCards = options.modelCards
        ? await options.modelCards()
        : MODEL_CARDS;
      let changed = await projectAssets.materializeDoc(projectId, doc);
      const durable = options.durableProviderRuns;
      const coordinator =
        durable && durableJournal
          ? createLocalDurableRunCoordinator({
              ownerId: durable.ownerId,
              journal: durableJournal,
              providerPluginExecutor: async (request) => {
                const response = await durable.providerPluginExecutor(request);
                if (
                  response.status !== "accepted" ||
                  options.providerPollDelayCapMs === undefined
                ) {
                  return response;
                }
                return {
                  ...response,
                  retryAfterMs: Math.min(
                    response.retryAfterMs ?? 5_000,
                    Math.max(0, options.providerPollDelayCapMs),
                  ),
                };
              },
              outputStore: {
                async stage({ run, idempotencyKey, outputs }) {
                  const frozen = frozenExecutorInput(run);
                  if (!frozen.nodeId && !frozen.delivery) {
                    throw new Error(
                      "A durable Provider output requires a Canvas node or Project Asset delivery.",
                    );
                  }
                  const rawTarget = frozen.nodeId
                    ? (nodes.get(frozen.nodeId) as
                        | Record<string, any>
                        | undefined)
                    : undefined;
                  if (
                    frozen.nodeId &&
                    (!rawTarget?.data || typeof rawTarget.data !== "object")
                  ) {
                    throw new Error(
                      `Durable Provider target node ${frozen.nodeId} is missing.`,
                    );
                  }
                  const output = outputs.find(
                    (candidate) => candidate.slot === run.outputSlot,
                  );
                  if (!output || output.kind !== "value") {
                    throw new Error(
                      `Durable Provider output slot ${run.outputSlot} is missing a value.`,
                    );
                  }
                  if (frozen.kind === "text") {
                    if (!frozen.nodeId || !rawTarget?.data) {
                      throw new Error(
                        "A durable Provider text output requires a target node.",
                      );
                    }
                    if (
                      typeof output.value !== "string" ||
                      !output.value.trim()
                    ) {
                      throw new Error(
                        "Durable Provider text output must be a non-empty string.",
                      );
                    }
                    const revision = await recordGeneratedTextRevision({
                      dataDir: options.dataDir,
                      userId,
                      projectId: frozen.projectId,
                      nodeId: frozen.nodeId,
                      nodeData: rawTarget.data as Record<string, unknown>,
                      content: output.value,
                      createdAt: new Date(run.createdAt).toISOString(),
                      auditId: `durable:${idempotencyKey}:text`,
                    });
                    return {
                      kind: "text",
                      content: output.value,
                      revisionId: revision.revisionId,
                    } as ExecutablePluginJsonValue;
                  }
                  if (
                    !output.value ||
                    typeof output.value !== "object" ||
                    Array.isArray(output.value)
                  ) {
                    throw new Error(
                      "Durable Provider media output must be an object.",
                    );
                  }
                  const media =
                    output.value as unknown as ProviderPluginExecutorMedia;
                  const staged =
                    typeof media.assetId === "string" && media.assetId
                      ? await pluginAssetStaging.resolve({
                          projectId: frozen.projectId,
                          projectAssetId: media.assetId,
                        })
                      : undefined;
                  if (staged && staged.kind !== frozen.kind) {
                    throw new Error(
                      `Durable Provider staged ${staged.kind} output for a ${frozen.kind} run.`,
                    );
                  }
                  if (
                    !staged &&
                    (typeof media.url !== "string" || !media.url)
                  ) {
                    throw new Error(
                      "Durable Provider media output requires a Host staging receipt or readable URL.",
                    );
                  }
                  const downloaded = staged
                    ? undefined
                    : await downloadProviderMedia(
                        durable.fetch ?? fetch,
                        media.url!,
                        frozen.kind,
                      );
                  const contentType =
                    staged?.projection.resource.contentType ??
                    media.contentType ??
                    downloaded?.contentType ??
                    (frozen.kind === "video"
                      ? "video/mp4"
                      : frozen.kind === "audio"
                        ? "audio/mpeg"
                        : frozen.kind === "model"
                          ? "model/gltf-binary"
                          : "image/png");
                  const assetId =
                    staged?.projectAssetId ??
                    `local-asset-${sanitizeStorageSegment(idempotencyKey)}`;
                  const projection = staged
                    ? await projectAssets.resolveStagedOwned(staged.resourceId)
                    : await projectAssets.stageOwned({
                        kind: frozen.kind,
                        bytes: downloaded!.bytes,
                        contentType,
                        name: `${assetId}${extensionForContentType(contentType)}`,
                      });
                  const projectAsset = ownedProjectAssetEntry({
                    projectAssetId: assetId,
                    projectId: frozen.projectId,
                    taskId: idempotencyKey,
                    actionRunId: run.actionRunId,
                    kind: frozen.kind,
                    ...(rawTarget?.data
                      ? {
                          nodeData: rawTarget.data as Record<string, unknown>,
                        }
                      : {}),
                    ...(frozen.delivery?.name
                      ? { name: frozen.delivery.name }
                      : {}),
                    ...(frozen.delivery?.prompt
                      ? { prompt: frozen.delivery.prompt }
                      : {}),
                    projection,
                    ...(media.width === undefined
                      ? {}
                      : { width: media.width }),
                    ...(media.height === undefined
                      ? {}
                      : { height: media.height }),
                    ...(media.durationMs === undefined
                      ? {}
                      : { durationMs: media.durationMs }),
                    ...(media.waveform ? { waveform: media.waveform } : {}),
                    ...(media.transcript
                      ? { transcript: media.transcript }
                      : {}),
                    ...(media.requestId ? { requestId: media.requestId } : {}),
                    ...(frozen.provider ? { provider: frozen.provider } : {}),
                    ...(frozen.modelEndpoint
                      ? { modelEndpoint: frozen.modelEndpoint }
                      : {}),
                    ...(downloaded?.remoteUrl
                      ? { remoteUrl: downloaded.remoteUrl }
                      : {}),
                  });
                  return {
                    kind: "asset",
                    projectAsset,
                  } as ExecutablePluginJsonValue;
                },
              },
              publisher: {
                async publish({ run, stagedOutput }) {
                  const frozen = frozenExecutorInput(run);
                  if (!frozen.nodeId && !frozen.delivery) {
                    throw new Error(
                      "A durable Provider publication requires a Canvas node or Project Asset delivery.",
                    );
                  }
                  const target = frozen.nodeId
                    ? (nodes.get(frozen.nodeId) as
                        | Record<string, any>
                        | undefined)
                    : undefined;
                  if (
                    frozen.nodeId &&
                    (!target?.data || typeof target.data !== "object")
                  ) {
                    throw new Error(
                      `Durable Provider target node ${frozen.nodeId} is missing.`,
                    );
                  }
                  if (
                    !stagedOutput ||
                    typeof stagedOutput !== "object" ||
                    Array.isArray(stagedOutput)
                  ) {
                    throw new Error(
                      "Durable Provider staged output is invalid.",
                    );
                  }
                  const staged = stagedOutput as Record<string, unknown>;
                  let publishedAsset: ProjectAssetEntry | undefined;
                  if (staged.kind === "asset") {
                    const parsed = ProjectAssetEntrySchema.safeParse(
                      staged.projectAsset,
                    );
                    if (!parsed.success) {
                      throw new Error(
                        `Durable Provider staged Project Asset is invalid: ${parsed.error.issues[0]?.message ?? "invalid entry"}`,
                      );
                    }
                    const publication =
                      publishLocalProjectAssetWithBindings(doc, parsed.data, [
                        {
                          id: `action-asset:${run.actionRunId}:${run.outputSlot}:output`,
                          owner: durableActionOwner(
                            frozen,
                            run.actionRunId,
                          ),
                          direction: "output",
                          slot: run.outputSlot,
                          projectAssetId: parsed.data.id,
                        },
                      ]);
                    publishedAsset = publication.entry;
                    changed = publication.changed || changed;
                  }
                  if (frozen.delivery) {
                    if (!publishedAsset) {
                      throw new Error(
                        "Direct Project Asset delivery requires a staged Asset output.",
                      );
                    }
                    // Project Asset + Action binding are the complete public projection for a
                    // node-less run. Checkpoint them before the journal records publication so a
                    // crash can replay this idempotent pair without regenerating the model.
                    await input.checkpoint?.();
                    return;
                  }
                  const updates = publishedAsset
                    ? { status: "completed", assetId: publishedAsset.id }
                    : staged.kind === "text" &&
                        typeof staged.content === "string"
                      ? { status: "completed", content: staged.content }
                      : undefined;
                  if (!updates)
                    throw new Error(
                      "Durable Provider staged output is incomplete.",
                    );
                  if (!frozen.nodeId || !target?.data) {
                    throw new Error(
                      "A Canvas Provider publication requires a target node.",
                    );
                  }
                  const current = target.data as Record<string, unknown>;
                  if (
                    current.status === updates.status &&
                    ("assetId" in updates
                      ? current.assetId === updates.assetId
                      : current.content === updates.content)
                  ) {
                    // A previous publication may have mutated the in-memory Loro doc and then lost
                    // its persistence acknowledgement. Re-checkpoint before the journal records
                    // success; equality alone is not evidence that the snapshot survived.
                    await input.checkpoint?.();
                    return;
                  }
                  nodes.set(frozen.nodeId, {
                    ...target,
                    data: durableProviderNodeData(current, updates),
                  });
                  changed = true;
                  await input.checkpoint?.();
                },
                async publishFailure({ run, failure }) {
                  const frozen = frozenExecutorInput(run);
                  if (!frozen.nodeId) return;
                  const target = nodes.get(frozen.nodeId) as
                    Record<string, any> | undefined;
                  if (!target?.data || typeof target.data !== "object") return;
                  const current = target.data as Record<string, unknown>;
                  if (
                    current.status === "failed" &&
                    current.failureCode === failure.code &&
                    current.error === failure.message
                  ) {
                    await input.checkpoint?.();
                    return;
                  }
                  nodes.set(frozen.nodeId, {
                    ...target,
                    data: durableProviderNodeData(current, {
                      status: "failed",
                      failureCode: failure.code,
                      error: failure.message,
                    }),
                  });
                  changed = true;
                  await input.checkpoint?.();
                },
              },
              retryPolicy: createBoundedRetryPolicy({
                maxFailures: { submit: 3, poll: 3, stage: 3, publish: 3 },
                baseDelayMs: 1_000,
                maxDelayMs: 60_000,
              }),
              ...(durable.now ? { clock: { now: durable.now } } : {}),
            })
          : undefined;

      const driveDurableRun = async (identity: {
        actionRunId: string;
        outputSlot: string;
      }): Promise<void> => {
        if (!coordinator) return;
        for (let step = 0; step < 12; step += 1) {
          const result = await coordinator.coordinate({
            type: "advance",
            identity,
          });
          if (
            result.kind === "waiting" ||
            result.kind === "terminal" ||
            result.kind === "contended"
          )
            return;
        }
        // A replay may compress many accepted/poll checkpoints into one turn. Yield the room after
        // a bounded batch and let its durable next-wake scheduler resume the still-journaled run;
        // reaching this fairness bound is not a Provider failure.
      };

      /**
       * Project input bindings are the synchronized provenance for the frozen owner-private run.
       * Rebuild them from the journal before every possible advance so a crash after journal
       * creation cannot submit a Provider request whose inputs were never checkpointed in Loro.
       */
      const ensureDurableInputBindings = async (identity: {
        actionRunId: string;
        outputSlot: string;
      }) => {
        if (!durableJournal) return undefined;
        const run = await durableJournal.load(identity);
        if (!run) return undefined;
        const frozen = frozenExecutorInput(run);
        const owner = durableActionOwner(frozen, identity.actionRunId);
        let bindingsChanged = false;
        for (const reference of frozen.input.references) {
          if (!("asset" in reference)) continue;
          const ensured = ensureActionAssetBinding(doc, {
              id: `action-asset:${identity.actionRunId}:${reference.slot}:${reference.index}:input`,
              owner,
              direction: "input",
              slot: `${reference.slot}:${reference.index}`,
              projectAssetId: reference.asset.assetId,
              role: "reference",
            });
          if (!ensured.ok) {
            throw new Error(
              `${ensured.error.code}: ${ensured.error.message}`,
            );
          }
          bindingsChanged = ensured.changed || bindingsChanged;
        }
        if (bindingsChanged) {
          changed = true;
          await input.checkpoint?.();
        }
        return run;
      };

      if (coordinator && durableJournal) {
        const recovery = await coordinator.coordinate({ type: "recoverable" });
        if (recovery.kind === "recoverable") {
          for (const identity of recovery.identities) {
            const run = await durableJournal.load(identity);
            if (run && frozenExecutorInput(run).projectId === projectId) {
              await ensureDurableInputBindings(identity);
              await driveDurableRun(identity);
            }
          }
        }
      }

      for (const [nodeId, rawNode] of nodes.entries()) {
        const node = rawNode as Record<string, any>;
        const custom = pendingCustomNode(node);
        if (custom) {
          const data = node.data as Record<string, unknown>;
          const parsedBinding = ExecutablePluginBindingSchema.safeParse(
            data.pluginBinding,
          );
          if (parsedBinding.success && options.executablePluginAction) {
            try {
              const references = [
                ...stringList(data.referenceImageAssetIds).map(
                  (assetId, index) => ({
                    slot: "image",
                    index,
                    asset: {
                      assetId,
                      uri: `clash-asset://${assetId}`,
                      kind: "image" as const,
                    },
                  }),
                ),
                ...stringList(data.referenceVideoAssetIds).map(
                  (assetId, index) => ({
                    slot: "video",
                    index,
                    asset: {
                      assetId,
                      uri: `clash-asset://${assetId}`,
                      kind: "video" as const,
                    },
                  }),
                ),
                ...stringList(data.referenceAudioAssetIds).map(
                  (assetId, index) => ({
                    slot: "audio",
                    index,
                    asset: {
                      assetId,
                      uri: `clash-asset://${assetId}`,
                      kind: "audio" as const,
                    },
                  }),
                ),
              ];
              const prompt = extractPromptText(
                parsePromptParts(
                  typeof data.prompt === "string"
                    ? data.prompt
                    : typeof data.content === "string"
                      ? data.content
                      : "",
                ),
              );
              const params =
                data.customActionParams &&
                typeof data.customActionParams === "object" &&
                !Array.isArray(data.customActionParams)
                  ? (data.customActionParams as Record<string, any>)
                  : {};
              const taskId = `local-custom-${sanitizeStorageSegment(nodeId)}`;
              const result = await options.executablePluginAction({
                binding: parsedBinding.data,
                taskId,
                projectId,
                nodeId,
                input: {
                  values: { prompt, ...params },
                  references,
                },
                actor:
                  data.actorType === "agent"
                    ? {
                        kind: "agent",
                        ...(typeof data.actorAgentId === "string"
                          ? { id: data.actorAgentId }
                          : {}),
                      }
                    : {
                        kind: "user",
                        ...(typeof data.actorUserId === "string"
                          ? { id: data.actorUserId }
                          : {}),
                      },
              });
              if (result.status === "failed") {
                throw new Error(
                  `Plugin action failed (${result.error.code}): ${result.error.message}`,
                );
              }
              if (result.status === "accepted") {
                // This path has no poll loop yet, so accepting work here would strand it: the node
                // would report success while nothing ever collects the result. Refusing is the
                // honest answer until the loop below owns every kind of task.
                throw new Error(
                  "Plugin action returned accepted, which this path cannot resume yet.",
                );
              }
              const assetOutput = result.outputs.find(
                (output) => output.kind === "asset",
              );
              const valueOutput = result.outputs.find(
                (output) => output.kind === "value",
              );
              const nextData: Record<string, unknown> = {
                ...data,
                status: "completed",
              };
              if (assetOutput?.kind === "asset") {
                if (
                  custom.outputType !== "image" &&
                  custom.outputType !== "video" &&
                  custom.outputType !== "audio"
                ) {
                  throw new Error(
                    `Plugin action ${custom.actionId} returned media for a ${custom.outputType} output.`,
                  );
                }
                if (assetOutput.asset.kind !== custom.outputType) {
                  throw new Error(
                    `Plugin action ${custom.actionId} returned ${assetOutput.asset.kind} for a ${custom.outputType} output.`,
                  );
                }
                const staged = await pluginAssetStaging.resolve({
                  projectId,
                  projectAssetId: assetOutput.asset.assetId,
                });
                if (!staged && !assetOutput.asset.url) {
                  throw new Error(
                    `Plugin action ${custom.actionId} returned an Asset without a Host staging receipt or readable URL.`,
                  );
                }
                const downloaded = staged
                  ? undefined
                  : await downloadProviderMedia(
                      options.durableProviderRuns?.fetch ?? fetch,
                      assetOutput.asset.url!,
                      custom.outputType,
                    );
                const contentType =
                  staged?.projection.resource.contentType ??
                  assetOutput.asset.mediaType ??
                  downloaded?.contentType ??
                  (custom.outputType === "video"
                    ? "video/mp4"
                    : custom.outputType === "audio"
                      ? "audio/mpeg"
                      : "image/png");
                const projectAssetId =
                  staged?.projectAssetId ??
                  `local-asset-${sanitizeStorageSegment(taskId)}`;
                const projection = staged
                  ? await projectAssets.resolveStagedOwned(staged.resourceId)
                  : await projectAssets.stageOwned({
                      kind: custom.outputType,
                      bytes: downloaded!.bytes,
                      contentType,
                      name: `${projectAssetId}${extensionForContentType(contentType)}`,
                    });
                const entry = ownedProjectAssetEntry({
                  projectAssetId,
                  projectId,
                  taskId,
                  kind: custom.outputType,
                  nodeData: data,
                  projection,
                  provider: `plugin:${parsedBinding.data.pluginId}`,
                });
                const owner = nodeActionOwner({
                  projectId,
                  nodeId,
                  actionRunId: taskId,
                  kind: custom.outputType,
                  nodeData: data,
                });
                const publication = publishLocalProjectAssetWithBindings(
                  doc,
                  entry,
                  [
                    ...references.map((reference) => ({
                    id: `action-asset:${taskId}:${reference.slot}:${reference.index}:input`,
                    owner,
                    direction: "input",
                    slot: `${reference.slot}:${reference.index}`,
                    projectAssetId: reference.asset.assetId,
                    role: "reference",
                    }) satisfies ActionAssetBinding),
                    {
                      id: `action-asset:${taskId}:${assetOutput.slot}:output`,
                      owner,
                      direction: "output",
                      slot: assetOutput.slot,
                      projectAssetId: entry.id,
                    },
                  ],
                );
                changed = publication.changed || changed;
                nextData.assetId = publication.entry.id;
              } else if (
                custom.outputType === "text" &&
                valueOutput?.kind === "value"
              ) {
                const value = valueOutput.value;
                const text =
                  typeof value === "string"
                    ? value
                    : value &&
                        typeof value === "object" &&
                        !Array.isArray(value) &&
                        typeof value.text === "string"
                      ? value.text
                      : value &&
                          typeof value === "object" &&
                          !Array.isArray(value) &&
                          typeof value.content === "string"
                        ? value.content
                        : JSON.stringify(value);
                await recordGeneratedTextRevision({
                  dataDir: options.dataDir,
                  userId,
                  projectId,
                  nodeId,
                  nodeData: data,
                  content: text,
                });
                nextData.content = text;
              } else {
                throw new Error(
                  `Plugin action ${custom.actionId} returned no ${custom.outputType} output.`,
                );
              }
              delete nextData.pendingTask;
              delete nextData.pendingTaskAt;
              delete nextData.error;
              nodes.set(nodeId, { ...node, data: nextData });
            } catch (error) {
              const nextData: Record<string, unknown> = {
                ...data,
                status: "failed",
                error: error instanceof Error ? error.message : String(error),
              };
              delete nextData.pendingTask;
              delete nextData.pendingTaskAt;
              nodes.set(nodeId, { ...node, data: nextData });
            }
            changed = true;
            continue;
          }
          const failureCode = parsedBinding.success
            ? "PLUGIN_ACTION_RUNTIME_UNAVAILABLE"
            : "LEGACY_CUSTOM_ACTION_PROTOCOL_RETIRED";
          const error = parsedBinding.success
            ? `Executable plugin runtime is unavailable for action ${custom.actionId}.`
            : `Legacy custom action ${custom.actionId} has no executable plugin binding. Install a clash.plugin/v1 plugin and recreate the Action.`;
          nodes.set(nodeId, {
            ...node,
            data: {
              ...data,
              status: "failed",
              failureCode,
              error,
            },
          });
          changed = true;
          continue;
        }

        const renderData =
          node.data && typeof node.data === "object"
            ? (node.data as Record<string, any>)
            : {};
        const isTimelineRender =
          node.type === "video" &&
          renderData.status === "pending" &&
          !renderData.assetId &&
          !renderData.pendingTask &&
          renderData.timelineDsl &&
          typeof renderData.timelineDsl === "object";
        if (isTimelineRender) {
          const taskId = `local-render-${sanitizeStorageSegment(nodeId)}`;
          try {
            if (!options.timelineRenderer) {
              throw new Error("Timeline rendering backend is unavailable");
            }
            const timelineDsl = await resolveLocalTimelineDslReferences({
              dataDir: options.dataDir,
              doc,
              projectId,
              mediaBaseUrl: options.mediaBaseUrl,
              timelineDsl: renderData.timelineDsl,
            });
            const rendered = await options.timelineRenderer.render({
              projectId,
              taskId,
              timelineDsl,
            });
            const asset = await saveAsset({
              doc,
              projectAssets,
              projectId,
              nodeId,
              taskId,
              kind: "video",
              nodeData: {
                ...renderData,
                modelId: "remotion-render",
                prompt: `Render Timeline ${String(renderData.sourceTimelineId ?? nodeId)}`,
              },
              bytes: rendered.bytes,
              contentType: rendered.contentType ?? "video/mp4",
              width: rendered.width,
              height: rendered.height,
              durationMs: rendered.durationMs,
              provider: "local-render",
            });
            const nextData: Record<string, any> = {
              ...renderData,
              status: "completed",
              assetId: asset.id,
            };
            delete nextData.pendingTask;
            delete nextData.pendingTaskAt;
            delete nextData.error;
            nodes.set(nodeId, { ...node, data: nextData });
          } catch (error) {
            const nextData: Record<string, any> = {
              ...renderData,
              status: "failed",
              error: error instanceof Error ? error.message : String(error),
            };
            delete nextData.pendingTask;
            delete nextData.pendingTaskAt;
            nodes.set(nodeId, { ...node, data: nextData });
          }
          changed = true;
          continue;
        }

        const kind = pendingKindForNode(node);
        if (!kind) continue;

        const durableIdentity = durableProviderIdentity(
          projectId,
          nodeId,
          kind,
        );
        if (durableJournal) {
          const existingDurableRun = await durableJournal.load(durableIdentity);
          if (existingDurableRun) {
            await ensureDurableInputBindings(durableIdentity);
            await providerExecutionHandoffs.remove(projectId, nodeId);
            const existingData = node.data as Record<string, unknown>;
            if (existingData.status !== "generating") {
              nodes.set(nodeId, {
                ...node,
                data: durableProviderNodeData(existingData, {
                  status: "generating",
                }),
              });
              changed = true;
              await input.checkpoint?.();
            }
            await driveDurableRun(durableIdentity);
            continue;
          }
        }

        const taskId = `local-gen-${sanitizeStorageSegment(nodeId)}`;
        let data = node.data as Record<string, unknown>;
        let selectedProviderAccountId: string | undefined;
        try {
          selectedProviderAccountId = (
            await providerExecutionHandoffs.load(projectId, nodeId)
          )?.accountId;
          const authoredPrompt = authoredPromptFromData(data, `Mock ${kind}`);
          const parsedPromptParts = parsePromptParts(authoredPrompt);
          const prompt = extractPromptText(parsedPromptParts);
          const model = modelFromData(data, `mock-${kind}`);
          const normalizedModel = normalizeModelId(model) ?? model;
          const modelCard = modelCards.find(
            (card) => card.id === normalizedModel,
          );
          const isStartEnd = !!modelCard?.input.inputMode.startEnd;
          const referenceImageAssetIds = stringList(
            data.referenceImageAssetIds,
          );
          const referenceVideoAssetIds = stringList(
            data.referenceVideoAssetIds,
          );
          const referenceAudioAssetIds = stringList(
            data.referenceAudioAssetIds,
          );
          if (modelCard) {
            const referenceError = validateRefs(
              modelCard,
              {
                image: referenceImageAssetIds.length,
                video: referenceVideoAssetIds.length,
                audio: referenceAudioAssetIds.length,
              },
              { prompt },
            );
            if (referenceError) throw new Error(referenceError);
          }
          const projectAssetById = new Map(
            listProjectAssets(doc).map((asset) => [asset.id, asset]),
          );
          const referenceEntries = (
            ids: string[],
            kind: ProcessableKind,
          ): ProjectAssetEntry[] =>
            ids
              .map((assetId) => {
                const asset = projectAssetById.get(assetId);
                if (!asset || asset.lifecycle.state !== "active") {
                  throw new Error(
                    `Reference Project Asset ${assetId} is not available in Project ${projectId}.`,
                  );
                }
                if (asset.kind !== kind) {
                  throw new Error(
                    `Reference Project Asset ${assetId} is ${asset.kind}, not ${kind}.`,
                  );
                }
                return asset;
              });
          const referenceImageEntries = referenceEntries(
            referenceImageAssetIds,
            "image",
          );
          const referenceVideoEntries = referenceEntries(
            referenceVideoAssetIds,
            "video",
          );
          const referenceAudioEntries = referenceEntries(
            referenceAudioAssetIds,
            "audio",
          );
          if (modelCard) {
            const mediaReferences: ReferenceMediaMetadata[] = [
              ...referenceImageEntries.map((asset) => ({
                asset,
                modality: "image" as const,
              })),
              ...referenceVideoEntries.map((asset) => ({
                asset,
                modality: "video" as const,
              })),
              ...referenceAudioEntries.map((asset) => ({
                asset,
                modality: "audio" as const,
              })),
            ].map(({ asset, modality }) => ({
              modality,
              contentType: asset.metadata.contentType,
              fileName: asset.metadata.originalName ?? asset.name,
              bytes: asset.metadata.bytes,
              width: asset.metadata.width,
              height: asset.metadata.height,
              durationMs: asset.metadata.durationMs,
              frameRate: asset.metadata.frameRate,
              videoCodec: asset.metadata.videoCodec,
              audioCodec: asset.metadata.audioCodec,
              embedded: !!options.mediaBaseUrl,
            }));
            const mediaError = validateReferenceMedia(
              modelCard,
              mediaReferences,
            );
            if (mediaError) throw new Error(mediaError);
          }
          const globalReferences: ProviderMediaReference[] = [
            ...referenceImageEntries.map((asset) => ({
              asset,
              kind: "image" as const,
            })),
            ...referenceVideoEntries.map((asset) => ({
              asset,
              kind: "video" as const,
            })),
            ...referenceAudioEntries.map((asset) => ({
              asset,
              kind: "audio" as const,
            })),
          ];
          let references: ExecutablePluginReference[];
          const referenceBindingType = modelCard?.input.referenceBinding?.type;
          if (isStartEnd) {
            references = [
              ...referenceImageEntries.flatMap((asset, index) =>
                index === 0
                  ? [assetReference(asset, "startFrame", 0)]
                  : index === 1
                    ? [assetReference(asset, "endFrame", 0)]
                    : [assetReference(asset, "image", index - 2)],
              ),
              ...referenceVideoEntries.map((asset, index) =>
                assetReference(asset, "video", index),
              ),
              ...referenceAudioEntries.map((asset, index) =>
                assetReference(asset, "audio", index),
              ),
            ];
          } else if (
            referenceBindingType === "ordered-content-parts" ||
            referenceBindingType === "positional-tokens"
          ) {
            references = mixedContentReferences({
              nodeId,
              promptParts: parsedPromptParts,
              globalReferences,
              resolveMention(mentionedNodeId) {
                const referencedNode = nodes.get(mentionedNodeId) as
                  Record<string, any> | undefined;
                const assetId =
                  typeof referencedNode?.data?.assetId === "string"
                    ? referencedNode.data.assetId
                    : undefined;
                const modality = referencedNode?.type;
                if (
                  !assetId ||
                  (modality !== "image" &&
                    modality !== "video" &&
                    modality !== "audio")
                ) {
                  return undefined;
                }
                return { assetId, kind: modality };
              },
            });
          } else {
            references = [
              ...referenceImageEntries.map((asset, index) =>
                assetReference(asset, "image", index),
              ),
              ...referenceVideoEntries.map((asset, index) =>
                assetReference(asset, "video", index),
              ),
              ...referenceAudioEntries.map((asset, index) =>
                assetReference(asset, "audio", index),
              ),
            ];
          }
          const requestedAspectRatio =
            kind === "image" || kind === "video"
              ? aspectRatioFromData(data)
              : undefined;
          const requestedDuration =
            kind === "video" || kind === "audio"
              ? durationFromData(data, modelCard)
              : undefined;
          const commonInput = {
            taskId,
            projectId,
            nodeId,
            actorType:
              data.actorType === "agent"
                ? ("agent" as const)
                : ("user" as const),
            actorUserId:
              typeof data.actorUserId === "string" ? data.actorUserId : userId,
            ...(typeof data.actorAgentId === "string"
              ? { actorAgentId: data.actorAgentId }
              : {}),
            prompt,
            model,
            ...(requestedAspectRatio
              ? { aspectRatio: requestedAspectRatio }
              : {}),
            ...(requestedDuration !== undefined
              ? { duration: requestedDuration }
              : {}),
            modelParams: modelParams(data),
            // Host-private command handoff. The selected account survives restart in SQLite and
            // is frozen into the durable run before Provider submit; it never enters Loro or the
            // plugin-visible values bag.
            ...(selectedProviderAccountId
              ? { providerAccountId: selectedProviderAccountId }
              : {}),
            references,
            ...(ExecutablePluginBindingSchema.safeParse(data.pluginBinding)
              .success
              ? {
                  pluginBinding: ExecutablePluginBindingSchema.parse(
                    data.pluginBinding,
                  ),
                }
              : {}),
          };
          const usesLocalTextAgent =
            kind === "text" && model === "local-acp" && !!options.textAgent;
          if (!usesLocalTextAgent && aigc.planProviderPlugin) {
            const plan = await aigc.planProviderPlugin(commonInput, kind);
            if (plan) {
              if (!coordinator) {
                throw new Error(
                  "Provider-backed generation requires the Host durable run coordinator before submit.",
                );
              }
              const createdAt = durable?.now?.() ?? Date.now();
              const executor: Omit<
                FrozenLocalProviderExecutorInput,
                "schemaVersion"
              > = {
                binding: plan.binding,
                ...(plan.accountId ? { accountId: plan.accountId } : {}),
                kind: plan.kind,
                projectId: plan.projectId,
                ...(plan.nodeId ? { nodeId: plan.nodeId } : {}),
                provider: plan.provider,
                modelEndpoint: plan.modelEndpoint,
                input: plan.input as FrozenLocalProviderExecutorInput["input"],
              };
              await coordinator.coordinate({
                type: "create",
                ...durableIdentity,
                deadlineAt: createdAt + generationDeadlineMs,
                executor,
              });
              await ensureDurableInputBindings(durableIdentity);
              await providerExecutionHandoffs.remove(projectId, nodeId);
              data = durableProviderNodeData(data, { status: "generating" });
              nodes.set(nodeId, { ...node, data });
              changed = true;
              // The SQLite journal and coarse Project state both survive before Provider submit.
              await input.checkpoint?.();
              await driveDurableRun(durableIdentity);
              continue;
            }
          }
          const invocationStartedAt = Date.now();
          const providerDeadlineAt = invocationStartedAt + generationDeadlineMs;
          if (kind === "text") {
            let generated;
            if (options.textAgent && model === "local-acp") {
              try {
                generated = await beforeProviderGenerationDeadline(
                  options.textAgent.generate({
                    projectId,
                    prompt,
                    modelId: model,
                    modelParams: modelParams(data),
                    actorAgentId:
                      typeof data.actorAgentId === "string"
                        ? data.actorAgentId
                        : undefined,
                  }),
                  providerDeadlineAt,
                  generationDeadlineMs,
                );
              } catch {
                generated = await beforeProviderGenerationDeadline(
                  aigc.generateText(commonInput),
                  providerDeadlineAt,
                  generationDeadlineMs,
                );
              }
            } else {
              generated = await beforeProviderGenerationDeadline(
                aigc.generateText(commonInput),
                providerDeadlineAt,
                generationDeadlineMs,
              );
            }
            await recordGeneratedTextRevision({
              dataDir: options.dataDir,
              userId,
              projectId,
              nodeId,
              nodeData: data,
              content: generated.text,
            });
            const nextData = durableProviderNodeData(data, {
              status: "completed",
              content: generated.text,
              ...(generated.provider ? { provider: generated.provider } : {}),
              ...(generated.modelEndpoint
                ? { modelEndpoint: generated.modelEndpoint }
                : {}),
            });
            nodes.set(nodeId, { ...node, data: nextData });
            changed = true;
            if (selectedProviderAccountId) {
              await providerExecutionHandoffs.remove(projectId, nodeId);
            }
            continue;
          }
          const generation =
            kind === "image"
              ? aigc.generateImage(commonInput)
              : kind === "video"
                ? aigc.generateVideo(commonInput)
                : aigc.generateAudio(commonInput);
          const generated = await beforeProviderGenerationDeadline(
            generation,
            providerDeadlineAt,
            generationDeadlineMs,
          );
          if (generated.status === "accepted") {
            throw new Error(
              "An accepted Provider result requires the durable executable Provider path.",
            );
          }
          if (generated.status === "failed") {
            nodes.set(nodeId, {
              ...node,
              data: durableProviderNodeData(data, {
                status: "failed",
                error: generated.error.message,
                failureCode: generated.error.code,
              }),
            });
            changed = true;
            if (selectedProviderAccountId) {
              await providerExecutionHandoffs.remove(projectId, nodeId);
            }
            continue;
          }
          const asset = await saveAsset({
            doc,
            projectAssets,
            projectId,
            nodeId,
            taskId,
            kind,
            nodeData: data,
            bytes: generated.bytes,
            contentType: generated.contentType,
            width: generated.width,
            height: generated.height,
            durationMs: generated.durationMs,
            waveform: generated.waveform,
            transcript: generated.transcript,
            requestId: generated.requestId,
            provider: generated.provider,
            modelEndpoint: generated.modelEndpoint,
            remoteUrl: generated.remoteUrl,
          });
          const nextData = durableProviderNodeData(data, {
            status: "completed",
            assetId: asset.id,
            ...(generated.pluginBinding
              ? { pluginBinding: generated.pluginBinding }
              : {}),
          });
          nodes.set(nodeId, { ...node, data: nextData });
          changed = true;
          if (selectedProviderAccountId) {
            await providerExecutionHandoffs.remove(projectId, nodeId);
          }
        } catch (error) {
          if (selectedProviderAccountId) {
            await providerExecutionHandoffs.remove(projectId, nodeId);
          }
          const nextData = durableProviderNodeData(data, {
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
          });
          nodes.set(nodeId, { ...node, data: nextData });
          changed = true;
        }
      }

      return changed;
    },
  };
}
