---
name: image-consistency-qa
description: Use when QAing image packs, storyboards, character sheets, product images, logo locks, scene sheets, and multi-image continuity before video generation.
---

# Image Consistency QA

Evaluate separate dimensions:

- character identity;
- wardrobe/props;
- scene continuity;
- product/logo/OCR;
- style;
- composition/safe area;
- temporal continuity.

Output `analysis/image/consistency-report.json` with per-dimension scores and a
verdict. Block downstream video generation on approved-reference drift.

For Clash storyboard packs, use the executable local planner:

```bash
clash production plan-storyboard-consistency-qa \
  --target-asset asset-storyboard \
  --characters storyboards/characters.json \
  --scenes storyboards/scenes.json \
  --panels storyboards/panels.json \
  --report projections/storyboards/asset-storyboard.consistency-qa.json \
  --out actions/storyboard-consistency-qa.json \
  --json
```

Current system limit: this deterministic QA checks reference-view completeness,
panel references, panel asset paths, and numeric consistency thresholds. Visual
embedding/OCR/logo/style drift detection still needs a backend.

When approved reference vectors already exist, register them through Clash so
consistency QA can cite stable baseline assets:

```bash
clash production plan-image-embedding-store \
  --target-asset asset-reference-pack \
  --embeddings embeddings/image-baselines.json \
  --out actions/image-embedding-store.json \
  --report qa/image/reference-baselines.embedding-store.json \
  --json
```

This records vector file paths and hashes as asset metadata. It does not run
the embedding backend or perform similarity search by itself.
