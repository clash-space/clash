# Lower Third MG Fixture

This fixture is an editable first-party motion-graphics overlay. The agent owns
the local `spec.json`; Clash generates preview/projection files explicitly.

```bash
clash production render-mg \
  --spec examples/mg/lower-third/spec.json \
  --out projections/mg/lower-third \
  --rendered-asset assets/overlays/cwd-principle-lower-third.webm \
  --from 42 \
  --json

clash production export-mg-snapshots \
  --spec examples/mg/lower-third/spec.json \
  --asset-id asset-cwd-principle-lower-third-snapshots \
  --out assets/overlays/cwd-principle-lower-third \
  --assets assets/manifest.json \
  --frames 0,18,42 \
  --json

clash production export-mg-video \
  --spec examples/mg/lower-third/spec.json \
  --asset-id asset-cwd-principle-lower-third-video \
  --out assets/overlays/cwd-principle-lower-third.webm \
  --assets assets/manifest.json \
  --json
```

The command writes:

- `projections/mg/lower-third/index.html`: self-contained seekable HTML preview.
- `projections/mg/lower-third/timeline-manifest.json`: overlay manifest for the
  future rendered asset.
- `projections/timelines/cwd-principle-lower-third.mg.timeline.yaml`: timeline
  view/projection.
- `assets/overlays/cwd-principle-lower-third/*.svg`: deterministic local
  snapshot frames.
- `assets/overlays/cwd-principle-lower-third.webm`: playable local MG overlay
  video.
- `assets/overlays/cwd-principle-lower-third.webm.manifest.json`: ffprobe-backed
  export receipt for codec, dimensions, and duration.
- `assets/manifest.json`: local asset entries for the snapshot sequence and
  playable overlay video.

It does not mutate canvas or timeline state. Apply the generated timeline YAML
through the timeline CAS path after review.
