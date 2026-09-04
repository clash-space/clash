import { createHash } from "node:crypto";
import type { LoroDoc } from "loro-crdt";
import {
  projectCanvasPreviewFromDoc,
  type ProjectCanvasPreview,
} from "@clash/shared-types";

import type {
  CachedProjectCanvasPreview,
  FileReplicaStore,
} from "./loro/file-replica-store.js";

export function projectCanvasPreviewCacheEntryFromDoc(
  doc: LoroDoc,
  generatedAt = new Date().toISOString(),
): CachedProjectCanvasPreview {
  return {
    sourceVersion: createHash("sha256")
      .update(doc.version().encode())
      .digest("hex"),
    generatedAt,
    preview: projectCanvasPreviewFromDoc(doc),
  };
}

/**
 * Reads the saved preview on the hot path. A missing legacy cache is generated
 * once from the canonical Project replica and then becomes an ordinary cache hit.
 */
export async function readThroughProjectCanvasPreview(options: {
  projectId: string;
  store: FileReplicaStore;
  inspect: <T>(read: (doc: LoroDoc) => T | Promise<T>) => Promise<T>;
}): Promise<ProjectCanvasPreview> {
  return (await readThroughProjectCanvasPreviewEntry(options)).preview;
}

export async function readThroughProjectCanvasPreviewEntry(options: {
  projectId: string;
  store: FileReplicaStore;
  inspect: <T>(read: (doc: LoroDoc) => T | Promise<T>) => Promise<T>;
}): Promise<CachedProjectCanvasPreview> {
  const cached = await options.store.readCanvasPreview(options.projectId);
  if (cached) return cached;

  const entry = await options.inspect((doc) =>
    projectCanvasPreviewCacheEntryFromDoc(doc),
  );
  await options.store.writeCanvasPreview(options.projectId, entry);
  return entry;
}
