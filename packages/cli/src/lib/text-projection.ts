import { createHash } from "node:crypto";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  agentReadToken,
  TextRevisionActorSchema,
  type TextAppliedRevision,
  type TextRevisionActor,
} from "@clash/shared-types";
import {
  validateCanvasContentPatch,
  type CanvasUpdateNodeWithIdLike,
} from "./canvas-update-guardrails";
import {
  hashProjectionContent,
  resolveProjectionFilePathInsideCwd,
} from "./projection-cas";

export type { TextAppliedRevision, TextRevisionActor };

export type TextNodeLike = {
  type: string;
  data?: Record<string, unknown>;
};

export type TextCasResult = { ok: true } | { ok: false; error: string };

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

export function isTextRevisionActor(value: unknown): value is TextRevisionActor {
  return TextRevisionActorSchema.safeParse(value).success;
}

export function assertTextNotReferenced(options: {
  nodeId: string;
  nodes?: Iterable<CanvasUpdateNodeWithIdLike>;
  edges: TextReferenceEdge[];
}): TextCasResult {
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

/**
 * Compare a caller's proof-of-read against the entity's current version.
 *
 * The daemon performs this check server-side. The direct-replica path has to do
 * it here too, otherwise a caller that did supply proof of read has that proof
 * silently discarded whenever no daemon is running.
 */
export function requireCurrentTextVersion(options: {
  observedVersion?: string;
  projectId: string;
  nodeId: string;
  currentContent: string;
  currentReadToken?: string;
}): void {
  // Compare only. Whether proof of read is mandatory is the caller's policy:
  // the agent gate and the projection loop require it; a direct small write
  // through `canvas update`/`text apply` does not.
  if (!options.observedVersion) return;
  const current = options.currentReadToken
    ?? textReadToken({
      projectId: options.projectId,
      nodeId: options.nodeId,
      content: options.currentContent,
    });
  if (current !== options.observedVersion) {
    throw new Error(
      "STALE_READ: This text changed after it was read. Pull it again, reconcile, then apply.",
    );
  }
}
