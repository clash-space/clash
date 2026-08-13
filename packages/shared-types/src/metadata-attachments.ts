import { z } from "zod";

const ScopedIdSchema = z.string().trim().min(1);

/**
 * A metadata target names product state only. Runtime locators, storage keys,
 * paths, and URLs are deliberately not part of this identity.
 */
export const ProjectAssetMetadataTargetSchema = z
  .object({
    kind: z.literal("project-asset"),
    projectId: ScopedIdSchema,
    assetId: ScopedIdSchema,
  })
  .strict();

export const ActionRevisionMetadataTargetSchema = z
  .object({
    kind: z.literal("action-revision"),
    projectId: ScopedIdSchema,
    actionId: ScopedIdSchema,
    actionRevisionId: ScopedIdSchema,
  })
  .strict();

export const MetadataAttachmentTargetSchema = z.discriminatedUnion("kind", [
  ProjectAssetMetadataTargetSchema,
  ActionRevisionMetadataTargetSchema,
]);

export type ProjectAssetMetadataTarget = z.infer<
  typeof ProjectAssetMetadataTargetSchema
>;
export type ActionRevisionMetadataTarget = z.infer<
  typeof ActionRevisionMetadataTargetSchema
>;
export type MetadataAttachmentTarget = z.infer<
  typeof MetadataAttachmentTargetSchema
>;

/**
 * Canonical, collision-free identity for projection indexes and idempotency.
 * Parsing first also prevents a caller from smuggling storage topology into
 * the key through unrecognized fields.
 */
export function metadataAttachmentTargetKey(
  value: MetadataAttachmentTarget,
): string {
  return JSON.stringify(MetadataAttachmentTargetSchema.parse(value));
}
