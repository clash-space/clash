import test from "node:test";
import assert from "node:assert/strict";
import { readNativeMediaActionRun } from "./generator-readback.js";

const outputContract = [{ slot: "image", kind: "media" }];
const asset = { metadata: { contentType: "image/png", width: 2, height: 3 }, url: "https://assets.test/a" };

function fixture(statuses: string[] = ["succeeded"]) {
  let index = 0;
  return {
    generator: {
      getActionRun: async () => ({ run: { status: statuses[Math.min(index++, statuses.length - 1)], outputContract, ...(statuses.at(-1) === "failed" ? { outcome: { message: "boom" } } : {}) } }),
      getOutputCommit: async (_projectId: string, _runId: string, slot: string) => {
        assert.equal(slot, "image");
        return { commit: { asset: { kind: "media", projectAssetId: "asset-1" } } };
      },
    },
    getAsset: async (id: string) => { assert.equal(id, "asset-1"); return asset; },
    downloadAsset: async (value: { url?: string }) => { assert.equal(value, asset); return new Uint8Array([1, 2, 3]); },
  };
}

test("polls wrapped ActionRuns and reads the exact wrapped OutputCommit media bytes", async () => {
  const value = await readNativeMediaActionRun({ ...fixture(["pending", "running", "succeeded"]), projectId: "p", actionRunId: "r", sleep: async () => undefined });
  assert.deepEqual(value, { actionRunId: "r", outputSlot: "image", projectAssetId: "asset-1", asset, bytes: new Uint8Array([1, 2, 3]) });
});

test("reports a failed ActionRun", async () => {
  await assert.rejects(readNativeMediaActionRun({ ...fixture(["failed"]), projectId: "p", actionRunId: "r" }), /failed.*boom/);
});

test("times out without a real polling delay", async () => {
  await assert.rejects(readNativeMediaActionRun({ ...fixture(["pending"]), projectId: "p", actionRunId: "r", timeoutMs: 0, sleep: async () => undefined }), /Timed out/);
});

test("rejects malformed and multiple output contracts", async () => {
  for (const contract of [{ outputs: [{ slot: "image" }] }, [{ slot: "a" }, { slot: "b" }]]) {
    const base = fixture();
    base.generator.getActionRun = (async () => ({ run: { status: "succeeded", outputContract: contract } })) as typeof base.generator.getActionRun;
    await assert.rejects(readNativeMediaActionRun({ ...base, projectId: "p", actionRunId: "r" }), /exactly one output slot/);
  }
});

test("rejects a missing OutputCommit wrapper", async () => {
  const base = fixture();
  base.generator.getOutputCommit = async () => ({}) as never;
  await assert.rejects(readNativeMediaActionRun({ ...base, projectId: "p", actionRunId: "r" }), /invalid response/);
});
