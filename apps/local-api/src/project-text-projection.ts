import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import {
  agentReadToken,
  type TextAppliedRevision,
  type TextRevisionActor,
} from "@clash/shared-types";

export type { TextRevisionActor } from "@clash/shared-types";

type TextNodeLike = { type: string; data?: Record<string, unknown> };

export function textContentFromNode(node: TextNodeLike): string {
  return typeof node.data?.content === "string" ? node.data.content : "";
}

export function textHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

export function textReadToken(options: {
  projectId: string;
  nodeId: string;
  content?: string;
  contentHash?: string;
}): string {
  return agentReadToken({
    namespace: "text",
    subject: {
      projectId: options.projectId,
      nodeId: options.nodeId,
      contentHash: options.contentHash ?? textHash(options.content ?? ""),
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
  const sourceLabel = options.sourceLabel?.trim();
  return {
    label: options.label?.trim()
      || (sourceLabel ? `${sourceLabel} (copy)` : `Copy of ${options.sourceNodeId}`),
    content: options.content,
    copyOnWrite: true,
    copyOnWriteKind: "text-replacement",
    sourceTextNodeId: options.sourceNodeId,
    sourceContentHash: textHash(options.sourceContent),
    contentHash: textHash(options.content),
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
  const absolutePath = isAbsolute(options.filePath)
    ? resolve(options.filePath)
    : resolve(cwd, options.filePath);
  assertPathInsideCwd(cwd, absolutePath);
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
  const suffix = createHash("sha256")
    .update(stableJson(revisionSeed))
    .digest("hex")
    .slice(0, 12);
  return {
    schemaVersion: 1,
    kind: "clash.text.revision",
    textId,
    revisionId: `txrev-${contentHash}-${suffix}`,
    ...(options.parentRevisionId ? { parentRevisionId: options.parentRevisionId } : {}),
    projectId: options.projectId,
    nodeId: options.nodeId,
    createdAt,
    contentHash,
    hashAlgorithm: "sha256-64",
    sourceFilePath: relative(cwd, absolutePath).split(sep).join("/"),
    sourceFileHash: contentHash,
    ...(options.actor ? { actor: options.actor } : {}),
  };
}

function assertPathInsideCwd(cwd: string, target: string): void {
  const rel = relative(cwd, target);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error("Text revision source path must stay inside the current project cwd");
  }
  let existing = target;
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) return;
    existing = parent;
  }
  if (!existsSync(cwd)) return;
  const realRel = relative(realpathSync.native(cwd), realpathSync.native(existing));
  if (realRel === ".." || realRel.startsWith(`..${sep}`) || isAbsolute(realRel)) {
    throw new Error("Text revision source path must not traverse a symlink outside the current project cwd");
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
