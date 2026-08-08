---
name: motion-graphics-overlays
description: Design and deliver kinetic typography, lower thirds, character motion, caption treatments, data callouts, logo stings, and other MG overlays in Clash. Use this skill whenever a video needs authored motion graphics; the executable path is an editable Remotion TSX Canvas component referenced live by a Timeline and delivered by Timeline render.
---

# Motion Graphics Overlays

Treat motion as part of the editorial argument. Decide what the viewer should
notice, when it should become readable, and how it hands attention back to the
footage. Keep the design source editable throughout review.

Clash has one executable path for authored MG: a default-exported Remotion TSX
module stored in a Canvas `remotion-component` node. A Timeline composition
references that fixed Canvas identity with `sourceNodeId`; preview and final
render resolve the node's latest source. Deliver through Timeline render, not an
independent overlay export.

## Shape the idea

- Write a one-line communication goal for every motion beat.
- Establish hierarchy before animation: one focal message, one supporting cue,
  and background detail only when it clarifies context.
- Use a small visual vocabulary of type scale, geometry, color, stroke, and
  depth. Repetition creates a system; contrast creates the beat.
- Protect mobile readability and safe areas at the most extreme animated pose,
  not only at frame zero.
- Let entries prepare the eye, actions deliver information, and settles create
  room for the next cut.

For characters, make silhouette, balance, gaze, and line of action readable in
the anticipation, action, and settle poses. Move mass on curved arcs; offset
secondary parts for overlap and follow-through. For typography and callouts,
animate semantic units rather than arbitrary letters or boxes.

## Author deterministic Remotion TSX

Use one self-contained TSX module with a default component export. Import only
from `react` and `remotion`. Derive visible state from `useCurrentFrame` and
`useVideoConfig`, using `interpolate` and `spring` for seek-safe motion. Avoid
wall-clock timers, event-driven animation, DOM measurement, dynamic imports,
`require()`, and unseeded randomness.

Keep important layers inspectable with stable semantic attributes such as
`data-mg-role="headline"`, `data-mg-role="callout"`, or
`data-character-part="head"`. Put the marker on the persistent transform
wrapper so it survives visual iteration.

## Put the source in Canvas

CLI and MCP are peer transports over the same project. With the CLI, author the
TSX in the working tree and persist it in a distinct Canvas node:

```sh
clash canvas add --type remotion --label "<component-name>" --content "$(cat <component.tsx>)" --json
clash canvas get --node <remotion-node-id> --json

# Re-read immediately before a guarded edit, then update the same fixed node id.
clash canvas get --node <remotion-node-id> --json
clash canvas update --node <remotion-node-id> --content "$(cat <component.tsx>)" --json
clash canvas get --node <remotion-node-id> --json
```

Through MCP, reveal the Canvas tools from the root `clash` menu, then use
`clash_canvas_add` with `type: "remotion"`, `clash_canvas_get`, and
`clash_canvas_update`. Preserve read-before-write and read back every mutation.

## Bind it live to Timeline

Preserve the complete Timeline state and add a composition item whose product
identity is the Canvas node:

```yaml
- id: <timeline-item-id>
  type: composition
  from: <start-frame>
  durationInFrames: <duration>
  compositionKind: custom
  runtime: remotion
  compositionId: <component-id>
  sourcePath: components/<remotion-node-id>.tsx
  sourceNodeId: <remotion-node-id>
```

`sourcePath` is a project-local authoring path; `sourceNodeId` is the live
binding. Do not duplicate TSX into Timeline state and do not replace the source
with an intermediate clip.

```sh
clash timeline list --json
clash timeline pull --timeline <timeline-id> --json
clash timeline validate --file timelines/<timeline-id>.timeline.yaml --json
clash timeline apply --timeline <timeline-id> --file timelines/<timeline-id>.timeline.yaml --json
clash timeline pull --timeline <timeline-id> --json
clash timeline render --timeline <timeline-id> --json
```

Through MCP, use `clash_timeline_get`, preserve the full returned state, save
with `clash_timeline_save` and its returned revision as `baseRevisionId`, read
back with `clash_timeline_get`, then call `clash_timeline_render`.

## Judge the product result

Canvas Player playback is rehearsal. A completed Timeline render receipt and a
playable product Asset are delivery evidence. Watch at normal speed for focus,
rhythm, and weight; then inspect key frames for readability, edge safety,
contacts, compositing, and final holds. Revise the same Canvas node and render
again so every Timeline reference sees the intended latest version.
