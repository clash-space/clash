---
name: music-video-beat-editing
description: Use when making MV, beat-cut videos, music-driven edits, lyric videos, karaoke visuals, AMV/GMV-style edits, or any video where music analysis, beat grids, downbeats, sections, and lyrics alignment drive the timeline.
---

# Music Video Beat Editing

Use this skill when music is the timing source. The core output is not just a
timeline; it is a set of audio intelligence files that explain why every cut
lands where it lands.

## Required Artifacts

```text
audio/source.mp3
analysis/audio/probe.json
analysis/audio/beat-grid.json
analysis/audio/sections.json
analysis/audio/energy.json
analysis/audio/stem-separation-request.json
analysis/lyrics/alignment.json
analysis/video/visual-moments.json
plans/cut-plan.json
projections/timelines/mv.timeline.yaml
exports/final.mp4
```

## Audio Analysis Contract

For local 16-bit PCM WAV sources, generate beat metadata explicitly:

```bash
clash production analyze-audio-beats \
  --audio audio/source.wav \
  --target-asset asset-song \
  --out actions/mv-beat-fill.json \
  --fps 30 \
  --json

clash production apply-metadata \
  --action actions/mv-beat-fill.json \
  --assets assets/manifest.json \
  --json

clash production plan-audio-stem-separation \
  --target-asset asset-song \
  --stems analysis/audio/stem-separation-request.json \
  --out actions/stem-separation.json \
  --json

clash production apply-metadata \
  --action actions/stem-separation.json \
  --assets assets/manifest.json \
  --json

clash production plan-lyrics-alignment \
  --target-asset asset-song \
  --lyrics lyrics.txt \
  --beat-action actions/mv-beat-fill.json \
  --out actions/lyrics-fill.json \
  --json

clash production apply-metadata \
  --action actions/lyrics-fill.json \
  --assets assets/manifest.json \
  --json

clash production plan-visual-moments \
  --target-asset asset-source-video \
  --source-path assets/video/source.mp4 \
  --moments analysis/video/source-moments.json \
  --fps 30 \
  --out actions/visual-moments.json \
  --json

clash production apply-metadata \
  --action actions/visual-moments.json \
  --assets assets/manifest.json \
  --json

clash production project-mv-beat-cuts \
  --action actions/mv-beat-fill.json \
  --audio-src assets/audio/source.wav \
  --clips plans/mv-clips.json \
  --json

clash production verify-mv-beat-sync \
  --action actions/mv-beat-fill.json \
  --projection projections/timelines/asset-song.mv-beat-cut.timeline-manifest.json \
  --out qa/mv/asset-song.beat-sync-verification.json \
  --json

clash production export-timeline-handoff \
  --timeline projections/timelines/asset-song.mv-beat-cut.timeline.yaml \
  --format csv \
  --out exports/handoff/asset-song.mv.timeline.csv \
  --json
```

This writes beat metadata, beat hints, section cut hints, energy/novelty/impact
curves, per-section cut-density hints, semantic section labels with review
confidence, and an optional MV beat-cut timeline projection at
`projections/timelines/<asset>.mv-beat-cut.timeline.yaml`.
`plan-audio-stem-separation` registers already-created local stem files as
`audio-stem` assets with path/hash lineage; it does not execute Demucs, UVR, or
any other separation backend.
`export-timeline-handoff` can convert that projection into CSV rows for an
external editor or review session.
`plan-lyrics-alignment` writes `audio.lyrics-alignment` metadata and a structured
lyric `caption` timeline at `projections/timelines/<asset>.lyrics.caption.timeline.yaml`.
`plan-visual-moments` writes ranked reusable source ranges at
`projections/visual-moments/<asset>.visual-moments.json`; those recommended
clips can be curated into `plans/mv-clips.json`.
It
does not mutate the canvas/timeline; use timeline CAS apply for any edit
decision built from the hints or projection.

`beat-grid.json` should include:

```json
{
  "bpm": 128,
  "beats": [{ "timeMs": 0, "confidence": 0.9, "bar": 1, "beatInBar": 1 }],
  "downbeats": [0],
  "phraseAnchors": [],
  "sections": [
    {
      "id": "bar-1",
      "label": "bar 1",
      "semanticLabel": "intro",
      "semanticConfidence": 0.72,
      "reviewRequired": true,
      "semanticSource": "local-rms-phrase-heuristic",
      "energy": 0.42,
      "novelty": 0.04,
      "impact": 0.42,
      "cutDensity": "medium"
    },
    {
      "id": "bar-2",
      "label": "bar 2",
      "semanticLabel": "drop",
      "semanticConfidence": 0.87,
      "reviewRequired": false,
      "semanticSource": "local-rms-phrase-heuristic",
      "energy": 0.96,
      "novelty": 0.52,
      "impact": 0.96,
      "cutDensity": "fast"
    }
  ],
  "energyCurve": [
    { "frame": 0, "timeSeconds": 0, "normalized": 0.4, "novelty": 0.4, "impact": 0.4 }
  ],
  "confidence": 0.82
}
```

`sections.json` should preserve both structural labels such as `bar 1` and
semantic labels such as `intro` or `drop`. Low-confidence semantic labels must
set `reviewRequired: true`.

`plans/mv-clips.json` should be an array of local visual assets:

```json
[
  { "assetId": "asset-shot-a", "type": "video", "path": "assets/video/shot-a.mp4", "sourceStartFrame": 12 },
  { "assetId": "asset-shot-b", "type": "image", "path": "assets/images/shot-b.png" }
]
```

`project-mv-beat-cuts` maps beat sections to these clips, writes a
`clash.mv.beat-cut.timeline-projection` manifest, and records the required
Timeline pull/apply contract. It creates no lock sidecar.
`verify-mv-beat-sync` writes `clash.mv.beat-sync-verification` QA that proves
the beat metadata has downbeats, section cut-density and review confidence, and
that the MV projection covers those sections through fresh-pull timeline CAS.

## Cut Planning

- Calm sections hold longer.
- Drops and high-impact beats permit faster cuts.
- Prefer downbeats and phrase anchors for major scene changes.
- Lyrics should drive text or visual emphasis; do not blindly cut every word.
- Keep frame-locked timestamps after converting ms to frames.

## Safety

- Do not overwrite source audio.
- Generated clips and beat plans remain separate; timeline apply is CAS.
- If beat confidence is low, mark the plan for review instead of pretending it
  is frame-perfect.
- Current local analyzer only supports 16-bit PCM WAV and lightweight RMS peak
  detection with 4-beat bar sections plus energy/novelty/impact, cut-density
  hints, semantic section labels, and review confidence. The beat-cut
  projection is deterministic section-to-clip mapping only; MP3/AAC decode,
  model-grade verse/chorus/drop detection, true vocal/phoneme lyrics alignment,
  visual moment ranking, and robust multi-tempo section detection remain
  separate system work.

## Migration Notes

BeatSync-style systems split music video creation into beat grid, rhythm
features, sections, source visual library, planning, and frame-locked render.
Clash should store each stage as `analysis/*` metadata attached to the audio or
source video assets.
