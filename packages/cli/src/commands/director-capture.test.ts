import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const state = {
  schemaVersion: 1 as const,
  scene: {
    backgroundColor: "#171816",
    grid: { visible: true, snap: false, size: 1 },
  },
  objects: [],
  cameras: [
    {
      id: "camera-a",
      name: "A",
      position: [0, 1.6, 5],
      rotation: [0, 0, 0],
      fov: 50,
    },
  ],
  shots: [],
  activeCameraId: "camera-a",
  shotSequence: [
    {
      id: "shot-a",
      name: "Opening",
      cameraId: "camera-a",
      startTime: 0,
      durationSeconds: 2,
      aspectRatio: "16:9" as const,
      transition: "cut" as const,
    },
  ],
};

test("uses the Host-published capture Assets as the receipt identities", async () => {
  const module = await import("./director").catch(
    () => ({}) as Record<string, any>,
  );
  const cwd = await mkdtemp(join(tmpdir(), "clash-director-host-capture-"));
  let reads = 0;

  const result = await module.captureDirectorStageWithReadback({
    cwd,
    stageId: "stage-a",
    times: [1],
    labels: ["frame-action"],
    longEdge: 1280,
    readStage: async () => {
      reads += 1;
      return {
        id: "stage-a",
        name: "Stage A",
        revisionId: "revision-a",
        state,
      };
    },
    capture: async (request: any) => ({
      captured: true,
      stageId: "stage-a",
      sourceStageRevisionId: "revision-a",
      renderer: { id: "clash-director-viewport-webgl", contractVersion: 1 },
      stateSha256: createHash("sha256")
        .update(JSON.stringify(state))
        .digest("hex"),
      frames: request.frames.map((frame: any) => ({
        ...frame,
        activeCameraId: "camera-a",
        width: 1280,
        height: 720,
        mimeType: "image/png",
        dataBase64: "AQID",
        sha256: createHash("sha256")
          .update(Buffer.from([1, 2, 3]))
          .digest("hex"),
        projectAssetId: "director-capture:published-by-host",
        metadataAttached: false,
      })),
    }),
  });

  assert.equal(reads, 2);
  assert.equal(
    result.frames[0]?.projectAssetId,
    "director-capture:published-by-host",
  );
  assert.deepEqual(
    await readFile(result.frames[0]!.path),
    Buffer.from([1, 2, 3]),
  );
});

test("rejects a Host capture that did not publish every frame as a Project Asset", async () => {
  const module = await import("./director").catch(
    () => ({}) as Record<string, any>,
  );
  await assert.rejects(
    module.captureDirectorStageWithReadback({
      cwd: await mkdtemp(join(tmpdir(), "clash-director-unpublished-capture-")),
      stageId: "stage-a",
      times: [0],
      longEdge: 1280,
      readStage: async () => ({
        id: "stage-a",
        name: "Stage A",
        revisionId: "revision-a",
        state,
      }),
      capture: async (request: any) => ({
        captured: true,
        stageId: "stage-a",
        sourceStageRevisionId: "revision-a",
        renderer: {
          id: "clash-director-viewport-webgl",
          contractVersion: 1,
        },
        stateSha256: createHash("sha256")
          .update(JSON.stringify(state))
          .digest("hex"),
        frames: request.frames.map((frame: any) => ({
          ...frame,
          width: 1280,
          height: 720,
          mimeType: "image/png",
          dataBase64: "AQID",
          sha256: createHash("sha256")
            .update(Buffer.from([1, 2, 3]))
            .digest("hex"),
        })),
      }),
    }),
    /did not publish a Project Asset/,
  );
});

test("captures product PNGs and commits a stage-revision readback receipt", async () => {
  const module = await import("./director").catch(
    () => ({}) as Record<string, any>,
  );
  assert.equal(typeof module.captureDirectorStageWithReadback, "function");
  const cwd = await mkdtemp(join(tmpdir(), "clash-director-capture-"));
  let reads = 0;
  const result = await module.captureDirectorStageWithReadback({
    cwd,
    stageId: "stage-a",
    times: [0, 1, 2],
    labels: ["frame-opening", "frame-action", "frame-closing"],
    longEdge: 1280,
    readStage: async () => {
      reads += 1;
      return {
        id: "stage-a",
        name: "Stage A",
        revisionId: "revision-a",
        state,
      };
    },
    capture: async (input: any) => ({
      captured: true,
      stageId: "stage-a",
      sourceStageRevisionId: "revision-a",
      renderer: { id: "clash-director-viewport-webgl", contractVersion: 1 },
      stateSha256: createHash("sha256")
        .update(JSON.stringify(state))
        .digest("hex"),
      frames: input.frames.map((frame: any) => ({
        ...frame,
        activeCameraId: "camera-a",
        width: 1280,
        height: 720,
        mimeType: "image/png",
        dataBase64: "AQID",
        sha256: createHash("sha256")
          .update(Buffer.from([1, 2, 3]))
          .digest("hex"),
        projectAssetId: `asset-${frame.label}`,
        metadataAttached: false,
      })),
    }),
  });

  assert.equal(
    reads,
    2,
    "capture must verify the Stage did not change while rendering",
  );
  assert.equal(result.sourceStageRevisionId, "revision-a");
  assert.equal(result.verifiedStageRevisionId, "revision-a");
  assert.deepEqual(
    result.frames.map((frame: any) => frame.artifactId),
    ["frame-opening", "frame-action", "frame-closing"],
  );
  assert.deepEqual(
    result.frames.map((frame: any) => frame.projectAssetId),
    ["asset-frame-opening", "asset-frame-action", "asset-frame-closing"],
  );
  assert.deepEqual(
    await Promise.all(result.frames.map((frame: any) => readFile(frame.path))),
    [Buffer.from([1, 2, 3]), Buffer.from([1, 2, 3]), Buffer.from([1, 2, 3])],
  );
  const receipt = JSON.parse(await readFile(result.receiptPath, "utf8"));
  assert.equal(receipt.renderer.id, "clash-director-viewport-webgl");
  assert.equal(receipt.frames.length, 3);
});

test("rejects capture readback when the persisted Stage revision changes", async () => {
  const module = await import("./director").catch(
    () => ({}) as Record<string, any>,
  );
  let reads = 0;
  await assert.rejects(
    module.captureDirectorStageWithReadback({
      cwd: await mkdtemp(join(tmpdir(), "clash-director-stale-")),
      stageId: "stage-a",
      times: [0],
      longEdge: 1280,
      readStage: async () => ({
        id: "stage-a",
        name: "Stage A",
        revisionId: ++reads === 1 ? "revision-a" : "revision-b",
        state,
      }),
      capture: async () => ({
        captured: true,
        stageId: "stage-a",
        sourceStageRevisionId: "revision-a",
        renderer: { id: "clash-director-viewport-webgl", contractVersion: 1 },
        stateSha256: createHash("sha256")
          .update(JSON.stringify(state))
          .digest("hex"),
        frames: [
          {
            label: "frame-001",
            timeSeconds: 0,
            aspectRatio: "16:9",
            activeCameraId: "camera-a",
            width: 1280,
            height: 720,
            mimeType: "image/png",
            dataBase64: "AQID",
            sha256: createHash("sha256")
              .update(Buffer.from([1, 2, 3]))
              .digest("hex"),
            projectAssetId: "asset-frame-001",
            metadataAttached: false,
          },
        ],
      }),
    }),
    /changed during capture/,
  );
});

test("rejects renderer metadata that does not prove the requested exact time", async () => {
  const module = await import("./director").catch(
    () => ({}) as Record<string, any>,
  );
  await assert.rejects(
    module.captureDirectorStageWithReadback({
      cwd: await mkdtemp(join(tmpdir(), "clash-director-wrong-time-")),
      stageId: "stage-a",
      times: [1],
      labels: ["frame-action"],
      longEdge: 1280,
      readStage: async () => ({
        id: "stage-a",
        name: "Stage A",
        revisionId: "revision-a",
        state,
      }),
      capture: async (input: any) => ({
        captured: true,
        stageId: "stage-a",
        sourceStageRevisionId: "revision-a",
        renderer: { id: "clash-director-viewport-webgl", contractVersion: 1 },
        stateSha256: createHash("sha256")
          .update(JSON.stringify(state))
          .digest("hex"),
        frames: [
          {
            ...input.frames[0],
            timeSeconds: 1.25,
            activeCameraId: "camera-a",
            width: 1280,
            height: 720,
            mimeType: "image/png",
            dataBase64: "AQID",
            sha256: createHash("sha256")
              .update(Buffer.from([1, 2, 3]))
              .digest("hex"),
            projectAssetId: "asset-frame-action",
            metadataAttached: false,
          },
        ],
      }),
    }),
    /changed frame time/,
  );
});
