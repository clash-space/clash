import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  TextAppliedRevision,
  TextRevisionContentDescriptor,
  TextRevisionHistoryEntry,
} from "@clash/shared-types";

export function textRevisionContentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

export function textRevisionContentBlobPath(dataDir: string, contentHash: string): string {
  if (!/^[a-f0-9]{16}$/.test(contentHash)) {
    throw new Error("Invalid text revision content hash");
  }
  return join(dataDir, "text-revision-blobs", contentHash.slice(0, 2), `${contentHash}.md`);
}

export function textRevisionContentUrl(revision: TextAppliedRevision): string {
  return `/api/v1/projects/${encodeURIComponent(revision.projectId)}/text-revisions/${encodeURIComponent(revision.revisionId)}/content`;
}

export function textRevisionContentDescriptor(
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

export async function storeTextRevisionContentBlob(
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

export async function withTextRevisionContentDescriptor(
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
