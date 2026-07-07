import {
  AssetMetadataFillActionSchema,
  ReferenceShotSchema,
  type AssetMetadataFillAction,
} from "@clash/shared-types";

export type PlanReferenceReviewActionOptions = {
  targetAssetId: string;
  sourceUrl: string;
  license?: string;
  attribution?: string;
  redistributionAllowed?: boolean;
  derivativeAllowed?: boolean;
  shots?: Array<{
    id: string;
    startFrame: number;
    endFrame: number;
    description: string;
    tags?: string[];
  }>;
  nonCopyingQa?: {
    status?: "passed" | "requires-review" | "failed";
    similarityScore?: number;
  };
  actionId?: string;
  producer?: string;
  createdAt?: string;
};

export function planReferenceReviewAction(
  options: PlanReferenceReviewActionOptions,
): AssetMetadataFillAction {
  const shots = ReferenceShotSchema.array().parse(options.shots ?? []);
  return AssetMetadataFillActionSchema.parse({
    actionId: options.actionId ?? `reference-review-${options.targetAssetId}`,
    targetAssetId: options.targetAssetId,
    metadataKind: "reference-video.analysis",
    producer: options.producer ?? "clash-production-plan-reference-review",
    createdAt: options.createdAt,
    metadata: {
      kind: "reference-video.analysis",
      sourceUrl: options.sourceUrl,
      rights: {
        license: options.license ?? "unknown",
        attribution: options.attribution ?? "unknown",
        redistributionAllowed: options.redistributionAllowed === true,
        derivativeAllowed: options.derivativeAllowed === true,
      },
      shots,
      nonCopyingQa: {
        status: options.nonCopyingQa?.status ?? "requires-review",
        similarityScore: options.nonCopyingQa?.similarityScore,
      },
    },
  });
}
