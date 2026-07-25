import { describe, expect, it } from "vitest";
import {
  TimelineTranscriptProjectionSchema,
  buildTimelineTranscriptProjection,
} from "./timeline-transcript";

describe("timeline transcript projection", () => {
  it("derives one editable transcript view from multiple asset transcripts", () => {
    const projection = buildTimelineTranscriptProjection({
      timelineId: "timeline-main",
      timelineRevision: "revision-7",
      fps: 30,
      durationFrames: 80,
      clips: [
        {
          clipId: "clip-a",
          trackId: "dialogue",
          assetId: "asset-a",
          timelineStartFrame: 0,
          sourceStartFrame: 10,
          sourceEndFrame: 30,
          transcript: {
            sourcePath: "analysis/transcripts/asset-a.json",
            sourceHash: `sha256:${"a".repeat(64)}`,
            words: [
              { id: "a-1", text: "你好", startFrame: 0, endFrame: 10 },
              { id: "a-2", text: "世界", startFrame: 12, endFrame: 20 },
            ],
          },
        },
        {
          clipId: "clip-b",
          trackId: "dialogue",
          assetId: "asset-b",
          timelineStartFrame: 30,
          sourceStartFrame: 30,
          sourceEndFrame: 50,
          transcript: {
            sourcePath: "analysis/transcripts/asset-b.json",
            sourceHash: `sha256:${"b".repeat(64)}`,
            words: [
              { id: "b-1", text: "Hello", startFrame: 30, endFrame: 40, speakerId: "speaker-1" },
              { id: "b-2", text: "Clash", startFrame: 40, endFrame: 50 },
            ],
          },
        },
      ],
    });

    expect(TimelineTranscriptProjectionSchema.parse(projection)).toEqual(projection);
    expect(projection.text).toBe("世界 Hello Clash");
    expect(projection.sources).toEqual([
      {
        assetId: "asset-a",
        transcriptSourcePath: "analysis/transcripts/asset-a.json",
        transcriptSourceHash: `sha256:${"a".repeat(64)}`,
      },
      {
        assetId: "asset-b",
        transcriptSourcePath: "analysis/transcripts/asset-b.json",
        transcriptSourceHash: `sha256:${"b".repeat(64)}`,
      },
    ]);
    expect(projection.words).toEqual([
      {
        id: "clip-a:a-2",
        text: "世界",
        assetId: "asset-a",
        assetWordId: "a-2",
        clipId: "clip-a",
        trackId: "dialogue",
        sourceStartFrame: 12,
        sourceEndFrame: 20,
        timelineStartFrame: 2,
        timelineEndFrame: 10,
      },
      {
        id: "clip-b:b-1",
        text: "Hello",
        assetId: "asset-b",
        assetWordId: "b-1",
        clipId: "clip-b",
        trackId: "dialogue",
        sourceStartFrame: 30,
        sourceEndFrame: 40,
        timelineStartFrame: 30,
        timelineEndFrame: 40,
        speakerId: "speaker-1",
      },
      {
        id: "clip-b:b-2",
        text: "Clash",
        assetId: "asset-b",
        assetWordId: "b-2",
        clipId: "clip-b",
        trackId: "dialogue",
        sourceStartFrame: 40,
        sourceEndFrame: 50,
        timelineStartFrame: 40,
        timelineEndFrame: 50,
      },
    ]);
  });

  it("maps trimmed words through clip playback rate", () => {
    const projection = buildTimelineTranscriptProjection({
      timelineId: "timeline-main",
      timelineRevision: "revision-8",
      fps: 30,
      durationFrames: 30,
      clips: [
        {
          clipId: "clip-fast",
          assetId: "asset-a",
          timelineStartFrame: 5,
          sourceStartFrame: 10,
          sourceEndFrame: 30,
          playbackRate: 2,
          transcript: {
            sourcePath: "analysis/transcripts/asset-a.json",
            sourceHash: `sha256:${"c".repeat(64)}`,
            words: [
              { id: "a-1", text: "trimmed", startFrame: 8, endFrame: 14 },
              { id: "a-2", text: "fast", startFrame: 20, endFrame: 30 },
            ],
          },
        },
      ],
    });

    expect(projection.words).toMatchObject([
      {
        id: "clip-fast:a-1",
        sourceStartFrame: 10,
        sourceEndFrame: 14,
        timelineStartFrame: 5,
        timelineEndFrame: 7,
      },
      {
        id: "clip-fast:a-2",
        sourceStartFrame: 20,
        sourceEndFrame: 30,
        timelineStartFrame: 10,
        timelineEndFrame: 15,
      },
    ]);
  });
});
