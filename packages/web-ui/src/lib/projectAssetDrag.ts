import type { ResolvedAsset } from "@clash/shared-types";

export const PROJECT_ASSET_DRAG_MIME = "application/x-clash-project-asset";

export function writeProjectAssetDrag(
  dataTransfer: DataTransfer,
  asset: ResolvedAsset,
): void {
  dataTransfer.effectAllowed = "copy";
  dataTransfer.setData(
    PROJECT_ASSET_DRAG_MIME,
    JSON.stringify({ assetId: asset.id }),
  );
}

export function hasProjectAssetDragData(dataTransfer: DataTransfer): boolean {
  const types = Array.from(dataTransfer.types, (type) =>
    type.toLocaleLowerCase(),
  );
  return types.includes(PROJECT_ASSET_DRAG_MIME);
}

export function readProjectAssetDrag(
  dataTransfer: DataTransfer,
  assets: readonly ResolvedAsset[],
): ResolvedAsset | undefined {
  const assetId = readProjectAssetDragId(dataTransfer);
  return assetId ? assets.find((asset) => asset.id === assetId) : undefined;
}

export function readProjectAssetDragId(
  dataTransfer: DataTransfer,
): string | undefined {
  let assetId = "";
  const clashPayload = dataTransfer.getData(PROJECT_ASSET_DRAG_MIME);
  if (clashPayload) {
    try {
      const parsed = JSON.parse(clashPayload) as { assetId?: unknown };
      if (typeof parsed.assetId === "string") assetId = parsed.assetId;
    } catch {
      return undefined;
    }
  }
  return assetId || undefined;
}
