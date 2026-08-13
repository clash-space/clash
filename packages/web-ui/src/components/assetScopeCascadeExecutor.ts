import type { AssetScopeCascadeStep } from "@clash/shared-types";

export interface AssetCascadeContext {
  assetId?: string;
  sourceNodeId?: string;
}

export interface AssetScopeCascadeAdapter {
  createProjectAsset?: (
    step: Extract<AssetScopeCascadeStep, { kind: "create-project-asset" }>,
  ) => Promise<AssetCascadeContext>;
  ensureProjectReference: (globalAssetId: string) => Promise<string>;
  ensureGlobalLibraryReference?: (assetId?: string) => Promise<void>;
  ensureCanvasPlacement: (input: {
    canvasId: string;
    assetId: string;
    sourceNodeId?: string;
  }) => Promise<string>;
}

function requireAssetId(context: AssetCascadeContext): string {
  if (!context.assetId)
    throw new Error("Asset cascade has no materialized asset");
  return context.assetId;
}

/**
 * Executes a domain-planned cascade without knowing how any scope is stored.
 * Timeline item insertion is intentionally outside this scope cascade: that
 * mutation writes the item and its Action binding together.
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
      context.assetId = await adapter.ensureProjectReference(step.assetId);
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
  }

  return context;
}
