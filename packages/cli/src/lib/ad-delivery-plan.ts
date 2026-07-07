import { type AssetMetadataFillAction } from "@clash/shared-types";

export type SafeZones = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type PlanAdDeliverySpecOptions = {
  targetAssetId: string;
  brand: string;
  platforms: string[];
  durations: number[];
  aspectRatio: string;
  width: number;
  height: number;
  fps: number;
  safeZones: SafeZones;
  packshotAssetId: string;
  packshotStartFrame: number;
  packshotEndFrame: number;
  endCardDurationFrames: number;
  cta: string;
  disclaimer?: string;
  rightsLedgerAssetId?: string;
  actionId?: string;
  producer?: string;
};

export function planAdDeliverySpecAction(
  options: PlanAdDeliverySpecOptions,
): AssetMetadataFillAction {
  if (!options.targetAssetId.trim()) throw new Error("target asset id is required");
  if (!options.brand.trim()) throw new Error("brand is required");
  if (options.platforms.length === 0) throw new Error("at least one platform is required");
  if (options.durations.length === 0) throw new Error("at least one duration is required");
  if (!options.packshotAssetId.trim()) throw new Error("packshot asset id is required");
  if (!options.cta.trim()) throw new Error("CTA is required");
  if (!Number.isInteger(options.packshotStartFrame) || options.packshotStartFrame < 0) {
    throw new Error("packshot start frame must be a non-negative integer");
  }
  if (!Number.isInteger(options.packshotEndFrame) || options.packshotEndFrame <= options.packshotStartFrame) {
    throw new Error("packshot end frame must be greater than packshot start frame");
  }

  const variants = options.platforms.flatMap((platform) =>
    options.durations.map((durationSeconds) => ({
      id: `${slug(platform)}-${aspectSlug(options.aspectRatio)}-${durationSlug(durationSeconds)}`,
      platform,
      durationSeconds,
      width: options.width,
      height: options.height,
      aspectRatio: options.aspectRatio,
      safeZones: options.safeZones,
      subtitlesRequired: true,
      loudnessTarget: "platform-default",
    }))
  );

  return {
    actionId: options.actionId ?? `ad-delivery-spec-${options.targetAssetId}`,
    targetAssetId: options.targetAssetId,
    metadataKind: "ad.delivery-spec",
    producer: options.producer ?? "clash-production-plan-ad-delivery-spec",
    metadata: {
      kind: "ad.delivery-spec",
      brand: options.brand,
      fps: options.fps,
      platforms: options.platforms,
      variants,
      packshot: {
        required: true,
        assetId: options.packshotAssetId,
        startFrame: options.packshotStartFrame,
        endFrame: options.packshotEndFrame,
      },
      endCard: {
        required: true,
        durationFrames: options.endCardDurationFrames,
        cta: options.cta,
        ...(options.disclaimer ? { disclaimer: options.disclaimer } : {}),
        qrRequired: true,
      },
      ...(options.rightsLedgerAssetId ? { rightsLedgerAssetId: options.rightsLedgerAssetId } : {}),
    },
  };
}

function slug(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!normalized) throw new Error("slug value is required");
  return normalized;
}

function aspectSlug(value: string): string {
  return value.trim().replace(/:/g, "x").replace(/[^0-9x.]+/g, "");
}

function durationSlug(value: number): string {
  return `${Number.isInteger(value) ? value : String(value).replace(/0+$/, "").replace(/\.$/, "")}s`;
}
