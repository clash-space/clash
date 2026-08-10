import { randomUUID } from "node:crypto";
import { relative, sep } from "node:path";

import {
  metadataBodyContentHash,
  canonicalMetadataBody,
  readMetadataBody,
  storeMetadataBody,
} from "@clash/shared-runtime";
import { defaultLocalApiDataDir } from "@clash/shared-runtime/local-paths";

import { applyProductionMetadataAction } from "./production-actions";
import { recordAgentObservation } from "./agent-worktree-observation";
import { loadWorkspaceMetadataKinds } from "./workspace-metadata-kinds";

/**
 * Attaching metadata is a product operation on an asset, not a document an agent
 * has to author. The fill action still exists -- it is what carries actionId,
 * producer, and hashes into the provenance ledger -- but it is synthesized here
 * and never becomes a file anybody has to shepherd.
 *
 * Bodies go to the content-addressed blob store; only their identity is attached
 * to the asset, so a manifest that gets rewritten on every apply never has to
 * carry a word grid.
 */
export type AttachAssetMetadataOptions = {
  cwd: string;
  assetId: string;
  metadataKind: string;
  /** The small, indexable facts attached to the asset. */
  metadata: Record<string, unknown>;
  producer: string;
  /** The large payload this metadata is the identity of, if the kind has one. */
  body?: unknown;
  /**
   * Field that receives the blob address. Defaults to `bodyHash`, kept separate
   * from any grid-identity field the kind defines over part of the body.
   */
  bodyHashField?: string;
  assetsPath?: string;
  dataDir?: string;
};

export type AttachAssetMetadataResult = {
  attached: true;
  assetId: string;
  metadataKind: string;
  metadataPath: string;
  version: string;
  body?: { contentHash: string; bytes: number; deduplicated: boolean };
  /** The identity row reached the local-api SQLite index. */
  indexed?: boolean;
};

/**
 * Best-effort report into the queryable local-api index. The workspace write
 * is the durable one; a host that is down only costs the query surface, so
 * this never fails an attach.
 */
async function reportAssetMetadataIndex(input: {
  assetId: string;
  metadataKind: string;
  producer: string;
  identity: Record<string, unknown>;
}): Promise<boolean> {
  const base = process.env.CLASH_API_URL?.trim() || "http://localhost:8788";
  try {
    const response = await fetch(`${base}/api/v1/local/asset-metadata`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(1_500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function attachAssetMetadata(
  options: AttachAssetMetadataOptions,
): Promise<AttachAssetMetadataResult> {
  await loadWorkspaceMetadataKinds(options.cwd);
  const dataDir = options.dataDir ?? defaultLocalApiDataDir();
  const bodyHashField = options.bodyHashField ?? "bodyHash";
  let metadata: Record<string, unknown> = { ...options.metadata, kind: options.metadataKind };
  let stored: Awaited<ReturnType<typeof storeMetadataBody>> | undefined;

  if (options.body !== undefined) {
    const declared = metadata[bodyHashField];
    stored = await storeMetadataBody({
      dataDir,
      body: options.body,
      // If the caller already pinned the identity, a mismatch is a real error and
      // not something to quietly paper over by rehashing.
      ...(typeof declared === "string" ? { expectedContentHash: declared } : {}),
    });
    metadata = { ...metadata, [bodyHashField]: stored.contentHash };
  }

  const result = await applyProductionMetadataAction({
    cwd: options.cwd,
    ...(options.assetsPath ? { assetsPath: options.assetsPath } : {}),
    action: {
      actionId: `attach-${randomUUID()}`,
      targetAssetId: options.assetId,
      metadataKind: options.metadataKind,
      producer: options.producer,
      metadata,
      createdAt: new Date().toISOString(),
    },
  });
  // Agents read what they attach; record the CAS token so a later
  // `assets metadata apply` can require it. No-op for human invocations.
  await recordAgentObservation({
    entityKind: "asset-metadata",
    entityId: relative(options.cwd, result.metadataPath).split(sep).join("/"),
    revision: result.version,
    cwd: options.cwd,
  });
  const indexed = await reportAssetMetadataIndex({
    assetId: options.assetId,
    metadataKind: options.metadataKind,
    producer: options.producer,
    identity: metadata,
  });

  return {
    attached: true,
    assetId: result.targetAssetId,
    metadataKind: result.metadataKind,
    metadataPath: result.metadataPath,
    version: result.version,
    ...(indexed ? { indexed } : {}),
    ...(stored
      ? {
          body: {
            contentHash: stored.contentHash,
            bytes: stored.bytes,
            deduplicated: stored.deduplicated,
          },
        }
      : {}),
  };
}

export async function readAssetMetadataBody(options: {
  contentHash: string;
  dataDir?: string;
}): Promise<unknown> {
  return readMetadataBody({
    dataDir: options.dataDir ?? defaultLocalApiDataDir(),
    contentHash: options.contentHash,
  });
}

export { canonicalMetadataBody, metadataBodyContentHash };
