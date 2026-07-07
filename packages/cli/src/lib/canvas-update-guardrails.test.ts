import test from "node:test";
import assert from "node:assert/strict";
import {
  canvasDownstreamTargets,
  canvasNodeReadToken,
  validateCanvasCheckpointPatch,
  validateCanvasContentPatch,
  validateCanvasDelete,
  validateCanvasEdgeAdd,
  validateCanvasEdgePatch,
  validateCanvasMediaAssetPatch,
  validateCanvasReadProof,
  validateCanvasUpdateDataFields,
} from "./canvas-update-guardrails";

test("allows safe canvas update metadata fields", () => {
  assert.deepEqual(
    validateCanvasUpdateDataFields(["status", "description", "assetId"]),
    { ok: true },
  );
});

test("canvas node read token is stable for semantic equality and changes with node data", () => {
  const base = {
    id: "node-1",
    type: "text",
    data: { content: "hello", label: "Script" },
  };

  assert.equal(
    canvasNodeReadToken(base),
    canvasNodeReadToken({
      id: "node-1",
      type: "text",
      data: { label: "Script", content: "hello" },
    }),
  );
  assert.notEqual(
    canvasNodeReadToken(base),
    canvasNodeReadToken({
      id: "node-1",
      type: "text",
      data: { content: "changed", label: "Script" },
    }),
  );
});

test("requires agent direct canvas writes to carry a matching read proof unless forced", () => {
  const node = {
    id: "node-1",
    type: "text",
    data: { content: "hello" },
  };
  const token = canvasNodeReadToken(node);

  const missing = validateCanvasReadProof({
    operation: "update",
    actorClientType: "agent",
    node,
  });
  assert.equal(missing.ok, false);
  if (!missing.ok) {
    assert.match(missing.error, /read proof/);
    assert.match(missing.error, /--if-match/);
  }

  assert.deepEqual(
    validateCanvasReadProof({
      operation: "update",
      actorClientType: "agent",
      node,
      expectedReadToken: token,
    }),
    { ok: true },
  );

  const stale = validateCanvasReadProof({
    operation: "delete",
    actorClientType: "agent",
    node: { ...node, data: { content: "changed" } },
    expectedReadToken: token,
  });
  assert.equal(stale.ok, false);
  if (!stale.ok) {
    assert.match(stale.error, /Stale canvas delete rejected/);
    assert.match(stale.error, /re-read/);
  }

  assert.deepEqual(
    validateCanvasReadProof({
      operation: "delete",
      actorClientType: "agent",
      node,
      force: true,
    }),
    { ok: true },
  );
});

test("rejects projection-owned timeline data patches", () => {
  const result = validateCanvasUpdateDataFields(["timelineDsl"]);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /projection-owned/);
    assert.match(result.error, /clash timeline apply/);
  }
});

test("rejects runtime-owned actor provenance patches", () => {
  const result = validateCanvasUpdateDataFields(["actorType", "actorUserId"]);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /runtime-owned/);
    assert.match(result.error, /Actor\/provenance/);
  }
});

test("rejects direct content patch on referenced text nodes", () => {
  const result = validateCanvasContentPatch({
    nodeId: "text-1",
    node: { type: "text" },
    edges: [{ source: "text-1", target: "image-gen-1" }],
    hasContentPatch: true,
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /referenced text content/);
    assert.match(result.error, /copy-on-write/);
  }
});

test("allows direct content patch for unreferenced text and non-text nodes", () => {
  assert.deepEqual(
    validateCanvasContentPatch({
      nodeId: "text-1",
      node: { type: "text" },
      edges: [],
      hasContentPatch: true,
    }),
    { ok: true },
  );
  assert.deepEqual(
    validateCanvasContentPatch({
      nodeId: "action-1",
      node: { type: "image_gen" },
      edges: [{ source: "action-1", target: "child-1" }],
      hasContentPatch: true,
    }),
    { ok: true },
  );
});

test("rejects semantic patches on downstream-referenced action checkpoints", () => {
  const result = validateCanvasCheckpointPatch({
    nodeId: "image-gen-1",
    node: {
      type: "image_gen",
      data: { actionType: "image.generate" },
    },
    edges: [{ source: "image-gen-1", target: "video-gen-1" }],
    fields: ["prompt", "modelId", "assetId", "status", "content"],
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /checkpoint/);
    assert.match(result.error, /materialized/);
    assert.match(result.error, /prompt/);
    assert.match(result.error, /assetId/);
    assert.match(result.error, /copy-on-write/);
  }
});

test("allows semantic patches on previously run actions until materialized downstream exists", () => {
  assert.deepEqual(
    validateCanvasCheckpointPatch({
      nodeId: "image-gen-1",
      node: {
        type: "image_gen",
        data: { actionType: "image.generate", hasRun: true, status: "success" },
      },
      nodes: [
        {
          id: "image-gen-1",
          type: "image_gen",
          data: { actionType: "image.generate", hasRun: true, status: "success" },
        },
      ],
      edges: [],
      fields: ["prompt", "modelId", "content"],
    }),
    { ok: true },
  );
});

test("allows label-only patches on downstream-referenced action checkpoints", () => {
  assert.deepEqual(
    validateCanvasCheckpointPatch({
      nodeId: "image-gen-1",
      node: {
        type: "image_gen",
        data: { actionType: "image.generate" },
      },
      edges: [{ source: "image-gen-1", target: "video-gen-1" }],
      fields: ["label"],
    }),
    { ok: true },
  );
});

test("allows semantic patches on unreferenced action drafts", () => {
  assert.deepEqual(
    validateCanvasCheckpointPatch({
      nodeId: "image-gen-1",
      node: {
        type: "image_gen",
        data: { actionType: "image.generate" },
      },
      edges: [],
      fields: ["prompt", "modelId", "assetId", "status", "content"],
    }),
    { ok: true },
  );
});

test("allows semantic patches while action downstream is only a draft placeholder", () => {
  assert.deepEqual(
    validateCanvasCheckpointPatch({
      nodeId: "image-gen-1",
      node: {
        type: "image_gen",
        data: { actionType: "image.generate" },
      },
      nodes: [
        {
          id: "image-gen-1",
          type: "image_gen",
          data: { actionType: "image.generate" },
        },
        {
          id: "draft-1",
          type: "image",
          data: { status: "draft" },
        },
      ],
      edges: [{ source: "image-gen-1", target: "draft-1" }],
      fields: ["prompt", "modelId", "content"],
    }),
    { ok: true },
  );
});

test("allows semantic patches through downstream action drafts until they materialize output", () => {
  assert.deepEqual(
    validateCanvasCheckpointPatch({
      nodeId: "image-gen-1",
      node: {
        type: "image_gen",
        data: { actionType: "image.generate" },
      },
      nodes: [
        {
          id: "image-gen-1",
          type: "image_gen",
          data: { actionType: "image.generate" },
        },
        {
          id: "video-gen-1",
          type: "action-badge",
          data: { actionType: "video.generate" },
        },
      ],
      edges: [{ source: "image-gen-1", target: "video-gen-1" }],
      fields: ["prompt", "modelId"],
    }),
    { ok: true },
  );

  const result = validateCanvasCheckpointPatch({
    nodeId: "image-gen-1",
    node: {
      type: "image_gen",
      data: { actionType: "image.generate" },
    },
    nodes: [
      {
        id: "image-gen-1",
        type: "image_gen",
        data: { actionType: "image.generate" },
      },
      {
        id: "video-gen-1",
        type: "action-badge",
        data: { actionType: "video.generate" },
      },
      {
        id: "video-1",
        type: "video",
        data: { status: "completed", assetId: "asset-video" },
      },
    ],
    edges: [
      { source: "image-gen-1", target: "video-gen-1" },
      { source: "video-gen-1", target: "video-1" },
    ],
    fields: ["prompt", "modelId"],
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /video-gen-1/);
    assert.match(result.error, /copy-on-write/);
  }
});

test("guards edge endpoint rewrites but permits draft-placeholder lineage edits", () => {
  const checkpointNodes = [
    { id: "image-1", type: "image", data: { assetId: "asset-1" } },
    { id: "image-2", type: "image", data: { assetId: "asset-2" } },
    { id: "action-1", type: "action-badge", data: { actionType: "image-gen" } },
    { id: "output-1", type: "image", data: { assetId: "asset-output" } },
  ];
  const checkpointEdges = [
    { source: "image-1", target: "action-1" },
    { source: "action-1", target: "output-1" },
  ];
  const rewrite = validateCanvasEdgePatch({
    existingEdge: { source: "image-1", target: "action-1" },
    patch: { source: "image-2", target: "action-1" },
    nodes: checkpointNodes,
    edges: checkpointEdges,
  });

  assert.equal(rewrite.ok, false);
  if (!rewrite.ok) assert.match(rewrite.error, /checkpoint lineage edge/);

  const draftNodes = [
    { id: "image-1", type: "image", data: { assetId: "asset-1" } },
    { id: "image-2", type: "image", data: { assetId: "asset-2" } },
    { id: "action-1", type: "action-badge", data: { actionType: "image-gen" } },
    { id: "draft-1", type: "image", data: { status: "idle" } },
  ];
  const draftEdges = [
    { source: "image-1", target: "action-1" },
    { source: "action-1", target: "draft-1" },
  ];

  assert.deepEqual(
    validateCanvasEdgeAdd({
      edge: { source: "image-2", target: "action-1" },
      nodes: draftNodes,
      edges: draftEdges,
    }),
    { ok: true },
  );
});

test("rejects direct assetId patch on referenced media nodes", () => {
  const result = validateCanvasMediaAssetPatch({
    nodeId: "image-1",
    node: { type: "image", data: { assetId: "asset-original" } },
    edges: [{ source: "image-1", target: "image-gen-1" }],
    hasAssetIdPatch: true,
    nextAssetId: "asset-replacement",
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /referenced media asset/);
    assert.match(result.error, /copy-on-write/);
  }
});

test("allows first assetId fulfillment on referenced pending media nodes", () => {
  assert.deepEqual(
    validateCanvasMediaAssetPatch({
      nodeId: "image-1",
      node: { type: "image", data: { status: "pending" } },
      edges: [{ source: "image-1", target: "video-editor-1" }],
      hasAssetIdPatch: true,
      nextAssetId: "asset-completed",
    }),
    { ok: true },
  );
});

test("rejects deleting nodes that have downstream references unless forced", () => {
  const edges = [{ source: "asset-1", target: "image-gen-1" }];

  const result = validateCanvasDelete({
    nodeId: "asset-1",
    edges,
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /Refusing to delete referenced node/);
    assert.match(result.error, /--force/);
  }
  assert.deepEqual(
    validateCanvasDelete({
      nodeId: "asset-1",
      edges,
      force: true,
    }),
    { ok: true },
  );
  assert.deepEqual(canvasDownstreamTargets("asset-1", edges), ["image-gen-1"]);
});
