/**
 * Assets D1 service — single write path for all asset creation paths
 * (upload, generation workflow, future cross-project import).
 *
 * Schema lives in apps/web/lib/db/app.schema.ts (assets + asset_refs tables).
 * Types live in @clash/shared-types/assets.ts.
 *
 * Permission model: this module is internal. User-facing API never writes here
 * directly — only routes that establish user identity may call createAsset.
 */

import type { AssetKind, AssetSource } from "@clash/shared-types/assets";
import { log } from "../logger";

/**
 * Descriptive metadata persisted as JSON on the asset row.
 *
 * Rationale: none of these are query predicates — we only read them back to
 * render UI or feed agents. Keeping them in one column lets us add fields
 * (contentHash, hasAudio, dominantColor, codec, ...) without migrating.
 *
 * Waveform: downsampled audio peaks normalized to 0..1, length is up to the
 * producer (render-server uses 128). Stored as a plain array on the JSON
 * blob — text overhead is a few KB which is fine for an uncached single-row
 * read; large arrays should be their own R2 object instead.
 */
export interface AssetMetadata {
  width?: number;
  height?: number;
  durationMs?: number;
  bytes?: number;
  waveform?: number[];
  originalName?: string;
  editParams?: unknown;
  editOrigin?: "canvas-node" | "asset-preview";
  /** Validated invocation that produced this immutable asset revision. */
  actionInvocation?: unknown;
}

export interface CreateAssetParams {
  userId: string;
  kind: AssetKind;
  srcR2Key: string;
  projectId?: string;            // creates the initial asset_refs row when project-scoped
  coverR2Key?: string;
  metadata?: AssetMetadata;
  sourceModel?: string;
  sourcePrompt?: string;
  sourceTaskId?: string;
  /**
   * Upstream assets that contributed to this one (lineage). Empty / undefined
   * stores NULL — distinguishes "no lineage recorded" from "explicitly empty".
   */
  sources?: AssetSource[];
  /** Override id (for deterministic re-create on workflow retries). */
  id?: string;
}

export interface AssetRecord {
  id: string;
  userId: string;
  kind: AssetKind;
  srcR2Key: string;
  coverR2Key: string | null;
  metadata: AssetMetadata | null;
  sourceModel: string | null;
  sourcePrompt: string | null;
  sourceTaskId: string | null;
  sources: AssetSource[] | null;
  createdAt: number;
  updatedAt: number;
}

const SELECT_COLS =
  `id, user_id as userId, kind, src_r2_key as srcR2Key, cover_r2_key as coverR2Key,
   metadata,
   source_model as sourceModel, source_prompt as sourcePrompt, source_task_id as sourceTaskId,
   sources,
   created_at as createdAt, updated_at as updatedAt`;

interface AssetRow extends Omit<AssetRecord, "metadata" | "sources"> {
  metadata: string | null;
  sources: string | null;
}

function hydrate(row: AssetRow | null | undefined): AssetRecord | null {
  if (!row) return null;
  let metadata: AssetMetadata | null = null;
  if (row.metadata) {
    try {
      metadata = JSON.parse(row.metadata) as AssetMetadata;
    } catch (e) {
      log.warn("asset.metadata JSON parse failed", { id: row.id, error: String(e) });
    }
  }
  let sources: AssetSource[] | null = null;
  if (row.sources) {
    try {
      sources = JSON.parse(row.sources) as AssetSource[];
    } catch (e) {
      log.warn("asset.sources JSON parse failed", { id: row.id, error: String(e) });
    }
  }
  return { ...row, metadata, sources };
}

/**
 * Create a new asset row + its initial asset_refs entry for the originating project.
 * Idempotent on `id` (uses INSERT OR REPLACE). Returns the asset id.
 */
export async function createAsset(
  db: D1Database,
  params: CreateAssetParams
): Promise<{ id: string }> {
  const id = params.id ?? crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);

  const metadataJson =
    params.metadata && Object.keys(params.metadata).length > 0
      ? JSON.stringify(params.metadata)
      : null;

  const sourcesJson =
    params.sources && params.sources.length > 0
      ? JSON.stringify(params.sources)
      : null;

  await db
    .prepare(
      `INSERT OR REPLACE INTO assets (
         id, user_id, kind, src_r2_key, cover_r2_key,
         metadata,
         source_model, source_prompt, source_task_id,
         sources,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      params.userId,
      params.kind,
      params.srcR2Key,
      params.coverR2Key ?? null,
      metadataJson,
      params.sourceModel ?? null,
      params.sourcePrompt ?? null,
      params.sourceTaskId ?? null,
      sourcesJson,
      now,
      now,
    )
    .run();

  if (params.projectId) await addAssetRef(db, id, params.projectId);
  return { id };
}

/** List assets explicitly saved in a user's reusable global library. */
export async function getLibraryAssets(
  db: D1Database,
  userId: string,
): Promise<AssetRecord[]> {
  const { results } = await db
    .prepare(
      `SELECT assets.id, assets.user_id as userId, assets.kind,
              assets.src_r2_key as srcR2Key, assets.cover_r2_key as coverR2Key,
              assets.metadata, assets.source_model as sourceModel,
              assets.source_prompt as sourcePrompt, assets.source_task_id as sourceTaskId,
              assets.sources, assets.created_at as createdAt, assets.updated_at as updatedAt
         FROM assets
         JOIN asset_library_refs ON asset_library_refs.asset_id = assets.id
        WHERE asset_library_refs.user_id = ? AND assets.user_id = ?
        ORDER BY asset_library_refs.added_at DESC, assets.created_at DESC`,
    )
    .bind(userId, userId)
    .all<AssetRow>();
  return (results ?? [])
    .map((row) => hydrate(row))
    .filter((asset): asset is AssetRecord => asset !== null);
}

/** Save an existing owned asset in the reusable global library. */
export async function addAssetToLibrary(
  db: D1Database,
  assetId: string,
  userId: string,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT OR IGNORE INTO asset_library_refs (asset_id, user_id, added_at) VALUES (?, ?, ?)`,
    )
    .bind(assetId, userId, now)
    .run();
}

/** Insert an asset_refs row. No-op if the (asset_id, project_id) pair already exists. */
export async function addAssetRef(
  db: D1Database,
  assetId: string,
  projectId: string,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT OR IGNORE INTO asset_refs (asset_id, project_id, imported_at) VALUES (?, ?, ?)`,
    )
    .bind(assetId, projectId, now)
    .run();
}

/** Drop a project's reference. Asset row stays; mark-and-sweep GC reclaims R2 later. */
export async function removeAssetRef(
  db: D1Database,
  assetId: string,
  projectId: string,
): Promise<void> {
  await db
    .prepare(`DELETE FROM asset_refs WHERE asset_id = ? AND project_id = ?`)
    .bind(assetId, projectId)
    .run();
}

/** Lookup an asset by the workflow task that produced it. Used by polling. */
export async function getAssetByTaskId(
  db: D1Database,
  taskId: string,
): Promise<AssetRecord | null> {
  const row = await db
    .prepare(`SELECT ${SELECT_COLS} FROM assets WHERE source_task_id = ?`)
    .bind(taskId)
    .first<AssetRow>();
  return hydrate(row);
}

/** Lookup by asset id. */
export async function getAssetById(
  db: D1Database,
  id: string,
): Promise<AssetRecord | null> {
  const row = await db
    .prepare(`SELECT ${SELECT_COLS} FROM assets WHERE id = ?`)
    .bind(id)
    .first<AssetRow>();
  return hydrate(row);
}

/** Lookup multiple assets owned by a user. Missing/forbidden ids are omitted. */
export async function getAssetsByIds(
  db: D1Database,
  ids: string[],
  userId: string,
): Promise<AssetRecord[]> {
  const uniqueIds = [...new Set(ids)].filter(Boolean);
  if (uniqueIds.length === 0) return [];

  const placeholders = uniqueIds.map(() => "?").join(", ");
  const { results } = await db
    .prepare(`SELECT ${SELECT_COLS} FROM assets WHERE user_id = ? AND id IN (${placeholders})`)
    .bind(userId, ...uniqueIds)
    .all<AssetRow>();

  return (results ?? [])
    .map((row) => hydrate(row))
    .filter((asset): asset is AssetRecord => asset !== null);
}

/** PATCH an asset's cover (called by thumbnail capture pipeline). System-only. */
export async function updateAssetCover(
  db: D1Database,
  id: string,
  coverR2Key: string,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(`UPDATE assets SET cover_r2_key = ?, updated_at = ? WHERE id = ?`)
    .bind(coverR2Key, now, id)
    .run();
}

/** Resolve the owning user for a project. Used when caller has projectId but not userId. */
export async function getProjectOwner(
  db: D1Database,
  projectId: string,
): Promise<string | null> {
  try {
    const row = await db
      .prepare(`SELECT owner_id as ownerId FROM project WHERE id = ?`)
      .bind(projectId)
      .first<{ ownerId: string }>();
    return row?.ownerId ?? null;
  } catch (e) {
    log.warn("getProjectOwner failed", { projectId, error: String(e) });
    return null;
  }
}
