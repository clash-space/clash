import { describe, expect, it, vi } from "vitest";

import {
  persistPendingAssetAdoption,
  persistPendingAssetCreation,
} from "./pendingAssetLoro";

describe("pending asset Loro persistence", () => {
  it("persists a new pending node and edge even while the Host socket is disconnected", () => {
    const loroSync = {
      connected: false,
      addNode: vi.fn(),
      addEdge: vi.fn(),
      updateNode: vi.fn(),
    };
    const node = {
      id: "pending-image",
      type: "image",
      data: { status: "pending" },
      position: { x: 10, y: 20 },
    };
    const edge = {
      id: "action-pending-image",
      source: "action",
      target: "pending-image",
      type: "default",
    };

    persistPendingAssetCreation(loroSync, node, edge);

    expect(loroSync.addNode).toHaveBeenCalledWith(node.id, node);
    expect(loroSync.addEdge).toHaveBeenCalledWith(edge.id, edge);
  });

  it("persists adoption of a local draft while disconnected", () => {
    const loroSync = {
      connected: false,
      addNode: vi.fn(),
      addEdge: vi.fn(),
      updateNode: vi.fn(),
    };
    const data = { status: "pending", prompt: "a dog" };

    persistPendingAssetAdoption(loroSync, "draft-image", data);

    expect(loroSync.updateNode).toHaveBeenCalledWith("draft-image", { data });
  });
});
