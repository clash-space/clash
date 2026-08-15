import { describe, expect, it } from "vitest";

import {
  canvasActionAssetInputs,
  type CanvasActionAssetInputNode,
} from "./canvas-action-asset-inputs.js";

describe("canvasActionAssetInputs", () => {
  it("freezes Director packet Assets from the referenced output node", () => {
    const output = {
      id: "director-output",
      type: "video",
      data: {
        assetId: "director-video",
        status: "completed",
        directorReferencePacket: {
          schemaVersion: 1,
          stageId: "stage-1",
          stageRevisionId: "stage-revision-1",
          exportedAt: "2026-07-24T00:00:00.000Z",
          aspectRatio: "16:9",
          durationSeconds: 6,
          fps: 30,
          cameraIds: ["camera-a"],
          referenceVideo: {
            assetId: "director-video",
            mimeType: "video/webm",
          },
          referenceStills: [
            {
              assetId: "director-still-start",
              cameraId: "camera-a",
              shotId: "shot-a",
              aspectRatio: "16:9",
              stageRevisionId: "stage-revision-1",
              timeSeconds: 0,
            },
            {
              assetId: "director-still-end",
              cameraId: "camera-a",
              shotId: "shot-a",
              aspectRatio: "16:9",
              stageRevisionId: "stage-revision-1",
              timeSeconds: 6,
            },
          ],
          shotSpec: { shots: [] },
        },
      },
    } satisfies CanvasActionAssetInputNode;
    const consumer = {
      id: "video-generator",
      type: "action-badge",
      data: { actionType: "video-gen" },
    } satisfies CanvasActionAssetInputNode;

    const inputs = canvasActionAssetInputs({
      node: consumer,
      nodes: [output, consumer],
      edges: [{ source: output.id, target: consumer.id }],
    });

    expect(inputs?.map(({ projectAssetId }) => projectAssetId)).toEqual([
      "director-video",
      "director-still-start",
      "director-still-end",
    ]);
    expect(inputs?.every(({ role }) => role === "reference")).toBe(true);
  });
});
