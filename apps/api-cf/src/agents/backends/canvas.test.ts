import { describe, it, expect, vi } from "vitest";
import { LoroDoc } from "loro-crdt";
import {
  listNodes,
  readNode,
  insertNode,
  insertEdge,
  createNode,
  searchNodes,
  findNodeByIdOrAssetId,
  getNodeStatus,
} from "./canvas";
import { NodeType, FrontendNodeType, ProposalType, Status } from "../../domain/canvas";

function makeDoc(): LoroDoc {
  return new LoroDoc();
}

const noop: (data: Uint8Array) => void = () => {};

describe("canvas backend (Loro)", () => {
  // ─── listNodes ──────────────────────────────────────────────

  describe("listNodes", () => {
    it("returns empty array for fresh doc", () => {
      const doc = makeDoc();
      expect(listNodes(doc)).toEqual([]);
    });

    it("returns all inserted nodes", () => {
      const doc = makeDoc();
      insertNode(doc, noop, "n1", "text", { label: "A" }, null, { x: 0, y: 0 });
      insertNode(doc, noop, "n2", "prompt", { label: "B" }, null, { x: 10, y: 20 });

      const nodes = listNodes(doc);
      expect(nodes).toHaveLength(2);
      expect(nodes.map((n) => n.id).sort()).toEqual(["n1", "n2"]);
    });

    it("filters by nodeType", () => {
      const doc = makeDoc();
      insertNode(doc, noop, "n1", "text", { label: "A" }, null, { x: 0, y: 0 });
      insertNode(doc, noop, "n2", "prompt", { label: "B" }, null, { x: 0, y: 0 });

      const textOnly = listNodes(doc, "text");
      expect(textOnly).toHaveLength(1);
      expect(textOnly[0].type).toBe("text");
    });

    it("filters by parentId", () => {
      const doc = makeDoc();
      insertNode(doc, noop, "g1", "group", { label: "G" }, null, { x: 0, y: 0 });
      insertNode(doc, noop, "n1", "text", { label: "A" }, "g1", { x: 0, y: 0 });
      insertNode(doc, noop, "n2", "text", { label: "B" }, null, { x: 0, y: 0 });

      const children = listNodes(doc, null, "g1");
      expect(children).toHaveLength(1);
      expect(children[0].id).toBe("n1");
    });
  });

  // ─── readNode ───────────────────────────────────────────────

  describe("readNode", () => {
    it("returns null for nonexistent node", () => {
      const doc = makeDoc();
      expect(readNode(doc, "missing")).toBeNull();
    });

    it("returns correct data for existing node", () => {
      const doc = makeDoc();
      insertNode(doc, noop, "n1", "text", { label: "Hello" }, null, { x: 5, y: 10 });

      const node = readNode(doc, "n1");
      expect(node).not.toBeNull();
      expect(node!.id).toBe("n1");
      expect(node!.type).toBe("text");
      expect(node!.data.label).toBe("Hello");
      expect(node!.position).toEqual({ x: 5, y: 10 });
      expect(node!.parent_id).toBeNull();
    });

    it("reads parentId correctly", () => {
      const doc = makeDoc();
      insertNode(doc, noop, "n1", "text", {}, "parent1", { x: 0, y: 0 });

      const node = readNode(doc, "n1");
      expect(node!.parent_id).toBe("parent1");
    });
  });

  // ─── insertNode ─────────────────────────────────────────────

  describe("insertNode", () => {
    it("broadcasts a Loro update", () => {
      const doc = makeDoc();
      const broadcasts: Uint8Array[] = [];
      const broadcast = (data: Uint8Array) => broadcasts.push(data);

      insertNode(doc, broadcast, "n1", "text", { label: "A" }, null, { x: 0, y: 0 });

      expect(broadcasts).toHaveLength(1);
      expect(broadcasts[0].byteLength).toBeGreaterThan(0);
    });

    it("broadcast can be applied to another doc", () => {
      const doc1 = makeDoc();
      const doc2 = makeDoc();
      const broadcasts: Uint8Array[] = [];

      insertNode(doc1, (data) => broadcasts.push(data), "n1", "text", { label: "synced" }, null, { x: 0, y: 0 });
      doc2.import(broadcasts[0]);

      const node = readNode(doc2, "n1");
      expect(node).not.toBeNull();
      expect(node!.data.label).toBe("synced");
    });
  });

  // ─── insertEdge ─────────────────────────────────────────────

  describe("insertEdge", () => {
    it("inserts an edge and broadcasts", () => {
      const doc = makeDoc();
      const broadcasts: Uint8Array[] = [];

      insertEdge(doc, (data) => broadcasts.push(data), "e1", "src", "tgt", "custom");

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
      const doc = makeDoc();
      const result = createNode(doc, noop, "n1", "text", { label: "Test" }, { x: 1, y: 2 }, null);

      expect(result.node_id).toBe("n1");
      expect(result.error).toBeNull();
      expect(result.asset_id).toBeNull();
      expect(result.proposal).not.toBeNull();
      expect(result.proposal!.type).toBe(ProposalType.Simple);
      expect(result.proposal!.nodeType).toBe("text");

      // Node should exist in doc
      const node = readNode(doc, "n1");
      expect(node).not.toBeNull();
      expect(node!.data.label).toBe("Test");
    });

    it("creates a group node with group proposal", () => {
      const doc = makeDoc();
      const result = createNode(doc, noop, "g1", "group", { label: "Group" });

      expect(result.proposal!.type).toBe(ProposalType.Group);
    });

    it("creates image_gen node with generative proposal and assetId", () => {
      const doc = makeDoc();
      const result = createNode(doc, noop, "img1", "image_gen", { label: "Img" }, null, null, "asset-123");

      expect(result.proposal!.type).toBe(ProposalType.Generative);
      expect(result.proposal!.nodeType).toBe(FrontendNodeType.ImageGen);
      expect(result.asset_id).toBe("asset-123");

      // assetId stored in node data
      const node = readNode(doc, "img1");
      expect(node!.data.assetId).toBe("asset-123");
    });

    it("auto-generates assetId for image_gen when not provided", () => {
      const doc = makeDoc();
      const result = createNode(doc, noop, "img1", "image_gen", { label: "Img" });

      expect(result.asset_id).toBeTruthy();
      expect(typeof result.asset_id).toBe("string");
      expect(result.asset_id!.length).toBe(8);
    });

    it("creates video_gen node with generative proposal", () => {
      const doc = makeDoc();
      const result = createNode(doc, noop, "vid1", "video_gen", { label: "Vid" });

      expect(result.proposal!.type).toBe(ProposalType.Generative);
      expect(result.proposal!.nodeType).toBe(FrontendNodeType.VideoGen);
      expect(result.asset_id).toBeTruthy();
    });

    it("includes upstreamNodeIds in proposal", () => {
      const doc = makeDoc();
      const result = createNode(doc, noop, "n1", "text", {
        label: "X",
        upstreamNodeIds: ["a", "b", "a"],
      });

      // Deduplicated
      expect(result.proposal!.upstreamNodeIds).toEqual(["a", "b"]);
    });

    it("uses auto-layout position when not provided", () => {
      const doc = makeDoc();
      createNode(doc, noop, "n1", "text", { label: "X" });

      const node = readNode(doc, "n1");
      expect(node!.position).toBeDefined();
      expect(typeof node!.position.x).toBe("number");
      expect(typeof node!.position.y).toBe("number");
    });
  });

  // ─── searchNodes ────────────────────────────────────────────

  describe("searchNodes", () => {
    it("finds nodes by label", () => {
      const doc = makeDoc();
      insertNode(doc, noop, "n1", "text", { label: "Hello World" }, null, { x: 0, y: 0 });
      insertNode(doc, noop, "n2", "text", { label: "Goodbye" }, null, { x: 0, y: 0 });

      const results = searchNodes(doc, "hello");
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("n1");
    });

    it("finds nodes by content", () => {
      const doc = makeDoc();
      insertNode(doc, noop, "n1", "text", { label: "X", content: "secret sauce" }, null, { x: 0, y: 0 });

      const results = searchNodes(doc, "secret");
      expect(results).toHaveLength(1);
    });

    it("filters by nodeTypes", () => {
      const doc = makeDoc();
      insertNode(doc, noop, "n1", "text", { label: "match" }, null, { x: 0, y: 0 });
      insertNode(doc, noop, "n2", "prompt", { label: "match" }, null, { x: 0, y: 0 });

      const results = searchNodes(doc, "match", ["prompt"]);
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe("prompt");
    });

    it("returns empty for no matches", () => {
      const doc = makeDoc();
      insertNode(doc, noop, "n1", "text", { label: "abc" }, null, { x: 0, y: 0 });

      expect(searchNodes(doc, "xyz")).toHaveLength(0);
    });
  });

  // ─── findNodeByIdOrAssetId ──────────────────────────────────

  describe("findNodeByIdOrAssetId", () => {
    it("finds by primary id", () => {
      const doc = makeDoc();
      insertNode(doc, noop, "n1", "text", { label: "A" }, null, { x: 0, y: 0 });

      const node = findNodeByIdOrAssetId(doc, "n1");
      expect(node).not.toBeNull();
      expect(node!.id).toBe("n1");
    });

    it("finds by assetId in data", () => {
      const doc = makeDoc();
      insertNode(doc, noop, "n1", "image_gen", { label: "Img", assetId: "asset-xyz" }, null, { x: 0, y: 0 });

      const node = findNodeByIdOrAssetId(doc, "asset-xyz");
      expect(node).not.toBeNull();
      expect(node!.id).toBe("n1");
    });

    it("returns null when not found", () => {
      const doc = makeDoc();
      expect(findNodeByIdOrAssetId(doc, "nope")).toBeNull();
    });
  });

  // ─── getNodeStatus ──────────────────────────────────────────

  describe("getNodeStatus", () => {
    it("returns NodeNotFound for missing node", () => {
      const doc = makeDoc();
      const result = getNodeStatus(doc, "missing");
      expect(result.status).toBe(Status.NodeNotFound);
    });

    it("returns Generating for image_gen node without status", () => {
      const doc = makeDoc();
      insertNode(doc, noop, "n1", "image_gen", { label: "Img" }, null, { x: 0, y: 0 });

      const result = getNodeStatus(doc, "n1");
      expect(result.status).toBe(Status.Generating);
    });

    it("returns Completed for text node without status", () => {
      const doc = makeDoc();
      insertNode(doc, noop, "n1", "text", { label: "T" }, null, { x: 0, y: 0 });

      const result = getNodeStatus(doc, "n1");
      expect(result.status).toBe(Status.Completed);
    });

    it("returns explicit status from node data", () => {
      const doc = makeDoc();
      insertNode(doc, noop, "n1", "image_gen", { label: "Img", status: "completed" }, null, { x: 0, y: 0 });

      const result = getNodeStatus(doc, "n1");
      expect(result.status).toBe(Status.Completed);
    });

    it("finds node by assetId", () => {
      const doc = makeDoc();
      insertNode(doc, noop, "n1", "image_gen", { label: "X", assetId: "a1", status: "failed" }, null, { x: 0, y: 0 });

      const result = getNodeStatus(doc, "a1");
      expect(result.status).toBe(Status.Failed);
    });
  });
});
