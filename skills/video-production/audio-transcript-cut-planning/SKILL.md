---
name: audio-transcript-cut-planning
description: Use when turning word-level ASR into safe text-based cuts: filler words, 语气词, 口癖, repeated phrases, long silences, caption cleanup, padding, crossfades, and reviewable cut plans.
---

# Transcript Cut Planning

Use this skill after ASR has produced word-level timestamps. It produces a cut
plan, caption projection, and optionally a new non-destructive rendered video
asset.

For Clash's current local planner:

```bash
clash production plan-text-cut \
  --transcript analysis/transcripts/words.json \
  --target-asset asset-talk \
  --out actions/talking-head-text-cut.json \
  --json
```

Then review the action JSON and run `clash production apply-metadata` to emit
metadata and caption timeline projections. The caption projection uses
`caption` items with cue `wordIds`, source frame ranges, `wordRefs`, and
`sourceToOutputMap`. Do not mutate canvas/timeline state without the explicit
CAS apply step. The transcript JSON may include `backendId`, `modelId`,
`language`, `durationFrames`, and `averageConfidence`; `plan-text-cut` records
the transcript file path/hash and those ASR fields in `talking-head.analysis`.

After review, create a media cut package or ffprobe-validated rendered clean
clip. `export-text-cut-media --render` refuses to render while the action still
has `review` cuts; export without `--render` first when you need a package that
lists pending `reviewRanges`.

```bash
clash production export-text-cut-media \
  --action actions/talking-head-text-cut.json \
  --source-asset asset-talk \
  --output-asset asset-talk-clean \
  --out assets/video/asset-talk-clean.mp4 \
  --assets assets/manifest.json \
  --render \
  --json

clash production export-captions \
  --timeline projections/timelines/asset-talk.caption.timeline.yaml \
  --format vtt \
  --out exports/captions/asset-talk-clean.vtt \
  --json

clash production project-caption-overlay \
  --timeline projections/timelines/asset-talk.caption.timeline.yaml \
  --out projections/timelines/asset-talk.caption-overlay.timeline.yaml \
  --json

clash production export-timeline-handoff \
  --timeline projections/timelines/asset-talk.caption.timeline.yaml \
  --format csv \
  --out exports/handoff/asset-talk-clean.timeline.csv \
  --json
```

## Input Contract

```text
analysis/transcripts/words.json
media/source.mp4
```

Each word should include `id`, `text`, `startFrame`, and `endFrame`. Words may
also include `confidence` and `speakerId`; transcript-level provenance can
include backend/model/language and average confidence.

## Output Contract

```text
actions/talking-head-text-cut.json
projections/metadata/<asset-id>.talking-head.analysis.json
projections/transcripts/<asset-id>.asr-transcript.json
projections/media-cuts/<asset-id>.transcript-cut-plan.json
projections/timelines/<asset-id>.caption.timeline.yaml
projections/timelines/<asset-id>.caption-overlay.timeline.yaml
projections/media-cuts/<output-asset-id>.media-cut.json
projections/media-cuts/<output-asset-id>.ffconcat
assets/video/<output-asset-id>.mp4
exports/captions/<output-asset-id>.srt
exports/captions/<output-asset-id>.vtt
exports/handoff/<output-asset-id>.timeline.csv
reviews/cut-plan-review.md
```

## Rules

- `subtitle-only` mode is allowed without video cuts.
- Audio/video cuts require word timestamps.
- Do not delete discourse markers that carry meaning.
- Every proposed deletion needs reason, confidence, and preview metadata.
- Filler words and word-gap silences may be automatic delete suggestions;
  tone-particle and adjacent-repeat suggestions are review cuts by default.
- Source media remains immutable; apply creates a new timeline/clip/export.
- Plain `text` clips are allowed for overlays but do not count as a structured
  caption system;字幕 projections should be `caption` items.
- Use `clash production export-captions` when the user needs SRT/VTT/ASS sidecars
  for review, upload, or ad delivery.
- Use `clash production project-caption-overlay` when the caption timeline needs
  an explicit CAS-required subtitle overlay projection for preview/apply.
- Use `clash production export-timeline-handoff` when a human editor or external
  NLE needs a CSV timeline review sheet.
- Rendered text-cut media must be registered as a new asset with source lineage.
- Do not render pending review cuts; approve, remove, or rewrite them before
  creating a rendered media asset.

## Cut Reasons

Use a controlled reason value:

- `silence`
- `filler`
- `tone-particle`
- `repeat`
- `false-start`
- `manual`

## Safety

Aggressive mode requires explicit review. Conservative mode may auto-propose but
still should not directly overwrite any source asset.
