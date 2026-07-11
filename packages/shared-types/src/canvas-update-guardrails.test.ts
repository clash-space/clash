import { describe, expect, it } from "vitest";
import { agentReadReceiptToken } from "./agent-read-proof";
import {
  canvasBatchDeleteReadToken,
  canvasNodeReadToken,
  validateCanvasBatchDelete,
  validateCanvasBatchDeleteReadProof,
  validateCanvasNodePatch,
  validateCanvasDelete,
  validateCanvasEdgeDelete,
  validateCanvasEdgeAdd,
  validateCanvasEdgePatch,
  validateCanvasReadProof,
  validateCanvasTimelineApply,
  validateCanvasUpdateDataFields,
  isCanvasActionCheckpointLocked,
  isCanvasNodeImmutable,
} from "./canvas-update-guardrails";

describe("canvas update guardrails", () => {
  it("derives whole-node immutability from downstream references", () => {
    expect(isCanvasNodeImmutable({
      nodeId: "gen-1",
      edges: [],
    })).toBe(false);
    expect(isCanvasNodeImmutable({
      nodeId: "gen-1",
      edges: [{ source: "gen-1", target: "image-1" }],
    })).toBe(true);
  });

  it("requires agent batch deletes to carry a matching graph-aware read token", () => {
    const nodes = [
      { id: "source-1", type: "text", data: { content: "source" } },
      { id: "child-1", type: "image", data: { status: "completed" } },
    ];
    const edges = [{ id: "edge-internal", source: "source-1", target: "child-1" }];
    const readToken = canvasBatchDeleteReadToken({ nodes, edges });

    expect(canvasBatchDeleteReadToken({ nodes: [...nodes].reverse(), edges })).toBe(readToken);
    expect(validateCanvasBatchDeleteReadProof({
      actorClientType: "agent",
      nodes,
      edges,
      expectedReadToken: readToken,
    })).toEqual({ ok: true });

    const stale = validateCanvasBatchDeleteReadProof({
      actorClientType: "agent",
      nodes,
      edges: [...edges, { id: "edge-external", source: "child-1", target: "render-1" }],
      expectedReadToken: readToken,
    });

    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.error).toContain("Stale canvas batch delete rejected");
      expect(stale.error).toContain("clash canvas delete-plan");
    }
  });

  it("requires agent direct writes to carry a matching node read token", () => {
    const node = {
      id: "text-1",
      type: "text",
      data: { content: "before", label: "Script" },
    };
    const token = canvasNodeReadToken(node);

    expect(canvasNodeReadToken({
      id: "text-1",
      type: "text",
      data: { label: "Script", content: "before" },
    })).toBe(token);
    expect(validateCanvasReadProof({
      operation: "update",
      actorClientType: "agent",
      node,
      expectedReadToken: token,
    })).toEqual({ ok: true });
    const stale = validateCanvasReadProof({
      operation: "delete",
      actorClientType: "agent",
      node: { ...node, data: { content: "after", label: "Script" } },
      expectedReadToken: token,
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.error).toContain("Stale canvas delete rejected");
      expect(stale.error).toContain("clash canvas get --json");
    }
  });

  it("can require a host-issued read receipt for agent direct writes", () => {
    const node = {
      id: "text-1",
      type: "text",
      data: { content: "before", label: "Script" },
    };
    const token = canvasNodeReadToken(node);
    const receiptToken = agentReadReceiptToken({
      readToken: token,
      receipt: "daemon.read.1",
    });

    expect(validateCanvasReadProof({
      operation: "update",
      actorClientType: "agent",
      node,
      expectedReadToken: receiptToken,
      requireReceipt: true,
      readReceiptVerifier: (proof) => proof.receipt === "daemon.read.1",
    })).toEqual({ ok: true });

    const missingReceipt = validateCanvasReadProof({
      operation: "update",
      actorClientType: "agent",
      node,
      expectedReadToken: token,
      requireReceipt: true,
      readReceiptVerifier: () => true,
    });
    expect(missingReceipt.ok).toBe(false);
    if (!missingReceipt.ok) {
      expect(missingReceipt.error).toContain("read receipt");
    }
  });

  it("rejects projection-owned direct patches", () => {
    const result = validateCanvasUpdateDataFields(["timelineDsl"]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("projection-owned");
    }
  });

  it("rejects nested Web UI semantic patches on downstream-referenced action checkpoints", () => {
    const result = validateCanvasNodePatch({
      nodeId: "image-gen-1",
      node: {
        type: "action-badge",
        data: { actionType: "image.generate" },
      },
      edges: [{ source: "image-gen-1", target: "video-gen-1" }],
      patch: {
        data: {
          prompt: "replace the original prompt",
          assetId: "asset-new",
          status: "completed",
        },
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("checkpoint");
      expect(result.error).toContain("prompt");
      expect(result.error).toContain("assetId");
      expect(result.error).toContain("copy-on-write");
    }
  });

  it("rejects storyboard metadata patches on downstream-referenced action checkpoints", () => {
    const result = validateCanvasNodePatch({
      nodeId: "storyboard-review",
      node: {
        type: "action-badge",
        data: {
          actionType: "storyboard.review",
          metadata: {
            kind: "image.storyboard-consistency",
            panels: [{ id: "panel-1", assetId: "asset-panel-1" }],
          },
        },
      },
      nodes: [
        {
          id: "storyboard-review",
          type: "action-badge",
          data: {
            actionType: "storyboard.review",
            metadata: {
              kind: "image.storyboard-consistency",
              panels: [{ id: "panel-1", assetId: "asset-panel-1" }],
            },
          },
        },
        { id: "prompt-pack", type: "text", data: { status: "completed", content: "generated prompt pack" } },
      ],
      edges: [{ source: "storyboard-review", target: "prompt-pack" }],
      patch: {
        data: {
          metadata: {
            kind: "image.storyboard-consistency",
            panels: [{ id: "panel-1", assetId: "asset-panel-replaced" }],
          },
        },
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("metadata");
      expect(result.error).toContain("copy-on-write");
    }
  });

  it("allows nested Web UI label patches on downstream-referenced action checkpoints", () => {
    expect(validateCanvasNodePatch({
      nodeId: "image-gen-1",
      node: {
        type: "image_gen",
        data: { actionType: "image.generate" },
      },
      edges: [{ source: "image-gen-1", target: "video-gen-1" }],
      patch: { data: { label: "renamed checkpoint" } },
    })).toEqual({ ok: true });
  });

  it("allows semantic patches on action drafts with only downstream draft placeholders", () => {
    expect(validateCanvasNodePatch({
      nodeId: "image-gen-1",
      node: {
        type: "action-badge",
        data: { actionType: "image.generate" },
      },
      nodes: [
        { id: "image-gen-1", type: "action-badge", data: { actionType: "image.generate" } },
        { id: "draft-1", type: "image", data: { status: "draft" } },
      ],
      edges: [{ source: "image-gen-1", target: "draft-1" }],
      patch: {
        data: {
          prompt: "keep editing before adoption",
          modelId: "nano-banana-2",
        },
      },
    })).toEqual({ ok: true });
  });

  it("allows semantic patches on previously run actions until materialized downstream exists", () => {
    expect(validateCanvasNodePatch({
      nodeId: "image-gen-1",
      node: {
        type: "action-badge",
        data: { actionType: "image.generate", hasRun: true, status: "success" },
      },
      nodes: [
        { id: "image-gen-1", type: "action-badge", data: { actionType: "image.generate", hasRun: true, status: "success" } },
      ],
      edges: [],
      patch: {
        data: {
          prompt: "rerun this checkpoint with a revised prompt",
          modelId: "image-model-next",
        },
      },
    })).toEqual({ ok: true });
  });

  it("allows semantic patches through downstream action drafts until they materialize output", () => {
    expect(validateCanvasNodePatch({
      nodeId: "image-gen-1",
      node: {
        type: "action-badge",
        data: { actionType: "image.generate" },
      },
      nodes: [
        { id: "image-gen-1", type: "action-badge", data: { actionType: "image.generate" } },
        { id: "video-gen-1", type: "action-badge", data: { actionType: "video.generate" } },
      ],
      edges: [{ source: "image-gen-1", target: "video-gen-1" }],
      patch: { data: { prompt: "still editable before downstream output exists" } },
    })).toEqual({ ok: true });

    const result = validateCanvasNodePatch({
      nodeId: "image-gen-1",
      node: {
        type: "action-badge",
        data: { actionType: "image.generate" },
      },
      nodes: [
        { id: "image-gen-1", type: "action-badge", data: { actionType: "image.generate" } },
        { id: "video-gen-1", type: "action-badge", data: { actionType: "video.generate" } },
        { id: "video-1", type: "video", data: { status: "completed", assetId: "asset-video" } },
      ],
      edges: [
        { source: "image-gen-1", target: "video-gen-1" },
        { source: "video-gen-1", target: "video-1" },
      ],
      patch: { data: { prompt: "too late after downstream output exists" } },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("materialized");
      expect(result.error).toContain("video-gen-1");
      expect(result.error).toContain("copy-on-write");
    }
  });

  it("rejects nested Web UI content patches on referenced text nodes", () => {
    const result = validateCanvasNodePatch({
      nodeId: "text-1",
      node: { type: "text", data: { content: "original" } },
      edges: [{ source: "text-1", target: "image-gen-1" }],
      patch: { data: { content: "changed" } },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("referenced text content");
    }
  });

  it("allows text content patches when the text only feeds an unmaterialized action draft", () => {
    expect(validateCanvasNodePatch({
      nodeId: "text-1",
      node: { type: "text", data: { content: "original" } },
      nodes: [
        { id: "text-1", type: "text", data: { content: "original" } },
        { id: "action-1", type: "action-badge", data: { actionType: "image-gen" } },
        { id: "draft-1", type: "image", data: { status: "idle" } },
      ],
      edges: [
        { source: "text-1", target: "action-1" },
        { source: "action-1", target: "draft-1" },
      ],
      patch: { data: { content: "changed before run" } },
    })).toEqual({ ok: true });
  });

  it("rejects text content patches once a downstream action has materialized output", () => {
    const result = validateCanvasNodePatch({
      nodeId: "text-1",
      node: { type: "text", data: { content: "original" } },
      nodes: [
        { id: "text-1", type: "text", data: { content: "original" } },
        { id: "action-1", type: "action-badge", data: { actionType: "image-gen" } },
        { id: "output-1", type: "image", data: { status: "completed", assetId: "asset-output" } },
      ],
      edges: [
        { source: "text-1", target: "action-1" },
        { source: "action-1", target: "output-1" },
      ],
      patch: { data: { content: "changed after run" } },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("referenced text content");
      expect(result.error).toContain("action-1");
    }
  });

  it("rejects assetId patches on downstream-referenced media nodes", () => {
    const result = validateCanvasNodePatch({
      nodeId: "image-1",
      node: { type: "image", data: { assetId: "asset-original" } },
      edges: [{ source: "image-1", target: "image-gen-1" }],
      patch: { data: { assetId: "asset-replacement" } },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("referenced media asset");
      expect(result.error).toContain("copy-on-write");
    }
  });

  it("allows first assetId fulfillment on downstream-referenced pending media nodes", () => {
    expect(validateCanvasNodePatch({
      nodeId: "pending-image-1",
      node: { type: "image", data: { status: "pending" } },
      edges: [{ source: "pending-image-1", target: "video-editor-1" }],
      patch: { data: { assetId: "asset-completed", status: "completed" } },
    })).toEqual({ ok: true });
  });

  it("rejects timeline apply when materialized downstream renders depend on it", () => {
    const result = validateCanvasTimelineApply({
      nodeId: "editor-1",
      nodes: [
        { id: "editor-1", type: "video-editor", data: { timelineDsl: { tracks: [] } } },
        { id: "render-1", type: "video", data: { status: "completed", assetId: "asset-render" } },
      ],
      edges: [{ source: "editor-1", target: "render-1" }],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("materialized downstream checkpoint");
      expect(result.error).toContain("render-1");
    }
  });

  it("allows timeline apply while downstream outputs are still draft placeholders", () => {
    expect(validateCanvasTimelineApply({
      nodeId: "editor-1",
      nodes: [
        { id: "editor-1", type: "video-editor", data: { timelineDsl: { tracks: [] } } },
        { id: "draft-render", type: "video", data: { status: "idle" } },
      ],
      edges: [{ source: "editor-1", target: "draft-render" }],
    })).toEqual({ ok: true });

  });

  it("rejects referenced node deletes until references are removed or rewired", () => {
    const edges = [{ source: "source-1", target: "child-1" }];

    const result = validateCanvasDelete({
      nodeId: "source-1",
      edges,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Refusing to delete referenced node");
      expect(result.error).toContain("Remove or rewire");
    }
  });

  it("allows batch deleting a closed referenced subgraph", () => {
    expect(validateCanvasBatchDelete({
      nodeIds: ["source-1", "child-1"],
      edges: [{ source: "source-1", target: "child-1" }],
    })).toEqual({ ok: true });
  });

  it("rejects batch deletes that leave external downstream references", () => {
    const result = validateCanvasBatchDelete({
      nodeIds: ["source-1", "child-1"],
      edges: [
        { source: "source-1", target: "child-1" },
        { source: "child-1", target: "external-render-1" },
      ],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Refusing to delete referenced node(s)");
      expect(result.error).toContain("child-1 -> external-render-1");
    }
  });

  it("allows deleting input edges on unreferenced action drafts", () => {
    expect(validateCanvasEdgeDelete({
      edge: { source: "image-1", target: "action-1" },
      nodes: [
        { id: "image-1", type: "image", data: { assetId: "asset-1" } },
        { id: "action-1", type: "action-badge", data: { actionType: "image-gen" } },
      ],
      edges: [{ source: "image-1", target: "action-1" }],
    })).toEqual({ ok: true });
  });

  it("allows editing input edges while downstream action outputs are only draft placeholders", () => {
    const nodes = [
      { id: "image-1", type: "image", data: { assetId: "asset-1" } },
      { id: "action-1", type: "action-badge", data: { actionType: "image-gen" } },
      { id: "draft-1", type: "image", data: { status: "idle" } },
    ];
    const edges = [
      { source: "image-1", target: "action-1" },
      { source: "action-1", target: "draft-1" },
    ];

    expect(validateCanvasEdgeDelete({
      edge: { source: "image-1", target: "action-1" },
      nodes,
      edges,
    })).toEqual({ ok: true });
    expect(validateCanvasEdgeAdd({
      edge: { source: "image-2", target: "action-1" },
      nodes: [...nodes, { id: "image-2", type: "image", data: { assetId: "asset-2" } }],
      edges,
    })).toEqual({ ok: true });
  });

  it("rejects adding new input edges to downstream-referenced action checkpoints", () => {
    const result = validateCanvasEdgeAdd({
      edge: { source: "image-2", target: "action-1" },
      nodes: [
        { id: "image-1", type: "image", data: { assetId: "asset-1" } },
        { id: "image-2", type: "image", data: { assetId: "asset-2" } },
        { id: "action-1", type: "action-badge", data: { actionType: "image-gen" } },
        { id: "output-1", type: "image", data: { assetId: "asset-output" } },
      ],
      edges: [
        { source: "image-1", target: "action-1" },
        { source: "action-1", target: "output-1" },
      ],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("checkpoint input edge");
      expect(result.error).toContain("action-1");
      expect(result.error).toContain("copy-on-write");
    }
  });

  it("rejects edge endpoint rewrites that would mutate checkpoint lineage", () => {
    const result = validateCanvasEdgePatch({
      existingEdge: { source: "image-1", target: "action-1" },
      patch: { source: "image-2", target: "action-1" },
      nodes: [
        { id: "image-1", type: "image", data: { assetId: "asset-1" } },
        { id: "image-2", type: "image", data: { assetId: "asset-2" } },
        { id: "action-1", type: "action-badge", data: { actionType: "image-gen" } },
        { id: "output-1", type: "image", data: { assetId: "asset-output" } },
      ],
      edges: [
        { source: "image-1", target: "action-1" },
        { source: "action-1", target: "output-1" },
      ],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("checkpoint lineage edge");
    }
  });

  it("allows edge metadata patches that do not rewrite lineage endpoints", () => {
    expect(validateCanvasEdgePatch({
      existingEdge: { source: "action-1", target: "output-1" },
      patch: { type: "preview" },
      nodes: [
        { id: "action-1", type: "action-badge", data: { actionType: "image-gen" } },
        { id: "output-1", type: "image", data: { assetId: "asset-output" } },
      ],
      edges: [{ source: "action-1", target: "output-1" }],
    })).toEqual({ ok: true });
  });

  it("rejects deleting checkpoint input and output lineage edges", () => {
    const nodes = [
      { id: "image-1", type: "image", data: { assetId: "asset-1" } },
      { id: "action-1", type: "action-badge", data: { actionType: "image-gen" } },
      { id: "output-1", type: "image", data: { assetId: "asset-output" } },
    ];
    const edges = [
      { source: "image-1", target: "action-1" },
      { source: "action-1", target: "output-1" },
    ];

    const inputResult = validateCanvasEdgeDelete({
      edge: { source: "image-1", target: "action-1" },
      nodes,
      edges,
    });
    expect(inputResult.ok).toBe(false);
    if (!inputResult.ok) {
      expect(inputResult.error).toContain("checkpoint lineage edge");
      expect(inputResult.error).toContain("action-1");
    }

    const outputResult = validateCanvasEdgeDelete({
      edge: { source: "action-1", target: "output-1" },
      nodes,
      edges,
    });
    expect(outputResult.ok).toBe(false);
  });

  it("exposes action checkpoint lock status for UI affordances", () => {
    expect(isCanvasActionCheckpointLocked({
      nodeId: "action-1",
      nodes: [
        { id: "action-1", type: "action-badge", data: { hasRun: true, actionType: "image-gen" } },
      ],
      edges: [],
    })).toBe(false);

    expect(isCanvasActionCheckpointLocked({
      nodeId: "action-1",
      nodes: [
        { id: "action-1", type: "action-badge", data: { actionType: "image-gen" } },
        { id: "output-1", type: "image", data: { status: "completed", assetId: "asset-1" } },
      ],
      edges: [{ source: "action-1", target: "output-1" }],
    })).toBe(true);
  });
});
