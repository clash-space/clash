---
name: clash-timeline
description: Open, inspect, create, and edit Clash Project Timelines through the bundled Timeline GUI and typed MCP tools.
---

# Clash Timeline

Use the bundled `clash_timeline_*` tools whenever the user asks to open, inspect,
create, attach, detach, copy, or edit a Clash Timeline.

## Workspace scope

Always pass the current task workspace's absolute `cwd` to Timeline tools. The
workspace should contain `.clash/project.toml`; the plugin process itself runs
from its installed package directory and must not be treated as the project.

## GUI workflow

1. Call `clash_timeline_open` with the workspace `cwd` and an optional
   `timelineId`.
2. Let the embedded GUI read and edit the returned Timeline state.
3. Save GUI edits through `clash_timeline_save`. This performs a Timeline read,
   writes the normal `timelines/<id>.timeline.yaml` projection, validates it,
   and applies it through the real Clash CLI contract.

## Tool workflow

- Call `clash_timeline_schema` before authoring an unfamiliar Timeline field.
  It returns the annotation-generated catalog for every root, track, common
  item, and type-specific item field; the operation catalog; stable semantic
  rule IDs; exact units and constraints; and executable examples. Do not guess
  field names from UI labels.
- Call `clash_timeline_validate` with the complete draft in `document` and
  `format: "object"` (or authored YAML/JSON plus its matching format) to execute
  both JSON Schema and cross-field semantic rules without mutating the Timeline.
  Preserve the returned rule IDs when reporting or repairing invalid state.
- Use `clash_timeline_list` or `clash_timeline_get` before describing current
  state. Never infer tracks or revisions from Canvas nodes.
- When calling `clash_timeline_save`, pass the `revisionId` returned by
  `clash_timeline_get` as `baseRevisionId`. A stale full-state save must be
  rejected and rebased, never silently retried over newer work.
- Use `clash_timeline_create` with canonical `id`, `name`, and optional complete
  `state` for a standalone Project Timeline.
- Use `clash_timeline_attach`, `clash_timeline_detach`, and
  `clash_timeline_copy` only when the user requests an ownership change. For
  attach use `actionNodeId`; for copy use `sourceTimelineId`, `targetCanvasId`,
  and optional `newActionNodeId`, exactly as published by the tool schema.
- Treat failed saves as real validation or stale-read failures. Read the
  Timeline again, preserve the user's draft, and resolve the conflict instead
  of bypassing it.
- Consume the track categories and ordering published by
  `clash_timeline_schema` (`effect`, `text`, `visual`, `primary`, `audio`) rather
  than maintaining a local list. Do not introduce `Main Storyline` or
  `Set as main` wording.

## Mask DSL

<!-- BEGIN GENERATED TIMELINE MASK CONTRACT -->
The implementation-side capability annotations define all required mask fields:
`shape`, `position`, `size`, `rotation`, `feather`, `inverted`. The generated animated channels are `maskPosition`, `maskSize`, `maskRotation`, `maskFeather`.
Coordinates use `percent-of-rendered-item-bounds`; frames are
`item-local` in `0..durationInFrames-1`;
and interpolation is `hold` or `linear`.
The complete editor default is `{"shape":"rectangle","position":[50,50],"size":[70,70],"rotation":0,"feather":0,"inverted":false}`.

Use `clash_timeline_schema` for the generated JSON Schema, field descriptions,
runtime semantics, operations, and executable YAML example; validate edits with
`clash_timeline_validate`. Remove a mask by
removing both `item.mask` and every generated mask channel.
<!-- END GENERATED TIMELINE MASK CONTRACT -->

Do not use Canvas MCP tools as a fallback for Timeline operations. The Timeline
plugin owns this interface; Canvas remains a separate work surface.
