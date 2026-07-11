import { describe, expect, it } from "vitest";
import { timelineDslHash } from "@clash/shared-types";

import {
  buildPendingRenderVideoNodePayload,
  type PendingRenderTimelineDsl,
} from "./pendingRenderVideo";

const timelineDsl: PendingRenderTimelineDsl = {
  tracks: [
    {
      id: "track-1",
      name: "Track 1",
      items: [
        { id: "clip-1", type: "video", src: "clip-1.mp4", from: 0, durationInFrames: 90 },
      ],
    },
  ],
  compositionWidth: 1920,
  compositionHeight: 1080,
  fps: 30,
  durationInFrames: 90,
};

describe("buildPendingRenderVideoNodePayload", () => {
  it("pins rendered videos to the Project Timeline's current revision", async () => {
    const payload = await buildPendingRenderVideoNodePayload(timelineDsl, {
      sourceTimelineNodeId: "editor-1",
      timelineRevision: {
        timelineId: "timeline-1",
        revisionId: "timeline-revision-v1:abc",
      },
    });

    expect(payload.data).toMatchObject({
      sourceTimelineNodeId: "editor-1",
      sourceTimelineId: "timeline-1",
      sourceTimelineRevisionId: "timeline-revision-v1:abc",
      sourceTimelineHash: await timelineDslHash(timelineDsl),
      sourceTimelineRevisionStatus: "applied",
    });
  });

  it("pins draft canvas renders to a semantic timeline hash without inventing a revision id", async () => {
    const payload = await buildPendingRenderVideoNodePayload(timelineDsl, {
      sourceTimelineNodeId: "editor-1",
    });

    expect(payload.data.sourceTimelineNodeId).toBe("editor-1");
    expect(payload.data.sourceTimelineHash).toBe(await timelineDslHash(timelineDsl));
    expect(payload.data.sourceTimelineRevisionStatus).toBe("draft-canvas");
    expect(payload.data).not.toHaveProperty("sourceTimelineRevisionId");
  });
});
