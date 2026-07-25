import type { ProjectAsset } from "../../lib/types";

type CanvasAssetNode = {
  type?: string;
  data?: Record<string, unknown>;
};

function basename(value?: string | null): string {
  return value?.split(/[\\/]/).filter(Boolean).at(-1)?.trim() ?? "";
}

function stem(value: string): string {
  return value.replace(/\.[^.]+$/, "");
}

function isMachineAssetName(value?: string | null): boolean {
  const candidate = stem(basename(value));
  if (!candidate) return true;
  return (
    /^local-(?:asset-)?(?:gen-)?[a-z\d-]+$/i.test(candidate) ||
    /^upload-\d+-[a-z\d]+$/i.test(candidate) ||
    /^[a-f\d]{16,}$/i.test(candidate) ||
    /^(?:[a-f\d]{8}-){1,}[a-f\d-]{8,}$/i.test(candidate)
  );
}

function assetKindLabel(type?: string): string {
  if (type === "video") return "video";
  if (type === "audio") return "audio";
  return "image";
}

export function projectAssetDisplayName(asset: ProjectAsset): string {
  const explicitName = asset.name?.trim();
  if (explicitName && !isMachineAssetName(explicitName)) return explicitName;

  const path = asset.storageKey?.trim() || asset.url || asset.id;
  const normalizedPath = path.toLocaleLowerCase();
  const kind = assetKindLabel(asset.type);
  if (/(?:^|\/)edits?(?:\/|$)/.test(normalizedPath)) return `Edited ${kind}`;
  if (
    /(?:^|\/)generated(?:\/|$)/.test(normalizedPath) ||
    /local-(?:asset-)?gen-/.test(normalizedPath)
  )
    return `Generated ${kind}`;
  if (/(?:^|\/)uploads?(?:\/|$)/.test(normalizedPath))
    return `Uploaded ${kind}`;

  const fileName = basename(path);
  return fileName && !isMachineAssetName(fileName)
    ? fileName
    : kind[0].toLocaleUpperCase() + kind.slice(1);
}

export function projectAssetThumbnailSource(asset: ProjectAsset): string {
  return asset.thumbnailUrl?.trim() || asset.url;
}

function assetKeys(asset: ProjectAsset): string[] {
  return [
    asset.id,
    asset.assetId,
    asset.storageKey,
    asset.url,
    asset.thumbnailUrl,
  ]
    .filter(
      (value): value is string => typeof value === "string" && Boolean(value),
    )
    .flatMap((value) => [value, basename(value)])
    .map((value) => value.toLocaleLowerCase());
}

export function resolveCanvasNodeProjectAsset(
  node: CanvasAssetNode,
  assets: readonly ProjectAsset[],
): ProjectAsset | undefined {
  const assetId = node.data?.assetId;
  if (typeof assetId === "string" && assetId) {
    const byId = assets.find(
      (asset) => asset.id === assetId || asset.assetId === assetId,
    );
    if (byId) return byId;
  }

  const nodeKeys = [
    node.data?.fileName,
    node.data?.label,
    node.data?.name,
    node.data?.src,
    node.data?.previewUrl,
  ]
    .filter(
      (value): value is string => typeof value === "string" && Boolean(value),
    )
    .flatMap((value) => [value, basename(value)])
    .map((value) => value.toLocaleLowerCase());
  if (nodeKeys.length === 0) return undefined;
  return assets.find((asset) => {
    const keys = new Set(assetKeys(asset));
    return nodeKeys.some((key) => keys.has(key));
  });
}

export function canvasNodeAssetDisplayName(
  node: CanvasAssetNode,
  asset?: ProjectAsset,
): string {
  const nodeName = [
    node.data?.label,
    node.data?.name,
    node.data?.fileName,
  ].find(
    (value): value is string =>
      typeof value === "string" && Boolean(value.trim()),
  );
  if (nodeName && !isMachineAssetName(nodeName)) return nodeName.trim();
  if (asset) return projectAssetDisplayName(asset);
  const kind = assetKindLabel(node.type);
  return kind[0].toLocaleUpperCase() + kind.slice(1);
}
