---
name: caption-retime-and-render
description: Use when captions must be regenerated or retimed after text-based cuts, filler deletion, silence removal, MV lyrics timing, or TVC disclaimer timing.
---

# Caption Retime and Render

Use this skill after `plans/cuts.json` or lyrics alignment exists.

Inputs:

- `transcript/words.json` or `analysis/lyrics/alignment.json`
- `plans/cuts.json`
- `sourceToOutputMap`
- caption `wordRefs`

Outputs:

- `captions/captions.json`
- `projections/timelines/<asset-id>.caption.timeline.yaml`
- `projections/timelines/<asset-id>.caption-overlay.timeline.yaml`
- `projections/timelines/<asset-id>.caption-overlay.timeline-manifest.json`
- `projections/caption-burn/<asset-id>.caption-burn.json`
- optional `.srt`, `.vtt`, `.ass`
- optional rendered overlay asset

Current local caption sidecar export:

```bash
clash production export-captions \
  --timeline projections/timelines/<asset-id>.caption.timeline.yaml \
  --format srt \
  --out exports/captions/<asset-id>.srt \
  --json

clash production export-captions \
  --timeline projections/timelines/<asset-id>.caption.timeline.yaml \
  --format vtt \
  --out exports/captions/<asset-id>.vtt \
  --json

clash production export-captions \
  --timeline projections/timelines/<asset-id>.caption.timeline.yaml \
  --format ass \
  --out exports/captions/<asset-id>.ass \
  --json

clash production project-caption-overlay \
  --timeline projections/timelines/<asset-id>.caption.timeline.yaml \
  --out projections/timelines/<asset-id>.caption-overlay.timeline.yaml \
  --json

clash production export-caption-burn \
  --timeline projections/timelines/<asset-id>.caption.timeline.yaml \
  --source-asset <source-video-asset-id> \
  --output-asset <asset-id>-caption-burn \
  --out assets/video/<asset-id>-caption-burn.mp4 \
  --assets assets/manifest.json \
  --json
```

This consumes structured `caption` timeline items and writes a
`clash.caption.export` manifest next to the sidecar file. The overlay
projection command writes a `clash.caption.timeline-overlay` manifest with
Remotion preview renderer metadata and an explicit `clash timeline apply` CAS
boundary. The caption burn command writes an ASS sidecar, an FFmpeg plan, a
copy-on-write `clash.caption.burn-in-export` package, and a derived asset
manifest entry; add `--render` only after review to render the burned-in video.

Rules:

- Captions use output timestamps, not original source timestamps.
- Deleted words disappear from captions unless `subtitle-only` mode is used.
- Every cue should carry `wordIds`, `sourceStartFrame`, and `sourceEndFrame`.
- Timeline caption items should include `wordRefs` and `sourceToOutputMap`;
  plain `text` clips are text overlays, not a complete字幕 system.
- Disclaimers in ads must satisfy minimum visible duration and safe area.
