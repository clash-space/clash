import { describe, it, expect } from "vitest";
import { LoroDoc } from "loro-crdt";

/**
 * Tests for Loro CRDT sync correctness — the core invariant of ProjectRoom.
 *
 * These validate that:
 * 1. Snapshots round-trip correctly (export → import)
 * 2. Incremental updates sync between docs
 * 3. Concurrent edits converge
 * 4. The message queue serialization pattern works
 */
describe("Loro CRDT sync", () => {
  describe("snapshot round-trip", () => {
    it("exports and reimports a snapshot with full fidelity", () => {
      const doc = new LoroDoc();
      const nodesMap = doc.getMap("nodes");
      nodesMap.set("n1", {
        type: "text",
        data: { label: "Hello", content: "World" },
        position: { x: 10, y: 20 },
        parentId: "g1",
      });
      nodesMap.set("n2", {
        type: "image",
        data: { status: "completed", src: "http://example.com/img.png" },
        position: { x: 100, y: 200 },
      });

      const edgesMap = doc.getMap("edges");
      edgesMap.set("e1", { source: "n1", target: "n2", type: "dep" });

      // Export → reimport
      const snapshot = doc.export({ mode: "snapshot" });
      const doc2 = LoroDoc.fromSnapshot(snapshot);

      const nodes2 = doc2.getMap("nodes");
      const n1 = nodes2.get("n1") as Record<string, any>;
      expect(n1.type).toBe("text");
      expect(n1.data.label).toBe("Hello");
      expect(n1.position).toEqual({ x: 10, y: 20 });
      expect(n1.parentId).toBe("g1");

      const n2 = nodes2.get("n2") as Record<string, any>;
      expect(n2.data.status).toBe("completed");
      expect(n2.data.src).toBe("http://example.com/img.png");

      const edges2 = doc2.getMap("edges");
      const e1 = edges2.get("e1") as Record<string, any>;
      expect(e1.source).toBe("n1");
      expect(e1.target).toBe("n2");
    });

    it("empty doc snapshot round-trips", () => {
      const doc = new LoroDoc();
      const snapshot = doc.export({ mode: "snapshot" });
      const doc2 = LoroDoc.fromSnapshot(snapshot);

      expect([...doc2.getMap("nodes").entries()]).toHaveLength(0);
    });
  });

  describe("incremental update sync", () => {
    it("syncs a single update from doc1 to doc2", () => {
      const doc1 = new LoroDoc();
      const doc2 = new LoroDoc();

      const v1 = doc1.version();
      doc1.getMap("nodes").set("n1", { type: "text", data: { label: "A" } });
      const update = doc1.export({ mode: "update", from: v1 });

      doc2.import(update);

      const n1 = doc2.getMap("nodes").get("n1") as Record<string, any>;
      expect(n1.data.label).toBe("A");
    });

    it("syncs multiple sequential updates", () => {
      const doc1 = new LoroDoc();
      const doc2 = new LoroDoc();

      // Update 1: add node
      let v = doc1.version();
      doc1.getMap("nodes").set("n1", { type: "text", data: { label: "v1" } });
      const u1 = doc1.export({ mode: "update", from: v });

      // Update 2: modify node
      v = doc1.version();
      doc1.getMap("nodes").set("n1", { type: "text", data: { label: "v2" } });
      const u2 = doc1.export({ mode: "update", from: v });

      // Apply in order
      doc2.import(u1);
      doc2.import(u2);

      const n1 = doc2.getMap("nodes").get("n1") as Record<string, any>;
      expect(n1.data.label).toBe("v2");
    });
  });

  describe("concurrent edits", () => {
    it("two docs editing different nodes converge", () => {
      // Start from same state
      const base = new LoroDoc();
      base.getMap("nodes").set("n1", { type: "text", data: { label: "orig" } });
      const snapshot = base.export({ mode: "snapshot" });

      const docA = LoroDoc.fromSnapshot(snapshot);
      const docB = LoroDoc.fromSnapshot(snapshot);

      // A adds a node
      const vA = docA.version();
      docA.getMap("nodes").set("n2", { type: "prompt", data: { label: "from-A" } });
      const updateA = docA.export({ mode: "update", from: vA });

      // B modifies existing node
      const vB = docB.version();
      docB.getMap("nodes").set("n1", { type: "text", data: { label: "from-B" } });
      const updateB = docB.export({ mode: "update", from: vB });

      // Apply cross-updates
      docA.import(updateB);
      docB.import(updateA);

      // Both should have both changes
      for (const doc of [docA, docB]) {
        const nodes = doc.getMap("nodes");
        expect((nodes.get("n1") as any).data.label).toBe("from-B");
        expect((nodes.get("n2") as any).data.label).toBe("from-A");
      }
    });

    it("two docs editing same node converge to same value", () => {
      const base = new LoroDoc();
      base.getMap("nodes").set("n1", { type: "text", data: { label: "orig" } });
      const snapshot = base.export({ mode: "snapshot" });

      const docA = LoroDoc.fromSnapshot(snapshot);
      const docB = LoroDoc.fromSnapshot(snapshot);

      // Both edit the same node
      const vA = docA.version();
      docA.getMap("nodes").set("n1", { type: "text", data: { label: "A-wins?" } });
      const updateA = docA.export({ mode: "update", from: vA });

      const vB = docB.version();
      docB.getMap("nodes").set("n1", { type: "text", data: { label: "B-wins?" } });
      const updateB = docB.export({ mode: "update", from: vB });

      docA.import(updateB);
      docB.import(updateA);

      // They should converge to the same value (CRDT guarantees)
      const labelA = (docA.getMap("nodes").get("n1") as any).data.label;
      const labelB = (docB.getMap("nodes").get("n1") as any).data.label;
      expect(labelA).toBe(labelB);
    });
  });

  describe("serialized import (message queue pattern)", () => {
    it("processing updates one at a time produces correct state", () => {
      const serverDoc = new LoroDoc();

      // Simulate 3 clients sending updates sequentially
      const updates: Uint8Array[] = [];

      for (let i = 0; i < 3; i++) {
        const clientDoc = LoroDoc.fromSnapshot(serverDoc.export({ mode: "snapshot" }));
        const v = clientDoc.version();
        clientDoc.getMap("nodes").set(`node-${i}`, {
          type: "text",
          data: { label: `Client ${i}` },
        });
        updates.push(clientDoc.export({ mode: "update", from: v }));
      }

      // Process queue serially (simulates processMessageQueue)
      for (const update of updates) {
        serverDoc.import(update);
      }

      const nodes = serverDoc.getMap("nodes");
      expect(nodes.get("node-0")).toBeDefined();
      expect(nodes.get("node-1")).toBeDefined();
      expect(nodes.get("node-2")).toBeDefined();
      expect((nodes.get("node-2") as any).data.label).toBe("Client 2");
    });
  });
});
