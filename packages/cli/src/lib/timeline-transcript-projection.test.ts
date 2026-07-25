import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TimelineTranscriptProjectionSchema } from "@clash/shared-types";
import { writeTimelineTranscriptProjection } from "./timeline-transcript-projection";

test("materializes the primary Timeline word map next to the editable DSL", () => {
  const cwd = mkdtempSync(join(tmpdir(), "clash-timeline-transcript-"));
  const timelineFilePath = join(cwd, "timelines", "talk.timeline.yaml");
  const result = writeTimelineTranscriptProjection({
    cwd,
    timelineFilePath,
    timelineId: "talk",
    timelineRevision: "revision-7",
    state: {
      fps: 30,
      durationInFrames: 90,
      primaryTrackId: "story",
      tracks: [{
        id: "story",
        role: "primary-video",
        items: [{
          id: "clip",
          type: "video",
          assetId: "speech",
          from: 0,
          durationInFrames: 90,
          sourceStartInFrames: 0,
        }],
      }],
      assetTranscripts: {
        speech: {
          schemaVersion: 1,
          kind: "clash.editor.asset-transcript",
          assetId: "speech",
          text: "大家 嗯 现在",
          durationMs: 1500,
          backendId: "funasr",
          modelId: "SenseVoiceSmall",
          language: "zh",
          words: [
            { id: "start", text: "大家", startMs: 0, endMs: 500 },
            { id: "filler", text: "嗯", startMs: 500, endMs: 1000 },
            { id: "end", text: "现在", startMs: 1000, endMs: 1500 },
          ],
        },
      },
    },
  });

  assert.ok(result);
  assert.equal(result.wordCount, 3);
  assert.equal(result.filePath, join(cwd, "timelines", "talk.transcript.json"));
  const projection = TimelineTranscriptProjectionSchema.parse(
    JSON.parse(readFileSync(result.filePath, "utf8")),
  );
  assert.deepEqual(projection.words.map((word) => ({
    text: word.text,
    source: [word.sourceStartFrame, word.sourceEndFrame],
    timeline: [word.timelineStartFrame, word.timelineEndFrame],
  })), [
    { text: "大家", source: [0, 15], timeline: [0, 15] },
    { text: "嗯", source: [15, 30], timeline: [15, 30] },
    { text: "现在", source: [30, 45], timeline: [30, 45] },
  ]);
  assert.match(projection.sources[0].transcriptSourcePath, /^timelines\/talk\.transcripts\/speech-[a-f0-9]{8}\.json$/);
  assert.match(projection.sources[0].transcriptSourceHash, /^sha256:[a-f0-9]{64}$/);
});

test("does not invent a transcript projection for a Timeline without primary spoken media", () => {
  const cwd = mkdtempSync(join(tmpdir(), "clash-timeline-transcript-empty-"));
  const result = writeTimelineTranscriptProjection({
    cwd,
    timelineFilePath: join(cwd, "timelines", "still.timeline.yaml"),
    timelineId: "still",
    timelineRevision: "revision-1",
    state: {
      fps: 30,
      durationInFrames: 30,
      primaryTrackId: "story",
      tracks: [{
        id: "story",
        items: [{ id: "still", type: "image", assetId: "image", from: 0, durationInFrames: 30 }],
      }],
      assetTranscripts: {},
    },
  });

  assert.equal(result, null);
});

test("projects narration when the primary visual track is b-roll and excludes music and sfx", () => {
  const cwd = mkdtempSync(join(tmpdir(), "clash-timeline-transcript-narration-"));
  const timelineFilePath = join(cwd, "timelines", "promo.timeline.yaml");
  const result = writeTimelineTranscriptProjection({
    cwd,
    timelineFilePath,
    timelineId: "promo",
    timelineRevision: "revision-voiceover",
    state: {
      fps: 30,
      durationInFrames: 120,
      primaryTrackId: "visuals",
      tracks: [
        {
          id: "visuals",
          role: "b-roll",
          items: [{
            id: "still",
            type: "image",
            assetId: "poster",
            from: 0,
            durationInFrames: 120,
          }],
        },
        {
          id: "voiceover",
          role: "narration",
          items: [{
            id: "voice",
            type: "audio",
            assetId: "speech",
            from: 10,
            durationInFrames: 90,
            sourceStartInFrames: 0,
          }],
        },
        {
          id: "music",
          role: "music",
          items: [{
            id: "bed",
            type: "audio",
            assetId: "bed",
            from: 0,
            durationInFrames: 120,
          }],
        },
        {
          id: "sound-design",
          role: "sfx",
          items: [{
            id: "impact",
            type: "audio",
            assetId: "impact",
            from: 0,
            durationInFrames: 15,
          }],
        },
      ],
      assetTranscripts: {
        speech: {
          assetId: "speech",
          text: "Agent 可编辑",
          durationMs: 1500,
          words: [
            { id: "agent", text: "Agent", startMs: 0, endMs: 500 },
            { id: "editable", text: "可编辑", startMs: 500, endMs: 1500 },
          ],
        },
        bed: {
          assetId: "bed",
          text: "music",
          durationMs: 1000,
          words: [{ id: "music", text: "music", startMs: 0, endMs: 1000 }],
        },
        impact: {
          assetId: "impact",
          text: "boom",
          durationMs: 500,
          words: [{ id: "boom", text: "boom", startMs: 0, endMs: 500 }],
        },
      },
    },
  });

  assert.ok(result);
  assert.equal(result.wordCount, 2);
  const projection = TimelineTranscriptProjectionSchema.parse(
    JSON.parse(readFileSync(result.filePath, "utf8")),
  );
  assert.deepEqual([...new Set(projection.words.map((word) => word.trackId))], ["voiceover"]);
  assert.deepEqual(projection.words.map((word) => word.text), ["Agent", "可编辑"]);
  assert.deepEqual(
    projection.words.map((word) => [word.timelineStartFrame, word.timelineEndFrame]),
    [[10, 25], [25, 55]],
  );
});

test("reconstructs the Agent transcript table from persisted Text lineage after reload", () => {
  const cwd = mkdtempSync(join(tmpdir(), "clash-timeline-transcript-text-lineage-"));
  const timelineFilePath = join(cwd, "timelines", "reloaded.timeline.yaml");
  const result = writeTimelineTranscriptProjection({
    cwd,
    timelineFilePath,
    timelineId: "reloaded",
    timelineRevision: "revision-text-lineage",
    state: {
      fps: 30,
      durationInFrames: 90,
      primaryTrackId: "visuals",
      tracks: [
        {
          id: "visuals",
          role: "b-roll",
          items: [{ id: "picture", type: "video", assetId: "picture", from: 0, durationInFrames: 90 }],
        },
        {
          id: "voiceover",
          role: "narration",
          items: [
            {
              id: "voice",
              type: "audio",
              assetId: "speech",
              from: 0,
              durationInFrames: 18,
              sourceStartInFrames: 0,
            },
            {
              id: "voice-ripple-18-30",
              type: "audio",
              assetId: "speech",
              from: 18,
              durationInFrames: 60,
              sourceStartInFrames: 30,
            },
          ],
        },
        {
          id: "text",
          role: "subtitle",
          items: [{
            id: "captions",
            type: "text",
            text: "hello world",
            from: 0,
            durationInFrames: 30,
            wordRefs: [
              {
                id: "caption-hello",
                text: "hello",
                assetId: "speech",
                assetWordId: "hello",
                clipId: "voice",
                trackId: "voiceover",
                sourceStartFrame: 0,
                sourceEndFrame: 12,
              },
              {
                id: "caption-world",
                text: "world",
                assetId: "speech",
                assetWordId: "world",
                clipId: "voice",
                trackId: "voiceover",
                sourceStartFrame: 30,
                sourceEndFrame: 42,
              },
            ],
          }],
        },
      ],
      assetTranscripts: {},
    },
  });

  assert.ok(result);
  assert.equal(result.wordCount, 2);
  const projection = TimelineTranscriptProjectionSchema.parse(
    JSON.parse(readFileSync(result.filePath, "utf8")),
  );
  assert.deepEqual(projection.words.map((word) => ({
    text: word.text,
    source: [word.sourceStartFrame, word.sourceEndFrame],
    timeline: [word.timelineStartFrame, word.timelineEndFrame],
  })), [
    { text: "hello", source: [0, 12], timeline: [0, 12] },
    { text: "world", source: [30, 42], timeline: [18, 30] },
  ]);
  assert.match(projection.sources[0].transcriptSourcePath, /reloaded\.transcripts/);
});
