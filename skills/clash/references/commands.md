# Command Reference

Always use `--json` for machine-readable output. Run `clash <command> -h` for the latest options.

## auth

```bash
clash auth login              # Configure API token (interactive)
clash auth status             # Verify connection
clash auth logout             # Remove saved token
```

## projects

```bash
clash projects list --json
clash projects create --name "Name" --description "..." --json
clash projects get --id <project-id> --json
clash project status --project <project-id> --json
clash doctor storage --project <project-id> --json
clash doctor storage --project <project-id> --repair --json
clash projects delete --id <project-id> --yes --json
clash project restore <project-id> --json
```

Local project delete is a recoverable soft-delete. Use `restore` to make the
project visible again before creating or resuming sessions.
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
clash canvas edges --project <id> --json                 # Edge graph + read tokens
clash canvas delete-plan --project <id> --node <id> --node <id> --json
clash canvas search --project <id> --query "sunset" --json
clash canvas search --project <id> --query "hero" --type image_gen,video_gen --json
```

`get --json` returns a node `readToken`. `edges --json` returns per-edge tokens
and a graph token. `delete-plan --json` returns a graph-aware batch delete
`readToken`. Agent direct writes must pass the matching token back with
`--if-match`; if the target changed after the read, the host rejects the write
and the agent should re-read.

### Writing

```bash
# Add nodes
clash canvas add --project <id> --type text --label "Script" --content "..." --json
clash canvas add --project <id> --type group --label "Scene 1" --json
clash canvas add --project <id> --type text --label "Prompt" --content "..." --parent <group-id> --json
clash canvas add --project <id> --type image_gen --label "Hero Shot" --parent <group-id> --json

# Update
clash canvas update --project <id> --node <id> --if-match <readToken> --label "New Label" --content "New content" --json

# Copy-on-write media asset replacement
clash canvas replace-asset --project <id> --node <media-node-id> --asset <asset-id> --if-match <readToken> --json

# Delete
clash canvas delete --project <id> --node <id> --if-match <readToken> --yes --json
clash canvas delete-batch --project <id> --node <id> --node <id> --if-match <readToken> --yes --json
# If the node has downstream references, add --force only after explicit user confirmation.

# Execute generation
clash canvas execute --project <id> --node <action-badge-id> --json
```

For agents, `canvas update`, `canvas delete`, and `canvas delete-batch` are
direct patch/admin writes, not projection apply commands. Use
`--if-match <readToken>` from a fresh `canvas get --json` for single-node
writes and from `canvas delete-plan --json` for batch deletes; use `--force`
only as an explicit user-approved override.
Use `canvas replace-asset` instead of `canvas update --asset-id` when changing a
fulfilled image/video/audio node. It creates a copy-on-write media node with
lineage to the source and does not mutate existing downstream references in
place.

## timeline

```bash
clash timeline pull --project <id> --node <video-editor-node-id> --json
clash timeline apply --project <id> --node <video-editor-node-id> --json
clash timeline replace --project <id> --node <video-editor-node-id> --json
```

`pull` writes `timelines/main.timeline.yaml` plus a CAS lock. `apply` refuses
stale writes unless `--force` is used and rejects materialized downstream render
checkpoints by default. `replace` uses the same lock as read proof, creates a
copy-on-write video-editor node, records revision lineage, refreshes the lock
to the new node, and does not mutate existing materialized downstream renders in
place.

## text

```bash
clash text pull --project <id> --node <text-node-id> --json
clash text apply --project <id> --node <text-node-id> --json
clash text replace --project <id> --node <text-node-id> --json
```

`pull` writes `projections/text/<node-id>.md` plus a CAS lock. `apply` refuses
stale writes unless `--force` is used. `replace` creates a copy-on-write text
node from the same Markdown file and refreshes the lock to the new node; it
does not mutate existing materialized downstream checkpoints in place.

## assets

```bash
clash asset get --asset <asset-id> --json
clash asset cover set --asset <asset-id> --cover-key <storage-key> --if-match <readToken> --json
clash asset link --project <id> --asset <asset-id> --json
clash asset link --project <id> --asset <asset-id> --name hero.png --force --json
clash asset ref get --asset <asset-id> --project <project-id> --json
clash asset ref delete --asset <asset-id> --project <project-id> --if-match <readToken> --yes --json
clash asset refs --asset <asset-id> --json
clash asset refs --asset <asset-id> --project <project-id> --json
clash asset refs --asset <asset-id> --project <project-id> --refresh --json
```

`get` reads an asset row and returns the host-issued `readToken` needed for
agent metadata updates such as `cover set`. `link` creates an agent-readable file under the project's `assets/links/`
directory, backed by the immutable asset cache. Treat it as read-only
inspection input; editing the linked file does not apply changes to canvas.
`refs` shows indexed project/node/field references and first-pass reference
roles for an asset through the local host API. Use it instead of reading SQLite
or `snapshot.bin` directly. Add `--refresh` when the index may be stale; this
updates the projection without running asset GC deletion.
`ref get` reads the project membership relation in `asset_refs` and returns its
host-issued `readToken`; `ref delete` must pass that token with `--if-match`
and `--yes` when removing the relation.

## production storyboard prompt packs

```bash
clash production project-storyboard-prompt-pack --action actions/storyboard-review.json --out plans/prompt-pack.json --json
clash production apply-storyboard-prompt-pack --file plans/prompt-pack.json --lock plans/prompt-pack.lock.json --json
clash production replace-storyboard-prompt-pack --file plans/prompt-pack.json --lock plans/prompt-pack.lock.json --json
```

`project-storyboard-prompt-pack` is the read step: it writes the editable
prompt-pack JSON plus a lock sidecar. `apply-storyboard-prompt-pack` writes the
managed storyboard projection only if that lock still matches the current
managed prompt-pack. `replace-storyboard-prompt-pack` uses the same lock as
read proof but creates a copy-on-write storyboard prompt-pack projection under
`projections/storyboards/<asset>.prompt-pack.<hash>.cow.json`; it does not
mutate the existing managed projection or existing downstream references in
place.

## production review gates

```bash
clash production plan-review-gate --pipeline pipeline.manifest.json --stage export --artifact projections/timelines/main.timeline.yaml --out reviews/gates/export.review-gate.json --json
clash production approve-review-gate --gate reviews/gates/export.review-gate.json --lock reviews/gates/export.review-gate.lock.json --reviewer qa-agent --decision approve --json
```

`plan-review-gate` writes the gate JSON and a sibling CAS lock. The lock binds
the gate file path and gate hash, so `approve-review-gate` must use the lock
created for that exact gate file. Reusing a lock from a copied or different
gate file is rejected even if the file contents currently hash the same.

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

## remote worker vars

```bash
clash vars list --json
clash vars set API_KEY --value "..."
clash vars delete API_KEY
```

These commands are for cloud/remote worker action variables. Local custom
actions use the local host environment and provider configuration instead of
syncing secrets into the project.
