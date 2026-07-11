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
clash canvas connect --project <project-id>
```

This starts a daemon-mode sync session for that project. Subsequent
canvas commands can resolve the project from the managed cwd marker, but pass
`--project` in reusable scripts and examples so the target is unambiguous.
When you're done with a project (e.g. switching to a different one), run
`clash canvas disconnect --project <project-id>`.

## Reading the canvas

```bash
clash canvas list --project <project-id> --json
clash canvas list --project <project-id> --type text --json
clash canvas search --project <project-id> --query "<text>" --json
clash canvas get --project <project-id> --node <node-id> --json
clash canvas edges --project <project-id> --json
clash canvas delete-plan --project <project-id> --node <node-id> --node <node-id> --json
```

Use `list` (or filtered `list --type`) for an overview, `search` when
the user references something by content rather than id, and `get`
when you need a node's full payload (e.g. inputs to an action node).
`get --json` records the observed node version in `.clash/observed.json` and exposes
whether the node is `immutable`. `edges` and `delete-plan` record their graph
versions the same way. Versions are internal CLI state, not command arguments.

The user can see the canvas live in their browser — don't paraphrase
its full state back to them. Cite what's relevant to the question.

## Adding a node

```bash
clash canvas add --project <project-id> --type text --label "<label>" --content "<text>" --json
clash canvas add --project <project-id> --type text --label "<label>" --content "<text>" --parent <group-id> --json
```

Without `--parent`, the node lands at the root. Choose an explicit node type
instead of relying on inference. Returns the new id.

## Editing

```bash
clash canvas update --project <project-id> --node <node-id> --label "<new label>" --json
clash canvas update --project <project-id> --node <node-id> --content "<new content>" --json
clash canvas copy --project <project-id> --node <node-id> --json
clash canvas replace-asset --project <project-id> --node <media-node-id> --asset <asset-id> --json
```

Update only the fields you want to change. For agents, always read with
`clash canvas get --json` first. The CLI checks the cwd observation and current
canvas version automatically; on `STALE_READ`, re-read and reconcile before
retrying. If the read reports `immutable: true`, an in-place update returns
`IMMUTABLE_NODE`; use `canvas copy`, then edit the copy. Use `replace-asset` for fulfilled image/video/audio
asset changes; it creates a copy-on-write node and leaves existing downstream
references on the old node. Re-`get` after if you need to verify the result.

## Executing an action node

```bash
clash canvas execute --project <project-id> --node <node-id> --json
```

Some nodes are "actions" (image generation, edit ops). Executing returns
a task id you can hand to the **generation** skill (`clash tasks wait`)
to track the result.

## Deleting

```bash
clash canvas delete --project <project-id> --node <node-id> --yes --json
clash canvas delete-batch --project <project-id> --node <node-id> --node <node-id> --yes --json
```

**Always confirm** with the user before deleting. Quote the node's
label back so they can verify which one you mean. The CLI requires
`--yes` as the machine-readable confirmation flag. Read the node first. For
multiple nodes, run `delete-plan --json` before `delete-batch`; the CLI uses
the recorded graph version automatically.
If the CLI reports downstream references or `STALE_READ`, do not retry with
an overwrite bypass. Re-read and reconcile the newer state. Remove or rewire
downstream references first, or use the explicit copy-on-write replacement
workflow when existing outputs must stay pinned.

## Conventions

- Concurrent edits: the user can edit the canvas in the browser at the
  same time. Re-`get` before direct or destructive writes and use
  `delete-plan` before `delete-batch`. The CLI performs CAS from cwd state.
- Don't loop `list` to poll for changes — Loro syncs in the background;
  the next read picks up everything.
- Keep your output terse. The user can see the canvas; they want
  *what changed* and *what's next*, not a node-by-node enumeration.
