---
name: audio-lyrics-alignment
description: Use when aligning lyrics to audio for MV, karaoke, lyric videos, subtitles, word/syllable timing, unmatched ranges, confidence reporting, and optional vocal stem preparation.
---

# Lyrics Alignment

Use this skill after audio probe and before MV timeline planning.

Artifacts:

```text
analysis/lyrics/alignment.json
analysis/lyrics/unmatched-ranges.json
```

For first-party managed execution, generate the metadata-fill action from lyric
lines and existing beat analysis. If a vocal stem was prepared by a local tool
or another agent, register it first instead of passing an untracked path:

```bash
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

clash production export-captions \
  --timeline projections/timelines/asset-song.lyrics.caption.timeline.yaml \
  --format vtt \
  --out exports/captions/asset-song.lyrics.vtt \
  --json
```

This writes `audio.lyrics-alignment` metadata, an agent-readable
`projections/lyrics/<asset>.lyrics-alignment.json`, and a structured `caption`
timeline at `projections/timelines/<asset>.lyrics.caption.timeline.yaml`.
Caption sidecar export can turn that view into SRT/VTT/ASS for karaoke or platform
upload. The current implementation is a beat-section heuristic, not a vocal
forced alignment backend. Stem registration records local path/hash lineage and
does not execute stem separation backends.

Include:

- line, word, and optional syllable units;
- `startMs`, `endMs`, frame at target fps;
- confidence and source backend;
- unmatched text/audio ranges;
- optional `vocalStemAssetId`.

Low confidence requires review instead of automatic karaoke timing.
