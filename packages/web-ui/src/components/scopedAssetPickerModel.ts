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
import { assetAvailabilityLabel } from "../features/assets/availability";
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
  status: ResolvedAsset["status"];
  progress?: number;
  error?: string;
  /** Operation-specific reason this otherwise visible Project member cannot be selected. */
  disabledReason?: string;
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

export interface ScopedTimelineAssetInsertRequest {
  timelineId: string;
  requestId: string;
  asset: EditorAssetInput;
}

/**
 * Asset-library sections for a Composer. Unlike Canvas/Timeline placement,
 * this surface only chooses prompt references, so no target relation is
 * invented here. Global entries are admitted lazily by the Composer owner.
 */
export function buildComposerAssetSections({
  projectAssets,
  globalAssets,
}: {
  projectAssets: ResolvedAsset[];
  globalAssets: ResolvedAsset[];
}): ScopedAssetSection[] {
  const option = (
    asset: ResolvedAsset,
    source: ScopedAssetOption["source"],
  ): ScopedAssetOption => ({
    assetId: asset.id,
    name: safeScopedAssetName(asset),
    type: asset.kind as ScopedAssetOption["type"],
    src: projectAssetPlaybackUrl(asset) ?? "",
    thumbnail: asset.thumbnailUrl,
    status: asset.status,
    ...(asset.progress === undefined ? {} : { progress: asset.progress }),
    ...(asset.error === undefined ? {} : { error: asset.error }),
    ...(asset.status === "ready" && projectAssetPlaybackUrl(asset)
      ? {}
      : { disabledReason: assetAvailabilityLabel(asset) }),
    source,
  });
  const visible = (asset: ResolvedAsset) =>
    asset.lifecycle.state === "active" && asset.kind !== "model";

  return [
    {
      scope: "project",
      label: "Project",
      description: "Media already available to this Project.",
      assets: projectAssets
        .filter(visible)
        .map((asset) => option(asset, { kind: "project", assetId: asset.id })),
    },
    {
      scope: "external",
      label: "Global Assets",
      description: "Reusable media from your personal library.",
      assets: globalAssets
        .filter(visible)
        .map((asset) =>
          option(asset, { kind: "global-library", assetId: asset.id }),
        ),
      allowLocalUpload: true,
    },
  ];
}

/**
 * Makes Timeline insertion the final publication step after scope admission.
 * The returned editor request is disposable UI state; Project Timeline state
 * and its ActionAssetBinding are committed together by the Project authority.
 */
export async function commitScopedTimelineAssetInsertion({
  option,
  target,
  runCascade,
  resolveProjectAsset,
  createRequestId,
  publishRequest,
}: {
  option: ScopedAssetOption;
  target: Extract<AssetScopeTarget, { kind: "timeline" }>;
  runCascade: () => Promise<{ assetId?: string; sourceNodeId?: string }>;
  resolveProjectAsset: (projectAssetId: string) => Promise<ResolvedAsset>;
  createRequestId: () => string;
  publishRequest: (request: ScopedTimelineAssetInsertRequest) => void;
}): Promise<ScopedTimelineAssetInsertRequest> {
  if (option.disabledReason) throw new Error(option.disabledReason);
  if (option.status !== "ready") {
    throw new Error(assetAvailabilityLabel(option));
  }
  if (!option.src) throw new Error("Asset bytes are unavailable");

  const cascade = await runCascade();
  const projectAssetId = cascade.assetId ?? option.assetId;
  const sourceNodeId =
    cascade.sourceNodeId ?? `timeline-asset:${projectAssetId}`;
  const authoritativeAsset = await resolveProjectAsset(projectAssetId);
  const request: ScopedTimelineAssetInsertRequest = {
    timelineId: target.timelineId,
    requestId: createRequestId(),
    asset: buildScopedTimelineAssetInput({
      option,
      sourceNodeId,
      projectAssetId,
      asset: authoritativeAsset,
    }),
  };
  publishRequest(request);
  return request;
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
  const resolvedStatus = asset?.status ?? option.status;
  const resolvedSource = asset?.url ?? option.src;
  if (resolvedStatus !== "ready" || !resolvedSource) {
    throw new Error(
      option.disabledReason ?? assetAvailabilityLabel(asset ?? option),
    );
  }
  return {
    id: sourceNodeId,
    projectAssetId,
    sourceNodeId,
    name: option.name,
    src: resolvedSource,
    thumbnail: asset?.thumbnailUrl ?? option.thumbnail,
    type: option.type,
    width: asset?.metadata?.width,
    height: asset?.metadata?.height,
    duration: asset?.metadata?.durationMs
      ? asset.metadata.durationMs / 1000
      : undefined,
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
  const operationDisabledReason = (
    asset: ResolvedAsset,
    source: AssetSourceScope,
  ): string | undefined => {
    const hasReadableBytes =
      asset.status === "ready" && Boolean(projectAssetPlaybackUrl(asset));
    if (hasReadableBytes) return undefined;
    if (target.kind === "timeline" || source === "external") {
      return assetAvailabilityLabel(asset);
    }
    return undefined;
  };

  const availability = (asset: ResolvedAsset, source: AssetSourceScope) => ({
    status: asset.status,
    ...(asset.progress === undefined ? {} : { progress: asset.progress }),
    ...(asset.error === undefined ? {} : { error: asset.error }),
    ...(operationDisabledReason(asset, source)
      ? { disabledReason: operationDisabledReason(asset, source) }
      : {}),
  });

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
        ...availability(asset, "current-canvas"),
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
        ...availability(asset, "project"),
        source: { kind: "project", assetId },
      };
    });

  const globalOptions = globalAssets
    .filter((asset) => asset.kind !== "model")
    .map((asset): ScopedAssetOption => {
      const assetId = asset.id;
      return {
        assetId,
        name: safeScopedAssetName(asset),
        type: asset.kind as ScopedAssetOption["type"],
        src: projectAssetPlaybackUrl(asset) ?? "",
        thumbnail: asset.thumbnailUrl,
        ...availability(asset, "external"),
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
