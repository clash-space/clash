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

export const AssetKindSchema = z.enum(['image', 'video', 'audio']);
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
});
export type AssetMetadata = z.infer<typeof AssetMetadataSchema>;

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
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Asset = z.infer<typeof AssetSchema>;

export const AssetRefRowSchema = z.object({
  assetId: z.string(),
  projectId: z.string(),
  importedAt: z.number(),
});
export type AssetRefRow = z.infer<typeof AssetRefRowSchema>;
