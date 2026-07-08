import { createHash } from "node:crypto";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  agentReadToken,
  TimelineAppliedRevisionSchema,
  timelineDslFromYaml,
  timelineDslToYaml,
  validateCanvasTimelineApply,
  type ResolvedTimelineDsl,
  type TimelineAppliedRevision,
  type TimelineRevisionActor,
  type TimelineRevisionDependencies,
} from "@clash/shared-types";
import {
  assertProjectionLockFilePath,
  createProjectionLock,
  hashProjectionContent,
  parseProjectionLock,
  type ProjectionLockEntity,
  resolveProjectionFilePathInsideCwd,
  resolveProjectionLockPathInsideCwd,
  resolveProjectionLockSidecarPathInsideCwd,
} from "./projection-cas";

export type {
  TimelineAppliedRevision,
  TimelineRevisionActor,
  TimelineRevisionDependencies,
};

export type TimelineNodeLike = {
  id?: string;
  type: string;
  data?: Record<string, unknown>;
};

export type TimelineReferenceNodeLike = {
  id: string;
  type?: string;
  data?: Record<string, unknown>;
};

export type TimelineReferenceEdge = {
  source: string;
  target: string;
};

export type TimelineLock = {
  schemaVersion: 1;
  kind: "clash.timeline.lock";
  projectionKind: "timeline";
  projectId: string;
  entity: ProjectionLockEntity;
  nodeId: string;
  filePath: string;
  contentHash: string;
  timelineHash: string;
  readToken?: string;
  hashAlgorithm: "sha256-64";
  pulledAt: string;
  appliedRevision?: TimelineAppliedRevision;
};

export type ParseTimelineApplyResult =
  | { ok: true; dsl: ResolvedTimelineDsl; sources: string[] }
  | { ok: false; error: string };

export type TimelineCasResult = { ok: true } | { ok: false; error: string };

export type TimelineRevisionStatus = "draft-file" | "applied";

export type TimelineSourceProvenance = {
  sourceTimelineId: string;
  sourceTimelinePath: string;
  sourceTimelineHash: string;
  sourceTimelineRevisionId: string;
  sourceTimelineRevisionStatus: TimelineRevisionStatus;
  sourceTimelineFrontiers?: unknown[];
  sourceTimelineVersionVector?: Record<string, number>;
};

export type LoroRevisionMetadata = {
  loroFrontiers?: unknown[];
  loroVersionVector?: Record<string, number>;
};

export type TimelineProjectionCasApply = {
  target: "timeline";
  mutation: "projection-only";
  applyCommand: "clash timeline apply";
  filePath: string;
  lockPath: string;
  lockRequired: true;
  lockSource: "fresh-canvas-pull";
  nodeIdPlaceholder: "<video-editor-node-id>";
  requiredRuntimeArgs: string[];
  pullCommand: "clash timeline pull";
  pullArgs: string[];
  applyArgs: string[];
};

export function resolveTimelineFilePath(options: {
  cwd: string;
  file?: string;
  timeline?: string;
}): string {
  const filePath = options.file
    ? options.file
    : join(options.cwd, "timelines", `${timelineFileSlug(options.timeline ?? "main")}.timeline.yaml`);
  return resolveProjectionFilePathInsideCwd({
    filePath,
    cwd: options.cwd,
  });
}

export function resolveTimelineLockPath(options: {
  cwd: string;
  file?: string;
  lock?: string;
  timeline?: string;
}): string {
  if (options.lock) {
    return resolveProjectionLockSidecarPathInsideCwd({
      lockPath: options.lock,
      cwd: options.cwd,
    });
  }
  return resolveProjectionLockPathInsideCwd({
    filePath: resolveTimelineFilePath(options),
    cwd: options.cwd,
  });
}

export function timelineProjectionCasApply(options: {
  cwd: string;
  filePath: string;
  timeline?: string;
}): { casApply: TimelineProjectionCasApply; lockPath: string } {
  const timeline = options.timeline ?? "main";
  const targetFilePath = resolveTimelineFilePath({ cwd: options.cwd, timeline });
  const lockPath = resolveTimelineLockPath({ cwd: options.cwd, timeline });
  const projectionPath = toProjectPath(options.cwd, options.filePath);
  const targetProjectPath = toProjectPath(options.cwd, targetFilePath);
  const lockProjectPath = toProjectPath(options.cwd, lockPath);
  return {
    lockPath,
    casApply: {
      target: "timeline",
      mutation: "projection-only",
      applyCommand: "clash timeline apply",
      filePath: projectionPath,
      lockPath: lockProjectPath,
      lockRequired: true,
      lockSource: "fresh-canvas-pull",
      nodeIdPlaceholder: "<video-editor-node-id>",
      requiredRuntimeArgs: ["--node <video-editor-node-id>"],
      pullCommand: "clash timeline pull",
      pullArgs: ["--node", "<video-editor-node-id>", "--file", targetProjectPath],
      applyArgs: ["--node", "<video-editor-node-id>", "--file", projectionPath, "--lock", lockProjectPath],
    },
  };
}

export function timelineYamlFromNode(node: TimelineNodeLike): string {
  const dsl = normalizeTimelineDslForYaml(node.data?.timelineDsl);
  return timelineDslToYaml(dsl);
}

export function parseTimelineFileForApply(raw: string): ParseTimelineApplyResult {
  const result = timelineDslFromYaml(raw);
  if (!result.ok) return result;
  return {
    ok: true,
    dsl: result.dsl,
    sources: sourceNodeIdsFromResolved(result.dsl),
  };
}

export function timelineHash(dsl: ResolvedTimelineDsl): string {
  return hashProjectionContent(stableJsonForHash(dsl));
}

export function timelineReadToken(options: {
  projectId: string;
  nodeId: string;
  dsl?: ResolvedTimelineDsl;
  timelineHash?: string;
}): string {
  const hash = options.timelineHash ?? (options.dsl ? timelineHash(options.dsl) : "");
  if (!hash) throw new Error("timelineReadToken requires a timeline hash or DSL");
  return agentReadToken({
    namespace: "timeline",
    subject: {
      projectId: options.projectId,
      nodeId: options.nodeId,
      timelineHash: hash,
    },
  });
}

export function createTimelineCowNodeData(options: {
  sourceNodeId: string;
  sourceLabel?: string;
  sourceDsl: ResolvedTimelineDsl;
  dsl: ResolvedTimelineDsl;
  label?: string;
  filePath?: string;
  timelineRevision?: TimelineAppliedRevision;
}): Record<string, unknown> {
  const sourceTimelineHash = timelineHash(options.sourceDsl);
  const nextTimelineHash = timelineHash(options.dsl);
  const sourceLabel = options.sourceLabel?.trim();
  const label = options.label?.trim() || (sourceLabel ? `${sourceLabel} (copy)` : `Copy of ${options.sourceNodeId}`);
  return {
    label,
    timelineDsl: options.dsl,
    copyOnWrite: true,
    copyOnWriteKind: "timeline-replacement",
    sourceTimelineNodeId: options.sourceNodeId,
    sourceTimelineHash,
    timelineHash: nextTimelineHash,
    ...(options.filePath ? { sourceTimelineFilePath: options.filePath } : {}),
    ...(options.timelineRevision ? { timelineRevision: options.timelineRevision } : {}),
  };
}

export function createTimelineSourceProvenance(options: {
  cwd: string;
  filePath: string;
  dsl: ResolvedTimelineDsl;
  appliedRevision?: TimelineAppliedRevision | null;
  timelineId?: string;
  revisionId?: string;
  revisionStatus?: TimelineRevisionStatus;
  sourceTimelineFrontiers?: unknown[];
  sourceTimelineVersionVector?: Record<string, number>;
}): TimelineSourceProvenance {
  const cwd = resolve(options.cwd);
  const absolutePath = isAbsolute(options.filePath) ? resolve(options.filePath) : resolve(cwd, options.filePath);
  if (!isInsideOrEqual(cwd, absolutePath)) {
    throw new Error("Timeline provenance path must stay inside the current project cwd");
  }
  const sourceTimelinePath = toProjectPath(cwd, absolutePath);
  if (options.appliedRevision) {
    return {
      sourceTimelineId: options.appliedRevision.timelineId,
      sourceTimelinePath,
      sourceTimelineHash: options.appliedRevision.timelineHash,
      sourceTimelineRevisionId: options.appliedRevision.revisionId,
      sourceTimelineRevisionStatus: "applied",
      ...(options.appliedRevision.loroFrontiers ? { sourceTimelineFrontiers: options.appliedRevision.loroFrontiers } : {}),
      ...(options.appliedRevision.loroVersionVector ? { sourceTimelineVersionVector: options.appliedRevision.loroVersionVector } : {}),
    };
  }
  const sourceTimelineHash = timelineHash(options.dsl);
  return {
    sourceTimelineId: options.timelineId ?? `timeline:${sourceTimelinePath}`,
    sourceTimelinePath,
    sourceTimelineHash,
    sourceTimelineRevisionId: options.revisionId ?? `tlrev-${sourceTimelineHash}`,
    sourceTimelineRevisionStatus: options.revisionStatus ?? "draft-file",
    ...(options.sourceTimelineFrontiers ? { sourceTimelineFrontiers: options.sourceTimelineFrontiers } : {}),
    ...(options.sourceTimelineVersionVector ? { sourceTimelineVersionVector: options.sourceTimelineVersionVector } : {}),
  };
}

export function createTimelineAppliedRevision(options: {
  projectId: string;
  nodeId: string;
  cwd: string;
  filePath: string;
  dsl: ResolvedTimelineDsl;
  parentRevisionId?: string | null;
  createdAt?: string;
  timelineId?: string;
  loroFrontiers?: unknown[];
  loroVersionVector?: Record<string, number>;
  actor?: TimelineRevisionActor;
}): TimelineAppliedRevision {
  const cwd = resolve(options.cwd);
  const absolutePath = isAbsolute(options.filePath) ? resolve(options.filePath) : resolve(cwd, options.filePath);
  if (!isInsideOrEqual(cwd, absolutePath)) {
    throw new Error("Timeline revision source path must stay inside the current project cwd");
  }
  const timelineId = options.timelineId ?? `timeline:${options.projectId}:${options.nodeId}`;
  const hash = timelineHash(options.dsl);
  const createdAt = options.createdAt ?? new Date().toISOString();
  const revisionSeed = {
    timelineId,
    timelineHash: hash,
    parentRevisionId: options.parentRevisionId ?? null,
    createdAt,
    actor: options.actor ?? null,
    loroFrontiers: options.loroFrontiers ?? null,
    loroVersionVector: options.loroVersionVector ?? null,
  };
  const revisionSuffix = createHash("sha256").update(stableJsonForHash(revisionSeed)).digest("hex").slice(0, 12);
  return {
    schemaVersion: 1,
    kind: "clash.timeline.revision",
    timelineId,
    revisionId: `tlrev-${hash}-${revisionSuffix}`,
    ...(options.parentRevisionId ? { parentRevisionId: options.parentRevisionId } : {}),
    projectId: options.projectId,
    nodeId: options.nodeId,
    createdAt,
    timelineHash: hash,
    hashAlgorithm: "sha256-64",
    sourceFilePath: toProjectPath(cwd, absolutePath),
    sourceFileHash: hash,
    ...(options.actor ? { actor: options.actor } : {}),
    ...(options.loroFrontiers ? { loroFrontiers: options.loroFrontiers } : {}),
    ...(options.loroVersionVector ? { loroVersionVector: options.loroVersionVector } : {}),
    dependencies: collectTimelineRevisionDependencies(options.dsl),
  };
}

export function readLoroRevisionMetadata(doc: unknown): LoroRevisionMetadata {
  const value = doc as {
    frontiers?: () => unknown;
    version?: () => { toJSON?: () => unknown };
  };
  const metadata: LoroRevisionMetadata = {};
  try {
    const frontiers = value.frontiers?.();
    if (Array.isArray(frontiers)) metadata.loroFrontiers = frontiers;
  } catch {
    // Version metadata is best-effort; the content hash remains the v1 guard.
  }
  try {
    const versionVector = value.version?.().toJSON?.();
    if (versionVector && typeof versionVector === "object" && !Array.isArray(versionVector)) {
      const record = versionVector as Record<string, number>;
      if (Object.keys(record).length > 0) metadata.loroVersionVector = record;
    }
  } catch {
    // Some Loro bindings do not expose a JSON-friendly VersionVector.
  }
  return metadata;
}

export function createTimelineLock(options: {
  projectId: string;
  nodeId: string;
  filePath: string;
  dsl: ResolvedTimelineDsl;
  readToken?: string;
  pulledAt?: string;
  appliedRevision?: TimelineAppliedRevision;
}): TimelineLock {
  return createTimelineLockFromHash({
    ...options,
    timelineHash: timelineHash(options.dsl),
  });
}

export function createTimelineLockFromHash(options: {
  projectId: string;
  nodeId: string;
  filePath: string;
  timelineHash: string;
  readToken?: string;
  pulledAt?: string;
  appliedRevision?: TimelineAppliedRevision;
}): TimelineLock {
  return createProjectionLock({
    kind: "clash.timeline.lock",
    projectionKind: "timeline",
    projectId: options.projectId,
    entity: { kind: "video-editor-node", id: options.nodeId },
    filePath: options.filePath,
    contentHash: options.timelineHash,
    readToken: options.readToken ?? timelineReadToken({
      projectId: options.projectId,
      nodeId: options.nodeId,
      timelineHash: options.timelineHash,
    }),
    pulledAt: options.pulledAt ?? new Date().toISOString(),
    extra: {
      nodeId: options.nodeId,
      timelineHash: options.timelineHash,
      ...(options.appliedRevision ? { appliedRevision: options.appliedRevision } : {}),
    },
  }) as TimelineLock;
}

export function parseTimelineLock(raw: string): TimelineLock {
  const value = JSON.parse(raw) as Partial<TimelineLock>;
  if (
    value.schemaVersion !== 1 ||
    value.kind !== "clash.timeline.lock" ||
    typeof value.projectId !== "string" ||
    typeof value.nodeId !== "string" ||
    typeof value.filePath !== "string" ||
    typeof value.timelineHash !== "string" ||
    (value.readToken !== undefined && typeof value.readToken !== "string") ||
    value.hashAlgorithm !== "sha256-64" ||
    typeof value.pulledAt !== "string"
  ) {
    throw new Error("Invalid timeline lock file");
  }
  if (value.appliedRevision !== undefined) {
    parseTimelineAppliedRevision(value.appliedRevision);
  }
  const normalized = {
    ...value,
    projectionKind: value.projectionKind ?? "timeline",
    entity: value.entity ?? { kind: "video-editor-node", id: value.nodeId },
    contentHash: value.contentHash ?? value.timelineHash,
  } as TimelineLock;
  parseProjectionLock(normalized, {
    kind: "clash.timeline.lock",
    projectionKind: "timeline",
    entityKind: "video-editor-node",
    entityId: value.nodeId,
  });
  return normalized;
}

export function assertTimelineCas(options: {
  projectId: string;
  nodeId: string;
  lock?: TimelineLock | null;
  currentDsl: ResolvedTimelineDsl;
  force?: boolean;
  filePath?: string;
  cwd?: string;
}): TimelineCasResult {
  if (options.force) return { ok: true };
  if (!options.lock) {
    return {
      ok: false,
      error: "Missing timeline CAS lock. Run `clash timeline pull` first, or pass --force to intentionally overwrite.",
    };
  }
  if (options.lock.projectId !== options.projectId || options.lock.nodeId !== options.nodeId) {
    return {
      ok: false,
      error: `Timeline CAS lock belongs to project ${options.lock.projectId} node ${options.lock.nodeId}, not project ${options.projectId} node ${options.nodeId}.`,
    };
  }
  const filePathResult = assertTimelineLockFilePath({
    lock: options.lock,
    filePath: options.filePath,
    cwd: options.cwd,
  });
  if (!filePathResult.ok) return filePathResult;
  const currentHash = timelineHash(options.currentDsl);
  if (currentHash !== options.lock.timelineHash) {
    return {
      ok: false,
      error:
        `Stale timeline apply rejected. Canvas timeline hash is ${currentHash}, ` +
        `but lock was pulled from ${options.lock.timelineHash}. ` +
        "Run `clash timeline pull` again and merge, or pass --force to intentionally overwrite.",
    };
  }
  return { ok: true };
}

export function assertTimelineLockFilePath(options: {
  lock?: TimelineLock | null;
  filePath?: string;
  cwd?: string;
  force?: boolean;
}): TimelineCasResult {
  return assertProjectionLockFilePath({
    label: "timeline",
    lockFilePath: options.lock?.filePath,
    filePath: options.filePath,
    cwd: options.cwd,
    force: options.force,
    readCommand: "clash timeline pull",
    writeVerb: "Apply",
  });
}

export function assertTimelineNotMaterializedReferenced(options: {
  nodeId: string;
  nodes?: Iterable<TimelineReferenceNodeLike>;
  edges: TimelineReferenceEdge[];
  force?: boolean;
}): TimelineCasResult {
  return validateCanvasTimelineApply(options);
}

export function normalizeTimelineDslForYaml(raw: unknown): ResolvedTimelineDsl {
  const skeleton: ResolvedTimelineDsl = {
    tracks: [],
    compositionWidth: 1920,
    compositionHeight: 1080,
    fps: 30,
    durationInFrames: 300,
  };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return skeleton;
  const input = raw as Record<string, unknown>;
  const tracks = Array.isArray(input.tracks) ? input.tracks : [];
  return {
    tracks: tracks.map((track, index) => normalizeTrackForYaml(track, index)),
    compositionWidth: typeof input.compositionWidth === "number" ? input.compositionWidth : skeleton.compositionWidth,
    compositionHeight: typeof input.compositionHeight === "number" ? input.compositionHeight : skeleton.compositionHeight,
    fps: typeof input.fps === "number" ? input.fps : skeleton.fps,
    durationInFrames: typeof input.durationInFrames === "number" ? input.durationInFrames : skeleton.durationInFrames,
  };
}

export function sourceNodeIdsFromResolved(dsl: ResolvedTimelineDsl): string[] {
  const seen = new Set<string>();
  for (const track of dsl.tracks) {
    for (const item of track.items) {
      const sourceNodeId = (item as Record<string, unknown>).sourceNodeId;
      if (typeof sourceNodeId === "string" && sourceNodeId.length > 0) {
        seen.add(sourceNodeId);
      }
    }
  }
  return Array.from(seen);
}

function parseTimelineAppliedRevision(value: unknown): TimelineAppliedRevision {
  const parsed = TimelineAppliedRevisionSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("Invalid timeline applied revision");
  }
  return parsed.data;
}

function collectTimelineRevisionDependencies(dsl: ResolvedTimelineDsl): TimelineRevisionDependencies {
  const sourceNodeIds = new Set<string>();
  const assetIds = new Set<string>();
  const componentIds = new Set<string>();
  const textNodeIds = new Set<string>();
  for (const track of dsl.tracks) {
    for (const item of track.items) {
      addString(sourceNodeIds, item.sourceNodeId);
      addString(assetIds, item.assetId);
      addString(assetIds, item.sourceAssetId);
      addString(assetIds, item.derivedAssetId);
      addString(assetIds, item.videoAssetId);
      addString(assetIds, item.audioAssetId);
      addString(assetIds, item.imageAssetId);
      addString(componentIds, item.componentId);
      addString(componentIds, item.compositionId);
      addString(textNodeIds, item.textNodeId);
      addString(textNodeIds, item.scriptNodeId);
      addString(textNodeIds, item.captionNodeId);
    }
  }
  return {
    sourceNodeIds: Array.from(sourceNodeIds),
    assetIds: Array.from(assetIds),
    componentIds: Array.from(componentIds),
    textNodeIds: Array.from(textNodeIds),
  };
}

function addString(target: Set<string>, value: unknown): void {
  if (typeof value === "string" && value.length > 0) target.add(value);
}

function timelineFileSlug(raw: string): string {
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "main";
}

function toProjectPath(cwd: string, absolutePath: string): string {
  return relative(cwd, absolutePath).split(sep).join("/");
}

function isInsideOrEqual(parent: string, child: string): boolean {
  const relativePath = relative(parent, child);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function normalizeTrackForYaml(raw: unknown, index: number): ResolvedTimelineDsl["tracks"][number] {
  const track = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const items = Array.isArray(track.items) ? track.items : [];
  const id = typeof track.id === "string" && track.id.length > 0 ? track.id : `track-${index}`;
  return {
    id,
    name: typeof track.name === "string" ? track.name : undefined,
    role: typeof track.role === "string" && track.role.length > 0 ? track.role : undefined,
    hidden: track.hidden === true || undefined,
    locked: track.locked === true || undefined,
    items: items
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .map((item, itemIndex) => normalizeItemForYaml(item, id, itemIndex)),
  };
}

function normalizeItemForYaml(
  item: Record<string, unknown>,
  trackId: string,
  itemIndex: number,
): ResolvedTimelineDsl["tracks"][number]["items"][number] {
  const from =
    typeof item.from === "number"
      ? item.from
      : typeof item.start_at === "number"
        ? item.start_at
        : typeof item.start === "number"
          ? item.start
          : 0;
  const durationInFrames =
    typeof item.durationInFrames === "number"
      ? item.durationInFrames
      : typeof item.duration_in_frames === "number"
        ? item.duration_in_frames
        : typeof item.end === "number" && typeof item.start === "number"
          ? Math.max(0, item.end - item.start)
          : 0;
  const drop = new Set(["from", "durationInFrames", "start", "end", "start_at", "duration_in_frames", "trackId", "id", "type"]);
  const passthrough: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(item)) {
    if (drop.has(key) || value === undefined) continue;
    passthrough[key] = value;
  }
  return {
    id: typeof item.id === "string" && item.id.length > 0 ? item.id : `item-${timelineFileSlug(trackId)}-${itemIndex}`,
    type: typeof item.type === "string" && item.type.length > 0 ? item.type : "image",
    from,
    durationInFrames,
    ...passthrough,
  };
}

function stableJsonForHash(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJsonForHash).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value as object)
      .filter((key) => key !== "fromExpr")
      .sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stableJsonForHash((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
