/**
 * Unit tests for the pure helpers inside workflow.ts.
 *
 * Complements workflow.test.ts (tool-level integration): these exercise the
 * algorithms directly, covering edge cases that don't map cleanly to a
 * full tool invocation — cycles, diamonds, fanout, partial-completion short
 * circuits, missing fields, etc.
 *
 * Every function tested here is pure: NodeInfo[] + EdgeWithId[] in, plain
 * data out, no Loro/broadcast side effects.
 */
import { describe, it, expect } from "vitest";
import type { NodeInfo } from "@clash/shared-types";
import {
  computeBuildPlan,
  computeAdoptionPayload,
  computeTrajectory,
  simulateDrop,
  describeActions,
  type EdgeWithId,
  type TrajectorySubgraph,
} from "./workflow";

// ─── Fixture builders ────────────────────────────────────────────────────

type NodeShape = { id: string; type: string; data?: Record<string, unknown>; parent_id?: string | null };

function n(shape: NodeShape): NodeInfo {
  return {
    id: shape.id,
    canvas_id: "main",
    upstream: [],
    type: shape.type,
    data: shape.data ?? {},
    parent_id: shape.parent_id ?? null,
    position: { x: 0, y: 0 },
    width: null,
    height: null,
    style: null,
  };
}

function e(id: string, source: string, target: string): EdgeWithId {
  return { id, source, target };
}

/** Shorthand for the common action-badge data shape. */
function actionData(prompt = "a photo", modelId = "nano-banana-2"): Record<string, unknown> {
  return {
    label: prompt.slice(0, 20),
    content: prompt,
    actionType: "image-gen",
    modelId,
    modelParams: { aspect_ratio: "16:9", resolution: "1K", count: 1 },
  };
}

// ═══════════════════════════════════════════════════════════════════════
// computeBuildPlan
// ═══════════════════════════════════════════════════════════════════════

describe("computeBuildPlan", () => {
  it("detects a cycle and aborts with empty entries", () => {
    // a → b → a via two action-badges pointing at each other's outputs.
    const nodes = [
      n({ id: "actA", type: "action-badge", data: actionData("A") }),
      n({ id: "draftA", type: "image", data: { status: "draft" } }),
      n({ id: "actB", type: "action-badge", data: actionData("B") }),
      n({ id: "draftB", type: "image", data: { status: "draft" } }),
    ];
    // cycle: draftA → actB → draftB → actA → draftA
    const edges = [
      e("1", "draftA", "actB"),
      e("2", "actB", "draftB"),
      e("3", "draftB", "actA"),
      e("4", "actA", "draftA"),
    ];

    const plan = computeBuildPlan("draftA", nodes, edges);
    expect(plan.cycle).toBe(true);
    expect(plan.entries).toEqual([]);
    expect(plan.blockers.some((b) => b.toLowerCase().includes("cycle"))).toBe(true);
  });

  it("stops at completed ancestors — they don't appear in entries", () => {
    // head → act1 → draft1(completed) → act2 → draft2(draft). Building draft2
    // should produce just one entry (draft2); draft1 is a ready boundary.
    const nodes = [
      n({ id: "head", type: "image", data: { status: "completed", assetId: "asset-h" } }),
      n({ id: "act1", type: "action-badge", data: actionData("one") }),
      n({ id: "draft1", type: "image", data: { status: "completed", assetId: "asset-d1" } }),
      n({ id: "act2", type: "action-badge", data: actionData("two") }),
      n({ id: "draft2", type: "image", data: { status: "draft" } }),
    ];
    const edges = [
      e("1", "head", "act1"),
      e("2", "act1", "draft1"),
      e("3", "draft1", "act2"),
      e("4", "act2", "draft2"),
    ];

    const plan = computeBuildPlan("draft2", nodes, edges);
    expect(plan.entries.map((x) => x.draftId)).toEqual(["draft2"]);
    expect(plan.entries[0].readyToAdopt).toBe(true); // draft1 is completed
    expect(plan.blockers).toEqual([]);
  });

  it("post-order: deepest ancestor appears first in entries", () => {
    // 3-stage chain; we want [draft1, draft2, draft3] in that order.
    const nodes = [
      n({ id: "head", type: "image", data: { status: "completed", assetId: "asset-h" } }),
      n({ id: "a1", type: "action-badge", data: actionData("1") }),
      n({ id: "d1", type: "image", data: { status: "draft" } }),
      n({ id: "a2", type: "action-badge", data: actionData("2") }),
      n({ id: "d2", type: "image", data: { status: "draft" } }),
      n({ id: "a3", type: "action-badge", data: actionData("3") }),
      n({ id: "d3", type: "image", data: { status: "draft" } }),
    ];
    const edges = [
      e("e1", "head", "a1"),
      e("e2", "a1", "d1"),
      e("e3", "d1", "a2"),
      e("e4", "a2", "d2"),
      e("e5", "d2", "a3"),
      e("e6", "a3", "d3"),
    ];

    const plan = computeBuildPlan("d3", nodes, edges);
    expect(plan.entries.map((x) => x.draftId)).toEqual(["d1", "d2", "d3"]);
    expect(plan.entries[0].readyToAdopt).toBe(true); // head completed
    expect(plan.entries[1].readyToAdopt).toBe(false);
    expect(plan.entries[2].readyToAdopt).toBe(false);
  });

  it("flags blocker when upstream action lacks a modelId", () => {
    const nodes = [
      n({ id: "head", type: "image", data: { status: "completed", assetId: "asset-h" } }),
      n({
        id: "act",
        type: "action-badge",
        data: { content: "prompt", actionType: "image-gen", modelId: null, modelParams: {} },
      }),
      n({ id: "draft", type: "image", data: { status: "draft" } }),
    ];
    const edges = [e("1", "head", "act"), e("2", "act", "draft")];

    const plan = computeBuildPlan("draft", nodes, edges);
    expect(plan.entries).toHaveLength(1);
    expect(plan.blockers.some((b) => b.includes("no model"))).toBe(true);
  });

  it("flags blocker when upstream action has empty prompt", () => {
    const nodes = [
      n({ id: "head", type: "image", data: { status: "completed", assetId: "asset-h" } }),
      n({
        id: "act",
        type: "action-badge",
        data: { content: "   ", actionType: "image-gen", modelId: "nano-banana-2", modelParams: {} },
      }),
      n({ id: "draft", type: "image", data: { status: "draft" } }),
    ];
    const edges = [e("1", "head", "act"), e("2", "act", "draft")];

    const plan = computeBuildPlan("draft", nodes, edges);
    expect(plan.blockers.some((b) => b.toLowerCase().includes("no prompt"))).toBe(true);
  });

  it("warns when draft has no upstream action", () => {
    const nodes = [n({ id: "orphan", type: "image", data: { status: "draft" } })];
    const plan = computeBuildPlan("orphan", nodes, []);
    expect(plan.entries).toHaveLength(1);
    expect(plan.entries[0].actionId).toBe(null);
    expect(plan.warnings.some((w) => w.toLowerCase().includes("no upstream action"))).toBe(true);
  });

  it("returns 'nothing to build' warning when target is already completed", () => {
    const nodes = [n({ id: "done", type: "image", data: { status: "completed", assetId: "asset-x" } })];
    const plan = computeBuildPlan("done", nodes, []);
    expect(plan.entries).toEqual([]);
    expect(plan.warnings.some((w) => w.toLowerCase().includes("nothing to build"))).toBe(true);
  });

  it("accepts 'idle' as a draft-equivalent status", () => {
    const nodes = [
      n({ id: "head", type: "image", data: { status: "completed", assetId: "asset-h" } }),
      n({ id: "act", type: "action-badge", data: actionData() }),
      n({ id: "idle", type: "image", data: { status: "idle" } }),
    ];
    const edges = [e("1", "head", "act"), e("2", "act", "idle")];

    const plan = computeBuildPlan("idle", nodes, edges);
    expect(plan.entries).toHaveLength(1);
    expect(plan.entries[0].draftId).toBe("idle");
  });

  it("labels fallback: uses id when label is empty or missing", () => {
    const nodes = [
      n({ id: "head", type: "image", data: { status: "completed", assetId: "asset-h" } }),
      n({ id: "act", type: "action-badge", data: actionData() }),
      n({ id: "unnamed", type: "image", data: { status: "draft" } }),
    ];
    const edges = [e("1", "head", "act"), e("2", "act", "unnamed")];

    const plan = computeBuildPlan("unnamed", nodes, edges);
    expect(plan.entries[0].label).toBe("unnamed");
  });

  it("diamond: one draft depends on two actions that share a head", () => {
    // head → actA → draftMid ↘
    //             → actB → target (via another branch)
    // Actually a true diamond: target depends on draftMid AND another path.
    const nodes = [
      n({ id: "head", type: "image", data: { status: "completed", assetId: "asset-h" } }),
      n({ id: "actL", type: "action-badge", data: actionData("L") }),
      n({ id: "draftL", type: "image", data: { status: "draft" } }),
      n({ id: "actR", type: "action-badge", data: actionData("R") }),
      n({ id: "draftR", type: "image", data: { status: "draft" } }),
      n({ id: "actMerge", type: "action-badge", data: actionData("M") }),
      n({ id: "target", type: "image", data: { status: "draft" } }),
    ];
    const edges = [
      e("1", "head", "actL"),
      e("2", "actL", "draftL"),
      e("3", "head", "actR"),
      e("4", "actR", "draftR"),
      e("5", "draftL", "actMerge"),
      e("6", "draftR", "actMerge"),
      e("7", "actMerge", "target"),
    ];

    const plan = computeBuildPlan("target", nodes, edges);
    const ids = plan.entries.map((x) => x.draftId);
    expect(ids).toContain("draftL");
    expect(ids).toContain("draftR");
    expect(ids).toContain("target");
    expect(ids.indexOf("target")).toBeGreaterThan(ids.indexOf("draftL"));
    expect(ids.indexOf("target")).toBeGreaterThan(ids.indexOf("draftR"));
    // target is not ready — both upstream drafts are still 'draft'.
    expect(plan.entries.find((x) => x.draftId === "target")!.readyToAdopt).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// computeAdoptionPayload
// ═══════════════════════════════════════════════════════════════════════

describe("computeAdoptionPayload", () => {
  it("preserves inline reference mentions for provider-side interleaving", () => {
    const prompt = "Describe @[First](node:img1), then compare @[Second](node:img2).";
    const action = n({
      id: "act",
      type: "action-badge",
      data: {
        content: prompt,
        actionType: "text-gen",
        modelId: "gpt-5.4",
        modelParams: {},
      },
    });
    const nodes = [
      action,
      n({ id: "img1", type: "image", data: { assetId: "asset-a" } }),
      n({ id: "img2", type: "image", data: { assetId: "asset-b" } }),
    ];
    const edges = [e("1", "img1", "act"), e("2", "img2", "act")];

    const res = computeAdoptionPayload(action, nodes, edges);

    expect(res.ok).toBe(true);
    expect(res.data?.prompt).toBe(prompt);
    expect(res.data?.referenceImageAssetIds).toEqual(["asset-a", "asset-b"]);
  });

  it("image-gen: partitions image refs only (drops videos/audios for model that doesn't accept)", () => {
    const action = n({ id: "act", type: "action-badge", data: actionData("test prompt") });
    const nodes = [
      action,
      n({ id: "img1", type: "image", data: { assetId: "asset-a", status: "completed" } }),
      n({ id: "vid1", type: "video", data: { assetId: "asset-v", status: "completed" } }),
    ];
    const edges = [e("1", "img1", "act"), e("2", "vid1", "act")];

    const res = computeAdoptionPayload(action, nodes, edges);
    expect(res.ok).toBe(true);
    expect(res.type).toBe("image");
    expect(res.data?.referenceImageAssetIds).toEqual(["asset-a"]);
    // No referenceVideoAssetIds field on image payload.
    expect(res.data).not.toHaveProperty("referenceVideoAssetIds");
  });

  it("video-gen: partitions image + video refs", () => {
    const action = n({
      id: "act",
      type: "action-badge",
      data: {
        content: "a video",
        actionType: "video-gen",
        modelId: "seedance-2-ref", // accepts images + videos
        modelParams: { duration: 5 },
      },
    });
    const nodes = [
      action,
      n({ id: "img1", type: "image", data: { assetId: "asset-a" } }),
      n({ id: "vid1", type: "video", data: { assetId: "asset-v" } }),
    ];
    const edges = [e("1", "img1", "act"), e("2", "vid1", "act")];

    const res = computeAdoptionPayload(action, nodes, edges);
    expect(res.ok).toBe(true);
    expect(res.type).toBe("video");
    expect(res.data?.referenceImageAssetIds).toEqual(["asset-a"]);
    expect(res.data?.duration).toBe(5);
  });

  it("rejects when prompt is empty or whitespace", () => {
    const action = n({
      id: "act",
      type: "action-badge",
      data: { content: "   ", actionType: "image-gen", modelId: "nano-banana-2", modelParams: {} },
    });
    const res = computeAdoptionPayload(action, [action], []);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/no prompt/i);
  });

  it("rejects custom actions (backend can't resolve customDef yet)", () => {
    const action = n({
      id: "act",
      type: "action-badge",
      data: { content: "x", actionType: "custom:some-id", modelId: "nano-banana-2", modelParams: {} },
    });
    const res = computeAdoptionPayload(action, [action], []);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/custom/i);
  });

  it("handles audio generation", () => {
    const action = n({
      id: "act",
      type: "action-badge",
      data: { content: "narrate this", actionType: "audio-gen", modelId: "minimax-tts", modelParams: {} },
    });
    const res = computeAdoptionPayload(action, [action], []);
    expect(res.ok).toBe(true);
    expect(res.type).toBe("audio");
    expect(res.data?.prompt).toBe("narrate this");
  });

  it("handles text generation", () => {
    const action = n({
      id: "act",
      type: "action-badge",
      data: { content: "write titles", actionType: "text-gen", modelId: "gpt-5.4", modelParams: {} },
    });
    const res = computeAdoptionPayload(action, [action], []);
    expect(res.ok).toBe(true);
    expect(res.type).toBe("text");
    expect(res.data?.content).toBe("");
    expect(res.data?.prompt).toBe("write titles");
  });

  it("uses connected text refs as prompt context when action content is placeholder", () => {
    const action = n({
      id: "act",
      type: "action-badge",
      data: {
        content: "# Prompt\nEnter your prompt here...",
        actionType: "image-gen",
        modelId: "nano-banana-2",
        modelParams: { aspect_ratio: "16:9", resolution: "1K", count: 1 },
      },
    });
    const textRef = n({
      id: "txt",
      type: "text",
      data: { content: "A calm product shot on a sandstone plinth." },
    });

    const res = computeAdoptionPayload(action, [action, textRef], [e("txt-act", "txt", "act")]);

    expect(res.ok).toBe(true);
    expect(res.type).toBe("image");
    expect(res.data?.prompt).toBe("A calm product shot on a sandstone plinth.");
  });

  it("rejects unsupported actionType", () => {
    const action = n({
      id: "act",
      type: "action-badge",
      data: { content: "x", actionType: "unknown-gen", modelId: "nano-banana-2", modelParams: {} },
    });
    const res = computeAdoptionPayload(action, [action], []);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/unsupported/i);
  });

  it("falls back to data.prompt when content is empty", () => {
    const action = n({
      id: "act",
      type: "action-badge",
      data: {
        content: "",
        prompt: "from-prompt-field",
        actionType: "image-gen",
        modelId: "nano-banana-2",
        modelParams: {},
      },
    });
    const res = computeAdoptionPayload(action, [action], []);
    expect(res.ok).toBe(true);
    expect(res.data?.prompt).toBe("from-prompt-field");
  });

  it("ignores refs without a src (missing-asset node)", () => {
    const action = n({ id: "act", type: "action-badge", data: actionData("test") });
    const nodes = [
      action,
      n({ id: "img1", type: "image", data: { assetId: "asset-a" } }),
      n({ id: "img2", type: "image", data: {} }), // no src
    ];
    const edges = [e("1", "img1", "act"), e("2", "img2", "act")];

    const res = computeAdoptionPayload(action, nodes, edges);
    expect(res.data?.referenceImageAssetIds).toEqual(["asset-a"]);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// computeTrajectory
// ═══════════════════════════════════════════════════════════════════════

describe("computeTrajectory", () => {
  it("leaf with no action parent → it's a head, trajectory is a singleton", () => {
    const nodes = [n({ id: "h", type: "image", data: { status: "completed" } })];
    const sub = computeTrajectory("h", nodes, []);
    expect(sub.nodeIds).toEqual(new Set(["h"]));
    expect(sub.headIds).toEqual(new Set(["h"]));
    expect(sub.target).toBe("h");
    expect(sub.previewEdges).toEqual([]);
  });

  it("simple chain: head classified as head, action-badge + output as cloneset", () => {
    const nodes = [
      n({ id: "h", type: "image", data: { status: "completed", assetId: "asset-h2" } }),
      n({ id: "a", type: "action-badge", data: actionData() }),
      n({ id: "l", type: "image", data: { status: "completed", assetId: "asset-l2" } }),
    ];
    const edges = [e("1", "h", "a"), e("2", "a", "l")];

    const sub = computeTrajectory("l", nodes, edges);
    expect(sub.nodeIds).toEqual(new Set(["h", "a", "l"]));
    expect(sub.headIds).toEqual(new Set(["h"]));
    expect(sub.previewEdges).toHaveLength(2);
  });

  it("diamond: two heads merge at action", () => {
    const nodes = [
      n({ id: "h1", type: "image", data: { status: "completed" } }),
      n({ id: "h2", type: "image", data: { status: "completed" } }),
      n({ id: "a", type: "action-badge", data: actionData() }),
      n({ id: "l", type: "image", data: { status: "completed" } }),
    ];
    const edges = [e("1", "h1", "a"), e("2", "h2", "a"), e("3", "a", "l")];

    const sub = computeTrajectory("l", nodes, edges);
    expect(sub.nodeIds).toEqual(new Set(["h1", "h2", "a", "l"]));
    expect(sub.headIds).toEqual(new Set(["h1", "h2"]));
    expect(sub.previewEdges).toHaveLength(3);
  });

  it("intermediate node with action parent is NOT a head", () => {
    // Two-stage chain — the middle output has an action ancestor.
    const nodes = [
      n({ id: "h", type: "image", data: { status: "completed" } }),
      n({ id: "a1", type: "action-badge", data: actionData() }),
      n({ id: "mid", type: "image", data: { status: "completed" } }),
      n({ id: "a2", type: "action-badge", data: actionData() }),
      n({ id: "l", type: "image", data: { status: "completed" } }),
    ];
    const edges = [e("1", "h", "a1"), e("2", "a1", "mid"), e("3", "mid", "a2"), e("4", "a2", "l")];

    const sub = computeTrajectory("l", nodes, edges);
    expect(sub.headIds).toEqual(new Set(["h"]));
    expect(sub.nodeIds.has("mid")).toBe(true);
    expect(sub.headIds.has("mid")).toBe(false);
  });

  it("preview edges are a subset of full edges (filters out-of-trajectory refs)", () => {
    // Include an unrelated node + edge; they should not appear in preview.
    const nodes = [
      n({ id: "h", type: "image", data: { status: "completed" } }),
      n({ id: "a", type: "action-badge", data: actionData() }),
      n({ id: "l", type: "image", data: {} }),
      n({ id: "other", type: "image", data: { status: "completed" } }),
    ];
    const edges = [
      e("1", "h", "a"),
      e("2", "a", "l"),
      e("3", "other", "h"), // unrelated — not reachable from l
    ];
    const sub = computeTrajectory("l", nodes, edges);
    expect(sub.previewEdges.map((x) => x.id).sort()).toEqual(["1", "2"]);
    expect(sub.nodeIds.has("other")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// simulateDrop
// ═══════════════════════════════════════════════════════════════════════

describe("simulateDrop", () => {
  /** Build a 2-stage chain with completed outputs. Used by several tests. */
  function twoStage(): { nodes: NodeInfo[]; edges: EdgeWithId[]; sub: TrajectorySubgraph } {
    const nodes = [
      n({ id: "h", type: "image", data: { status: "completed", assetId: "asset-h" } }),
      n({ id: "a1", type: "action-badge", data: actionData() }),
      n({ id: "m", type: "image", data: { status: "completed", assetId: "asset-m" } }),
      n({ id: "a2", type: "action-badge", data: actionData() }),
      n({ id: "l", type: "image", data: { status: "completed", assetId: "asset-l" } }),
    ];
    const edges = [e("1", "h", "a1"), e("2", "a1", "m"), e("3", "m", "a2"), e("4", "a2", "l")];
    const sub = computeTrajectory("l", nodes, edges);
    return { nodes, edges, sub };
  }

  it("drop last-before-leaf action: nothing remains upstream, leaf orphans — rejected", () => {
    // Single-stage: dropping the only action leaves the leaf as a root.
    const nodes = [
      n({ id: "h", type: "image", data: { status: "completed", assetId: "asset-h" } }),
      n({ id: "a", type: "action-badge", data: actionData() }),
      n({ id: "l", type: "image", data: { status: "draft" } }), // draft leaf
    ];
    const edges = [e("1", "h", "a"), e("2", "a", "l")];
    const sub = computeTrajectory("l", nodes, edges);

    const res = simulateDrop(sub, new Set(["a"]), nodes, edges);
    expect("error" in res).toBe(true);
    if ("error" in res) expect(res.error).toMatch(/must be completed/i);
  });

  it("drop earlier action: intermediate output promotes to head", () => {
    const { nodes, edges, sub } = twoStage();
    const res = simulateDrop(sub, new Set(["a1"]), nodes, edges);
    expect("error" in res).toBe(false);
    if ("error" in res) return;

    expect(res.newHeads).toEqual(["m"]);
    expect(res.pruned.nodeIds).toEqual(new Set(["m", "a2", "l"]));
    expect(res.pruned.headIds.has("m")).toBe(true);
    expect(res.pruned.previewEdges.map((x) => x.id).sort()).toEqual(["3", "4"]);
  });

  it("drop ALL actions: non-leaf outputs all promote to heads; leaf itself also must be completed", () => {
    const { nodes, edges, sub } = twoStage();
    const res = simulateDrop(sub, new Set(["a1", "a2"]), nodes, edges);
    // After dropping both: only `l` remains reachable from `l`. Since l is
    // completed, that's a valid — but trivial — subgraph (just the leaf).
    expect("error" in res).toBe(false);
    if ("error" in res) return;
    expect(res.pruned.nodeIds).toEqual(new Set(["l"]));
    // `l` was the target and not originally a head (it had an action parent),
    // so after promotion it's a "new head".
    expect(res.newHeads).toContain("l");
  });

  it("parallel path keeps a head alive even if one action is dropped", () => {
    // head feeds TWO actions (a1 and a2), both produce intermediates that
    // merge at a3 → leaf. Dropping a1 should NOT orphan the head because
    // a2 still consumes it.
    const nodes = [
      n({ id: "h", type: "image", data: { status: "completed", assetId: "asset-h" } }),
      n({ id: "a1", type: "action-badge", data: actionData() }),
      n({ id: "m1", type: "image", data: { status: "completed", assetId: "asset-m1" } }),
      n({ id: "a2", type: "action-badge", data: actionData() }),
      n({ id: "m2", type: "image", data: { status: "completed", assetId: "asset-m2" } }),
      n({ id: "a3", type: "action-badge", data: actionData() }),
      n({ id: "l", type: "image", data: { status: "completed", assetId: "asset-l" } }),
    ];
    const edges = [
      e("1", "h", "a1"), e("2", "a1", "m1"),
      e("3", "h", "a2"), e("4", "a2", "m2"),
      e("5", "m1", "a3"), e("6", "m2", "a3"),
      e("7", "a3", "l"),
    ];
    const sub = computeTrajectory("l", nodes, edges);

    const res = simulateDrop(sub, new Set(["a1"]), nodes, edges);
    expect("error" in res).toBe(false);
    if ("error" in res) return;

    // m1 still needs to be in the kept set because `a3` wants it. But a3's
    // incoming edge from m1 is only kept if m1 is still reachable. m1's
    // incoming is from a1, which is dropped → m1 orphans → m1 promotes to head.
    // h stays alive via a2 (parallel path).
    expect(res.pruned.nodeIds.has("h")).toBe(true);
    expect(res.pruned.nodeIds.has("a2")).toBe(true);
    expect(res.pruned.nodeIds.has("m1")).toBe(true);
    expect(res.pruned.nodeIds.has("a1")).toBe(false);
    expect(res.newHeads).toContain("m1");
  });

  it("drops an intermediate that would leave an action as root → rejected", () => {
    // Force a situation where dropping leaves an action-badge without any inputs.
    // Chain: h → a1 → m → a2 → l. Drop m... wait, m isn't an action.
    // Instead construct: a1 has no head input, is already in the graph somehow.
    // Trajectory requires incoming edges to propagate, so let's test by
    // simulating a malformed graph where removing the head's producer leaves
    // an action hanging. Easier: two actions in series with no head feeding a1.
    const nodes = [
      n({ id: "a1", type: "action-badge", data: actionData() }),
      n({ id: "m", type: "image", data: { status: "completed", assetId: "asset-m" } }),
      n({ id: "a2", type: "action-badge", data: actionData() }),
      n({ id: "l", type: "image", data: { status: "completed", assetId: "asset-l" } }),
    ];
    const edges = [e("1", "a1", "m"), e("2", "m", "a2"), e("3", "a2", "l")];
    const sub = computeTrajectory("l", nodes, edges);
    // a1 is a root of the trajectory already — this is a malformed starting
    // graph (action with no inputs). simulateDrop with no drops should still
    // flag it when validating.
    const res = simulateDrop(sub, new Set(), nodes, edges);
    expect("error" in res).toBe(true);
    if ("error" in res) expect(res.error).toMatch(/action-badge.*root/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// describeActions
// ═══════════════════════════════════════════════════════════════════════

describe("describeActions", () => {
  it("reports every action-badge in the trajectory with its output node", () => {
    const nodes = [
      n({ id: "h", type: "image", data: { status: "completed", assetId: "asset-h" } }),
      n({ id: "a1", type: "action-badge", data: actionData() }),
      n({ id: "m", type: "image", data: { status: "completed", assetId: "asset-m" } }),
      n({ id: "a2", type: "action-badge", data: actionData() }),
      n({ id: "l", type: "image", data: { status: "completed", assetId: "asset-l" } }),
    ];
    const edges = [e("1", "h", "a1"), e("2", "a1", "m"), e("3", "m", "a2"), e("4", "a2", "l")];
    const sub = computeTrajectory("l", nodes, edges);

    const reports = describeActions(sub, nodes, edges);
    const byId = Object.fromEntries(reports.map((r) => [r.actionId, r]));
    expect(Object.keys(byId).sort()).toEqual(["a1", "a2"]);
    expect(byId.a1.outputNodeId).toBe("m");
    expect(byId.a2.outputNodeId).toBe("l");
    expect(byId.a1.droppable).toBe(true);
    expect(byId.a2.droppable).toBe(true);
  });

  it("marks action undroppable when its output would leave an incomplete draft as root", () => {
    // Chain where the middle is a draft (not completed). Dropping a1 would
    // promote the draft `m` to head — but m isn't completed.
    const nodes = [
      n({ id: "h", type: "image", data: { status: "completed", assetId: "asset-h" } }),
      n({ id: "a1", type: "action-badge", data: actionData() }),
      n({ id: "m", type: "image", data: { status: "draft" } }), // draft!
      n({ id: "a2", type: "action-badge", data: actionData() }),
      n({ id: "l", type: "image", data: { status: "completed", assetId: "asset-l" } }),
    ];
    const edges = [e("1", "h", "a1"), e("2", "a1", "m"), e("3", "m", "a2"), e("4", "a2", "l")];
    const sub = computeTrajectory("l", nodes, edges);

    const reports = describeActions(sub, nodes, edges);
    const a1 = reports.find((r) => r.actionId === "a1")!;
    expect(a1.droppable).toBe(false);
    expect(a1.reason).toMatch(/must be completed/i);
  });

  it("excludes non-action nodes", () => {
    const nodes = [
      n({ id: "h", type: "image", data: { status: "completed" } }),
      n({ id: "a", type: "action-badge", data: actionData() }),
      n({ id: "l", type: "image", data: { status: "completed" } }),
    ];
    const edges = [e("1", "h", "a"), e("2", "a", "l")];
    const sub = computeTrajectory("l", nodes, edges);

    const reports = describeActions(sub, nodes, edges);
    expect(reports.every((r) => r.actionId === "a")).toBe(true);
    expect(reports).toHaveLength(1);
  });

  it("returns empty array when trajectory has no actions (leaf is a bare head)", () => {
    const nodes = [n({ id: "h", type: "image", data: { status: "completed" } })];
    const sub = computeTrajectory("h", nodes, []);
    expect(describeActions(sub, nodes, [])).toEqual([]);
  });
});
