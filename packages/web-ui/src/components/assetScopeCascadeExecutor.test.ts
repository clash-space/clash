import { describe, expect, it, vi } from "vitest";
import { executeAssetScopeCascade } from "./assetScopeCascadeExecutor";

function adapter() {
  return {
    ensureProjectReference: vi.fn(async () => undefined),
    ensureCanvasPlacement: vi.fn(async () => "canvas-node-2"),
    ensureTimelineReference: vi.fn(async () => undefined),
    ensureCanvasTimelineInput: vi.fn(async () => undefined),
  };
}

describe("executeAssetScopeCascade", () => {
  it("passes the created Canvas placement forward into the Timeline input", async () => {
    const target = adapter();
    await executeAssetScopeCascade({
      steps: [
        { kind: "ensure-project-reference", assetId: "asset-1" },
        {
          kind: "ensure-canvas-placement",
          canvasId: "canvas-1",
          assetId: "asset-1",
        },
        {
          kind: "ensure-timeline-input",
          via: "canvas-edge",
          timelineId: "timeline-1",
          canvasId: "canvas-1",
          actionNodeId: "action-1",
          assetId: "asset-1",
        },
      ],
      initial: { assetId: "asset-1" },
      adapter: target,
    });

    expect(target.ensureCanvasTimelineInput).toHaveBeenCalledWith(
      expect.objectContaining({ sourceNodeId: "canvas-node-2" }),
    );
  });

  it("uses an existing current-Canvas node without creating another placement", async () => {
    const target = adapter();
    await executeAssetScopeCascade({
      steps: [
        {
          kind: "ensure-timeline-input",
          via: "canvas-edge",
          timelineId: "timeline-1",
          canvasId: "canvas-1",
          actionNodeId: "action-1",
          assetId: "asset-1",
          sourceNodeId: "existing-node",
        },
      ],
      initial: { assetId: "asset-1", sourceNodeId: "existing-node" },
      adapter: target,
    });

    expect(target.ensureCanvasPlacement).not.toHaveBeenCalled();
    expect(target.ensureCanvasTimelineInput).toHaveBeenCalledWith(
      expect.objectContaining({ sourceNodeId: "existing-node" }),
    );
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
