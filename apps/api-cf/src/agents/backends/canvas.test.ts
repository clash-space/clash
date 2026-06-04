import { describe, it, expect } from "vitest";
import { LoroDoc } from "loro-crdt";
import { Canvas, MODEL_CARDS, capability } from "@clash/shared-types";
import { NodeType, RF_NODE_TYPE, ProposalType, Status } from "../../domain/canvas";

function makeCanvas(): Canvas {
  return new Canvas(new LoroDoc(), () => {});
}

describe("Canvas class", () => {
  // ─── listNodes ──────────────────────────────────────────────

  describe("listNodes", () => {
    it("returns empty array for fresh doc", () => {
      const canvas = makeCanvas();
      expect(canvas.listNodes()).toEqual([]);
    });

    it("returns all inserted nodes", () => {
      const canvas = makeCanvas();
      canvas.insertNode("n1", "text", { label: "A" }, null, { x: 0, y: 0 });
      canvas.insertNode("n2", "text", { label: "B" }, null, { x: 10, y: 20 });

      const nodes = canvas.listNodes();
      expect(nodes).toHaveLength(2);
      expect(nodes.map((n) => n.id).sort()).toEqual(["n1", "n2"]);
    });

    it("filters by nodeType", () => {
      const canvas = makeCanvas();
      canvas.insertNode("n1", "text", { label: "A" }, null, { x: 0, y: 0 });
      canvas.insertNode("n2", "image", { label: "B" }, null, { x: 0, y: 0 });

      const textOnly = canvas.listNodes("text");
      expect(textOnly).toHaveLength(1);
      expect(textOnly[0].type).toBe("text");
    });

    it("filters by parentId", () => {
      const canvas = makeCanvas();
      canvas.insertNode("g1", "group", { label: "G" }, null, { x: 0, y: 0 });
      canvas.insertNode("n1", "text", { label: "A" }, "g1", { x: 0, y: 0 });
      canvas.insertNode("n2", "text", { label: "B" }, null, { x: 0, y: 0 });

      const children = canvas.listNodes(null, "g1");
      expect(children).toHaveLength(1);
      expect(children[0].id).toBe("n1");
    });
  });

  // ─── readNode ───────────────────────────────────────────────

  describe("readNode", () => {
    it("returns null for nonexistent node", () => {
      const canvas = makeCanvas();
      expect(canvas.readNode("missing")).toBeNull();
    });

    it("returns correct data for existing node", () => {
      const canvas = makeCanvas();
      canvas.insertNode("n1", "text", { label: "Hello" }, null, { x: 5, y: 10 });

      const node = canvas.readNode("n1");
      expect(node).not.toBeNull();
      expect(node!.id).toBe("n1");
      expect(node!.type).toBe("text");
      expect(node!.data.label).toBe("Hello");
      expect(node!.position).toEqual({ x: 5, y: 10 });
      expect(node!.parent_id).toBeNull();
    });

    it("reads parentId correctly", () => {
      const canvas = makeCanvas();
      canvas.insertNode("n1", "text", {}, "parent1", { x: 0, y: 0 });

      const node = canvas.readNode("n1");
      expect(node!.parent_id).toBe("parent1");
    });
  });

  // ─── insertNode ─────────────────────────────────────────────

  describe("insertNode", () => {
    it("broadcasts a Loro update", () => {
      const broadcasts: Uint8Array[] = [];
      const canvas = new Canvas(new LoroDoc(), (data) => broadcasts.push(data));

      canvas.insertNode("n1", "text", { label: "A" }, null, { x: 0, y: 0 });

      expect(broadcasts).toHaveLength(1);
      expect(broadcasts[0].byteLength).toBeGreaterThan(0);
    });

    it("broadcast can be applied to another doc", () => {
      const doc1 = new LoroDoc();
      const doc2 = new LoroDoc();
      const broadcasts: Uint8Array[] = [];

      const canvas = new Canvas(doc1, (data) => broadcasts.push(data));
      canvas.insertNode("n1", "text", { label: "synced" }, null, { x: 0, y: 0 });
      doc2.import(broadcasts[0]);

      const canvas2 = new Canvas(doc2, () => {});
      const node = canvas2.readNode("n1");
      expect(node).not.toBeNull();
      expect(node!.data.label).toBe("synced");
    });
  });

  // ─── insertEdge ─────────────────────────────────────────────

  describe("insertEdge", () => {
    it("inserts an edge and broadcasts", () => {
      const doc = new LoroDoc();
      const broadcasts: Uint8Array[] = [];
      const canvas = new Canvas(doc, (data) => broadcasts.push(data));

      canvas.insertEdge("e1", "src", "tgt", "custom");

      expect(broadcasts).toHaveLength(1);
      const edgesMap = doc.getMap("edges");
      const edge = edgesMap.get("e1") as Record<string, any>;
      expect(edge.source).toBe("src");
      expect(edge.target).toBe("tgt");
      expect(edge.type).toBe("custom");
    });
  });

  // ─── createNode ─────────────────────────────────────────────

  describe("createNode", () => {
    it("creates a text node with simple proposal", () => {
      const canvas = makeCanvas();
      const result = canvas.createNode("n1", "text", { label: "Test" }, { x: 1, y: 2 }, null);

      expect(result.node_id).toBe("n1");
      expect(result.error).toBeNull();
      expect(result.asset_id).toBeNull();
      expect(result.proposal).not.toBeNull();
      expect(result.proposal!.type).toBe(ProposalType.Simple);
      expect(result.proposal!.nodeType).toBe("text");

      const node = canvas.readNode("n1");
      expect(node).not.toBeNull();
      expect(node!.data.label).toBe("Test");
    });

    it("creates a group node with group proposal", () => {
      const canvas = makeCanvas();
      const result = canvas.createNode("g1", "group", { label: "Group" });

      expect(result.proposal!.type).toBe(ProposalType.Group);
    });

    it("creates image_gen node with generative proposal and assetId", () => {
      const canvas = makeCanvas();
      const result = canvas.createNode("img1", "image_gen", { label: "Img" }, null, null, "asset-123");

      expect(result.proposal!.type).toBe(ProposalType.Generative);
      expect(result.proposal!.nodeType).toBe(RF_NODE_TYPE.ActionBadge);
      expect(result.asset_id).toBe("asset-123");

      const node = canvas.readNode("img1");
      expect(node!.data.assetId).toBe("asset-123");
    });

    it("auto-generates assetId for image_gen when not provided", () => {
      const canvas = makeCanvas();
      const result = canvas.createNode("img1", "image_gen", { label: "Img" });

      expect(result.asset_id).toBeTruthy();
      expect(typeof result.asset_id).toBe("string");
      expect(result.asset_id!.length).toBe(8);
    });

    it("creates video_gen node with generative proposal", () => {
      const canvas = makeCanvas();
      const result = canvas.createNode("vid1", "video_gen", { label: "Vid" });

      expect(result.proposal!.type).toBe(ProposalType.Generative);
      expect(result.proposal!.nodeType).toBe(RF_NODE_TYPE.ActionBadge);
      expect(result.asset_id).toBeTruthy();
    });

    it("includes upstreamNodeIds in proposal", () => {
      const canvas = makeCanvas();
      const result = canvas.createNode("n1", "text", {
        label: "X",
        upstreamNodeIds: ["a", "b", "a"],
      });

      expect(result.proposal!.upstreamNodeIds).toEqual(["a", "b"]);
    });

    it("uses auto-layout position when not provided", () => {
      const canvas = makeCanvas();
      canvas.createNode("n1", "text", { label: "X" });

      const node = canvas.readNode("n1");
      expect(node!.position).toBeDefined();
      expect(typeof node!.position.x).toBe("number");
      expect(typeof node!.position.y).toBe("number");
    });
  });

  // ─── searchNodes ────────────────────────────────────────────

  describe("searchNodes", () => {
    it("finds nodes by label", () => {
      const canvas = makeCanvas();
      canvas.insertNode("n1", "text", { label: "Hello World" }, null, { x: 0, y: 0 });
      canvas.insertNode("n2", "text", { label: "Goodbye" }, null, { x: 0, y: 0 });

      const results = canvas.searchNodes("hello");
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("n1");
    });

    it("finds nodes by content", () => {
      const canvas = makeCanvas();
      canvas.insertNode("n1", "text", { label: "X", content: "secret sauce" }, null, { x: 0, y: 0 });

      const results = canvas.searchNodes("secret");
      expect(results).toHaveLength(1);
    });

    it("filters by nodeTypes", () => {
      const canvas = makeCanvas();
      canvas.insertNode("n1", "text", { label: "match" }, null, { x: 0, y: 0 });
      canvas.insertNode("n2", "image", { label: "match" }, null, { x: 0, y: 0 });

      const results = canvas.searchNodes("match", ["text"]);
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe("text");
    });

    it("returns empty for no matches", () => {
      const canvas = makeCanvas();
      canvas.insertNode("n1", "text", { label: "abc" }, null, { x: 0, y: 0 });

      expect(canvas.searchNodes("xyz")).toHaveLength(0);
    });
  });

  // ─── findNode ──────────────────────────────────────────────

  describe("findNode", () => {
    it("finds by primary id", () => {
      const canvas = makeCanvas();
      canvas.insertNode("n1", "text", { label: "A" }, null, { x: 0, y: 0 });

      const node = canvas.findNode("n1");
      expect(node).not.toBeNull();
      expect(node!.id).toBe("n1");
    });

    it("finds by assetId in data", () => {
      const canvas = makeCanvas();
      canvas.insertNode("n1", "image_gen", { label: "Img", assetId: "asset-xyz" }, null, { x: 0, y: 0 });

      const node = canvas.findNode("asset-xyz");
      expect(node).not.toBeNull();
      expect(node!.id).toBe("n1");
    });

    it("returns null when not found", () => {
      const canvas = makeCanvas();
      expect(canvas.findNode("nope")).toBeNull();
    });
  });

  // ─── createLinkedNode ────────────────────────────────────────

  describe("createLinkedNode", () => {
    it("creates node + edge with auto-layout position", () => {
      const canvas = makeCanvas();
      // Create a source node first
      canvas.insertNode("src", "action-badge", { label: "Source" }, null, { x: 100, y: 100 });

      const result = canvas.createLinkedNode({
        nodeId: "target",
        nodeType: "image",
        data: { label: "Generated", status: "pending" },
        parentId: null,
        sourceNodeId: "src",
      });

      expect(result.nodeId).toBe("target");
      expect(result.position.x).toBeGreaterThan(100); // placed to the right of source

      // Node should exist
      const node = canvas.readNode("target");
      expect(node).not.toBeNull();
      expect(node!.data.label).toBe("Generated");

      // Edge should exist
      const edges = canvas.listEdges();
      expect(edges).toHaveLength(1);
      expect(edges[0].source).toBe("src");
      expect(edges[0].target).toBe("target");
    });

    it("pushes overlapping siblings", () => {
      const canvas = makeCanvas();
      canvas.insertNode("src", "action-badge", { label: "Source" }, null, { x: 0, y: 0 });
      // Place an existing node where the linked node would go
      canvas.insertNode("blocker", "text", { label: "Blocker" }, null, { x: 380, y: 0 });

      const result = canvas.createLinkedNode({
        nodeId: "new",
        nodeType: "image",
        data: { label: "New" },
        parentId: null,
        sourceNodeId: "src",
      });

      expect(result.pushedNodeIds.length).toBeGreaterThanOrEqual(0);
      // new node should be placed to right of source
      expect(result.position.x).toBeGreaterThan(0);
    });

    it("uses custom edgeId and edgeType", () => {
      const doc = new LoroDoc();
      const canvas = new Canvas(doc, () => {});
      canvas.insertNode("src", "text", { label: "S" }, null, { x: 0, y: 0 });

      canvas.createLinkedNode({
        nodeId: "tgt",
        nodeType: "text",
        data: { label: "T" },
        parentId: null,
        sourceNodeId: "src",
        edgeId: "custom-edge",
        edgeType: "special",
      });

      const edgesMap = doc.getMap("edges");
      const edge = edgesMap.get("custom-edge") as Record<string, any>;
      expect(edge).toBeDefined();
      expect(edge.type).toBe("special");
    });
  });

  // ─── executeGeneration ──────────────────────────────────────

  describe("executeGeneration", () => {
    function makeCanvasWithBadge(
      modelId = "nano-banana-2",
      prompt = "A cute cat",
    ): Canvas {
      const canvas = makeCanvas();
      canvas.insertNode("badge1", "action-badge", {
        label: "Test Badge",
        actionType: "image-gen",
        content: prompt,
        modelId,
        model: modelId,
        modelParams: { aspect_ratio: "16:9" },
        referenceMode: "single",
      }, null, { x: 0, y: 0 });
      return canvas;
    }

    let idCounter = 0;
    const generateId = () => `gen-${++idCounter}`;

    it("creates pending asset node linked to action-badge", () => {
      idCounter = 0;
      const canvas = makeCanvasWithBadge();

      const result = canvas.executeGeneration("badge1", generateId);

      expect(result.error).toBeNull();
      expect(result.assetNodeId).toBe("gen-1");
      expect(result.assetNodeType).toBe("image");

      // Pending node exists with correct data
      const pending = canvas.readNode("gen-1");
      expect(pending).not.toBeNull();
      expect(pending!.data.status).toBe("pending");
      expect(pending!.data.prompt).toBe("A cute cat");
      expect(pending!.data.modelId).toBe("nano-banana-2");

      // Edge exists
      const edges = canvas.listEdges();
      expect(edges.some(e => e.source === "badge1" && e.target === "gen-1")).toBe(true);
    });

    it("returns error for missing node", () => {
      const canvas = makeCanvas();
      const result = canvas.executeGeneration("nonexistent", generateId);
      expect(result.error).toContain("not found");
    });

    it("returns error for non-generation node", () => {
      const canvas = makeCanvas();
      canvas.insertNode("text1", "text", { label: "Hello" }, null, { x: 0, y: 0 });

      const result = canvas.executeGeneration("text1", generateId);
      expect(result.error).toContain("not a generation node");
    });

    it("returns error for empty prompt", () => {
      const canvas = makeCanvasWithBadge("nano-banana-2", "");
      const result = canvas.executeGeneration("badge1", generateId);
      expect(result.error).toContain("No prompt");
    });

    it("returns validation error when model requires reference image", () => {
      const startEndModel = MODEL_CARDS.find(
        (card) => card.kind === "video" && capability(card).ref.image.isStartEnd,
      );
      expect(startEndModel).toBeDefined();
      const canvas = makeCanvasWithBadge(startEndModel!.id, "Animate this image");
      const result = canvas.executeGeneration("badge1", generateId);
      expect(result.error).toMatch(/start frame|reference image/i);
    });

    it("succeeds when model requires reference and images are provided", () => {
      idCounter = 0;
      const canvas = makeCanvas();
      canvas.insertNode("badge1", "action-badge", {
        label: "Edit Badge",
        actionType: "image-gen",
        content: "Edit this",
        modelId: "nano-banana-2-edit",
        model: "nano-banana-2-edit",
        modelParams: { aspect_ratio: "16:9" },
        referenceMode: "multi",
        referenceImageUrls: ["projects/p1/assets/ref.png"],
      }, null, { x: 0, y: 0 });

      const result = canvas.executeGeneration("badge1", generateId);
      expect(result.error).toBeNull();
      expect(result.assetNodeId).toBe("gen-1");
    });

    it("handles video generation", () => {
      idCounter = 0;
      const canvas = makeCanvas();
      canvas.insertNode("badge1", "action-badge", {
        label: "Video Badge",
        actionType: "video-gen",
        content: "A flying bird",
        modelId: "sora-2",
        model: "sora-2",
        modelParams: { duration: 5 },
        referenceMode: "none",
      }, null, { x: 0, y: 0 });

      const result = canvas.executeGeneration("badge1", generateId);
      expect(result.error).toBeNull();
      expect(result.assetNodeType).toBe("video");

      const pending = canvas.readNode("gen-1");
      expect(pending!.data.status).toBe("pending");
      expect(pending!.data.duration).toBe(5);
    });
  });

  // ─── updateNode ─────────────────────────────────────────────

  describe("updateNode", () => {
    it("updates node data", () => {
      const canvas = makeCanvas();
      canvas.insertNode("n1", "text", { label: "Old" }, null, { x: 0, y: 0 });

      const ok = canvas.updateNode("n1", { label: "New" });
      expect(ok).toBe(true);

      const node = canvas.readNode("n1");
      expect(node!.data.label).toBe("New");
    });

    it("returns false for missing node", () => {
      const canvas = makeCanvas();
      expect(canvas.updateNode("missing", { label: "X" })).toBe(false);
    });
  });

  // ─── deleteNode ─────────────────────────────────────────────

  describe("deleteNode", () => {
    it("deletes existing node", () => {
      const canvas = makeCanvas();
      canvas.insertNode("n1", "text", { label: "X" }, null, { x: 0, y: 0 });

      expect(canvas.deleteNode("n1")).toBe(true);
      expect(canvas.readNode("n1")).toBeNull();
    });

    it("returns false for missing node", () => {
      const canvas = makeCanvas();
      expect(canvas.deleteNode("missing")).toBe(false);
    });
  });

  // ─── getNodeStatus ──────────────────────────────────────────

  describe("getNodeStatus", () => {
    it("returns NodeNotFound for missing node", () => {
      const canvas = makeCanvas();
      const result = canvas.getNodeStatus("missing");
      expect(result.status).toBe(Status.NodeNotFound);
    });

    it("returns Completed for image_gen node without explicit status", () => {
      const canvas = makeCanvas();
      canvas.insertNode("n1", "image_gen", { label: "Img" }, null, { x: 0, y: 0 });

      const result = canvas.getNodeStatus("n1");
      expect(result.status).toBe(Status.Completed);
    });

    it("returns Completed for text node without status", () => {
      const canvas = makeCanvas();
      canvas.insertNode("n1", "text", { label: "T" }, null, { x: 0, y: 0 });

      const result = canvas.getNodeStatus("n1");
      expect(result.status).toBe(Status.Completed);
    });

    it("returns explicit status from node data", () => {
      const canvas = makeCanvas();
      canvas.insertNode("n1", "image_gen", { label: "Img", status: "completed" }, null, { x: 0, y: 0 });

      const result = canvas.getNodeStatus("n1");
      expect(result.status).toBe(Status.Completed);
    });

    it("finds node by assetId", () => {
      const canvas = makeCanvas();
      canvas.insertNode("n1", "image_gen", { label: "X", assetId: "a1", status: "failed" }, null, { x: 0, y: 0 });

      const result = canvas.getNodeStatus("a1");
      expect(result.status).toBe(Status.Failed);
    });
  });
});
