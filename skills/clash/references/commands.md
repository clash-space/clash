# Command Reference

Always use `--json` for machine-readable output. Run `clash <command> -h` for the latest options.

## local setup

```bash
clash host status --json
clash init --project <project-id> --json
```

Cloud OAuth is optional: `clash auth login` only enables product-managed
remote sync. Local project, canvas, Timeline, text, and asset commands do not
require it.

## projects

```bash
clash projects list --json
clash projects create --name "Name" --description "..." --json
clash projects get --id <project-id> --json
clash project status --project <project-id> --json
clash doctor storage --project <project-id> --json
clash doctor storage --project <project-id> --repair --json
clash projects delete --id <project-id> --yes --json
clash project get --id <project-id> --include-deleted --json
clash project restore <project-id> --json
```

Local project delete is a recoverable soft-delete. Read the project first;
the CLI records its version in `.clash/observed.json`. Read it again with
`--include-deleted` before restore. Missing or stale observations are rejected.
`doctor storage` is read-only by default. It validates editable/protected path
boundaries, project asset links, and local SQLite asset reference index
readiness before an agent relies on project projections. `--repair` explicitly
creates the standard workspace roots and repairs the local SQLite asset
reference index schema; it does not delete legacy or canonical files.

## canvas

### Connection management

```bash
clash canvas connect --project <id>     # Start daemon (persistent WebSocket)
clash canvas disconnect --project <id>  # Stop daemon
```

### Reading

```bash
clash canvas list --project <id> --json                  # All nodes
clash canvas list --project <id> --type text --json      # Filter by type
clash canvas get --project <id> --node <node-id> --json  # Single node
clash canvas edges --project <id> --json                 # Edge graph
clash canvas delete-plan --project <id> --node <id> --node <id> --json
clash canvas search --project <id> --query "sunset" --json
clash canvas search --project <id> --query "hero" --type image_gen,video_gen --json
```

`get --json` records the node version in `.clash/observed.json` and reports
`immutable`. `edges --json` records the graph version; `delete-plan --json`
records the graph-aware batch-delete version. Writes consume these observations
implicitly. If the target changed after the read, the host returns `STALE_READ`.

### Writing

```bash
# Add nodes
clash canvas add --project <id> --type text --label "Script" --content "..." --json
clash canvas add --project <id> --type group --label "Scene 1" --json
clash canvas add --project <id> --type text --label "Prompt" --content "..." --parent <group-id> --json
clash canvas add --project <id> --type image_gen --label "Hero Shot" --parent <group-id> --json

# Update
clash canvas update --project <id> --node <id> --label "New Label" --content "New content" --json

# Generic copy-on-write for an immutable node
clash canvas copy --project <id> --node <id> --json

# Copy-on-write media asset replacement
clash canvas replace-asset --project <id> --node <media-node-id> --asset <asset-id> --json

# Delete
clash canvas delete --project <id> --node <id> --yes --json
clash canvas delete-batch --project <id> --node <id> --node <id> --yes --json
# Referenced nodes must be rewired first; batch deletes must describe a closed subgraph.

# Execute generation
clash canvas execute --project <id> --node <action-badge-id> --json
```

For agents, `canvas update`, `canvas delete`, and `canvas delete-batch` are
direct patch writes, not projection apply commands. Run a fresh `canvas get`
for single-node writes and `canvas delete-plan` for batch deletes. The CLI does
the observation and CAS checks internally. There is no force or overwrite
bypass: re-read, reconcile the intended change, and retry.
Any node with a downstream reference is immutable as a whole. Use
`canvas copy` when an in-place write returns `IMMUTABLE_NODE`; existing
downstream references remain on the source.
Use `canvas replace-asset` instead of `canvas update --asset-id` when changing a
fulfilled image/video/audio node. It creates a copy-on-write media node with
lineage to the source and does not mutate existing downstream references in
place.

## timeline

```bash
clash timeline create --project <id> --id <timeline-id> --name <name> --json
clash timeline pull --project <id> --timeline <timeline-id> --json
clash timeline apply --project <id> --timeline <timeline-id> --json
clash timeline attach --project <id> --timeline <timeline-id> --canvas <canvas-id> --json
clash timeline copy --project <id> --timeline <timeline-id> --canvas <canvas-id> --json
```

`pull` writes `timelines/<timeline-id>.timeline.yaml` and records the Timeline
observation in `.clash/observed.json`. `apply` consumes that observation
implicitly and refuses stale writes. A Timeline is editable state; rendered
assets pin the source Timeline revision. `attach` moves a standalone Timeline
under one Canvas Timeline Action. Cross-Canvas `copy` creates a new Timeline
and Action node, leaving the source unchanged. No lock sidecar is created.

## text

```bash
clash text pull --project <id> --node <text-node-id> --json
clash text apply --project <id> --node <text-node-id> --json
clash text replace --project <id> --node <text-node-id> --json
```

`pull` writes `projections/text/<node-id>.md` and records the text version in
`.clash/observed.json`. `apply` consumes that observation implicitly and
refuses stale writes. `replace` creates a copy-on-write text node from the same
Markdown file; no lock sidecar is created.

## assets

```bash
clash asset get --asset <asset-id> --json
clash asset cover set --asset <asset-id> --cover-key <storage-key> --json
clash asset link --project <id> --asset <asset-id> --json
clash asset link --project <id> --asset <asset-id> --name hero.png --json
clash asset ref get --asset <asset-id> --project <project-id> --json
clash asset ref delete --asset <asset-id> --project <project-id> --yes --json
clash asset refs --asset <asset-id> --json
clash asset refs --asset <asset-id> --project <project-id> --json
clash asset refs --asset <asset-id> --project <project-id> --refresh --json
```

`get` reads an asset row and records its version for metadata updates such as
`cover set`. `link` creates an agent-readable file under the project's `assets/links/`
directory, backed by the immutable asset cache. Treat it as read-only
inspection input; editing the linked file does not apply changes to canvas.
`refs` shows indexed project/node/field references and first-pass reference
roles for an asset through the local host API. Use it instead of reading SQLite
or `snapshot.bin` directly. Add `--refresh` when the index may be stale; this
updates the projection without running asset GC deletion.
`ref get` records the project membership relation version in cwd state;
`ref delete` consumes it implicitly and still requires `--yes`.

## asset metadata

```bash
clash assets metadata kinds --json
clash assets metadata list --asset <asset-id> --json
clash assets metadata get --asset <asset-id> --kind media.transcript --json
clash assets metadata get --asset <asset-id> --kind media.transcript --body --json
clash assets metadata set --asset <asset-id> --kind media.transcript --metadata meta.json --body words.json --json
clash assets metadata apply --file projections/metadata/<asset>.<kind>.json --expect-version <token> --json
clash assets metadata validate --kind <kind> --metadata meta.json --json
```

`--kind` is a parameter, never a command: declaring a new kind adds no CLI
surface. `kinds` lists what this build accepts — the product-declared kinds plus
any workspace kind declared under `.clash/metadata-kinds/*.json`. An undeclared
kind is refused everywhere.

`set` attaches the identity to the asset and stores any `--body` as an immutable
content-addressed blob, deduplicated by hash; it also materializes an editable
projection under `projections/metadata/` and returns its CAS token.

After editing that JSON, `apply` refuses to write unless it can prove you edited
what you read. Inside a cwd linked through `.clash/project.toml` the read is
recorded implicitly and no token is needed. Anywhere else, spend the token from
`set` with `--expect-version`; the option is not spelled `--version`, which the
global version flag would swallow. A token is single-use: replaying a spent one
is rejected as stale, and an apply with no token at all fails `READ_REQUIRED`
rather than forcing the write.

`get --body` returns the stored blob
verbatim and fails loudly if the blob no longer hashes to its recorded address.

Attaching does not require an action file — the fill envelope is synthesized
internally, and every attach appends to the asset's `metadataFills` provenance
ledger.

## tasks

```bash
clash tasks status --task-id <id> --json
clash tasks wait --task-id <id> --timeout 120 --json
```

## actions

An executable plugin is written as ordinary source in your own working directory,
then registered. Registration is what hands it to Clash: `activate` validates the
draft, runs its declared contracts, asks for approval if it wants new capabilities,
and atomically stores the result. From that point Clash owns the stored copy --
content-hashed, recorded as an activation, and rollback-protected -- so the draft is
the input and the stored copy is the output.

For that reason a draft directory must live outside Clash's own storage. Pointing
one inside it is refused, because freely editable source has no place among attested
state.

```bash
# Author a plugin
clash action init-plugin ./my-plugin --id my-plugin --name "My Plugin"
clash action validate ./my-plugin            # schema + declared contract tests
clash action activate ./my-plugin            # register; Clash stores and owns it

# Edit one that is already active
clash action checkout <id> ./my-plugin       # copy it out to a draft
clash action validate ./my-plugin
clash action activate ./my-plugin

# Manage what is registered
clash action list --local --json
clash action search <query> --json
clash action install <id>                    # fetch from the server registry
clash action uninstall <id>
clash action rollback <id>                   # restore the retained prior version
```

The bridge hot-reloads an activated plugin, so no daemon restart is needed.

## remote worker secrets

Remote worker action secrets are managed in hosted/remote Settings, not through
the local-first CLI. Local custom actions use the local host environment and
provider configuration instead of syncing secrets into the project.
