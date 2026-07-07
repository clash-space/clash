import {
  AssetMetadataFillActionSchema,
  ImageStoryboardMetadataSchema,
  type AssetMetadataFillAction,
} from "@clash/shared-types";

export type PlanStoryboardConsistencyActionOptions = {
  targetAssetId: string;
  characters?: unknown[];
  scenes?: unknown[];
  panels?: unknown[];
  actionId?: string;
  producer?: string;
  createdAt?: string;
};

export function planStoryboardConsistencyAction(
  options: PlanStoryboardConsistencyActionOptions,
): AssetMetadataFillAction {
  const metadata = ImageStoryboardMetadataSchema.parse({
    kind: "image.storyboard-consistency",
    characters: options.characters ?? [],
    scenes: options.scenes ?? [],
    panels: options.panels ?? [],
  });

  return AssetMetadataFillActionSchema.parse({
    actionId: options.actionId ?? `storyboard-review-${options.targetAssetId}`,
    targetAssetId: options.targetAssetId,
    metadataKind: "image.storyboard-consistency",
    producer: options.producer ?? "clash-production-plan-storyboard-review",
    createdAt: options.createdAt,
    metadata,
  });
}
