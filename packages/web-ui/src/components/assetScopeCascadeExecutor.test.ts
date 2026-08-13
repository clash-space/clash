import { describe, expect, it, vi } from "vitest";
import { executeAssetScopeCascade } from "./assetScopeCascadeExecutor";

function adapter() {
  return {
    ensureProjectReference: vi.fn(async (assetId: string) => assetId),
    ensureCanvasPlacement: vi.fn(async () => "canvas-node-2"),
  };
}

describe("executeAssetScopeCascade", () => {
  it("returns the created Canvas placement for the caller's insertion hint", async () => {
    const target = adapter();
    const result = await executeAssetScopeCascade({
      steps: [
        { kind: "ensure-project-reference", assetId: "asset-1" },
        {
          kind: "ensure-canvas-placement",
          canvasId: "canvas-1",
          assetId: "asset-1",
        },
      ],
      initial: { assetId: "asset-1" },
      adapter: target,
    });

    expect(result).toEqual({
      assetId: "asset-1",
      sourceNodeId: "canvas-node-2",
    });
  });

  it("uses the new Project identity returned when a Global entry is admitted", async () => {
    const target = adapter();
    target.ensureProjectReference.mockResolvedValue("project-asset-2");

    const result = await executeAssetScopeCascade({
      steps: [
        { kind: "ensure-project-reference", assetId: "global-asset-1" },
        { kind: "ensure-canvas-placement", canvasId: "canvas-1" },
      ],
      initial: { assetId: "global-asset-1" },
      adapter: target,
    });

    expect(target.ensureCanvasPlacement).toHaveBeenCalledWith({
      canvasId: "canvas-1",
      assetId: "project-asset-2",
      sourceNodeId: undefined,
    });
    expect(result.assetId).toBe("project-asset-2");
  });

  it("preserves an existing current-Canvas node until item insertion", async () => {
    const target = adapter();
    const result = await executeAssetScopeCascade({
      steps: [],
      initial: { assetId: "asset-1", sourceNodeId: "existing-node" },
      adapter: target,
    });

    expect(target.ensureCanvasPlacement).not.toHaveBeenCalled();
    expect(result).toEqual({
      assetId: "asset-1",
      sourceNodeId: "existing-node",
    });
  });

  it("materializes a local file only through the supplied project adapter", async () => {
    const target = adapter();
    const createProjectAsset = vi.fn(async () => ({ assetId: "uploaded-1" }));
    await executeAssetScopeCascade({
      steps: [
        { kind: "create-project-asset", addToGlobalLibrary: false },
        { kind: "ensure-canvas-placement", canvasId: "canvas-1" },
      ],
      adapter: { ...target, createProjectAsset },
    });

    expect(createProjectAsset).toHaveBeenCalledWith({
      kind: "create-project-asset",
      addToGlobalLibrary: false,
    });
    expect(target.ensureProjectReference).not.toHaveBeenCalled();
    expect(target.ensureCanvasPlacement).toHaveBeenCalledWith(
      expect.objectContaining({ assetId: "uploaded-1" }),
    );
  });
});
