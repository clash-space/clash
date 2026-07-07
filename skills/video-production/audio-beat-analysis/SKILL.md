---
name: audio-beat-analysis
description: Use when analyzing music or audio for BPM, beat grids, downbeats, bar anchors, phrase anchors, sections, drops, energy curves, novelty, and cut-density metadata for MV or beat-synced videos.
---

# Audio Beat Analysis

Use this skill for the analysis stage before MV, AMV/GMV, beat-cut, karaoke, or
music-driven edits.

## Output Files

```text
analysis/audio/probe.json
analysis/audio/beat-grid.json
analysis/audio/sections.json
analysis/audio/energy.json
analysis/audio/cut-density.json
analysis/audio/analysis-report.md
```

Current Clash local command for 16-bit PCM WAV:

```bash
clash production analyze-audio-beats \
  --audio audio/source.wav \
  --target-asset asset-song \
  --out actions/mv-beat-fill.json \
  --fps 30 \
  --json
```

Review the action JSON, then run `clash production apply-metadata` to attach
the beat metadata and emit timeline edit hints plus section cut hints.
When the beat metadata is used to drive an MV timeline projection, run:

```bash
clash production verify-mv-beat-sync \
  --action actions/mv-beat-fill.json \
  --projection projections/timelines/asset-song.mv-beat-cut.timeline-manifest.json \
  --out qa/mv/asset-song.beat-sync-verification.json \
  --json
```

This verification step is the review gate between audio analysis and timeline
apply. It reads only public action/projection artifacts and writes a QA report;
it does not mutate canvas state.
The local action now includes `energyCurve` points and per-section
`energy`/`novelty`/`impact`/`cutDensity` metadata for MV cut-density planning.
It also writes deterministic semantic section metadata
(`semanticLabel`, `semanticConfidence`, `reviewRequired`, `semanticSource`) so
MV planners can distinguish an intro/drop-style section from a plain bar
without treating the heuristic as final music understanding.

When multiple analysis backends or agent-produced result files exist, benchmark
them before choosing the metadata source:

```bash
clash production plan-analysis-benchmark \
  --target-asset asset-song \
  --request benchmarks/beat-backends.json \
  --out actions/beat-backend-benchmark.json \
  --report qa/analysis/beat-backend-benchmark.json \
  --json

clash production apply-metadata \
  --action actions/beat-backend-benchmark.json \
  --assets assets/manifest.json \
  --json
```

The benchmark request compares existing local result files against deterministic
metric thresholds. It does not execute ASR, beat, image, VLM, or provider
backends.

## Beat Grid Schema

```json
{
  "audioAssetId": "asset-song",
  "bpm": 128,
  "fps": 30,
  "beats": [
    { "index": 0, "timeMs": 0, "frame": 0, "beatInBar": 1, "confidence": 0.9 }
  ],
  "downbeats": [0],
  "phraseAnchors": [0],
  "sections": [
    {
      "id": "bar-1",
      "startFrame": 0,
      "endFrame": 60,
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
      "startFrame": 60,
      "endFrame": 120,
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

## Analysis Rules

- Keep raw probe, beat grid, section detection, and cut-density hints separate.
- Convert timestamps to frame numbers for the target timeline fps.
- Report confidence; low confidence means review, not silent auto-cut.
- Preserve both structural labels (`label`: bar/phrase name) and semantic
  labels (`semanticLabel`: intro/drop/etc.) in downstream timeline projections.
- Attach analysis metadata to the audio asset.
- Do not mutate timeline directly; downstream MV skills consume these files.
- The local command is a lightweight RMS peak detector for PCM WAV fixtures.
  It emits BPM, beats, downbeats, 4-beat bar sections, energy/novelty/impact
  curves, section cut-density hints, semantic section labels, and review
  confidence.
  Do not treat it as a full BeatSync-style backend for dense music, tempo
  changes, model-grade verse/chorus detection, lyrics, or compressed audio.

## Migration Notes

BeatSync-style pipelines split beat grid, rhythm features, sections, source
moment selection, and render. Clash should preserve that split in `analysis/`
instead of burying it in one generated timeline.
