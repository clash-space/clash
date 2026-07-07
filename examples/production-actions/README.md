# Production Action Fixtures

These fixtures exercise the local-first production chain:

```text
action JSON -> asset metadata fill -> projections/* -> timeline apply/view
```

Run from this directory:

```bash
clash production apply-metadata --action actions/mv-beat-fill.json --assets assets/manifest.json --json
clash production apply-metadata --action actions/talking-head-fill.json --assets assets/manifest.json --json
clash production apply-metadata --action actions/reference-fill.json --assets assets/manifest.json --json
clash production apply-metadata --action actions/storyboard-fill.json --assets assets/manifest.json --json
clash production plan-text-cut --transcript transcripts/talking-head-words.json --target-asset asset-talk --out actions/talking-head-text-cut.json --min-silence-frames 10 --json
clash production apply-metadata --action actions/talking-head-text-cut.json --assets assets/manifest.json --json
clash production plan-storyboard-review --target-asset asset-storyboard --characters storyboards/characters.json --scenes storyboards/scenes.json --panels storyboards/panels.json --out actions/storyboard-review.json --json
clash production apply-metadata --action actions/storyboard-review.json --assets assets/manifest.json --json
# For local 16-bit PCM WAV audio:
# clash production analyze-audio-beats --audio audio/source.wav --target-asset asset-song --out actions/mv-beat-fill.json --fps 30 --json
# clash production apply-metadata --action actions/mv-beat-fill.json --assets assets/manifest.json --json
```

The command intentionally writes local files only. Canvas/timeline state is
updated later through `clash timeline apply`, preserving CAS.

Beat analysis projections include both beat hints and section cut hints. The
current local analyzer derives 4-beat bar sections from PCM WAV click/peak
energy; semantic song sections still require a richer analyzer.

Storyboard panel entries with `assetId` and project-relative `path` are
registered as `storyboard-panel` assets during `apply-metadata`, so generated
panels become addressable local assets instead of only analysis rows.

Reference review projections include an agent-readable rights ledger under
`projections/rights/`. The default policy keeps public references metadata-only:
no download, source-frame copy, or derivative export is allowed unless rights are
explicitly recorded.
