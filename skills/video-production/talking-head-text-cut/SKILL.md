---
name: talking-head-text-cut
description: Use when editing talking-head, interview, podcast, course, or口播 videos with ASR, transcript editing, silence removal, filler word deletion, tone-particle cleanup, captions, MG overlays, and text-based cuts.
---

# Talking Head Text Cut

Use this skill for口播剪辑. The user usually wants to remove pauses, filler
words,语气词,口癖, repeated phrases, or boring sections while preserving the
speaker's meaning and rhythm.

## Required Artifacts

```text
media/source.mp4
analysis/transcripts/words.json
actions/talking-head-text-cut.json
projections/metadata/<asset-id>.talking-head.analysis.json
projections/transcripts/<asset-id>.asr-transcript.json
projections/timelines/main.timeline.yaml
projections/timelines/<asset-id>.caption-overlay.timeline.yaml
projections/media-cuts/<output-asset-id>.media-cut.json
projections/caption-burn/<output-asset-id>.caption-burn.json
assets/video/<output-asset-id>.mp4
exports/final.mp4
```

For existing word-level timestamps, generate the action explicitly:

```bash
clash production plan-text-cut \
  --transcript analysis/transcripts/words.json \
  --target-asset asset-talk \
  --out actions/talking-head-text-cut.json \
  --min-silence-frames 15 \
  --json

clash production apply-metadata \
  --action actions/talking-head-text-cut.json \
  --assets assets/manifest.json \
  --json

clash production export-text-cut-media \
  --action actions/talking-head-text-cut.json \
  --source-asset asset-talk \
  --output-asset asset-talk-clean \
  --out assets/video/asset-talk-clean.mp4 \
  --assets assets/manifest.json \
  --render \
  --json

clash production verify-caption-lineage \
  --timeline projections/timelines/asset-talk.caption.timeline.yaml \
  --out qa/captions/asset-talk.caption-lineage.json \
  --json

clash production export-captions \
  --timeline projections/timelines/asset-talk.caption.timeline.yaml \
  --format srt \
  --out exports/captions/asset-talk-clean.srt \
  --json

clash production project-caption-overlay \
  --timeline projections/timelines/asset-talk.caption.timeline.yaml \
  --out projections/timelines/asset-talk.caption-overlay.timeline.yaml \
  --json

clash production export-caption-burn \
  --timeline projections/timelines/asset-talk.caption.timeline.yaml \
  --source-asset asset-talk-clean \
  --output-asset asset-talk-clean-caption-burn \
  --out assets/video/asset-talk-clean-caption-burn.mp4 \
  --assets assets/manifest.json \
  --json

clash production export-timeline-handoff \
  --timeline projections/timelines/asset-talk.caption.timeline.yaml \
  --format csv \
  --out exports/handoff/asset-talk-clean.timeline.csv \
  --json
```

This writes metadata, a structured caption timeline projection with cue word
references and source-to-output maps, a non-destructive media cut package, and
optionally a rendered clean video asset with ffprobe validation. Rendering is
allowed only when the plan has no `review` cuts; tone-particle and adjacent
repeat suggestions are recorded as `reviewRanges` until a user or agent
explicitly approves or removes them. Caption
sidecar export consumes the `caption` timeline view and writes SRT/VTT/ASS plus a
manifest. Caption overlay projection writes a caption-only subtitle timeline
view plus `clash.caption.timeline-overlay` manifest for preview/apply. Caption
burn export writes an ASS sidecar, FFmpeg plan, copy-on-write
`clash.caption.burn-in-export` package, and derived asset manifest entry; pass
`--render` only when the reviewed plan should actually render a burned-in video.
Timeline handoff writes CSV rows for external NLE review. These commands do not
overwrite source media and do not mutate canvas/timeline state. Use timeline CAS
apply after review.
Caption lineage verification writes `clash.caption.lineage-verification` and
blocks plain `text` timeline items from masquerading as a complete subtitle
system.

`analysis/transcripts/words.json` may include `backendId`, `modelId`,
`language`, `durationFrames`, and `averageConfidence`. `plan-text-cut` records
the transcript file path/hash and those ASR fields in `talking-head.analysis`;
`apply-metadata` writes a readable
`projections/transcripts/<asset-id>.asr-transcript.json` projection. This is
ASR provenance recording, not ASR backend execution.

## Strategy Modes

- `subtitle-only`: clean captions/text, do not cut audio/video.
- `conservative`: remove clear standalone filler in pauses.
- `balanced`: remove obvious filler phrases and long dead air.
- `aggressive`: compress strongly; requires preview and undo.

Without word-level timestamps, only use `subtitle-only`.

## Cut Plan Contract

```json
{
  "metadataKind": "talking-head.analysis",
  "metadata": {
    "kind": "talking-head.analysis",
    "disfluencies": [
      {
        "type": "filler",
        "text": "嗯",
        "startFrame": 12,
        "endFrame": 18,
        "requiresReview": false,
        "confidence": 0.92,
        "detectionSource": "configured-token"
      },
      {
        "type": "tone-particle",
        "text": "啊",
        "startFrame": 42,
        "endFrame": 48,
        "requiresReview": true,
        "confidence": 0.72,
        "detectionSource": "configured-token"
      },
      {
        "type": "silence",
        "startFrame": 18,
        "endFrame": 30,
        "requiresReview": false,
        "confidence": 0.98,
        "detectionSource": "word-gap"
      }
    ],
    "cuts": [
      { "action": "keep", "sourceStartFrame": 0, "sourceEndFrame": 12 },
      {
        "action": "delete",
        "sourceStartFrame": 12,
        "sourceEndFrame": 18,
        "reason": "filler",
        "requiresReview": false,
        "confidence": 0.92,
        "detectionSource": "configured-token"
      },
      {
        "action": "review",
        "sourceStartFrame": 42,
        "sourceEndFrame": 48,
        "reason": "tone-particle",
        "requiresReview": true,
        "confidence": 0.72,
        "detectionSource": "configured-token"
      }
    ],
    "captionCues": [
      {
        "id": "cue-1",
        "startFrame": 0,
        "durationInFrames": 12,
        "text": "大家好",
        "wordIds": ["w1", "w2"],
        "sourceStartFrame": 0,
        "sourceEndFrame": 12
      }
    ]
  }
}
```

## Rules

- Do not remove semantic words just because they look like filler.
- Keep every removal explainable.
- Preserve audio/video sync.
- Source footage is immutable; output a new clip/timeline/export.
- Captions are regenerated from the retained transcript as `caption` timeline
  items with `wordRefs` and `sourceToOutputMap`; plain `text` timeline items
  are not a complete subtitle system.
- MG overlays are separate assets or composition layers, not burned into source
  unless exporting final video.
- Current planner handles configured filler/tone-particle tokens, adjacent
  repeated words, and silence gaps between word timestamps. Filler tokens and
  silence gaps are automatic delete suggestions; tone particles and adjacent
  repeats are review suggestions by default and are not rendered until approved.
  `export-text-cut-media` can turn a review-clean cut plan into a new
  ffprobe-validated local video asset with FFmpeg, `export-captions` writes
  SRT/VTT/ASS sidecars from the caption
  timeline projection, `verify-caption-lineage` writes a pass/blocked QA report
  over cues, `wordRefs`, and `sourceToOutputMap`, `project-caption-overlay`
  writes a CAS-required caption
  overlay timeline projection for preview/apply, `export-caption-burn` writes a
  copy-on-write caption-burn package plus optional FFmpeg render, and
  `export-timeline-handoff` writes CSV for external NLE review. Full ASR,
  waveform VAD/RMS, semantic discourse-marker scoring, broader false-start
  analysis, crossfades, batch review, and OTIO/EDL handoff remain separate
  system work.

## Migration Notes

CutScript suggests word-level transcript editing, filler removal, caption export,
and FFmpeg export. auto-editor suggests silence/loudness methods, margins, and
NLE export. Clash should express these as transcript analysis plus a cut plan
that applies to timeline through CAS.
