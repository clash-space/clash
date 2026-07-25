---
name: canvas-operations
description: Use when the user wants to read, modify, search, add, or delete nodes on a project's canvas. Triggers on "canvas", "scene", "node", "add a clip", "edit the timeline", "what's in the canvas", "rearrange", "remove the X". Use the `clash canvas` CLI subcommands; always pass `--json` for parseable output.
---

# Canvas operations

The canvas is a Loro CRDT-backed graph of nodes that represent scenes,
generated assets, prompts, and other primitives in the user's video
project. Edits sync back to the user's browser in real time.

## First step: connect to the project

Before any read/write, establish the canvas connection in this terminal:

```bash
clash canvas connect <project-id>
```

This starts a daemon-mode sync session for that project. Subsequent
canvas commands operate on the connected project (no need to repeat the
project id). When you're done with a project (e.g. switching to a
different one), run `clash canvas disconnect`.

## Reading the canvas

```bash
clash canvas list --json
clash canvas list --type prompt --json     # filter to one type
clash canvas search "<text>" --json        # full-text over labels/content
clash canvas get <node-id> --json          # full single-node detail
```

Use `list` (or filtered `list --type`) for an overview, `search` when
the user references something by content rather than id, and `get`
when you need a node's full payload (e.g. inputs to an action node).

The user can see the canvas live in their browser — don't paraphrase
its full state back to them. Cite what's relevant to the question.

## Adding a node

### Text / group nodes

```bash
clash canvas add --type text  --label "<short label>" --content "<text>" --json
clash canvas add --type group --label "<group label>"                    --json
```

Without `--parent`, the node lands at the root. Returns the new id.

### Generation action-badge nodes (image_gen / video_gen / audio_gen / text_gen)

All four kinds share **one** input shape — `prompt`, `model`,
`modelParams`, and `references`. The CLI flattens this into the data
your model card already expects. You never pick `img2img` vs
`text2img` explicitly; just attach the references you want the model
to consume and the system partitions them by asset kind.

```bash
clash canvas add --type image_gen \
  --label "<short label>" \
  --prompt "<prompt text — may contain @[Label](node:<id>) mentions>" \
  --model gemini-flash-image \
  --ref <canvas-node-or-asset-id> \
  --param aspectRatio=16:9 --param seed=42 \
  --json
```

Flags:

- `--prompt` is the text given to the model. Inline mentions of canvas
  asset nodes use `@[Label](node:<id>)` — the exact syntax the chat
  composer emits when a user `@`s an asset. The CLI extracts these
  mentions, resolves each `<id>` to its underlying asset, and slots it
  into the right `referenceXAssetIds[]` based on asset kind.
- `--ref` is the same idea without polluting prompt text. Accepts a
  canvas node id (resolved via `node.data.assetId`) or a bare asset id.
  Repeatable.
- `--model` picks the provider model id (`gemini-flash-image`,
  `imagen-4-fast`, `veo3-fast-text-to-video`, …). Has a sensible default
  per node type so you can omit it for quick experiments.
- `--param` populates `data.modelParams`. The model card decides which
  keys it accepts; `aspectRatio`, `duration`, `seed` are common. Booleans
  and integers are coerced; the rest stays a string.

Returns the new node id and (for `*_gen` nodes) the asset id of the
pending output.

Notes:

- Edges from each reference node to the generation node appear
  automatically as a side-effect of `referenceXAssetIds` — don't draw
  them manually.
- Model-specific knobs go through `--param k=v` so they land under
  `data.modelParams` where the model card validator looks. Don't try
  to pass them through `--data`.

## Editing

```bash
clash canvas update <node-id> --label "<new label>" --json
clash canvas update <node-id> --content "<new content>" --json
```

Update only the fields you want to change. Re-`get` after if you need to
verify the result.

**Editing a Timeline Action's Project Timeline** does not go through
`canvas update`. The action node points to a Project Timeline through
`data.timelineId`; the Timeline entity owns the editable tracks/items
state.

When starting from a Timeline Action, inspect it and read that id:

```bash
clash canvas get --node <timeline-action-node-id> --json
```

Then switch to the **timeline-editing** skill and use the public Project
Timeline workflow:

```bash
clash timeline list --json
clash timeline pull --timeline <id> --file timelines/<id>.timeline.yaml --json
# edit timelines/<id>.timeline.yaml
clash timeline apply --timeline <id> --file timelines/<id>.timeline.yaml --json
```

Use `data.timelineId` as `<id>`, not the Timeline Action node id.

## Executing an action node

```bash
clash canvas execute <node-id> --json
```

Some nodes are "actions" (image generation, edit ops). Executing returns
a task id you can hand to the **generation** skill (`clash tasks wait`)
to track the result.

## Deleting

```bash
clash canvas delete <node-id> --json
```

**Always confirm** with the user before deleting. Quote the node's
label back so they can verify which one you mean.

## Conventions

- Concurrent edits: the user can edit the canvas in the browser at the
  same time. Re-`list` (or `get`) before destructive ops to avoid acting
  on stale state.
- Don't loop `list` to poll for changes — Loro syncs in the background;
  the next read picks up everything.
- Keep your output terse. The user can see the canvas; they want
  *what changed* and *what's next*, not a node-by-node enumeration.
