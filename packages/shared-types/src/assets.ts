/**
 * Asset metadata — single source of truth for generated/uploaded media.
 *
 * - `assets` row = the asset itself (one per asset_id, immutable to user APIs).
 * - `asset_refs` row = M:N junction recording which projects use this asset.
 *
 * Cross-project reuse: insert an asset_refs row pointing at the same asset_id.
 * R2 blobs are content-shared via src_r2_key.
 */

import { z } from 'zod';
import { agentReadToken } from './agent-read-proof.js';

export const AssetKindSchema = z.enum(['image', 'video', 'audio', 'model']);
export type AssetKind = z.infer<typeof AssetKindSchema>;

/**
 * Descriptive metadata persisted as a JSON blob on the asset row.
 *
 * Rationale for collapsing into one object: none of these are query predicates
 * (we never WHERE/ORDER BY on width or duration), so there's no reason to
 * spread them across columns. Keeping one JSON lets us grow the shape
 * (contentHash, hasAudio, dominantColor, codec, ...) without a D1 migration.
 *
 * `waveform` is a downsampled peak array (0..1 floats) — default 128 samples
 * from the audio probe. Keep sample counts reasonable; if a consumer needs a
 * very high-resolution waveform it should be its own R2 object, not inlined.
 */
export const AssetMetadataSchema = z.object({
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  durationMs: z.number().int().optional(),
  bytes: z.number().int().optional(),
  waveform: z.array(z.number()).optional(),
  contentType: z.string().optional(),
  frameRate: z.number().positive().optional(),
  videoCodec: z.string().optional(),
  audioCodec: z.string().optional(),
  contentHash: z.string().optional(),
  localBlobKey: z.string().optional(),
  originalName: z.string().optional(),
  mockText: z.string().optional(),
  transcript: z.string().optional(),
  provider: z.string().optional(),
  requestId: z.string().optional(),
  modelEndpoint: z.string().optional(),
  remoteUrl: z.string().optional(),
  /** Parameters used by a copy-on-write image/video edit. */
  editParams: z.unknown().optional(),
  /** Whether the edit was represented by a visible canvas node or an implicit asset-preview action. */
  editOrigin: z.enum(['canvas-node', 'asset-preview']).optional(),
  /** Validated ActionInvocation envelope that produced this immutable output. */
  actionInvocation: z.unknown().optional(),
});
export type AssetMetadata = z.infer<typeof AssetMetadataSchema>;

/**
 * One upstream asset that contributed to producing this asset.
 *
 * Roles:
 * - `edit-source` : the single input asset for image-editor / video-clipper
 *                   (always exactly one entry with this role).
 * - `reference`   : a reference image / video / audio fed into a generation
 *                   model (image-gen, video-gen).
 * - `primary`     : the primary input image for image-to-video generation —
 *                   distinguished from secondary refs because most i2v models
 *                   treat it as the first frame.
 *
 * Stored as JSON on `assets.sources`. NULL = lineage not recorded
 * (uploads, pre-existing rows). Not a query predicate.
 */
export const AssetSourceSchema = z.object({
  assetId: z.string(),
  role: z.enum(['edit-source', 'reference', 'primary']),
});
export type AssetSource = z.infer<typeof AssetSourceSchema>;

export const AssetSchema = z.object({
  id: z.string(),
  userId: z.string(),
  kind: AssetKindSchema,
  srcR2Key: z.string(),
  coverR2Key: z.string().nullable().optional(),
  metadata: AssetMetadataSchema.nullable().optional(),
  sourceModel: z.string().nullable().optional(),
  sourcePrompt: z.string().nullable().optional(),
  sourceTaskId: z.string().nullable().optional(),
  sources: z.array(AssetSourceSchema).nullable().optional(),
  signedUrl: z.string().optional(),
  signedUrlExp: z.number().optional(),
  signedCoverUrl: z.string().optional(),
  signedCoverUrlExp: z.number().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Asset = z.infer<typeof AssetSchema>;

export type AssetReadProofLike = Pick<
  Asset,
  | 'id'
  | 'kind'
  | 'srcR2Key'
  | 'coverR2Key'
  | 'metadata'
  | 'sourceModel'
  | 'sourcePrompt'
  | 'sourceTaskId'
  | 'sources'
  | 'createdAt'
  | 'updatedAt'
>;

export function assetReadToken(asset: AssetReadProofLike): string {
  return agentReadToken({
    namespace: 'asset',
    subject: {
      id: asset.id,
      kind: asset.kind,
      srcR2Key: asset.srcR2Key,
      coverR2Key: asset.coverR2Key ?? null,
      metadata: asset.metadata ?? null,
      sourceModel: asset.sourceModel ?? null,
      sourcePrompt: asset.sourcePrompt ?? null,
      sourceTaskId: asset.sourceTaskId ?? null,
      sources: asset.sources ?? null,
      createdAt: asset.createdAt,
      updatedAt: asset.updatedAt,
    },
  });
}

export const AssetRefRowSchema = z.object({
  assetId: z.string(),
  projectId: z.string(),
  importedAt: z.number(),
});
export type AssetRefRow = z.infer<typeof AssetRefRowSchema>;

export type AssetRefReadProofLike = Pick<AssetRefRow, 'assetId' | 'projectId' | 'importedAt'>;

export function assetRefReadToken(ref: AssetRefReadProofLike): string {
  return agentReadToken({
    namespace: 'asset-ref',
    subject: {
      assetId: ref.assetId,
      projectId: ref.projectId,
      importedAt: ref.importedAt,
    },
  });
}
