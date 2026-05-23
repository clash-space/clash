---
name: timeline-editing
description: Use when the user wants to edit a VideoEditorNode's timeline — cut/trim/split a clip, reorder items, add a media asset to a track, change fps or composition size. Round-trip the timeline through a YAML file on disk using `clash canvas timeline pull / push`.
---

# Timeline editing — edit-on-disk for VideoEditorNode

A **VideoEditorNode** (type `video-editor` on the canvas) owns a
`timelineDsl` blob — a tracks/items DSL that the React editor renders
into a playable composition. To edit it, **pull it as YAML, edit the
file with your normal Read/Edit tools, push it back**.

Why YAML, not JSON: the timeline-yaml format is the agent-facing surface
the rest of the system has standardized on. It supports relative
references like `from: prev` and `from: <id>+15`, the parser is strict
(typos like `start`/`end` instead of `from`/`durationInFrames` fail
loudly with a clear error message), and a round-trip preserves
authoring style.

## Workflow

```bash
# 1. Find the editor node (or take it from the user's mention).
clash canvas list --type video-editor --json

# 2. Pull the current timeline to disk as YAML.
clash canvas timeline pull --node <video-editor-id> -o timeline.yaml

# 3. Edit timeline.yaml with Read/Edit (treat it as any other file).

# 4. Push it back.
clash canvas timeline push --node <video-editor-id> -i timeline.yaml
```

`--project` is optional — `CLASH_PROJECT_ID` is set in your env and
the CLI uses it by default.

## DSL shape

```yaml
compositionWidth: 1920
compositionHeight: 1080
fps: 30
durationInFrames: 300
tracks:
  - id: track-1
    name: Video
    items:
      - id: shot-A
        type: image
        from: 0
        durationInFrames: 150
        sourceNodeId: abc12345    # canvas asset node id
        assetId: asset_xyz        # D1 asset row id (optional)
      - id: shot-B
        type: image
        from: prev                # = previous item's end
        durationInFrames: 150
        sourceNodeId: def67890
```

### Required item fields

- **`id`** (string): stable identifier for the item. Used as the
  target id for `from: <id>+N` references in OTHER items.
- **`type`** (string): one of `video`, `audio`, `image`, `text`,
  `solid`, `sticker`, `transition`.
- **`from`** (number OR string expression): when the item starts on
  its track, in frames.
  - **number**: absolute frame index. `from: 0` = beginning.
  - **`prev`**: the previous item on the same track (its `from +
    durationInFrames`). Best for "back-to-back" placement — the value
    auto-updates if you change earlier items.
  - **`prev+N`** / **`prev-N`**: previous item's end ± N frames.
    Negative for overlap; positive for a gap.
  - **`<item-id>+N`** / **`<item-id>-N`**: relative to another named
    item's end. Useful for syncing audio to a specific video clip
    regardless of intervening edits.
  - On `push`, all expressions are resolved to absolute frames and
    stored alongside the original expression as `fromExpr` (memo).
    A subsequent `pull` brings the expression back so your edits keep
    their authoring intent.
- **`durationInFrames`** (positive number): how many frames the item
  occupies. **NOT `start`/`end`** — the editor reads `from` +
  `durationInFrames` and ignores `start`/`end`. The validator will
  reject items missing a valid `durationInFrames`.

### Required composition fields (top level)

- **`fps`**, **`compositionWidth`**, **`compositionHeight`**:
  numbers. Frame rate + frame size of the rendered output.
- **`durationInFrames`**: total timeline length. Should be ≥ the max
  `from + durationInFrames` across all items, or trailing content
  gets clipped.

### Media references

- **`sourceNodeId`** (string): points at a canvas media node (image
  / video / audio). The editor pulls `src` + dimensions from that
  node at render time. Don't bake a URL into the item — it gets
  stripped on load anyway.
- **`assetId`** (string, optional): the D1 asset row id. Copy from
  the source node's `data.assetId` when present. Skip if the source
  is a pending generation node with no asset yet.

Frames vs seconds: convert with `fps`. 5 seconds @ 30 fps = 150
frames.

## Finding things to put on the timeline

Most edits start with "drop this asset on the timeline". Use the
canvas list to find candidates and copy their ids:

```bash
clash canvas list --type image --json    # image_gen completed → image node
clash canvas list --type video --json
clash canvas list --type audio --json
```

For each result, `id` is the `sourceNodeId` to use in an item;
`data.assetId` (if present) is the `assetId`.

## Common operations

- **Cut a clip at frame N (relative to the item's `from`)**: for an
  existing item `{ id: A, from: F, durationInFrames: D }`, lower D to
  `N - F`, then add a sibling `{ id: A2, from: A, durationInFrames: D
  - (N - F), sourceNodeId: (same), ... }`. Using `from: A` keeps the
  split connected if you move A later.
- **Reorder** by rewriting `from`s (or by using `prev` chains so
  reordering "just works" — flip the order in the items array and
  every `from: prev` realigns).
- **Trim**: shorten `durationInFrames`. For pre-roll trim on
  video/audio (start clip later inside its source media), use
  `sourceStartInFrames` — that's a different field from `from`.
- **Add a clip**: append a new item with a fresh `id`, `sourceNodeId`
  from `clash canvas list`, and `from: prev` for back-to-back
  placement.
- **Delete**: remove the item from `items`. Also drop any
  `transition` item that references it via `fromItemId`/`toItemId`.
- **Resize composition**: bump `compositionWidth` /
  `compositionHeight`. Item frame positions don't change.

## Validation

`push` runs the shared timeline-yaml parser, which catches:

- YAML parse errors (with line + column).
- Missing `tracks`, items without `id` / `type` /
  `durationInFrames`.
- Items typoed with `start`/`end` instead of `from`/`durationInFrames`
  (they fail the "valid `durationInFrames`" check).
- Wrong types on top-level numerics (`fps`, etc.).
- Items that reference an `<id>+N` target that doesn't exist (the
  resolver falls back to 0 silently — verify with a `pull` if the
  positions look surprising).

If you get an error, re-`pull` to reset and retry the edit
incrementally with `Edit` rather than re-emitting the whole file.

## What `push` does besides writing the DSL

For every unique `sourceNodeId` referenced by items in the timeline,
`push` also makes sure there's a default canvas edge from that source
node → the editor node. This keeps the canvas graph view honest:
"this editor consumes these media nodes" is now a visible line, not
just an implicit data reference. The edge insertion is idempotent —
pushing the same timeline twice does not duplicate edges.

## Rendering the assembled timeline

```bash
clash canvas execute --node <video-editor-id>
```

`execute` is overloaded: on an action-badge it spawns generation, on
a video-editor it spawns the render. Either way it creates a pending
child node downstream of the source — the server's NodeProcessor
poll picks up `data.status === "pending"` plus a `timelineDsl` and
ships the render to the render-server. Track the new render-video
node's status with:

```bash
clash canvas get --node <render-video-id> --json
```

You don't need to poll — once the render finishes, `data.status`
flips to `completed` and `data.src` points at the rendered file.

## Don'ts

- Don't write `start`/`end` (the buggy v0 of this skill taught those
  — they don't work, the editor reads `from`/`durationInFrames`).
- Don't write `trackId` on items — track ownership is positional
  (the item lives in its track's `items` array).
- Don't write `src` URLs into items — stripped on load, breaks the
  reference-only contract.
- Don't fabricate `sourceNodeId` — always copy from `clash canvas
  list` output.
- Don't mass-rewrite if a small Edit will do; agents tend to
  re-emit the whole file and lose the user's manual tweaks. Prefer
  targeted Edits.
- Don't `push` mid-edit. One pull → all edits → one push.
