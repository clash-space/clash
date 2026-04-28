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

```bash
clash canvas add --content "<text>" --json
clash canvas add --content "<text>" --parent <group-id> --json
```

Without `--parent`, the node lands at the root. Defaults pick a sensible
node type from the content. Returns the new id.

## Editing

```bash
clash canvas update <node-id> --label "<new label>" --json
clash canvas update <node-id> --content "<new content>" --json
```

Update only the fields you want to change. Re-`get` after if you need to
verify the result.

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
