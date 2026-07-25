import type { AssetScopeCascadeStep } from "@clash/shared-types";

export interface AssetCascadeContext {
  assetId?: string;
  sourceNodeId?: string;
}

export interface AssetScopeCascadeAdapter {
  createProjectAsset?: (
    step: Extract<AssetScopeCascadeStep, { kind: "create-project-asset" }>,
  ) => Promise<AssetCascadeContext>;
  ensureProjectReference: (assetId: string) => Promise<void>;
  ensureGlobalLibraryReference?: (assetId?: string) => Promise<void>;
  ensureCanvasPlacement: (input: {
    canvasId: string;
    assetId: string;
    sourceNodeId?: string;
  }) => Promise<string>;
  ensureTimelineReference: (input: {
    timelineId: string;
    assetId: string;
  }) => Promise<void>;
  ensureCanvasTimelineInput: (input: {
    timelineId: string;
    canvasId: string;
    actionNodeId: string;
    assetId: string;
    sourceNodeId: string;
  }) => Promise<void>;
}

function requireAssetId(context: AssetCascadeContext): string {
  if (!context.assetId)
    throw new Error("Asset cascade has no materialized asset");
  return context.assetId;
}

/**
 * Executes a domain-planned cascade without knowing how any scope is stored.
 * The returned Canvas placement becomes the source of the following Timeline
 * edge, so the propagation chain extends naturally rather than being rebuilt
 * independently by each surface.
 */
export async function executeAssetScopeCascade({
  steps,
  initial,
  adapter,
}: {
  steps: readonly AssetScopeCascadeStep[];
  initial?: AssetCascadeContext;
  adapter: AssetScopeCascadeAdapter;
}): Promise<AssetCascadeContext> {
  let context: AssetCascadeContext = { ...initial };

  for (const step of steps) {
    if (step.kind === "create-project-asset") {
      if (!adapter.createProjectAsset) {
        throw new Error("Asset cascade cannot materialize a local file");
      }
      context = { ...context, ...(await adapter.createProjectAsset(step)) };
      continue;
    }
    if (step.kind === "ensure-project-reference") {
      await adapter.ensureProjectReference(step.assetId);
      context.assetId = step.assetId;
      continue;
    }
    if (step.kind === "ensure-global-library-reference") {
      if (!adapter.ensureGlobalLibraryReference) {
        throw new Error("Asset cascade cannot write to the global library");
      }
      await adapter.ensureGlobalLibraryReference(
        step.assetId ?? context.assetId,
      );
      continue;
    }
    if (step.kind === "ensure-canvas-placement") {
      const assetId = step.assetId ?? requireAssetId(context);
      context.assetId = assetId;
      context.sourceNodeId = await adapter.ensureCanvasPlacement({
        canvasId: step.canvasId,
        assetId,
        sourceNodeId: context.sourceNodeId,
      });
      continue;
    }

    const assetId = step.assetId ?? requireAssetId(context);
    context.assetId = assetId;
    if (step.via === "timeline-reference") {
      await adapter.ensureTimelineReference({
        timelineId: step.timelineId,
        assetId,
      });
      continue;
    }
    const sourceNodeId = step.sourceNodeId ?? context.sourceNodeId;
    if (!sourceNodeId)
      throw new Error("Timeline input needs a Canvas placement");
    context.sourceNodeId = sourceNodeId;
    await adapter.ensureCanvasTimelineInput({
      timelineId: step.timelineId,
      canvasId: step.canvasId,
      actionNodeId: step.actionNodeId,
      assetId,
      sourceNodeId,
    });
  }

  return context;
}
