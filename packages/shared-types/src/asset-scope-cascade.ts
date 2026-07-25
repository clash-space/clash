export type AssetSourceScope = "current-canvas" | "project" | "external";

export type AssetReferenceScope = "project" | "canvas" | "timeline";

export type AssetScopeTarget =
  | { kind: "canvas"; canvasId: string }
  | {
      kind: "timeline";
      timelineId: string;
      owner:
        | { kind: "project" }
        | { kind: "canvas-action"; canvasId: string; actionNodeId: string };
    };

export type AssetScopeSource =
  | {
      kind: "current-canvas";
      assetId: string;
      sourceNodeId: string;
      canvasId: string;
    }
  | { kind: "project"; assetId: string }
  | { kind: "global-library"; assetId: string }
  | { kind: "local-file" };

export type AssetScopeCascadeStep =
  | { kind: "create-project-asset"; addToGlobalLibrary: false }
  | { kind: "ensure-project-reference"; assetId: string }
  | { kind: "ensure-global-library-reference"; assetId?: string }
  | { kind: "ensure-canvas-placement"; canvasId: string; assetId?: string }
  | {
      kind: "ensure-timeline-input";
      timelineId: string;
      assetId?: string;
      via: "timeline-reference";
    }
  | {
      kind: "ensure-timeline-input";
      timelineId: string;
      assetId?: string;
      via: "canvas-edge";
      canvasId: string;
      actionNodeId: string;
      sourceNodeId?: string;
    };

export function visibleAssetSourceScopes(
  target: AssetScopeTarget,
): AssetSourceScope[] {
  if (target.kind === "timeline" && target.owner.kind === "canvas-action") {
    return ["current-canvas", "project", "external"];
  }
  return ["project", "external"];
}

export function assetReferenceScopePath(
  target: AssetScopeTarget,
): AssetReferenceScope[] {
  if (target.kind === "canvas") return ["project", "canvas"];
  return target.owner.kind === "canvas-action"
    ? ["project", "canvas", "timeline"]
    : ["project", "timeline"];
}

export function planAssetScopeCascade({
  source,
  target,
}: {
  source: AssetScopeSource;
  target: AssetScopeTarget;
}): AssetScopeCascadeStep[] {
  if (source.kind === "current-canvas") {
    if (
      target.kind !== "timeline" ||
      target.owner.kind !== "canvas-action" ||
      target.owner.canvasId !== source.canvasId
    ) {
      throw new Error(
        "Current Canvas is only an ancestor of its owned Timeline",
      );
    }
  }
  const assetId = source.kind === "local-file" ? undefined : source.assetId;
  const steps: AssetScopeCascadeStep[] = [];

  if (source.kind === "local-file") {
    steps.push({ kind: "create-project-asset", addToGlobalLibrary: false });
  } else if (source.kind === "global-library") {
    steps.push({ kind: "ensure-project-reference", assetId: source.assetId });
  }

  const path = assetReferenceScopePath(target);
  const sourceAnchor: AssetReferenceScope | "catalog" =
    source.kind === "current-canvas"
      ? "canvas"
      : source.kind === "project"
        ? "project"
        : "catalog";
  const anchorIndex =
    sourceAnchor === "catalog" ? -1 : path.indexOf(sourceAnchor);
  if (sourceAnchor !== "catalog" && anchorIndex < 0) {
    throw new Error(`${sourceAnchor} is not an ancestor of the target scope`);
  }

  for (const scope of path.slice(anchorIndex + 1)) {
    if (scope === "project") {
      if (source.kind !== "global-library") {
        // Local creation already registers the Project reference. Catalog assets
        // selected from the global library use the explicit step above.
        continue;
      }
    } else if (scope === "canvas") {
      const canvasId =
        target.kind === "canvas"
          ? target.canvasId
          : target.owner.kind === "canvas-action"
            ? target.owner.canvasId
            : undefined;
      if (!canvasId) throw new Error("Canvas scope requires a Canvas target");
      steps.push({
        kind: "ensure-canvas-placement",
        canvasId,
        ...(assetId ? { assetId } : {}),
      });
    } else if (target.kind === "timeline") {
      if (target.owner.kind === "project") {
        steps.push({
          kind: "ensure-timeline-input",
          timelineId: target.timelineId,
          ...(assetId ? { assetId } : {}),
          via: "timeline-reference",
        });
      } else {
        steps.push({
          kind: "ensure-timeline-input",
          timelineId: target.timelineId,
          ...(assetId ? { assetId } : {}),
          via: "canvas-edge",
          canvasId: target.owner.canvasId,
          actionNodeId: target.owner.actionNodeId,
          ...(source.kind === "current-canvas"
            ? { sourceNodeId: source.sourceNodeId }
            : {}),
        });
      }
    }
  }
  return steps;
}
