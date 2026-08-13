import type { ResolvedAsset } from "@clash/shared-types";

export type AssetAvailability = Pick<
  ResolvedAsset,
  "status" | "progress" | "error"
>;

function progressLabel(prefix: string, progress?: number): string {
  return progress === undefined
    ? prefix
    : `${prefix} ${Math.round(progress * 100)}%`;
}

/** Human-readable projection of the current Host's byte availability. */
export function assetAvailabilityLabel(asset: AssetAvailability): string {
  switch (asset.status) {
    case "ready":
      return "Ready";
    case "uploading":
      return progressLabel("Uploading", asset.progress);
    case "downloading":
      return progressLabel("Downloading", asset.progress);
    case "unavailable":
      return asset.error ?? "Unavailable on this device";
    case "failed":
      return asset.error ? `Failed: ${asset.error}` : "Failed";
  }
}
