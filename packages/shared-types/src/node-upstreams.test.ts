import { describe, expect, it } from "vitest";
import { LoroDoc } from "loro-crdt";
import { Canvas } from "./canvas-ops.js";
import * as graph from "./node-upstreams.js";

function mergePeers(
  left: LoroDoc,
  right: LoroDoc,
  leftVersion: ReturnType<LoroDoc["version"]>,
  rightVersion: ReturnType<LoroDoc["version"]>,
): void {
  const leftUpdate = left.export({ mode: "update", from: leftVersion });
  const rightUpdate = right.export({ mode: "update", from: rightVersion });
  left.import(rightUpdate);
  right.import(leftUpdate);
}

describe("Canvas edge CRDT identity", () => {
  it("reports the one-time identity schema write so hosts persist it", () => {
    const doc = new LoroDoc();
    doc.getMap("nodes").set("source", { canvasId: "main" });
    doc.getMap("nodes").set("target", { canvasId: "main" });
    doc.getMap("edges").set("legacy-edge", {
      source: "source",
      target: "target",
      type: "default",
    });
    const before = doc.version();

    expect((graph as any).reconcileCanvasGraph(doc)).toMatchObject({
      initializedIdentity: true,
      migratedLegacyEdgeIds: ["legacy-edge"],
    });
    expect(doc.export({ mode: "update", from: before }).byteLength).toBeGreaterThan(0);
    expect((graph as any).reconcileCanvasGraph(doc)).toMatchObject({
      initializedIdentity: false,
      migratedLegacyEdgeIds: [],
    });
  });

  it("reads legacy top-level edge records through the shared Canvas model", () => {
    const doc = new LoroDoc();
    const canvas = new Canvas(doc, () => {}, "main");
    canvas.insertNode("source", "text", {}, null, { x: 0, y: 0 });
    canvas.insertNode("target", "image_gen", {}, null, { x: 100, y: 0 });
    doc.getMap("edges").set("legacy-edge", {
      source: "source",
      target: "target",
      type: "reference",
    });

    expect(canvas.listEdges()).toEqual([
      { id: "legacy-edge", source: "source", target: "target", type: "reference" },
    ]);
  });

  it("converges concurrent retargets of one edge id to one target", () => {
    const base = new LoroDoc();
    const canvas = new Canvas(base, () => {}, "main");
    canvas.insertNode("source", "text", {}, null, { x: 0, y: 0 });
    canvas.insertNode("target-a", "image_gen", {}, null, { x: 100, y: 0 });
    canvas.insertNode("target-b", "image_gen", {}, null, { x: 100, y: 100 });
    canvas.insertNode("target-c", "image_gen", {}, null, { x: 100, y: 200 });
    canvas.insertEdge("movable", "source", "target-a");

    const snapshot = base.export({ mode: "snapshot" });
    const left = LoroDoc.fromSnapshot(snapshot);
    const right = LoroDoc.fromSnapshot(snapshot);
    const leftVersion = left.version();
    const rightVersion = right.version();
    new Canvas(left, () => {}, "main").updateEdge("movable", { target: "target-b" });
    new Canvas(right, () => {}, "main").updateEdge("movable", { target: "target-c" });
    mergePeers(left, right, leftVersion, rightVersion);

    for (const doc of [left, right]) {
      (graph as any).reconcileCanvasGraph(doc);
    }
    const leftEdges = new Canvas(left, () => {}, "main").listEdges();
    const rightEdges = new Canvas(right, () => {}, "main").listEdges();
    expect(leftEdges).toEqual(rightEdges);
    expect(leftEdges).toHaveLength(1);
    expect(leftEdges[0]).toMatchObject({ id: "movable", source: "source" });
    expect(["target-b", "target-c"]).toContain(leftEdges[0]?.target);
  });

  it("removes an orphan created by concurrent source deletion and edge insertion", () => {
    const base = new LoroDoc();
    const canvas = new Canvas(base, () => {}, "main");
    canvas.insertNode("source", "text", {}, null, { x: 0, y: 0 });
    canvas.insertNode("target", "image_gen", {}, null, { x: 100, y: 0 });

    const snapshot = base.export({ mode: "snapshot" });
    const left = LoroDoc.fromSnapshot(snapshot);
    const right = LoroDoc.fromSnapshot(snapshot);
    const leftVersion = left.version();
    const rightVersion = right.version();
    new Canvas(left, () => {}, "main").deleteNode("source");
    new Canvas(right, () => {}, "main").insertEdge("late-edge", "source", "target");
    mergePeers(left, right, leftVersion, rightVersion);

    for (const doc of [left, right]) {
      (graph as any).reconcileCanvasGraph(doc);
      expect(new Canvas(doc, () => {}, "main").listEdges()).toEqual([]);
    }
  });

  it("does not resurrect an incident edge after a deleted target id is reused", () => {
    const doc = new LoroDoc();
    const canvas = new Canvas(doc, () => {}, "main");
    canvas.insertNode("source", "text", {}, null, { x: 0, y: 0 });
    canvas.insertNode("target", "image_gen", {}, null, { x: 100, y: 0 });
    canvas.insertEdge("source-target", "source", "target");

    canvas.deleteNode("target");
    (graph as any).reconcileCanvasGraph(doc);
    canvas.insertNode("target", "image_gen", {}, null, { x: 100, y: 0 });

    expect(canvas.listEdges()).toEqual([]);
    expect(canvas.readNode("target")?.upstream).toEqual([]);
  });
});
