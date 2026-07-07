---
name: asset-metadata-architecture
description: Use when designing Clash media storage, asset registry rows, analysis metadata, immutable media references, copy-on-write behavior, rights metadata, or how image/video/audio/text assets map to canvas paths.
---

# Asset Metadata Architecture

Use this skill when a workflow needs media or analysis files to become durable
project entities. The purpose is to keep agent-editable files useful without
letting agents bypass canvas, CRDT, rights, or lineage rules.

## Entity Types

Model these as first-class project entities:

- `asset`: image, video, audio, text, SVG, Lottie, caption, overlay, export.
- `analysis`: transcript, beat grid, shot list, scene tags, image consistency.
- `plan`: storyboard, cut list, shot list, prompt pack, MG overlay plan.
- `projection`: CAS-protected timeline/canvas/text file.
- `reference`: public source URL, brand file, competitor example, raw footage.

## Recommended Layout

```text
assets/
  originals/
  generated/
  clips/
  overlays/
  exports/
analysis/
  audio/
  transcript/
  video/
  image/
plans/
  cut-plans/
  storyboards/
  prompt-packs/
rights/
  sources.json
```

## Rules

- Asset bytes are immutable by default.
- Editing referenced media creates a new asset and records lineage.
- Agent-readable analysis files are projections of product state, not hidden
  scratch if they influence canvas.
- Rights/source metadata travels with public references and derivatives.
- Generated assets keep model, prompt, seed/config if available, source asset ids,
  and review status.
- Text nodes that are used downstream follow the same copy-on-write rule as
  images and videos.

## Required Metadata

Every asset-like file should be representable as:

```json
{
  "id": "asset-id",
  "projectId": "project-id",
  "kind": "image | video | audio | text | caption | overlay | export | reference",
  "path": "assets/generated/example.mp4",
  "source": { "type": "generated | imported | derived | public-reference" },
  "lineage": { "parents": [], "operation": "string" },
  "rights": { "license": "unknown", "sourceUrl": null, "allowedUses": [] },
  "analysis": [],
  "createdBy": "user | agent | system"
}
```

## System Gaps To Surface

Call out missing `media.asset-registry`, `media.analysis-store`,
`media.copy-on-write`, and `media.rights-ledger` explicitly. Do not hide them
inside workflow prose.
