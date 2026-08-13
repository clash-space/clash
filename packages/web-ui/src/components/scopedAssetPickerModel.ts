import {
  projectTimelineActionId,
  type ActionAssetBinding,
  type AssetScopeSource,
  type AssetScopeTarget,
  type AssetSourceScope,
  type ResolvedAsset,
} from "@clash/shared-types";
import type { EditorAssetInput } from "@clash/remotion-core";
import type { AssetRelationNode } from "../features/assets/relations";
import { projectAssetPlaybackUrl } from "../features/assets/media-url";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?:\.[a-z0-9]+)?$/i;
const INTERNAL_NAME_PATTERN = /^(?:https?:|data:|file:)|[\\/]/i;

function fallbackName(kind: ResolvedAsset["kind"]) {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

export function safeScopedAssetName(
  asset: Pick<ResolvedAsset, "name" | "kind">,
  candidate?: string,
) {
  const value = (candidate || asset.name)?.trim();
  if (!value || UUID_PATTERN.test(value) || INTERNAL_NAME_PATTERN.test(value)) {
    return fallbackName(asset.kind);
  }
  return value;
}

export interface ScopedAssetOption {
  assetId: string;
  name: string;
  type: "image" | "video" | "audio";
  src: string;
  thumbnail?: string;
  source: AssetScopeSource;
  sourceNodeId?: string;
}

export interface ScopedAssetSection {
  scope: AssetSourceScope;
  label: string;
  description: string;
  assets: ScopedAssetOption[];
  allowLocalUpload?: boolean;
}

export function buildScopedTimelineAssetInput({
  option,
  sourceNodeId,
  projectAssetId,
  asset,
}: {
  option: ScopedAssetOption;
  sourceNodeId: string;
  projectAssetId: string;
  asset?: ResolvedAsset;
}): EditorAssetInput {
  return {
    id: sourceNodeId,
    projectAssetId,
    sourceNodeId,
    name: option.name,
    src: asset?.url ?? option.src,
    thumbnail: asset?.thumbnailUrl ?? option.thumbnail,
    type: option.type,
    width: asset?.metadata?.width,
    height: asset?.metadata?.height,
    duration: asset?.metadata?.durationMs
      ? asset.metadata.durationMs / 1000
      : undefined,
    waveform: asset?.metadata?.waveform,
  };
}

export function buildScopedAssetSections({
  target,
  bindings = [],
  projectAssets,
  globalAssets,
  nodes,
}: {
  target: AssetScopeTarget;
  bindings?: ActionAssetBinding[];
  projectAssets: ResolvedAsset[];
  globalAssets: ResolvedAsset[];
  nodes: AssetRelationNode[];
}): ScopedAssetSection[] {
  const projectById = new Map<string, ResolvedAsset>();
  for (const asset of projectAssets) {
    projectById.set(asset.id, asset);
  }

  const targetAssetIds = new Set<string>();
  if (target.kind === "canvas") {
    for (const node of nodes) {
      if (
        node.canvasId === target.canvasId &&
        typeof node.data?.assetId === "string"
      ) {
        targetAssetIds.add(node.data.assetId);
      }
    }
  } else {
    const actionId = projectTimelineActionId(target.timelineId, target.owner);
    for (const binding of bindings) {
      if (
        binding.direction === "input" &&
        binding.owner.kind === "draft" &&
        binding.owner.actionId === actionId
      ) {
        targetAssetIds.add(binding.projectAssetId);
      }
    }
  }

  const alreadyInTarget = (asset: ResolvedAsset) =>
    targetAssetIds.has(asset.id);
  const canvasId =
    target.kind === "timeline" && target.owner.kind === "canvas-action"
      ? target.owner.canvasId
      : undefined;
  const canvasOptions: ScopedAssetOption[] = [];
  const canvasAssetIds = new Set<string>();
  if (canvasId) {
    for (const node of nodes) {
      if (
        node.canvasId !== canvasId ||
        !["image", "video", "audio"].includes(node.type || "")
      )
        continue;
      const assetId =
        typeof node.data?.assetId === "string" ? node.data.assetId : undefined;
      const asset = assetId ? projectById.get(assetId) : undefined;
      if (!asset || !assetId || canvasAssetIds.has(assetId)) continue;
      canvasAssetIds.add(assetId);
      if (alreadyInTarget(asset)) continue;
      canvasOptions.push({
        assetId,
        sourceNodeId: node.id,
        name: safeScopedAssetName(
          asset,
          typeof node.data?.label === "string" ? node.data.label : undefined,
        ),
        type: asset.kind as ScopedAssetOption["type"],
        src: projectAssetPlaybackUrl(asset) ?? "",
        thumbnail: asset.thumbnailUrl,
        source: {
          kind: "current-canvas",
          assetId,
          sourceNodeId: node.id,
          canvasId,
        },
      });
    }
  }

  const projectOptions = projectAssets
    .filter(
      (asset) =>
        !alreadyInTarget(asset) &&
        !canvasAssetIds.has(asset.id) &&
        asset.kind !== "model",
    )
    .map((asset): ScopedAssetOption => {
      const assetId = asset.id;
      return {
        assetId,
        name: safeScopedAssetName(asset),
        type: asset.kind as ScopedAssetOption["type"],
        src: projectAssetPlaybackUrl(asset) ?? "",
        thumbnail: asset.thumbnailUrl,
        source: { kind: "project", assetId },
      };
    });

  const projectIds = new Set(projectAssets.map((asset) => asset.id));
  const globalOptions = globalAssets
    .filter(
      (asset) =>
        !alreadyInTarget(asset) &&
        !projectIds.has(asset.id) &&
        asset.kind !== "model",
    )
    .map((asset): ScopedAssetOption => {
      const assetId = asset.id;
      return {
        assetId,
        name: safeScopedAssetName(asset),
        type: asset.kind as ScopedAssetOption["type"],
        src: projectAssetPlaybackUrl(asset) ?? "",
        thumbnail: asset.thumbnailUrl,
        source: { kind: "global-library", assetId },
      };
    });

  return [
    ...(canvasId
      ? [
          {
            scope: "current-canvas" as const,
            label: "Current Canvas",
            description: "Media already placed on this Canvas.",
            assets: canvasOptions,
          },
        ]
      : []),
    {
      scope: "project" as const,
      label: "Project",
      description: "Media already referenced by this Project.",
      assets: projectOptions,
    },
    {
      scope: "external" as const,
      label: "More sources",
      description: "Choose from Global Assets or upload from this Mac.",
      assets: globalOptions,
      allowLocalUpload: true,
    },
  ];
}
