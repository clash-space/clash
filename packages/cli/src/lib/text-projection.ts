import { createHash } from "node:crypto";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { agentReadToken } from "@clash/shared-types";
import {
  validateCanvasContentPatch,
  type CanvasUpdateNodeWithIdLike,
} from "./canvas-update-guardrails";
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

export type TextNodeLike = {
  type: string;
  data?: Record<string, unknown>;
};

export type TextLock = {
  schemaVersion: 1;
  kind: "clash.text.lock";
  projectionKind: "text";
  projectId: string;
  entity: ProjectionLockEntity;
  nodeId: string;
  filePath: string;
  contentHash: string;
  readToken?: string;
  hashAlgorithm: "sha256-64";
  pulledAt: string;
  appliedRevision?: TextAppliedRevision;
};

export type TextCasResult = { ok: true } | { ok: false; error: string };

export type TextRevisionActor = {
  actorType: "user" | "agent";
  actorUserId: string;
  actorAgentId?: string;
};

export type TextAppliedRevision = {
  schemaVersion: 1;
  kind: "clash.text.revision";
  textId: string;
  revisionId: string;
  parentRevisionId?: string;
  projectId: string;
  nodeId: string;
  createdAt: string;
  contentHash: string;
  hashAlgorithm: "sha256-64";
  sourceFilePath: string;
  sourceFileHash: string;
  actor?: TextRevisionActor;
};

export type TextReferenceEdge = {
  source: string;
  target: string;
};

export function resolveTextFilePath(options: {
  cwd: string;
  file?: string;
  nodeId: string;
}): string {
  const filePath = options.file
    ? options.file
    : join(options.cwd, "projections", "text", `${textFileSlug(options.nodeId)}.md`);
  return resolveProjectionFilePathInsideCwd({
    filePath,
    cwd: options.cwd,
  });
}

export function resolveTextLockPath(options: {
  cwd: string;
  file?: string;
  lock?: string;
  nodeId: string;
}): string {
  if (options.lock) {
    return resolveProjectionLockSidecarPathInsideCwd({
      lockPath: options.lock,
      cwd: options.cwd,
    });
  }
  return resolveProjectionLockPathInsideCwd({
    filePath: resolveTextFilePath(options),
    cwd: options.cwd,
  });
}

export function textContentFromNode(node: TextNodeLike): string {
  const content = node.data?.content;
  return typeof content === "string" ? content : "";
}

export function textHash(content: string): string {
  return hashProjectionContent(content);
}

export function textReadToken(options: {
  projectId: string;
  nodeId: string;
  content?: string;
  contentHash?: string;
}): string {
  const contentHash = options.contentHash ?? textHash(options.content ?? "");
  return agentReadToken({
    namespace: "text",
    subject: {
      projectId: options.projectId,
      nodeId: options.nodeId,
      contentHash,
    },
  });
}

export function createTextCowNodeData(options: {
  sourceNodeId: string;
  sourceLabel?: string;
  sourceContent: string;
  content: string;
  label?: string;
  filePath?: string;
  textRevision?: TextAppliedRevision;
}): Record<string, unknown> {
  const sourceContentHash = textHash(options.sourceContent);
  const contentHash = textHash(options.content);
  const sourceLabel = options.sourceLabel?.trim();
  const label = options.label?.trim() || (sourceLabel ? `${sourceLabel} (copy)` : `Copy of ${options.sourceNodeId}`);
  return {
    label,
    content: options.content,
    copyOnWrite: true,
    copyOnWriteKind: "text-replacement",
    sourceTextNodeId: options.sourceNodeId,
    sourceContentHash,
    contentHash,
    ...(options.filePath ? { sourceTextFilePath: options.filePath } : {}),
    ...(options.textRevision ? { textRevision: options.textRevision } : {}),
  };
}

export function createTextAppliedRevision(options: {
  projectId: string;
  nodeId: string;
  cwd: string;
  filePath: string;
  content: string;
  parentRevisionId?: string | null;
  createdAt?: string;
  textId?: string;
  actor?: TextRevisionActor;
}): TextAppliedRevision {
  const cwd = resolve(options.cwd);
  const absolutePath = isAbsolute(options.filePath) ? resolve(options.filePath) : resolve(cwd, options.filePath);
  if (!isInsideOrEqual(cwd, absolutePath)) {
    throw new Error("Text revision source path must stay inside the current project cwd");
  }
  const textId = options.textId ?? `text:${options.projectId}:${options.nodeId}`;
  const contentHash = textHash(options.content);
  const createdAt = options.createdAt ?? new Date().toISOString();
  const revisionSeed = {
    textId,
    contentHash,
    parentRevisionId: options.parentRevisionId ?? null,
    createdAt,
    actor: options.actor ?? null,
  };
  const revisionSuffix = createHash("sha256").update(stableJsonForHash(revisionSeed)).digest("hex").slice(0, 12);
  return {
    schemaVersion: 1,
    kind: "clash.text.revision",
    textId,
    revisionId: `txrev-${contentHash}-${revisionSuffix}`,
    ...(options.parentRevisionId ? { parentRevisionId: options.parentRevisionId } : {}),
    projectId: options.projectId,
    nodeId: options.nodeId,
    createdAt,
    contentHash,
    hashAlgorithm: "sha256-64",
    sourceFilePath: toProjectPath(cwd, absolutePath),
    sourceFileHash: contentHash,
    ...(options.actor ? { actor: options.actor } : {}),
  };
}

export function createTextLock(options: {
  projectId: string;
  nodeId: string;
  filePath: string;
  content: string;
  readToken?: string;
  pulledAt?: string;
  appliedRevision?: TextAppliedRevision;
}): TextLock {
  return createTextLockFromHash({
    ...options,
    contentHash: textHash(options.content),
  });
}

export function createTextLockFromHash(options: {
  projectId: string;
  nodeId: string;
  filePath: string;
  contentHash: string;
  readToken?: string;
  pulledAt?: string;
  appliedRevision?: TextAppliedRevision;
}): TextLock {
  return createProjectionLock({
    kind: "clash.text.lock",
    projectionKind: "text",
    projectId: options.projectId,
    entity: { kind: "text-node", id: options.nodeId },
    filePath: options.filePath,
    contentHash: options.contentHash,
    readToken: options.readToken ?? textReadToken({
      projectId: options.projectId,
      nodeId: options.nodeId,
      contentHash: options.contentHash,
    }),
    pulledAt: options.pulledAt ?? new Date().toISOString(),
    extra: {
      nodeId: options.nodeId,
      ...(options.appliedRevision ? { appliedRevision: options.appliedRevision } : {}),
    },
  }) as TextLock;
}

export function parseTextLock(raw: string): TextLock {
  const value = JSON.parse(raw) as Partial<TextLock>;
  if (
    value.schemaVersion !== 1 ||
    value.kind !== "clash.text.lock" ||
    typeof value.projectId !== "string" ||
    typeof value.nodeId !== "string" ||
    typeof value.filePath !== "string" ||
    typeof value.contentHash !== "string" ||
    (value.readToken !== undefined && typeof value.readToken !== "string") ||
    value.hashAlgorithm !== "sha256-64" ||
    typeof value.pulledAt !== "string"
  ) {
    throw new Error("Invalid text lock file");
  }
  if (value.appliedRevision !== undefined) {
    parseTextAppliedRevision(value.appliedRevision);
  }
  if (value.projectionKind !== undefined || value.entity !== undefined) {
    parseProjectionLock(value, {
      kind: "clash.text.lock",
      projectionKind: "text",
      entityKind: "text-node",
      entityId: value.nodeId,
    });
  }
  return {
    ...value,
    projectionKind: "text",
    entity: { kind: "text-node", id: value.nodeId },
  } as TextLock;
}

function parseTextAppliedRevision(value: unknown): TextAppliedRevision {
  const revision = value as Partial<TextAppliedRevision>;
  if (
    !revision ||
    typeof revision !== "object" ||
    revision.schemaVersion !== 1 ||
    revision.kind !== "clash.text.revision" ||
    typeof revision.textId !== "string" ||
    typeof revision.revisionId !== "string" ||
    (revision.parentRevisionId !== undefined && typeof revision.parentRevisionId !== "string") ||
    typeof revision.projectId !== "string" ||
    typeof revision.nodeId !== "string" ||
    typeof revision.createdAt !== "string" ||
    typeof revision.contentHash !== "string" ||
    revision.hashAlgorithm !== "sha256-64" ||
    typeof revision.sourceFilePath !== "string" ||
    typeof revision.sourceFileHash !== "string" ||
    (revision.actor !== undefined && !isTextRevisionActor(revision.actor))
  ) {
    throw new Error("Invalid text applied revision");
  }
  return revision as TextAppliedRevision;
}

export function isTextRevisionActor(value: unknown): value is TextRevisionActor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actor = value as Partial<TextRevisionActor>;
  return (
    (actor.actorType === "user" || actor.actorType === "agent") &&
    typeof actor.actorUserId === "string" &&
    (actor.actorAgentId === undefined || typeof actor.actorAgentId === "string")
  );
}

export function assertTextCas(options: {
  projectId: string;
  nodeId: string;
  lock?: TextLock | null;
  currentContent: string;
  force?: boolean;
  filePath?: string;
  cwd?: string;
}): TextCasResult {
  if (options.force) return { ok: true };
  if (!options.lock) {
    return {
      ok: false,
      error: "Missing text CAS lock. Run `clash text pull` first, or pass --force to intentionally overwrite.",
    };
  }
  if (options.lock.projectId !== options.projectId || options.lock.nodeId !== options.nodeId) {
    return {
      ok: false,
      error: `Text CAS lock belongs to project ${options.lock.projectId} node ${options.lock.nodeId}, not project ${options.projectId} node ${options.nodeId}.`,
    };
  }
  const filePathResult = assertTextLockFilePath({
    lock: options.lock,
    filePath: options.filePath,
    cwd: options.cwd,
  });
  if (!filePathResult.ok) return filePathResult;
  const currentHash = textHash(options.currentContent);
  if (currentHash !== options.lock.contentHash) {
    return {
      ok: false,
      error:
        `Stale text apply rejected. Canvas text hash is ${currentHash}, ` +
        `but lock was pulled from ${options.lock.contentHash}. ` +
        "Run `clash text pull` again and merge, or pass --force to intentionally overwrite.",
    };
  }
  return { ok: true };
}

export function assertTextLockFilePath(options: {
  lock?: TextLock | null;
  filePath?: string;
  cwd?: string;
  force?: boolean;
}): TextCasResult {
  return assertProjectionLockFilePath({
    label: "text",
    lockFilePath: options.lock?.filePath,
    filePath: options.filePath,
    cwd: options.cwd,
    force: options.force,
    readCommand: "clash text pull",
    writeVerb: "Apply",
  });
}

export function assertTextNotReferenced(options: {
  nodeId: string;
  nodes?: Iterable<CanvasUpdateNodeWithIdLike>;
  edges: TextReferenceEdge[];
  force?: boolean;
}): TextCasResult {
  if (options.force) return { ok: true };

  const guard = validateCanvasContentPatch({
    nodeId: options.nodeId,
    node: { type: "text" },
    nodes: options.nodes,
    edges: options.edges,
    hasContentPatch: true,
  });
  if (guard.ok) return { ok: true };

  const downstream = options.edges.filter((edge) => edge.source === options.nodeId);
  if (downstream.length === 0) return { ok: true };
  const targets = downstream.map((edge) => edge.target).join(", ");
  return {
    ok: false,
    error:
      `Referenced text apply rejected. Text node ${options.nodeId} is referenced by downstream node(s): ${targets}. ` +
      "Use a copy-on-write/replace command instead of mutating referenced text in place.",
  };
}

function textFileSlug(raw: string): string {
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "text";
}

function isInsideOrEqual(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function toProjectPath(cwd: string, absolutePath: string): string {
  return relative(cwd, absolutePath).split(sep).join("/");
}

function stableJsonForHash(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJsonForHash).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJsonForHash(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
