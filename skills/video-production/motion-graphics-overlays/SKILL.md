---
name: motion-graphics-overlays
description: Use when creating MG motion graphics, kinetic typography, lower thirds, caption treatments, product callouts, data overlays, transparent overlays, or HTML/Remotion composition layers for Clash videos.
---

# Motion Graphics Overlays

Use this skill for MG 动效 and designed overlays, especially for口播/TVC/product
videos. The deliverable can be an embedded video layer, a transparent overlay, or
a composition source attached to the timeline.

## Inputs

- script segment or transcript range;
- brand tokens: color, type, logo, motion style;
- overlay type: lower third, callout, chart hit, kinetic caption, logo sting;
- output mode: embedded MP4, alpha overlay, or editable composition.

## Pipeline

```text
plans/mg-overlay-plan.json
compositions/overlay-name/
assets/overlays/overlay-name.mp4
assets/overlays/overlay-name.webm
projections/timelines/main.timeline.yaml
```

For first-party HTML MG overlays, write an editable `spec.json` using the
Clash MG composition schema. For managed Clash projects, route the composition
first so the runtime choice is explicit and no fallback is hidden:

```bash
clash production plan-composition-route \
  --request plans/overlay-name.route-request.json \
  --out plans/routes/overlay-name.route.json \
  --json
```

After the route plan selects `html`, generate the local projection explicitly:

```bash
clash production render-mg \
  --spec compositions/overlay-name/spec.json \
  --out projections/mg/overlay-name \
  --rendered-asset assets/overlays/overlay-name.webm \
  --from 0 \
  --json
```

This command writes HTML, a manifest, and a timeline YAML projection. The
HTML preview is self-contained and seekable: it exposes a frame scrubber,
updates `data-current-frame` on the stage, and emits `clash-mg-frame` events
when `window.__CLASH_MG__.seek(frame)` is called. The
manifest includes the required `clash timeline apply` CAS boundary, the
required video-editor node placeholder, and the fresh-pull lock path. The
command does not mint a fake lock and does not apply the projection to
canvas/timeline state. Pull the current timeline lock before apply.

Verify the generated preview before review/apply:

```bash
clash production verify-mg-preview \
  --html projections/mg/overlay-name/index.html \
  --manifest projections/mg/overlay-name/timeline-manifest.json \
  --frames 0,15,30 \
  --out qa/mg/overlay-name.preview-verification.json \
  --json
```

This writes `clash.mg.preview-verification` with self-contained HTML checks,
seek API checks, fresh-pull CAS checks, first-party license checks, and
deterministic per-frame layer evaluations.

To create a real local QA/export asset from the same spec, export deterministic
SVG frame snapshots and register them in `assets/manifest.json`:

```bash
clash production export-mg-snapshots \
  --spec compositions/overlay-name/spec.json \
  --asset-id asset-overlay-name-snapshots \
  --out assets/overlays/overlay-name \
  --assets assets/manifest.json \
  --frames 0,15,30 \
  --json
```

This is not a final MP4/WebM/alpha render. It is a first-party local snapshot
asset for inspection, regression tests, and downstream review.

To create a playable local overlay asset, export the same spec through the
first-party rasterizer and ffmpeg/ffprobe validation:

```bash
clash production export-mg-video \
  --spec compositions/overlay-name/spec.json \
  --asset-id asset-overlay-name-video \
  --out assets/overlays/overlay-name.webm \
  --assets assets/manifest.json \
  --json
```

This writes a `.webm` or `.mp4`, an adjacent `.manifest.json`, and an
`overlay-video` entry in `assets/manifest.json`. The exporter validates codec,
dimensions, duration, and VP9 `alpha_mode=1` for transparent WebM exports
through ffprobe. Transparent WebM exports are also decoded through FFmpeg and
sampled for alpha-plane evidence, so the manifest must show both transparent
and visible pixels before `pixelSampleVerified` is true.

To place an already registered derived overlay asset onto the timeline, produce
an explicit projection instead of editing canvas state directly:

```bash
clash production project-derived-overlay \
  --source-asset asset-source-logo \
  --derived-asset asset-overlay-name-video \
  --media-type video \
  --from 120 \
  --duration 90 \
  --derivation-kind mg-render \
  --description "copy-on-write MG render from approved logo source" \
  --json
```

This writes a `derived-overlay` timeline YAML projection and adjacent manifest
with the required `clash timeline apply` CAS boundary. It requires source and
derived assets to be different and does not create a lock or mutate the canvas.

## Composition Rules

- Keep text readable on mobile.
- Tie animation to frame/time, not wall clock.
- Use stable dimensions and safe area.
- Record fonts, colors, and media sources.
- For captions, keep text source separate from rendered overlay.
- Use CAS when applying overlay items into the timeline.

## HyperFrames/Remotion Split

- Use HTML composition when the agent needs fast, inspectable HTML/CSS/JS.
- Use Remotion when the project already owns React components or render-server
  needs that path.
- Either way, validate render duration, dimensions, transparency expectation, and
  media decode.
- Treat HyperFrames as a research reference only unless a separate license ledger
  explicitly approves vendoring. The default MG manifest must declare a Clash
  first-party renderer, MIT implementation, no external runtime, and no copied
  third-party code.

## Output Contract

```json
{
  "overlayId": "lower-third-001",
  "sourcePath": "projections/mg/lower-third-001/index.html",
  "renderedAssetPath": "assets/overlays/lower-third-001.webm",
  "snapshotAssetPath": "assets/overlays/lower-third-001/manifest.json",
  "videoAssetPath": "assets/overlays/lower-third-001.webm",
  "previewVerificationPath": "qa/mg/lower-third-001.preview-verification.json",
  "derivedOverlayProjection": "projections/timelines/asset-overlay-name-video.derived-overlay.timeline.yaml",
  "casApply": {
    "target": "timeline",
    "mutation": "projection-only",
    "applyCommand": "clash timeline apply",
    "filePath": "projections/timelines/lower-third-001.mg.timeline.yaml",
    "lockPath": "timelines/main.timeline.lock.json",
    "lockRequired": true,
    "lockSource": "fresh-canvas-pull",
    "nodeIdPlaceholder": "<video-editor-node-id>",
    "requiredRuntimeArgs": ["--node <video-editor-node-id>"],
    "pullCommand": "clash timeline pull",
    "pullArgs": ["--node", "<video-editor-node-id>", "--file", "timelines/main.timeline.yaml"],
    "applyArgs": ["--node", "<video-editor-node-id>", "--file", "projections/timelines/lower-third-001.mg.timeline.yaml", "--lock", "timelines/main.timeline.lock.json"]
  },
  "timelineItems": [
    {
      "type": "composition",
      "compositionKind": "motion-graphics",
      "runtime": "html",
      "compositionId": "lower-third-001"
    }
  ],
  "validation": {
    "htmlPreview": true,
    "seekablePreview": true,
    "currentFrameState": "data-current-frame",
    "frameEvent": "clash-mg-frame",
    "snapshotExport": true,
    "videoExport": true,
    "alpha": {
      "verified": true,
      "mode": "vp9-alpha-mode",
      "pixelSampleVerified": true,
      "sample": {
        "transparentPixels": 1024,
        "visiblePixels": 512
      }
    },
    "implementation": {
      "renderer": "clash-first-party-mg-composition",
      "source": "first-party",
      "license": "MIT",
      "thirdPartyCodeCopied": false,
      "externalRuntime": false,
      "researchReferences": ["HyperFrames"]
    }
  }
}
```
