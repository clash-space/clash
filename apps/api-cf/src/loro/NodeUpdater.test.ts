import { describe, it, expect } from "vitest";
import { LoroDoc } from "loro-crdt";
import { updateNodeData, updateNode, updateEdge } from "./NodeUpdater";

function makeDocWithNode(
  nodeId: string,
  nodeData: Record<string, any>
): LoroDoc {
  const doc = new LoroDoc();
  const nodesMap = doc.getMap("nodes");
  nodesMap.set(nodeId, nodeData);
  return doc;
}

describe("NodeUpdater", () => {
  // ─── updateNodeData ─────────────────────────────────────────

  describe("updateNodeData", () => {
    it("merges updates into node data and broadcasts", () => {
      const doc = makeDocWithNode("n1", {
        type: "image",
        data: { status: "generating", label: "Test" },
        position: { x: 10, y: 20 },
      });

      const broadcasts: Uint8Array[] = [];
      updateNodeData(doc, "n1", { status: "completed", src: "url" }, (data) =>
        broadcasts.push(data)
      );

      expect(broadcasts).toHaveLength(1);

      // Verify merge
      const nodesMap = doc.getMap("nodes");
      const node = nodesMap.get("n1") as Record<string, any>;
      expect(node.data.status).toBe("completed");
      expect(node.data.src).toBe("url");
      expect(node.data.label).toBe("Test"); // preserved
    });

    it("preserves position during update", () => {
      const doc = makeDocWithNode("n1", {
        type: "image",
        data: { label: "A" },
        position: { x: 42, y: 99 },
      });

      updateNodeData(doc, "n1", { label: "B" }, () => {});

      const nodesMap = doc.getMap("nodes");
      const node = nodesMap.get("n1") as Record<string, any>;
      expect(node.position).toEqual({ x: 42, y: 99 });
    });

    it("does nothing for nonexistent node", () => {
      const doc = new LoroDoc();
      const broadcasts: Uint8Array[] = [];

      // Should not throw
      updateNodeData(doc, "missing", { x: 1 }, (data) => broadcasts.push(data));

      expect(broadcasts).toHaveLength(0);
    });

    it("broadcast update can be imported by another doc", () => {
      const doc1 = makeDocWithNode("n1", {
        type: "text",
        data: { label: "old" },
        position: { x: 0, y: 0 },
      });

      // Sync doc1 → doc2 first
      const doc2 = LoroDoc.fromSnapshot(doc1.export({ mode: "snapshot" }));

      const broadcasts: Uint8Array[] = [];
      updateNodeData(doc1, "n1", { label: "new" }, (data) =>
        broadcasts.push(data)
      );

      doc2.import(broadcasts[0]);

      const node = (doc2.getMap("nodes").get("n1") as Record<string, any>);
      expect(node.data.label).toBe("new");
    });

    it("restores default position when node has none", () => {
      const doc = makeDocWithNode("n1", {
        type: "text",
        data: { label: "A" },
        // no position field
      });

      updateNodeData(doc, "n1", { label: "B" }, () => {});

      const node = (doc.getMap("nodes").get("n1") as Record<string, any>);
      expect(node.position).toEqual({ x: 0, y: 0 });
    });
  });

  // ─── updateNode ─────────────────────────────────────────────

  describe("updateNode", () => {
    it("replaces entire node and broadcasts", () => {
      const doc = makeDocWithNode("n1", { type: "text", data: { old: true } });

      const broadcasts: Uint8Array[] = [];
      updateNode(
        doc,
        "n1",
        { type: "prompt", data: { new: true }, position: { x: 5, y: 5 } },
        (data) => broadcasts.push(data)
      );

      expect(broadcasts).toHaveLength(1);

      const node = (doc.getMap("nodes").get("n1") as Record<string, any>);
      expect(node.type).toBe("prompt");
      expect(node.data.new).toBe(true);
      expect(node.data.old).toBeUndefined();
    });

    it("can create a new node in the doc", () => {
      const doc = new LoroDoc();
      updateNode(doc, "new1", { type: "text", data: {} }, () => {});

      const node = (doc.getMap("nodes").get("new1") as Record<string, any>);
      expect(node).toBeDefined();
      expect(node.type).toBe("text");
    });
  });

  // ─── updateEdge ─────────────────────────────────────────────

  describe("updateEdge", () => {
    it("inserts an edge and broadcasts", () => {
      const doc = new LoroDoc();
      const broadcasts: Uint8Array[] = [];

      updateEdge(
        doc,
        "e1",
        { source: "a", target: "b", type: "dep" },
        (data) => broadcasts.push(data)
      );

      expect(broadcasts).toHaveLength(1);

      const edge = (doc.getMap("edges").get("e1") as Record<string, any>);
      expect(edge.source).toBe("a");
      expect(edge.target).toBe("b");
    });

    it("overwrites existing edge", () => {
      const doc = new LoroDoc();
      updateEdge(doc, "e1", { source: "a", target: "b" }, () => {});
      updateEdge(doc, "e1", { source: "c", target: "d" }, () => {});

      const edge = (doc.getMap("edges").get("e1") as Record<string, any>);
      expect(edge.source).toBe("c");
      expect(edge.target).toBe("d");
    });
  });
});
