---
name: composition-runtime-router
description: Use when choosing between Remotion, HTML/HyperFrames-style rendering, FFmpeg, Manim, or future renderers, including runtime availability, fallback decisions, and validation.
---

# Composition Runtime Router

Use this skill to route a renderable composition.

The skill should stay portable: first write a readable route request file in the
project/cwd, then let Clash management produce the route plan when available.
Clash owns the action execution, runtime decision log, and managed projection
boundaries; the skill owns the artifact contract and creative workflow.

Renderer choices:

- Remotion: React timeline/editor integration.
- HTML/HyperFrames-style: agent-readable HTML/CSS/JS MG overlays.
- FFmpeg: trims, concatenation, transcodes, simple overlays.
- Manim: math/diagram-heavy generated animation.

Rules:

- Do not silently fallback between renderers.
- Emit a decision log with unavailable runtimes and tradeoffs.
- Validate output duration, dimensions, fps, audio, and frame nonblankness.

## Clash Managed Route Plan

For managed local projects, create a request like:

```json
{
  "compositionId": "lower-third-001",
  "compositionKind": "motion-graphics",
  "requirements": ["agent-readable", "interactive-preview", "transparent-overlay"],
  "availableRuntimes": ["html", "ffmpeg"],
  "inputPath": "compositions/lower-third-001/spec.json",
  "outputPath": "projections/mg/lower-third-001/index.html"
}
```

Then ask Clash to turn it into an auditable route plan:

```bash
clash production plan-composition-route \
  --request plans/lower-third.route-request.json \
  --out plans/routes/lower-third.route.json \
  --json
```

The plan uses `kind: "clash.render.composition-route"` and records
`selectedRuntime`, `validationPlan`, `decisionLog`, `blockedReasons`,
`rejectedFallbacks`, and `fallbackUsed: false`.

If a request requires React/timeline-editor integration and Remotion is not
available, the managed route must be `blocked`. Do not route it to HTML or
FFmpeg as an automatic substitute.

React/Remotion composition sources are not themselves timeline-preview assets.
Before writing a `composition` timeline item with `runtime: "react"` or
`runtime: "remotion"`, render or register a local `renderedAssetPath` such as
`assets/renders/<composition-id>.webm`. Timeline apply rejects non-HTML
composition items without that local rendered preview asset.

For an already rendered Remotion route, project the registered asset into the
timeline through Clash rather than editing canvas internals:

```bash
clash production project-composition-timeline \
  --route plans/routes/react-chart.route.json \
  --rendered-asset asset-react-chart-render \
  --from 30 \
  --duration 120 \
  --json
```

This writes `projections/timelines/<composition-id>.composition.timeline.yaml`
and a `composition-timeline-projection` manifest. The projection is still only a
draft view until applied with `clash timeline apply` using a fresh
`clash timeline pull` observation.
