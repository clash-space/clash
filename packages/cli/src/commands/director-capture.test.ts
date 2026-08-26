import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureDirectorStageWithReadback } from "./director";

const png = new Uint8Array([137,80,78,71,13,10,26,10,1]);
const state = { schemaVersion: 1 as const, scene: { backgroundColor: "#000", grid: { visible: true, snap: false, size: 1 } }, objects: [], cameras: [], shots: [] };
const stage = (revisionId = "revision-a") => ({ id: "stage-a", name: "A", revisionId, state });

async function capture(count: number, overrides: Record<string, unknown> = {}) {
  let reads = 0;
  const result = await captureDirectorStageWithReadback({
    cwd: await mkdtemp(join(tmpdir(), "director-capture-")), stageId: "stage-a",
    times: Array.from({ length: count }, (_, i) => i), labels: Array.from({ length: count }, (_, i) => `label-${count-i}`), longEdge: 1280,
    readStage: async () => stage(++reads === 2 && overrides.afterRevision ? String(overrides.afterRevision) : "revision-a"),
    capture: async () => ({ submitted: true, captured: false, stageId: "stage-a", sourceStageRevisionId: String(overrides.sourceRevision ?? "revision-a"), runs: Array.from({ length: count }, (_, i) => ({ actionRunId: `run-${i}` })) }),
    readRunMedia: async (id) => { if (overrides.readError) throw new Error(String(overrides.readError)); return { projectAssetId: `asset-${id}`, bytes: (overrides.bytes as Uint8Array) ?? png, metadata: { contentType: String(overrides.contentType ?? "image/png"), width: 1280, height: 720 } }; },
  });
  return { result, reads };
}

test("reconstructs complete receipts for one and two submitted frames in requested label order", async () => {
  for (const count of [1, 2]) {
    const { result, reads } = await capture(count);
    assert.equal(reads, 2);
    assert.equal(result.captured, true);
    assert.equal(result.verifiedStageRevisionId, "revision-a");
    assert.equal(result.renderer.id, "clash-director-viewport-webgl");
    assert.equal(result.stateSha256, createHash("sha256").update(JSON.stringify(state)).digest("hex"));
    assert.deepEqual(result.frames.map((f) => f.artifactId), Array.from({ length: count }, (_, i) => `label-${count-i}`));
    assert.deepEqual(result.frames.map((f) => f.projectAssetId), Array.from({ length: count }, (_, i) => `asset-run-${i}`));
    for (const frame of result.frames) assert.deepEqual(await readFile(frame.path), Buffer.from(png));
    assert.equal(JSON.parse(await readFile(result.receiptPath, "utf8")).captured, true);
  }
});

test("rejects wrong source and changed verified revisions", async () => {
  await assert.rejects(capture(1, { sourceRevision: "wrong" }), /expected revision-a/);
  await assert.rejects(capture(1, { afterRevision: "revision-b" }), /changed during capture/);
});

test("rejects non-PNG metadata and bytes", async () => {
  await assert.rejects(capture(1, { contentType: "image/jpeg" }), /non-PNG/);
  await assert.rejects(capture(1, { bytes: new Uint8Array([1]) }), /invalid PNG bytes/);
});

test("propagates failed native readback", async () => {
  await assert.rejects(capture(1, { readError: "ActionRun failed" }), /ActionRun failed/);
});
