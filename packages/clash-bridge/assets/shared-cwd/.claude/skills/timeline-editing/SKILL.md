---
name: timeline-editing
description: Use when the user wants to cut, trim, split, reorder, or add media to a Project Timeline, or change its fps or composition size. Round-trip the Timeline through timelines/<id>.timeline.yaml with public `clash timeline list`, `pull`, and `apply` commands.
---

# Project Timeline editing

A Timeline is a project-scoped entity with its own id, revision, owner,
and tracks/items state. A Timeline Action on a canvas points to that
entity; the canvas node is not the editable timeline itself.

Edit the agent-facing YAML projection with normal file tools, then apply
it back through the public Timeline command. Do not update a Timeline
Action's nested data to change tracks or items.

## Find the Timeline id

List Project Timelines when the user names a timeline or when you need
to discover what is available:

```bash
clash timeline list --json
```

The result includes each Timeline's `id`, `name`, and owner. Use the
Timeline `id` for `--timeline`.

When the user starts from a Timeline Action on the canvas, inspect that
node and read `data.timelineId`:

```bash
clash canvas get --node <timeline-action-node-id> --json
```

Do not substitute the Timeline Action node id for `data.timelineId`.

## Pull, edit, apply

Use one stable projection path per Timeline:

```bash
# 1. Read the current Project Timeline revision into the working tree.
clash timeline pull --timeline <id> --file timelines/<id>.timeline.yaml --json

# 2. Edit timelines/<id>.timeline.yaml with normal file tools.

# 3. Validate and apply the edited projection.
clash timeline apply --timeline <id> --file timelines/<id>.timeline.yaml --json
```

The managed cwd already resolves the project. Do not add `--project`
unless the user explicitly asks to target a different project.

Pull records the current Timeline observation. Apply uses that read
proof and rejects a stale write if the Timeline changed concurrently.
On a conflict, pull the same Timeline again, merge the user's current
state into the YAML file, and retry apply. Leave `.clash/observed.json`
and other product-owned state alone.

## YAML shape

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
        sourceNodeId: abc12345
        assetId: asset_xyz
      - id: shot-B
        type: image
        from: prev
        durationInFrames: 150
        sourceNodeId: def67890
```

### Item fields

- **`id`**: stable item identifier. Other items can target it with a
  relative `from` expression.
- **`type`**: `video`, `audio`, `image`, `text`, `solid`, `sticker`, or
  `transition`.
- **`from`**: absolute frame number or a relative expression:
  - `prev` starts at the previous item end on the same track.
  - `prev+N` and `prev-N` add a gap or overlap.
  - `<item-id>+N` and `<item-id>-N` are relative to a named item end.
- **`durationInFrames`**: positive item length in frames. Use `from`
  plus `durationInFrames`, not `start` and `end`.
- **`sourceNodeId`**: canvas media node supplying image, video, or
  audio input.
- **`assetId`**: optional project asset id copied from the source node's
  `data.assetId` when present.

### Composition fields

- **`fps`**, **`compositionWidth`**, and **`compositionHeight`** are
  numeric.
- **`durationInFrames`** is the full Timeline length. Keep it at least
  as large as the latest item end so the result is not clipped.

Frames convert to seconds through `fps`; five seconds at 30 fps is 150
frames.

## Find media inputs

Use canvas reads to find real source nodes:

```bash
clash canvas list --type image --json
clash canvas list --type video --json
clash canvas list --type audio --json
```

Copy a result's `id` into `sourceNodeId`. Copy `data.assetId` when it is
present. Never fabricate either identifier or embed a transient `src`
URL in the Timeline item.

## Common edits

- **Cut**: shorten the existing item at the cut frame, then add a sibling
  for the remainder with the same media reference.
- **Trim**: change `durationInFrames`; for source pre-roll on video or
  audio, change `sourceStartInFrames` instead of `from`.
- **Reorder**: reorder items and update `from`, or keep a `prev` chain so
  adjacent items realign automatically.
- **Add**: append an item with a fresh id, a real `sourceNodeId`, and an
  intentional `from` value.
- **Delete**: remove the item and any transition that names it through
  `fromItemId` or `toItemId`.
- **Resize**: update `compositionWidth` and `compositionHeight`; item
  frame positions do not change automatically.

## Validate and render

Apply validates YAML structure, required fields, numeric composition
values, and timeline references before advancing the Project Timeline
revision. Fix validation errors in the existing projection rather than
re-emitting the whole file.

If `clash timeline list --json` shows a canvas-owned Timeline, its owner
identifies the Timeline Action node. Execute that node to render:

```bash
clash canvas execute --node <timeline-action-node-id> --json
```

Keep edits targeted: one pull, all related file edits, then one apply.
Use only the public Project Timeline edit surface for Timeline state.
