/**
 * Integration tests for workflow_op tool.
 *
 * Scope: exercises the full tool code path against a real LoroDoc seeded with
 * a realistic generation chain. Skips the LLM layer — asserts on the tool's
 * return JSON and on post-apply doc state directly. See workflow-e2e.test.ts
 * for LLM-driven behavioral tests.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { LoroDoc } from "loro-crdt";
import type { BroadcastFn, NodeInfo } from "@clash/shared-types";
import { Canvas } from "@clash/shared-types";
import { createWorkflowTools } from "./workflow";

// ─── Fixture helpers ─────────────────────────────────────────────────────

interface SeedNode {
  id: string;
  type: string;
  data: Record<string, any>;
  parentId?: string;
  position?: { x: number; y: number };
}
interface SeedEdge {
  id: string;
  source: string;
  target: string;
  type?: string;
}

function seedDoc(nodes: SeedNode[], edges: SeedEdge[]): LoroDoc {
  const doc = new LoroDoc();
  const nodesMap = doc.getMap("nodes");
  for (const n of nodes) {
    nodesMap.set(n.id, {
      type: n.type,
      data: n.data,
      parentId: n.parentId,
      position: n.position ?? { x: 0, y: 0 },
    });
  }
  const edgesMap = doc.getMap("edges");
  for (const e of edges) {
    edgesMap.set(e.id, { source: e.source, target: e.target, type: e.type ?? "default" });
  }
  return doc;
}

/**
 * Two-stage image chain:
 *   img1 (completed) → act1 → draft1 (draft) → act2 → draft2 (draft)
 *
 * Both action-badges use nano-banana-2 with real prompts, so adoption can
 * produce valid pending payloads.
 */
function seedTwoStageChain(draft1Status = "draft", draft2Status = "draft"): LoroDoc {
  const actionData = (prompt: string) => ({
    label: prompt.slice(0, 20),
    content: prompt,
    actionType: "image-gen",
    modelId: "nano-banana-2",
    modelParams: { aspect_ratio: "16:9", resolution: "1K", count: 1 },
  });

  return seedDoc(
    [
      { id: "img1", type: "image", data: { label: "Original", status: "completed", src: "img1.png" } },
      { id: "act1", type: "action-badge", data: actionData("stylize as anime") },
      { id: "draft1", type: "image", data: { label: "Stage 1", status: draft1Status } },
      { id: "act2", type: "action-badge", data: actionData("add bokeh") },
      { id: "draft2", type: "image", data: { label: "Stage 2", status: draft2Status } },
    ],
    [
      { id: "e1", source: "img1", target: "act1" },
      { id: "e2", source: "act1", target: "draft1" },
      { id: "e3", source: "draft1", target: "act2" },
      { id: "e4", source: "act2", target: "draft2" },
    ],
  );
}

function readNode(doc: LoroDoc, id: string): NodeInfo | null {
  const canvas = new Canvas(doc, () => {});
  return canvas.readNode(id);
}

/** Deterministic ID allocator for clone tests. */
function makeSequentialIds(prefix = "new"): () => string {
  let i = 0;
  return () => `${prefix}-${++i}`;
}

async function callTool(
  tools: ReturnType<typeof createWorkflowTools>,
  args: Record<string, unknown>,
): Promise<unknown> {
  const raw = await tools.workflow_op.execute!(args as any, { toolCallId: "t", messages: [] } as any);
  // Tool returns either a plain error string or a JSON string.
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

describe("workflow_op", () => {
  let broadcast: BroadcastFn;

  beforeEach(() => {
    broadcast = vi.fn();
  });

  // ─── kind: build ─────────────────────────────────────────────────────

  describe("build", () => {
    it("dry-run returns two-entry plan with correct readyToAdopt flags", async () => {
      const doc = seedTwoStageChain();
      const tools = createWorkflowTools(doc, broadcast, makeSequentialIds("b"));

      const res = (await callTool(tools, { kind: "build", target_node_id: "draft2" })) as any;

      expect(res.kind).toBe("build");
      expect(res.applied).toBe(false);
      expect(res.cycle).toBe(false);
      expect(res.blockers).toEqual([]);
      expect(res.entries).toHaveLength(2);

      // Post-order: deepest ancestor first.
      expect(res.entries[0].draftId).toBe("draft1");
      expect(res.entries[0].readyToAdopt).toBe(true); // img1 is completed
      expect(res.entries[1].draftId).toBe("draft2");
      expect(res.entries[1].readyToAdopt).toBe(false); // draft1 still draft
    });

    it("apply adopts ready drafts and seeds the rest with shared cascadeToken", async () => {
      const doc = seedTwoStageChain();
      const tools = createWorkflowTools(doc, broadcast, makeSequentialIds("b"));

      const res = (await callTool(tools, {
        kind: "build",
        target_node_id: "draft2",
        apply: true,
      })) as any;

      expect(res.applied).toBe(true);
      expect(res.adoptedNow).toEqual(["draft1"]);
      expect(res.seeded).toEqual(["draft2"]);
      expect(res.failed).toEqual([]);
      expect(typeof res.cascadeToken).toBe("string");
      expect(res.cascadeToken.length).toBeGreaterThan(0);

      // Doc state: draft1 adopted to pending, draft2 just flagged.
      const d1 = readNode(doc, "draft1")!;
      expect(d1.data.status).toBe("pending");
      expect(d1.data.cascadeToken).toBe(res.cascadeToken);
      expect(d1.data.runRequested).toBe(false);
      expect(d1.data.prompt).toBe("stylize as anime");
      expect(d1.data.referenceImageUrls).toEqual(["img1.png"]);

      const d2 = readNode(doc, "draft2")!;
      expect(d2.data.status).toBe("draft"); // still draft; cascade runner will adopt later
      expect(d2.data.runRequested).toBe(true);
      expect(d2.data.cascadeToken).toBe(res.cascadeToken);

      // Mutations broadcast for downstream sync.
      expect(broadcast).toHaveBeenCalled();
    });

    it("blockers prevent apply when action has no prompt", async () => {
      const doc = seedTwoStageChain();
      // Strip prompt from act1.
      doc.getMap("nodes").set("act1", {
        type: "action-badge",
        data: { label: "X", content: "", actionType: "image-gen", modelId: "nano-banana-2", modelParams: {} },
        position: { x: 0, y: 0 },
      });
      const tools = createWorkflowTools(doc, broadcast, makeSequentialIds("b"));

      const res = (await callTool(tools, {
        kind: "build",
        target_node_id: "draft2",
        apply: true,
      })) as string;

      // Apply with blockers returns plain error string.
      expect(typeof res).toBe("string");
      expect(res).toMatch(/Cannot apply/);
      expect(res).toMatch(/no prompt/i);

      // Doc untouched.
      const d1 = readNode(doc, "draft1")!;
      expect(d1.data.status).toBe("draft");
      expect(d1.data.runRequested).toBeUndefined();
    });

    it("returns 'nothing to build' when target is already completed", async () => {
      const doc = seedTwoStageChain("completed", "completed");
      const tools = createWorkflowTools(doc, broadcast, makeSequentialIds("b"));

      const res = (await callTool(tools, { kind: "build", target_node_id: "draft2" })) as any;
      expect(res.entries).toEqual([]);
      expect(res.warnings.some((w: string) => w.includes("Nothing to build"))).toBe(true);
    });

    it("errors on unknown target", async () => {
      const doc = seedTwoStageChain();
      const tools = createWorkflowTools(doc, broadcast, makeSequentialIds("b"));

      const res = (await callTool(tools, { kind: "build", target_node_id: "ghost" })) as string;
      expect(res).toMatch(/not found/);
    });
  });

  // ─── kind: clone ─────────────────────────────────────────────────────

  describe("clone", () => {
    /** Chain where both outputs are completed, suitable for cloning. */
    function seedCompletedChain(): LoroDoc {
      const doc = seedTwoStageChain();
      doc.getMap("nodes").set("draft1", {
        type: "image",
        data: { label: "Stage 1", status: "completed", src: "d1.png" },
        position: { x: 0, y: 0 },
      });
      doc.getMap("nodes").set("draft2", {
        type: "image",
        data: { label: "Stage 2", status: "completed", src: "d2.png" },
        position: { x: 0, y: 0 },
      });
      return doc;
    }

    it("dry-run enumerates trajectory and per-action droppability", async () => {
      const doc = seedCompletedChain();
      const tools = createWorkflowTools(doc, broadcast, makeSequentialIds("c"));

      const res = (await callTool(tools, { kind: "clone", target_node_id: "draft2" })) as any;

      expect(res.applied).toBe(false);
      expect(res.totalNodes).toBe(5);
      expect(res.heads).toEqual(["img1"]);
      expect(new Set(res.cloneset)).toEqual(new Set(["act1", "draft1", "act2", "draft2"]));

      expect(res.actions).toHaveLength(2);
      const byId = Object.fromEntries(res.actions.map((a: any) => [a.actionId, a]));
      // act1: dropping would orphan img1 as root, but img1 is completed → OK
      expect(byId.act1.droppable).toBe(true);
      expect(byId.act1.outputNodeId).toBe("draft1");
      // act2: dropping would leave draft1 as root; draft1 is completed → OK
      expect(byId.act2.droppable).toBe(true);
      expect(byId.act2.outputNodeId).toBe("draft2");
    });

    it("apply forks every subgraph node + edge under fresh IDs", async () => {
      const doc = seedCompletedChain();
      const tools = createWorkflowTools(doc, broadcast, makeSequentialIds("c"));

      const res = (await callTool(tools, {
        kind: "clone",
        target_node_id: "draft2",
        apply: true,
      })) as any;

      expect(res.applied).toBe(true);
      expect(res.createdNodes).toHaveLength(5);
      expect(res.createdEdges).toHaveLength(4);
      expect(res.newLeafId).toBe(res.idMap["draft2"]);

      // Original nodes untouched.
      expect(readNode(doc, "draft2")!.data.status).toBe("completed");
      expect(readNode(doc, "draft2")!.data.src).toBe("d2.png");

      // Head clone retains src.
      const clonedImg1 = readNode(doc, res.idMap["img1"])!;
      expect(clonedImg1.type).toBe("image");
      expect(clonedImg1.data.status).toBe("completed");
      expect(clonedImg1.data.src).toBe("img1.png");

      // Cloneset outputs are reset to drafts with src stripped.
      const clonedLeaf = readNode(doc, res.newLeafId)!;
      expect(clonedLeaf.type).toBe("image");
      expect(clonedLeaf.data.status).toBe("draft");
      expect(clonedLeaf.data.src).toBe("");
      expect(clonedLeaf.data.assetId).toBeUndefined();
    });

    it("drop_action_ids prunes upstream stages and promotes outputs to heads", async () => {
      const doc = seedCompletedChain();
      const tools = createWorkflowTools(doc, broadcast, makeSequentialIds("c"));

      const res = (await callTool(tools, {
        kind: "clone",
        target_node_id: "draft2",
        drop_action_ids: ["act1"],
        apply: true,
      })) as any;

      expect(res.applied).toBe(true);
      expect(res.dropsApplied).toEqual(["act1"]);
      expect(res.newHeadsFromDrops).toEqual(["draft1"]);
      // Pruned: act1, img1. Kept: act2, draft1, draft2. 3 nodes + 2 edges.
      expect(res.createdNodes).toHaveLength(3);
      expect(res.createdEdges).toHaveLength(2);

      // draft1's clone is a HEAD (status completed, src preserved).
      const clonedDraft1 = readNode(doc, res.idMap["draft1"])!;
      expect(clonedDraft1.data.status).toBe("completed");
      expect(clonedDraft1.data.src).toBe("d1.png");

      // act1 and img1 were NOT cloned.
      expect(res.idMap["act1"]).toBeUndefined();
      expect(res.idMap["img1"]).toBeUndefined();
    });

    it("rejects drop that would leave an incomplete draft as root", async () => {
      // Chain where draft1 is still a draft — dropping act1 would promote it
      // to head, but a draft isn't valid head material.
      const doc = seedTwoStageChain("draft", "completed");
      // Mark draft2 completed so clone makes sense.
      doc.getMap("nodes").set("draft2", {
        type: "image",
        data: { label: "Stage 2", status: "completed", src: "d2.png" },
        position: { x: 0, y: 0 },
      });
      const tools = createWorkflowTools(doc, broadcast, makeSequentialIds("c"));

      const res = (await callTool(tools, { kind: "clone", target_node_id: "draft2" })) as any;
      const byId = Object.fromEntries(res.actions.map((a: any) => [a.actionId, a]));
      expect(byId.act1.droppable).toBe(false);
      expect(byId.act1.reason).toMatch(/must be completed/i);

      // Attempting to apply the drop fails hard.
      const applied = (await callTool(tools, {
        kind: "clone",
        target_node_id: "draft2",
        drop_action_ids: ["act1"],
        apply: true,
      })) as string;
      expect(typeof applied).toBe("string");
      expect(applied).toMatch(/must be completed/i);
    });

    it("errors when drop_action_id is not in trajectory or not an action-badge", async () => {
      const doc = seedCompletedChain();
      const tools = createWorkflowTools(doc, broadcast, makeSequentialIds("c"));

      const notInTraj = (await callTool(tools, {
        kind: "clone",
        target_node_id: "draft2",
        drop_action_ids: ["ghost"],
        apply: true,
      })) as string;
      expect(notInTraj).toMatch(/not in the trajectory/);

      const wrongType = (await callTool(tools, {
        kind: "clone",
        target_node_id: "draft2",
        drop_action_ids: ["img1"],
        apply: true,
      })) as string;
      expect(wrongType).toMatch(/not an action-badge/);
    });
  });

  // ─── kind: adopt ─────────────────────────────────────────────────────

  describe("adopt", () => {
    /** Single-stage chain where act1's only ref (img1) is already completed. */
    function seedSingleStageReady(): LoroDoc {
      return seedDoc(
        [
          { id: "img1", type: "image", data: { label: "Ref", status: "completed", src: "img1.png" } },
          {
            id: "act1",
            type: "action-badge",
            data: {
              label: "P",
              content: "a photo",
              actionType: "image-gen",
              modelId: "nano-banana-2",
              modelParams: { aspect_ratio: "16:9", resolution: "1K", count: 1 },
            },
          },
          { id: "draft1", type: "image", data: { label: "Out", status: "draft" } },
        ],
        [
          { id: "e1", source: "img1", target: "act1" },
          { id: "e2", source: "act1", target: "draft1" },
        ],
      );
    }

    it("dry-run reports refs ready and payload preview ok", async () => {
      const doc = seedSingleStageReady();
      const tools = createWorkflowTools(doc, broadcast, makeSequentialIds("a"));

      const res = (await callTool(tools, { kind: "adopt", target_node_id: "draft1" })) as any;

      expect(res.applied).toBe(false);
      expect(res.allRefsReady).toBe(true);
      expect(res.payloadPreviewOk).toBe(true);
      expect(res.payloadType).toBe("image");
      expect(res.refs).toEqual([{ id: "img1", status: "completed" }]);
    });

    it("apply flips draft to pending with prompt + refs populated", async () => {
      const doc = seedSingleStageReady();
      const tools = createWorkflowTools(doc, broadcast, makeSequentialIds("a"));

      const res = (await callTool(tools, {
        kind: "adopt",
        target_node_id: "draft1",
        apply: true,
      })) as any;

      expect(res.applied).toBe(true);
      expect(res.adopted).toBe(true);

      const d1 = readNode(doc, "draft1")!;
      expect(d1.data.status).toBe("pending");
      expect(d1.data.prompt).toBe("a photo");
      expect(d1.data.referenceImageUrls).toEqual(["img1.png"]);
      expect(d1.data.modelId).toBe("nano-banana-2");
    });

    it("rejects adopt when an upstream ref isn't completed", async () => {
      const doc = seedTwoStageChain(); // draft1 is draft; refs of act2 include draft1
      const tools = createWorkflowTools(doc, broadcast, makeSequentialIds("a"));

      const dry = (await callTool(tools, { kind: "adopt", target_node_id: "draft2" })) as any;
      expect(dry.allRefsReady).toBe(false);
      expect(dry.refs).toEqual([{ id: "draft1", status: "draft" }]);

      const applied = (await callTool(tools, {
        kind: "adopt",
        target_node_id: "draft2",
        apply: true,
      })) as any;
      expect(applied.applied).toBe(true); // apply mode entered
      expect(applied.adopted).toBe(false);
      expect(applied.error).toMatch(/not completed/i);
    });

    it("errors on non-draft target", async () => {
      const doc = seedTwoStageChain("completed");
      const tools = createWorkflowTools(doc, broadcast, makeSequentialIds("a"));

      const res = (await callTool(tools, { kind: "adopt", target_node_id: "draft1" })) as string;
      expect(res).toMatch(/not a draft/);
    });
  });
});
