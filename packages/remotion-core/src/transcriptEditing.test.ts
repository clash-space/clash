import { describe, expect, it } from "vitest";
import type { Track } from "./types";

describe("timeline transcript projection", () => {
  it("selects spoken lanes without sending music, SFX, subtitles, or B-roll to ASR", async () => {
    const core = (await import("./index")) as Record<string, any>;
    expect(typeof core.isSpokenMediaTrack).toBe("function");

    const track = (id: string, role: Track["role"], type: "audio" | "video" | "text"): Track => ({
      id,
      name: id,
      role,
      items: type === "text"
        ? [{ id: `${id}-item`, type: "text", text: id, color: "#fff", from: 0, durationInFrames: 30 }]
        : [{ id: `${id}-item`, type, assetId: `${id}-asset`, src: `${id}.${type}`, from: 0, durationInFrames: 30 }],
    });

    expect(core.isSpokenMediaTrack(track("narration", "narration", "audio"), "visuals")).toBe(true);
    expect(core.isSpokenMediaTrack(track("primary", "primary-video", "video"), "primary")).toBe(true);
    expect(core.isSpokenMediaTrack(track("primary", "b-roll", "video"), "primary")).toBe(false);
    expect(core.isSpokenMediaTrack(track("legacy-dialogue", "dialogue" as Track["role"], "audio"), "visuals")).toBe(true);
    expect(core.isSpokenMediaTrack(track("music", "music", "audio"), "visuals")).toBe(false);
    expect(core.isSpokenMediaTrack(track("sfx", "sfx", "audio"), "visuals")).toBe(false);
    expect(core.isSpokenMediaTrack(track("subtitles", "subtitle", "text"), "visuals")).toBe(false);
    expect(core.isSpokenMediaTrack(track("b-roll", "b-roll", "video"), "visuals")).toBe(false);

    const visualSpine = track("visuals", "b-roll", "video");
    const narration = track("voice", "narration", "audio");
    expect(core.selectSpokenMediaTracks([visualSpine, narration], "visuals"))
      .toEqual([narration]);
  });

  it("derives the visible word stream from reusable per-asset transcripts and current clip trims", async () => {
    const core = (await import("./index")) as Record<string, any>;
    expect(typeof core.deriveTimelineTranscriptWords).toBe("function");

    const tracks: Track[] = [
      {
        id: "dialogue",
        name: "Dialogue",
        items: [
          {
            id: "clip-a",
            type: "video",
            assetId: "asset-a",
            src: "a.mp4",
            from: 30,
            durationInFrames: 30,
            sourceStartInFrames: 15,
          },
        ],
      },
    ];
    const words = core.deriveTimelineTranscriptWords({
      tracks,
      fps: 30,
      assetTranscripts: {
        "asset-a": {
          schemaVersion: 1,
          kind: "clash.editor.asset-transcript",
          assetId: "asset-a",
          text: "旧 大家 好",
          durationMs: 1500,
          words: [
            { id: "old", text: "旧", startMs: 0, endMs: 500 },
            { id: "hello", text: "大家", startMs: 500, endMs: 1000 },
            { id: "good", text: "好", startMs: 1000, endMs: 1500 },
          ],
        },
      },
    });

    expect(words).toEqual([
      expect.objectContaining({
        id: "clip-a:hello",
        text: "大家",
        assetId: "asset-a",
        clipId: "clip-a",
        trackId: "dialogue",
        timelineStartFrame: 30,
        timelineEndFrame: 45,
      }),
      expect.objectContaining({
        id: "clip-a:good",
        text: "好",
        timelineStartFrame: 45,
        timelineEndFrame: 60,
      }),
    ]);
  });

  it("reconstructs persisted words from subtitle Text lineage when the ASR cache is not loaded", async () => {
    const core = (await import("./index")) as Record<string, any>;
    expect(typeof core.deriveTimelineTranscriptWordsFromText).toBe("function");

    const words = core.deriveTimelineTranscriptWordsFromText({
      trackId: "voice",
      tracks: [{
        id: "text",
        name: "Text",
        role: "subtitle",
        items: [{
          id: "captions",
          type: "text",
          text: "hello world",
          color: "#fff",
          from: 20,
          durationInFrames: 30,
          cues: [{
            id: "cue",
            text: "hello world",
            startFrame: 20,
            durationInFrames: 30,
            sourceStartFrame: 0,
            sourceEndFrame: 30,
            wordIds: ["caption-hello", "caption-world"],
          }],
          wordRefs: [
            {
              id: "caption-hello",
              text: "hello",
              assetId: "speech",
              assetWordId: "hello",
              clipId: "voice-clip",
              trackId: "voice",
              sourceStartFrame: 0,
              sourceEndFrame: 10,
            },
            {
              id: "caption-world",
              text: "world",
              assetId: "speech",
              assetWordId: "world",
              clipId: "voice-clip",
              trackId: "voice",
              sourceStartFrame: 15,
              sourceEndFrame: 30,
            },
          ],
          sourceToOutputMap: [{
            sourceStartFrame: 0,
            sourceEndFrame: 30,
            outputStartFrame: 20,
            outputEndFrame: 50,
          }],
        }],
      }],
    });

    expect(words).toEqual([
      expect.objectContaining({
        text: "hello",
        trackId: "voice",
        timelineStartFrame: 20,
        timelineEndFrame: 30,
      }),
      expect.objectContaining({
        text: "world",
        trackId: "voice",
        timelineStartFrame: 35,
        timelineEndFrame: 50,
      }),
    ]);
  });

  it("groups word-accurate timing into sentence presentation blocks", async () => {
    const core = (await import("./index")) as Record<string, any>;
    expect(typeof core.deriveTimelineTranscriptSentences).toBe("function");

    const sentences = core.deriveTimelineTranscriptSentences({
      fps: 30,
      words: [
        {
          id: "clip:hello",
          text: "大家好，",
          assetId: "speech",
          assetWordId: "hello",
          clipId: "clip",
          trackId: "voice",
          sourceStartFrame: 0,
          sourceEndFrame: 12,
          timelineStartFrame: 0,
          timelineEndFrame: 12,
        },
        {
          id: "clip:first",
          text: "这是第一句。",
          assetId: "speech",
          assetWordId: "first",
          clipId: "clip",
          trackId: "voice",
          sourceStartFrame: 12,
          sourceEndFrame: 30,
          timelineStartFrame: 12,
          timelineEndFrame: 30,
        },
        {
          id: "clip:second",
          text: "第二句",
          assetId: "speech",
          assetWordId: "second",
          clipId: "clip",
          trackId: "voice",
          sourceStartFrame: 48,
          sourceEndFrame: 66,
          timelineStartFrame: 48,
          timelineEndFrame: 66,
        },
      ],
    });

    expect(sentences).toEqual([
      expect.objectContaining({
        text: "大家好，这是第一句。",
        timelineStartFrame: 0,
        timelineEndFrame: 30,
        wordIds: ["clip:hello", "clip:first"],
      }),
      expect.objectContaining({
        text: "第二句",
        timelineStartFrame: 48,
        timelineEndFrame: 66,
        wordIds: ["clip:second"],
      }),
    ]);
  });

  it("uses editable Text cues as authoritative sentence boundaries", async () => {
    const core = (await import("./index")) as Record<string, any>;
    expect(typeof core.deriveTimelineTranscriptSentencesFromText).toBe("function");

    const sentences = core.deriveTimelineTranscriptSentencesFromText({
      trackId: "voice",
      tracks: [{
        id: "text",
        name: "Text",
        role: "subtitle",
        items: [{
          id: "captions",
          type: "text",
          text: "第一句。第二句。",
          color: "#fff",
          from: 0,
          durationInFrames: 60,
          cues: [
            {
              id: "cue-1",
              text: "第一",
              startFrame: 0,
              durationInFrames: 10,
              wordIds: ["word-1"],
            },
            {
              id: "cue-2",
              text: "句。",
              startFrame: 10,
              durationInFrames: 14,
              wordIds: ["word-2"],
            },
            {
              id: "cue-3",
              text: "第二句。",
              startFrame: 36,
              durationInFrames: 24,
              wordIds: ["word-3"],
            },
          ],
          wordRefs: [
            {
              id: "word-1",
              text: "第一句。",
              assetId: "speech",
              assetWordId: "source-1",
              clipId: "voice-clip",
              trackId: "voice",
              sourceStartFrame: 0,
              sourceEndFrame: 24,
            },
            {
              id: "word-2",
              text: "句。",
              assetId: "speech",
              assetWordId: "source-2",
              clipId: "voice-clip",
              trackId: "voice",
              sourceStartFrame: 10,
              sourceEndFrame: 24,
            },
            {
              id: "word-3",
              text: "第二句。",
              assetId: "speech",
              assetWordId: "source-3",
              clipId: "voice-clip",
              trackId: "voice",
              sourceStartFrame: 36,
              sourceEndFrame: 60,
            },
          ],
        }],
      }],
    });

    expect(sentences).toEqual([
      expect.objectContaining({
        id: "captions:cue-1:sentence",
        text: "第一句。",
        timelineStartFrame: 0,
        timelineEndFrame: 24,
      }),
      expect.objectContaining({
        id: "captions:cue-3",
        text: "第二句。",
        timelineStartFrame: 36,
        timelineEndFrame: 60,
      }),
    ]);
  });
});
