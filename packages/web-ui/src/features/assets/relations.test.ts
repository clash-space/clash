import { describe, expect, it } from "vitest";
import { buildAssetRelationSummary, readAssetRelationGraph } from "./relations";

describe("readAssetRelationGraph", () => {
  it("normalizes every persisted Canvas node and edge into one project relation graph", () => {
    const graph = readAssetRelationGraph(
      [
        [
          "image-1",
          { canvasId: "main", type: "image", data: { assetId: "asset-1" } },
        ],
        [
          "prompt-1",
          {
            canvasId: "review",
            type: "action-badge",
            data: { prompt: "Make it warmer" },
          },
        ],
        ["bad-node", null],
      ],
      [
        ["edge-1", { canvasId: "main", source: "prompt-1", target: "image-1" }],
        ["bad-edge", { source: "prompt-1" }],
      ],
    );

    expect(graph.nodes).toEqual([
      {
        id: "image-1",
        canvasId: "main",
        type: "image",
        data: { assetId: "asset-1" },
      },
      {
        id: "prompt-1",
        canvasId: "review",
        type: "action-badge",
        data: { prompt: "Make it warmer" },
      },
    ]);
    expect(graph.edges).toEqual([
      { canvasId: "main", source: "prompt-1", target: "image-1" },
    ]);
  });
});

describe("buildAssetRelationSummary", () => {
  it("projects Timeline, Canvas, and upstream relations only from authoritative bindings", () => {
    const generationOwner = {
      kind: "run" as const,
      actionId: "node:generate-image",
      actionRevisionId: "generation-revision-1",
      actionRunId: "generation-run-1",
    };
    const summary = buildAssetRelationSummary({
      assetId: "asset-output",
      asset: {
        id: "asset-output",
        kind: "image",
        metadata: {},
        lifecycle: { state: "active" },
        status: "ready",
        url: "https://media.clash.test/assets/asset-output",
        provenance: {
          kind: "generation",
          model: "nano-banana-2",
          prompt: "A lighthouse above a coral sea",
        },
      },
      projectAssets: [
        {
          id: "asset-sketch",
          name: "sketch.png",
          kind: "image",
          url: "https://media.clash.test/assets/asset-sketch",
          metadata: {},
          lifecycle: { state: "active" },
          status: "ready",
        },
        {
          id: "asset-palette",
          name: "palette.png",
          kind: "image",
          url: "https://media.clash.test/assets/asset-palette",
          metadata: {},
          lifecycle: { state: "active" },
          status: "ready",
        },
      ],
      canvases: [
        { id: "main", name: "Main", position: 0 },
        { id: "review", name: "Review", position: 1 },
      ],
      nodes: [
        {
          id: "generate-image",
          canvasId: "main",
          type: "action-badge",
          data: {
            prompt: "This Canvas field is not Asset provenance",
            modelId: "untrusted-canvas-model",
          },
        },
        {
          id: "output-node",
          canvasId: "main",
          type: "image",
          data: { assetId: "asset-output", label: "Lighthouse" },
        },
        {
          id: "review-prompt",
          canvasId: "review",
          type: "action-badge",
          data: { referenceImageAssetIds: ["asset-output"] },
        },
      ],
      edges: [
        { canvasId: "main", source: "generate-image", target: "output-node" },
      ],
      timelines: [
        {
          id: "trailer",
          name: "Trailer",
          owner: { kind: "project" },
          revisionId: "revision-1",
          state: {
            tracks: [{ items: [{ id: "junk", assetId: "asset-output" }] }],
          },
        },
      ],
      bindings: [
        {
          id: "generation-output",
          owner: generationOwner,
          direction: "output",
          slot: "media",
          projectAssetId: "asset-output",
        },
        {
          id: "generation-primary",
          owner: generationOwner,
          direction: "input",
          slot: "primary",
          projectAssetId: "asset-sketch",
          role: "primary",
        },
        {
          id: "generation-reference",
          owner: generationOwner,
          direction: "input",
          slot: "reference:0",
          projectAssetId: "asset-palette",
          role: "reference",
        },
        {
          id: "different-run-input",
          owner: {
            ...generationOwner,
            actionRunId: "generation-run-2",
          },
          direction: "input",
          slot: "reference:1",
          projectAssetId: "asset-from-different-run",
          role: "reference",
        },
        {
          id: "timeline-input",
          owner: { kind: "draft", actionId: "timeline:trailer" },
          direction: "input",
          slot: "timeline:item:shot-1",
          projectAssetId: "asset-output",
          role: "source",
        },
        {
          id: "canvas-reference",
          owner: { kind: "draft", actionId: "node:review-prompt" },
          direction: "input",
          slot: "reference:0",
          projectAssetId: "asset-output",
          role: "reference",
        },
      ],
    });

    expect(summary.origin).toMatchObject({
      canvasId: "main",
      canvasName: "Main",
      nodeId: "output-node",
    });
    expect(summary.canvases).toEqual([
      expect.objectContaining({
        canvasId: "main",
        canvasName: "Main",
        role: "origin",
      }),
      expect.objectContaining({
        canvasId: "review",
        canvasName: "Review",
        role: "reference",
      }),
    ]);
    expect(summary.timelines).toEqual([
      expect.objectContaining({
        timelineId: "trailer",
        timelineName: "Trailer",
        itemCount: 1,
      }),
    ]);
    expect(summary.upstreamAssets).toEqual([
      expect.objectContaining({
        assetId: "asset-sketch",
        label: "sketch.png",
        role: "primary",
        availableInProject: true,
      }),
      expect.objectContaining({
        assetId: "asset-palette",
        label: "palette.png",
        role: "reference",
        availableInProject: true,
      }),
    ]);
    expect(summary.prompts).toEqual([
      { label: "Prompt", value: "A lighthouse above a coral sea" },
    ]);
    expect(summary.sourceModel).toBe("nano-banana-2");
  });

  it("ignores asset-looking Canvas and Timeline fields when no binding authorizes a relation", () => {
    const summary = buildAssetRelationSummary({
      assetId: "asset-output",
      asset: {
        id: "asset-output",
        kind: "image",
        metadata: {},
        lifecycle: { state: "active" },
        status: "ready",
      },
      projectAssets: [
        {
          id: "source-image",
          name: "source.png",
          kind: "image",
          url: "https://media.clash.test/assets/source-image",
          metadata: {},
          lifecycle: { state: "active" },
          status: "ready",
        },
      ],
      canvases: [{ id: "main", name: "Main", position: 0 }],
      nodes: [
        {
          id: "output",
          canvasId: "main",
          type: "image",
          data: {
            assetId: "asset-output",
            prompt: "Untrusted prompt-shaped junk",
            modelId: "untrusted-model-shaped-junk",
            referenceImageAssetIds: ["source-image"],
          },
        },
        {
          id: "junk-reference",
          canvasId: "main",
          type: "action-badge",
          data: {
            nested: { sourceAssetId: "asset-output" },
            referencedAssets: ["asset-output"],
          },
        },
      ],
      edges: [],
      timelines: [
        {
          id: "rough-cut",
          name: "Rough Cut",
          owner: { kind: "project" },
          revisionId: "revision-1",
          state: {
            tracks: [
              {
                items: [
                  {
                    id: "clip",
                    assetId: "asset-output",
                    sourceNodeId: "output",
                  },
                ],
              },
            ],
          },
        },
      ],
      bindings: [],
    });

    expect(summary.origin).toBeUndefined();
    expect(summary.canvases).toEqual([
      expect.objectContaining({
        canvasId: "main",
        nodeId: "output",
        nodeCount: 1,
        role: "placement",
      }),
    ]);
    expect(summary.timelines).toEqual([]);
    expect(summary.upstreamAssets).toEqual([]);
    expect(summary.prompts).toEqual([]);
    expect(summary.sourceModel).toBeUndefined();
  });

  it("recognizes only draft bindings with a concrete Timeline item slot", () => {
    const summary = buildAssetRelationSummary({
      assetId: "asset-video",
      projectAssets: [],
      canvases: [],
      nodes: [],
      edges: [],
      timelines: [
        {
          id: "rough-cut",
          name: "Rough Cut",
          owner: { kind: "project" },
          revisionId: "revision-1",
          state: {},
        },
      ],
      bindings: [
        {
          id: "missing-item-id",
          owner: { kind: "draft", actionId: "timeline:rough-cut" },
          direction: "input",
          slot: "timeline:item:",
          projectAssetId: "asset-video",
          role: "source",
        },
        {
          id: "frozen-history",
          owner: {
            kind: "run",
            actionId: "timeline:rough-cut",
            actionRevisionId: "revision-1",
            actionRunId: "render-1",
          },
          direction: "input",
          slot: "timeline:item:historic-clip",
          projectAssetId: "asset-video",
          role: "source",
        },
      ],
    });

    expect(summary.timelines).toEqual([]);
  });

  it("does not invent an origin Canvas for an implicit asset placed there later", () => {
    const summary = buildAssetRelationSummary({
      assetId: "implicit-edit",
      asset: {
        id: "implicit-edit",
        kind: "image",
        metadata: {},
        lifecycle: { state: "active" },
        status: "ready",
        provenance: {
          kind: "edit",
          model: "implicit:image-editor",
          prompt: "Crop and rotate",
        },
      },
      projectAssets: [],
      canvases: [{ id: "review", name: "Review", position: 0 }],
      nodes: [
        {
          id: "placement",
          canvasId: "review",
          type: "image",
          data: { assetId: "implicit-edit" },
        },
      ],
      edges: [],
      timelines: [],
      bindings: [],
    });

    expect(summary.origin).toBeUndefined();
    expect(summary.canvases).toEqual([
      expect.objectContaining({ canvasId: "review", role: "placement" }),
    ]);
  });
});
