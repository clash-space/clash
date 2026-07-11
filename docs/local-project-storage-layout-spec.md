# Local Project Storage Layout

Status: Accepted

Last updated: 2026-07-11

## Invariants

1. One Project has one canonical Loro replica per machine.
2. Marker workspaces contain references, drafts, projections, and links only.
3. Immutable media bytes are globally deduplicated by content hash.
4. Machine-local metadata is SQLite, not a JSON database.
5. Cloud collaboration replicates the local model; it does not fork it.

## Marker Workspace

For a cwd linked to Project `P`:

```text
<cwd>/
  .clash/
    project.toml
    observed.json
  drafts/
  projections/
    text/
    timelines/
    metadata/
  timelines/
  sessions/
  assets/
    links/
```

`project.toml` stores stable identity. `observed.json` stores owner-only opaque
read observations. All other files are agent-owned drafts, projections,
manifests, or read-only links. The current marker root is the workspace path
reported by `project status.storage.workspace.root`.

`$CLASH_HOME/projects/<encoded-project-id>` may be used as Clash's default
managed cwd. It is not canonical Project state and is not preferred over an
explicit marker cwd.

## Host-Owned State

```text
$CLASH_HOME/
  local-api/
    local.sqlite
    projects/<encoded-project-id>/
      loro/
        snapshot.bin
        updates.log
    text-revision-blobs/<prefix>/<hash>.md
  assets/
    blobs/<sha256>/original.<ext>
  config.json
  credentials.json
  projects/<encoded-project-id>/
    runtime/
```

These paths are product-owned and not agent-editable.

### Project Loro Replica

`snapshot.bin` plus `updates.log` are the single machine-local Project replica.
They contain Canvas and Project Timeline collaborative state. There is no
second snapshot in cwd and no separate Timeline history store.

### SQLite

`local.sqlite` owns structured machine-local rows including:

- projects and recoverable deletion state;
- runtime sessions, agent members, and chat messages;
- assets, project asset membership, and derived Canvas reference indexes;
- immutable text revision metadata;
- provider accounts and encrypted provider/OAuth state;
- local sync/audio/harness configuration;
- sanitized mutation audit evidence.

SQLite does not store media bodies or Timeline history. The mutation audit
records operation, entity, actor client type, acceptance, reason, result, and
sanitized mutation metadata. It has no mutation override field.

### Media Assets

Media bytes are addressed by SHA-256 under the global blob root. SQLite Asset
rows and Project membership rows reference those bytes. `assets/links/` in a
marker cwd contains symlinks, or read-only copies where symlinks are not
available. Editing a link never mutates the canonical asset.

### Text Revisions

Applied text content is stored as immutable Markdown in the text revision blob
root and indexed by `text_revisions`. This is separate from the media Asset
table because text revision bodies are versioned node inputs, not media.

### Project Timeline

Timeline state and history live in the Project Loro replica. The editable YAML
file is a projection. Apply advances the Project Timeline revision atomically.
Rendered outputs pin the revision ID and semantic state hash. No Timeline
revision table, content endpoint, lock file, or revision JSON sidecar exists.

## Configuration Formats

- TOML: project pointer.
- SQLite: host-owned mutable machine state.
- Loro binary/update log: collaborative Project state.
- JSON/YAML/Markdown: agent-facing projections, plans, manifests, and
  intentionally editable configuration.
- Content-addressed files: immutable media and text revision bodies.

No broad mutable JSON database path is supported.

## Permissions

- `.clash/observed.json`: owner read/write only (`0600`).
- local credentials and config: owner-only.
- canonical media and text revision blobs: read-only after commit.
- SQLite and Loro files: host process writes only.
- marker cwd drafts/projections: normal user/agent workspace permissions.

## Recovery

- Deleting a marker cwd removes drafts and links, not canonical Project state.
- Project delete is recoverable until host purge policy expires.
- `doctor storage` may create missing workspace roots, repair SQLite schema,
  quarantine accidental secondary snapshots, and report broken links.
- Recovery never silently imports a cwd snapshot over canonical state; compare
  evidence and an explicit host operation are required.

## Cloud Sync

Optional cloud sync exchanges admitted Loro state, Asset metadata, and required
immutable content through product-owned replication. Credentials, local paths,
raw traces, scratch files, and machine-local config remain local by default.
Every device still operates its own local replica and marker workspace.
