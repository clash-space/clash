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

- Use `clash_timeline_list` or `clash_timeline_get` before describing current
  state. Never infer tracks or revisions from Canvas nodes.
- Use `clash_timeline_create` for a standalone Project Timeline.
- Use `clash_timeline_attach`, `clash_timeline_detach`, and
  `clash_timeline_copy` only when the user requests an ownership change.
- Treat failed saves as real validation or stale-read failures. Read the
  Timeline again, preserve the user's draft, and resolve the conflict instead
  of bypassing it.
- Keep user-facing track labels explicit: video/image, text/subtitle, effects,
  and audio. Do not introduce `Main Storyline` or `Set as main` wording.

Do not use Canvas MCP tools as a fallback for Timeline operations. The Timeline
plugin owns this interface; Canvas remains a separate work surface.
