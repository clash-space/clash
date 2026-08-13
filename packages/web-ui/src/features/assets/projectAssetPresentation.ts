import type { ResolvedAsset } from "@clash/shared-types";

type CanvasAssetNode = {
  type?: string;
  data?: Record<string, unknown>;
};

/**
 * Preserve only descriptive fallback metadata while treating the Host read as
 * authoritative for lifecycle, availability, and every media projection.
 */
export function mergeResolvedAssetProjection(
  authoritative: ResolvedAsset,
  fallback?: ResolvedAsset,
): ResolvedAsset {
  const name = authoritative.name ?? fallback?.name;
  return {
    ...authoritative,
    metadata: { ...fallback?.metadata, ...authoritative.metadata },
    ...(name === undefined ? {} : { name }),
  };
}

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

function assetKindLabel(kind?: string): string {
  if (kind === "video") return "video";
  if (kind === "audio") return "audio";
  if (kind === "model") return "model";
  return "image";
}

export function projectAssetDisplayName(asset: ResolvedAsset): string {
  const explicitName = asset.name?.trim();
  if (explicitName && !isMachineAssetName(explicitName)) return explicitName;

  const originalName = asset.metadata.originalName?.trim();
  if (originalName && !isMachineAssetName(originalName)) return originalName;

  const kind = assetKindLabel(asset.kind);
  const provenanceLabel =
    asset.provenance?.kind === "import"
      ? "Uploaded"
      : asset.provenance?.kind === "generation"
        ? "Generated"
        : asset.provenance?.kind === "edit"
          ? "Edited"
          : asset.provenance?.kind === "render"
            ? "Rendered"
            : asset.provenance?.kind === "admission"
              ? "Imported"
              : undefined;
  return provenanceLabel
    ? `${provenanceLabel} ${kind}`
    : kind[0].toLocaleUpperCase() + kind.slice(1);
}

export function resolveCanvasNodeProjectAsset(
  node: CanvasAssetNode,
  assets: readonly ResolvedAsset[],
): ResolvedAsset | undefined {
  const assetId = node.data?.assetId;
  if (typeof assetId !== "string" || !assetId) return undefined;
  return assets.find((asset) => asset.id === assetId);
}

export function canvasNodeAssetDisplayName(
  node: CanvasAssetNode,
  asset?: ResolvedAsset,
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
