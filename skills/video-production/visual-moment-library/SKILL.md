---
name: visual-moment-library
description: Use when analyzing source footage into reusable moments for MV, TVC, reference remix, or short drama, including scene changes, motion, quality, action, emotion, semantic tags, and source ranges.
---

# Visual Moment Library

Create `analysis/video/visual-moments.json`.

For managed local execution, turn candidate ranges into asset metadata and an
agent-readable projection:

```bash
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
```

This writes `video.visual-moments` metadata and
`projections/visual-moments/<asset>.visual-moments.json` with ranked
`recommendedClips`. It indexes source ranges; it does not copy frames into final
exports.

Each candidate should include:

- source asset id;
- start/end/peak timestamps;
- scene index;
- motion, sharpness, brightness, contrast;
- action/beauty/tension/soft scores;
- semantic tags;
- whether AI/VLM analysis was used.

The library is analysis metadata. It does not copy source frames into final
exports unless rights and lineage allow it.
