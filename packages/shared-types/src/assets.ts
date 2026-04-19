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

export const AssetSchema = z.object({
  id: z.string(),
  userId: z.string(),
  kind: AssetKindSchema,
  srcR2Key: z.string(),
  coverR2Key: z.string().nullable().optional(),
  width: z.number().int().nullable().optional(),
  height: z.number().int().nullable().optional(),
  durationMs: z.number().int().nullable().optional(),
  bytes: z.number().int().nullable().optional(),
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
