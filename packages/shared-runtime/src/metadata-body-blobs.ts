import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Content-addressed bodies for asset metadata, mirroring the text revision blob
 * store: written once, never mutated, `0o444` on disk.
 *
 * Attached metadata only carries a body's identity, so a transcript or a beat
 * grid never has to be inlined into a manifest that gets rewritten on every
 * apply. Because the path is the hash of the content, two writers racing on the
 * same body converge instead of conflicting -- which is why this store, unlike
 * SQLite or the Loro replica, is safe to write from outside the host process.
 */

export const METADATA_BODY_BLOB_DIRNAME = "metadata-blobs";

export function metadataBodyContentHash(body: string): string {
  return `sha256:${createHash("sha256").update(body, "utf8").digest("hex")}`;
}

export function metadataBodyBlobPath(dataDir: string, contentHash: string): string {
  const digest = /^sha256:([a-f0-9]{64})$/u.exec(contentHash)?.[1];
  if (!digest) throw new Error(`Invalid metadata body content hash: ${contentHash}`);
  return join(dataDir, METADATA_BODY_BLOB_DIRNAME, digest.slice(0, 2), `${digest}.json`);
}

/**
 * Serialize a body the one way its hash is defined over, so an identical body
 * never lands under two hashes because of key ordering or spacing.
 */
export function canonicalMetadataBody(body: unknown): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .filter(([, item]) => item !== undefined)
          .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
          .map(([key, item]) => [key, canonical(item)]),
      );
    }
    return value;
  };
  return JSON.stringify(canonical(body));
}

export type StoredMetadataBody = {
  contentHash: string;
  path: string;
  bytes: number;
  /** The body was already present, byte-identical, and was not rewritten. */
  deduplicated: boolean;
};

export async function storeMetadataBody(options: {
  dataDir: string;
  body: unknown;
  /** Reject the write unless the body hashes to this, for callers that pinned it earlier. */
  expectedContentHash?: string;
}): Promise<StoredMetadataBody> {
  const serialized = canonicalMetadataBody(options.body);
  const contentHash = metadataBodyContentHash(serialized);
  if (options.expectedContentHash && options.expectedContentHash !== contentHash) {
    throw new Error(
      `metadata body content hash mismatch: expected ${options.expectedContentHash}, got ${contentHash}`,
    );
  }
  const path = metadataBodyBlobPath(options.dataDir, contentHash);
  const bytes = Buffer.byteLength(serialized);
  const existing = await readFile(path, "utf8").catch((error: unknown) => {
    if (error && typeof error === "object" && (error as { code?: unknown }).code === "ENOENT") {
      return null;
    }
    throw error;
  });
  if (existing !== null) {
    // A hash collision is not survivable silently, so verify rather than assume.
    if (existing !== serialized) {
      throw new Error(`metadata body blob ${contentHash} already exists with different content`);
    }
    return { contentHash, path, bytes, deduplicated: true };
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, serialized, { encoding: "utf8", mode: 0o444 });
  await chmod(path, 0o444).catch(() => undefined);
  return { contentHash, path, bytes, deduplicated: false };
}

export async function readMetadataBody(options: {
  dataDir: string;
  contentHash: string;
}): Promise<unknown> {
  const path = metadataBodyBlobPath(options.dataDir, options.contentHash);
  const serialized = await readFile(path, "utf8").catch((error: unknown) => {
    if (error && typeof error === "object" && (error as { code?: unknown }).code === "ENOENT") {
      throw new Error(`metadata body ${options.contentHash} is not stored`);
    }
    throw error;
  });
  // The body is what downstream wordIds are aligned to, so a corrupted blob must
  // surface here rather than as a mysterious mismatch far downstream.
  const actual = metadataBodyContentHash(serialized);
  if (actual !== options.contentHash) {
    throw new Error(
      `metadata body blob is corrupt: ${options.contentHash} contains ${actual}`,
    );
  }
  return JSON.parse(serialized) as unknown;
}
