import { LoroDoc } from "loro-crdt";
import { describe, expect, it } from "vitest";

import { projectCanvasPreviewFromDoc } from "./project-canvas-preview.js";

describe("projectCanvasPreviewFromDoc", () => {
  it("projects nested Main nodes in absolute canvas coordinates", () => {
    const doc = new LoroDoc();
    const nodes = doc.getMap("nodes");
    nodes.set("group", {
      canvasId: "main",
      type: "group",
      position: { x: 100, y: 100 },
      width: 500,
      height: 400,
      data: { label: "References" },
    });
    nodes.set("child", {
      canvasId: "main",
      parentId: "group",
      type: "image",
      position: { x: 20, y: 30 },
      width: 200,
      height: 100,
      data: { assetId: "asset-child" },
    });
    nodes.set("other-canvas", {
      canvasId: "shots",
      type: "image",
      position: { x: 9_000, y: 9_000 },
      width: 1_000,
      height: 1_000,
      data: {},
    });

    const preview = projectCanvasPreviewFromDoc(doc);

    expect(preview.bounds).toEqual({
      x: 100,
      y: 100,
      width: 500,
      height: 400,
    });
    expect(preview.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "child",
          parentId: "group",
          x: 120,
          y: 130,
          width: 200,
          height: 100,
          assetId: "asset-child",
        }),
      ]),
    );
    expect(preview.nodes.map((node) => node.id)).not.toContain("other-canvas");
  });
});
