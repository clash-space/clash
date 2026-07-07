---
name: reference-video-ingest-analysis
description: Use when importing or analyzing public reference videos, YouTube/TikTok/Reels examples, hotspot video复刻, TVC references, yt-dlp downloads, rights ledgers, shot breakdowns, and visual moment libraries.
---

# Reference Video Ingest Analysis

Use this skill when a workflow starts from a public reference video. The goal is
to learn structure and extract analysis, not to silently copy or redistribute.

## Required Artifacts

```text
references/source-ledger.json
analysis/video/reference-001-shots.json
analysis/video/reference-001-visual-moments.json
analysis/video/reference-001-remix-constraints.md
projections/rights/asset-reference.rights-ledger.json
```

Current safe Clash entrypoint starts with a controlled download plan. It is
blocked by default:

```bash
clash production plan-reference-download \
  --source-url https://example.com/video \
  --target-asset asset-reference \
  --out references/downloads/asset-reference.download-plan.json \
  --json
```

Without `--allow-download`, the plan is blocked and records why. When the user
and rights ledger explicitly allow local reference capture, produce the reviewed
command plan:

```bash
clash production plan-reference-download \
  --source-url https://example.com/video \
  --target-asset asset-reference \
  --allow-download \
  --license analysis-only \
  --allowed-uses analysis-only,shot-breakdown \
  --out references/downloads/asset-reference.download-plan.json \
  --json
```

The plan writes a `yt-dlp` command, raw-reference quarantine path, rights
ledger, and final-export guard. The executable command surface is intentionally
narrow: `downloadCommand[0]` must remain `yt-dlp`, and local-execution options
such as `--exec`, `--exec-before-download`, custom external downloaders, and
postprocessor argument hooks are rejected before any runner is invoked. If
download is permitted, execute the reviewed plan explicitly:

```bash
clash production execute-reference-download \
  --plan references/downloads/asset-reference.download-plan.json \
  --assets assets/manifest.json \
  --out references/downloads/asset-reference.download-receipt.json \
  --json
```

The receipt registers `reference.download` metadata on a quarantined raw
reference asset for analysis. Raw reference media still cannot enter final
exports unless rights explicitly allow it.

Then write reference metadata:

```bash
clash production plan-reference-review \
  --source-url https://example.com/video \
  --target-asset asset-reference \
  --shots analysis/video/reference-001-shots.json \
  --out actions/reference-review.json \
  --json
```

Run `clash production apply-metadata` after reviewing the action to write the
metadata projection, reference review projection, rights ledger projection, and
`projections/references/<asset-id>.shot-analysis.json`. The shot-analysis
projection is analysis-only: it records `mediaCopied: false`, allowed/
prohibited uses from the rights ledger, and cannot by itself grant final export
rights.

When candidate ranges already exist from an agent or external analyzer, index
them as visual moments without copying source frames:

```bash
clash production plan-visual-moments \
  --target-asset asset-reference \
  --source-path references/raw/reference-001.mp4 \
  --moments analysis/video/reference-001-visual-moments.json \
  --fps 30 \
  --out actions/reference-visual-moments.json \
  --json
```

Apply writes `video.visual-moments` metadata and
`projections/visual-moments/<asset>.visual-moments.json`. This is still analysis
metadata; raw reference media cannot enter final exports unless the rights
ledger allows it.

## Rights Ledger

```json
{
  "assetId": "asset-reference",
  "sourceUrl": "https://example.com/video",
  "rights": { "license": "unknown", "redistributionAllowed": false, "derivativeAllowed": false },
  "remixAllowed": false,
  "blockedReasons": ["derivative use is not allowed", "redistribution is not allowed"],
  "allowedUses": ["metadata-analysis", "shot-analysis", "non-copying-reference"],
  "prohibitedUses": ["download-source", "copy-frames", "export-derivative"]
}
```

## Analysis Dimensions

- shot boundaries and timestamps;
- visible subject, product, action, text, camera move;
- audio/dialogue/music cues if available;
- platform format and safe area;
- what can be structurally remixed without copying exact frames.

## Rules

- Record the source and rights decision before analysis.
- Keep raw downloaded references separate from generated assets.
- Do not use source frames as final output unless rights allow it.
- Downstream TVC/hotspot skills consume shot/structure analysis and produce new
  assets.
