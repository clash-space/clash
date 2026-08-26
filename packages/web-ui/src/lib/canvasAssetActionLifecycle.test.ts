import { describe, expect, it, vi } from "vitest";

import { beginCanvasAssetAction } from "./canvasAssetActionLifecycle.js";

describe("Canvas asset Action lifecycle", () => {
  it("creates one pending video output and completes that same node", async () => {
    const createLinkedNode = vi.fn(() => ({
      nodeId: "edited-video-1",
      position: { x: 300, y: 100 },
      pushedNodeIds: [],
    }));
    const updateNode = vi.fn();
    const lifecycle = await beginCanvasAssetAction({
      actionRunId: "edit:crop-1",
      actionId: "video-clipper",
      outputKind: "video",
      sourceNodeId: "clipper-1",
      projectId: "project-1",
      nodes: [
        {
          id: "clipper-1",
          type: "video-clipper",
          position: { x: 100, y: 100 },
          data: {},
        },
      ],
      writer: { createLinkedNode, updateNode },
      createNodeId: async () => "edited-video-1",
    });

    expect(createLinkedNode).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeId: "edited-video-1",
        nodeType: "video",
        data: expect.objectContaining({
          status: "pending",
          actionType: "video-clipper",
          taskId: "edit:crop-1",
        }),
      }),
    );
    lifecycle.complete("asset:edited-video");
    expect(updateNode).toHaveBeenLastCalledWith("edited-video-1", {
      data: expect.objectContaining({
        status: "completed",
        assetId: "asset:edited-video",
      }),
    });
    expect(createLinkedNode).toHaveBeenCalledTimes(1);
  });

  it("fails the existing pending output instead of creating a replacement", async () => {
    const writer = {
      createLinkedNode: vi.fn(() => ({
        nodeId: "edited-image-1",
        position: { x: 200, y: 0 },
        pushedNodeIds: [],
      })),
      updateNode: vi.fn(),
    };
    const lifecycle = await beginCanvasAssetAction({
      actionRunId: "edit:image-1",
      actionId: "image-editor",
      outputKind: "image",
      sourceNodeId: "editor-1",
      projectId: "project-1",
      nodes: [
        {
          id: "editor-1",
          type: "image-editor",
          position: { x: 0, y: 0 },
          data: {},
        },
      ],
      writer,
      createNodeId: async () => "edited-image-1",
    });

    lifecycle.fail(new Error("canvas render failed"));
    expect(writer.updateNode).toHaveBeenLastCalledWith("edited-image-1", {
      data: expect.objectContaining({
        status: "failed",
        error: "canvas render failed",
      }),
    });
    lifecycle.pending();
    expect(writer.updateNode).toHaveBeenLastCalledWith("edited-image-1", {
      data: expect.objectContaining({ status: "pending" }),
    });
    expect(writer.createLinkedNode).toHaveBeenCalledTimes(1);
  });
});
