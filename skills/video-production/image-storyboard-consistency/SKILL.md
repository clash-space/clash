---
name: image-storyboard-consistency
description: Use when creating or QAing image packs for video: character identity sheets, three-view character sheets, scene boards, product boards, storyboard panels, style references, and multi-image consistency checks.
---

# Image Storyboard Consistency

Use this skill whenever images are preproduction assets for video. The goal is
not one nice image; it is a consistent asset pack the video pipeline can reuse.

## Asset Packs

```text
assets/reference-sheets/characters/
assets/reference-sheets/scenes/
assets/reference-sheets/products/
storyboards/panels/
analysis/image/consistency-report.json
plans/prompt-pack.json
```

## Character Sheet Contract

```json
{
  "characterId": "protagonist",
  "identityAnchors": ["face shape", "hair", "wardrobe", "age"],
  "views": [
    {
      "kind": "front",
      "assetId": "asset-front",
      "assetPath": "assets/reference-sheets/characters/protagonist-front.png",
      "locked": true,
      "copyOnWriteRequired": true
    },
    {
      "kind": "side",
      "assetId": "asset-side",
      "assetPath": "assets/reference-sheets/characters/protagonist-side.png",
      "locked": true,
      "copyOnWriteRequired": true
    },
    {
      "kind": "back",
      "assetId": "asset-back",
      "assetPath": "assets/reference-sheets/characters/protagonist-back.png",
      "locked": true,
      "copyOnWriteRequired": true
    }
  ],
  "negativePrompts": [],
  "locked": true
}
```

## Storyboard Rules

Current local planner:

```bash
clash production plan-storyboard-review \
  --target-asset asset-storyboard \
  --characters storyboards/characters.json \
  --scenes storyboards/scenes.json \
  --panels storyboards/panels.json \
  --out actions/storyboard-review.json \
  --json
```

Review the action JSON, then run `clash production apply-metadata` to emit the
storyboard projection, register panel assets in `assets/manifest.json` when
panel entries include `assetId` and project-relative `path`, and register
character reference sheets when character entries include `referenceViews`.
This does not run embedding/OCR QA.

Use `referenceViews` in `storyboards/characters.json` when locked character
sheets already exist as files:

```json
{
  "id": "hero",
  "name": "便利店店员",
  "referenceAssetIds": ["asset-hero-front", "asset-hero-side", "asset-hero-back"],
  "requiredViews": ["front", "side", "back"],
  "referenceViews": [
    {
      "view": "front",
      "assetId": "asset-hero-front",
      "path": "assets/reference-sheets/characters/hero-front.png",
      "locked": true,
      "copyOnWriteRequired": true
    }
  ]
}
```

Managed apply attaches `image.character-reference-sheet` metadata to each
declared asset with `downstreamUsage: "identity-reference"`. Do not point this
field at a mutable draft file; create a new asset id for revisions.

To prepare image/video generation prompts without mutating canvas state, project
a CAS-locked prompt pack, edit the JSON file, then apply it explicitly:

```bash
clash production project-storyboard-prompt-pack \
  --action actions/storyboard-review.json \
  --out plans/prompt-pack.json \
  --style "vertical short drama, cinematic light" \
  --negative "logo drift, extra fingers" \
  --json

clash production apply-storyboard-prompt-pack \
  --file plans/prompt-pack.json \
  --lock plans/prompt-pack.lock.json \
  --json

clash production replace-storyboard-prompt-pack \
  --file plans/prompt-pack.json \
  --lock plans/prompt-pack.lock.json \
  --json
```

Managed apply writes `projections/storyboards/<asset>.prompt-pack.json`. If the
managed prompt-pack changed since the lock was pulled, apply is rejected unless
the user intentionally passes `--force`. Use `replace-storyboard-prompt-pack`
when the edit should become a versioned copy-on-write prompt-pack projection
while existing downstream references keep pointing at the old managed
projection.

To turn approved storyboard panel assets into a timeline view, project them
explicitly:

```bash
clash production project-storyboard-timeline \
  --action actions/storyboard-review.json \
  --duration-per-panel 45 \
  --json

clash production verify-storyboard-timeline \
  --action actions/storyboard-review.json \
  --manifest projections/timelines/asset-storyboard.storyboard.timeline-manifest.json \
  --min-consistency 0.75 \
  --out qa/storyboards/asset-storyboard.timeline-verification.json \
  --json
```

This writes a `clash.storyboard.timeline-projection` manifest and
`projections/timelines/<asset>.storyboard.timeline.yaml` with image timeline
items. It reports the required CAS lock path and never creates a fake lock.
The verification report proves panel coverage, timeline item coverage,
fresh-pull CAS, local asset paths, and panel consistency thresholds before the
timeline projection is applied.

Before moving storyboard panels into video generation, run the executable
consistency QA planner:

```bash
clash production plan-storyboard-consistency-qa \
  --target-asset asset-storyboard \
  --characters storyboards/characters.json \
  --scenes storyboards/scenes.json \
  --panels storyboards/panels.json \
  --out actions/storyboard-consistency-qa.json \
  --report projections/storyboards/asset-storyboard.consistency-qa.json \
  --min-consistency 0.75 \
  --json
```

This writes a QA report and a normal `image.storyboard-consistency`
metadata-fill action. The current QA is deterministic: required reference views,
panel scene/character references, panel asset paths, and panel consistency score
thresholds. It does not perform visual embedding, OCR, or logo checks yet.

- Separate identity reference, scene reference, and action prompt.
- Store prompt pack and generated panel ids.
- Give generated storyboard panels stable `assetId` values and local
  project-relative `path` values so apply can register them as assets.
- Do not overwrite approved references; create variants.
- For product images, preserve packaging, logo, color, and legal claims.
- Run consistency QA before video generation.

## QA Dimensions

- character identity;
- wardrobe and props;
- scene continuity;
- product/logo accuracy;
- composition and safe area;
- temporal continuity across panels;
- style drift.

## Migration Notes

Multi-image generation research clusters around multi-view, character, temporal,
and semantic consistency. For Clash, these become separate analysis dimensions
attached to image assets and storyboards.
