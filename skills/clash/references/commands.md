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

## production storyboard prompt packs

```bash
clash production project-storyboard-prompt-pack --action actions/storyboard-review.json --out plans/prompt-pack.json --json
clash production apply-storyboard-prompt-pack --file plans/prompt-pack.json --json
clash production replace-storyboard-prompt-pack --file plans/prompt-pack.json --json
```

`project-storyboard-prompt-pack` is the read step: it writes the editable
prompt-pack JSON and records its version in `.clash/observed.json`.
`apply-storyboard-prompt-pack` writes the managed storyboard projection only
if the observed version still matches. `replace-storyboard-prompt-pack` uses
the same implicit observation but creates a copy-on-write projection under
`projections/storyboards/<asset>.prompt-pack.<hash>.cow.json`; it does not
mutate the existing managed projection or existing downstream references in
place.

## production metadata projections

```bash
clash production apply-metadata --action actions/metadata-fill.json --assets assets/manifest.json --json
clash production apply-metadata-projection --file projections/metadata/<asset>.<kind>.json --assets assets/manifest.json --json
```

`apply-metadata` applies the explicit metadata-fill action, materializes an
editable metadata projection, and records its version. After editing that JSON,
`apply-metadata-projection` performs the read-presence and stale-version checks
implicitly before updating the asset metadata. The sibling manifest records
projection provenance; it is not a write token and should not be edited.

## production review gates

```bash
clash production plan-review-gate --pipeline pipeline.manifest.json --stage export --artifact projections/timelines/main.timeline.yaml --out reviews/gates/export.review-gate.json --json
clash production approve-review-gate --gate reviews/gates/export.review-gate.json --reviewer qa-agent --decision approve --json
```

`plan-review-gate` writes the gate JSON and records its path-bound version in
`.clash/observed.json`. `approve-review-gate` consumes that observation
implicitly. A copied, unread, or stale gate is rejected even when its current
contents happen to match another gate.

## tasks

```bash
clash tasks status --task-id <id> --json
clash tasks wait --task-id <id> --timeout 120 --json
```

## actions

```bash
clash action list --json           # List installed actions
clash action search --query "..." --json
clash action install --id <id>
clash action uninstall --id <id>
```

## remote worker secrets

Remote worker action secrets are managed in hosted/remote Settings, not through
the local-first CLI. Local custom actions use the local host environment and
provider configuration instead of syncing secrets into the project.
