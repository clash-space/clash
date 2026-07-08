# Local Project Storage Layout Spec

Last updated: 2026-07-08

## Purpose

Define where local Clash project state should live, how cwd relates to a
project, how assets avoid unnecessary copies, and which paths are safe for
agents to edit.

This spec resolves the product direction discussed in the local/agent-first
review:

```text
The canonical project store is under the global Clash app root.
The user's cwd is a reference/draft workspace.
```

## Current Implementation

Current relevant paths:

- `packages/clash-bridge/src/lib/platform.ts`
  - root: `~/.clash`
  - project cwd root: `~/.clash/projects`
  - legacy workspace root: `~/.clash/workspaces`
- `packages/clash-bridge/src/lib/session-cwd.ts`
  - spawned ACP agents run in `~/.clash/projects/<encodedProjectId>/`
  - project cwd creation initializes `drafts/`, `projections/text/`,
    `projections/timelines/`, `projections/storyboards/`,
    `projections/prompts/`, `projections/metadata/`, `assets/links/`,
    `sessions/`, and protected `runtime/`
  - sessions do not create separate cwd directories
  - `.clash/project.toml` is written into that cwd
  - old cwd layouts are not auto-migrated into hidden archive directories
- `packages/cli/src/lib/project-context.ts`
  - project context resolves from explicit `--project`, nearest marker, then
    `CLASH_PROJECT_ID`
  - marker/env conflicts are rejected
- `apps/local-api/src/loro/file-replica-store.ts`
  - local Loro persistence is `projects/<encodedProjectId>/loro/snapshot.bin`
    and `updates.log` under the local-api data root

Current state is coherent for alpha, but not yet fully aligned:

- bridge project cwd and local-api Loro project store are adjacent concepts but
  not yet one documented storage model,
- agents run at the canonical project root, with first-pass
  `project status`/`doctor storage` editable-vs-protected checks but no
  automatic migration/repair yet,
- assets have first-pass project links through `clash asset link`,
  content-addressed local import through `clash asset import --file`,
  local-api registration into SQLite `assets`/`asset_refs`, registered-asset
  COW replacement, and local GC that can refresh project-level refs from
  persisted Loro canvas state plus first-pass `asset_node_refs`, but do not
  yet have a full dependency graph or full UI/E2E coverage,
- session/draft/project boundaries are not yet visible enough to agents.

`clash project status --json` should be treated as the alpha source of truth
for these current paths. It exposes the bridge workspace root
(`projectWorkspaceRoot`), the protected runtime root (`roots.runtime` and
`runtimeRoot`), and the current local-api Loro replica root
(`loro.replicaRoot`). Agents must not infer that `snapshot.bin` or runtime state
lives under an editable workspace root unless the status payload says so.
For CLI calls, `currentWorkspace` records the actual cwd and `.clash/project.toml`
marker root as a `project-reference-workspace`; when the marker has
`workspace_id`, status exposes it as `markerWorkspaceId`. This is deliberately
separate from `projectWorkspaceRoot`: deleting or moving the cwd/marker
workspace must not imply deleting the machine's canonical SQLite/Loro project
state.
The `collaboration` object in the same payload is the mode gate agents and UI
should use before offering cloud/web/shared affordances: local projects are not
web-openable, `cloud-sync` projects remain pending and not web-openable until
`syncReadiness` proves canvas, room, and asset-metadata sync capabilities are
ready, and shared projects are the only mode that uses a cloud sequencer for
multiplayer.
The `storage` object makes this non-inferential: `storage.workspace` is the
agent draft/projection workspace and explicitly does not own canonical snapshot
or metadata state; `storage.canonicalReplica` points at the machine-scoped
SQLite metadata store, Loro canvas replica, and immutable text/timeline
revision content blob roots, all marked non-agent-writable. Text and timeline
applied bodies therefore have Obsidian-like file recoverability through content
descriptors, without making the protected canonical store a directly editable
vault.
`clash doctor storage --json` verifies this role contract and warns when local
SQLite is missing core metadata tables, provider auth tables/primary keys, or the
`asset_refs`, `asset_node_refs` / `reference_role`, `text_revisions`, or
`timeline_revisions` projection indexes required for host-readable projects,
assets, sessions, provider accounts, OAuth rows, room messages, mutation audit,
asset usage, and revision history lookups. It also fails when the revision content blob
roots are moved into editable agent paths, when existing revision blob files
are writable or no longer match their content-addressed filenames, or when the
cwd or project workspace contains stray `snapshot.bin` / `updates.log` files outside
`storage.canonicalReplica.canvas.replicaRoot`, because that would imply a
second local canvas replica.
When `--repair` is explicit, doctor may make hash-valid writable revision blob
files read-only again; it still refuses to auto-repair hash-mismatched,
symlinked, or structurally invalid revision blob files.

## v1 Product Decision

### Canonical store

The canonical local store is under the Clash app root:

```text
~/.clash/
```

For tests and isolated local runs, `CLASH_HOME` may override this root. When
set, the same layout is rooted at `$CLASH_HOME/`.

For a given project id and machine, there is exactly one durable local project
replica:

```text
~/.clash/projects/<encodedProjectId>/
```

`<encodedProjectId>` is a collision-resistant URI-encoded project id path
segment. The canonical id remains in `.clash/project.toml`; paths are not the
identity source.

The user's shell cwd may reference that project, but must not own a second
snapshot or a second copy of canonical state.

### CWD

The cwd is a working area:

- it may contain `.clash/project.toml`,
- it may contain draft files,
- it may contain projection files,
- it may contain generated reports/scripts,
- it may be deleted without deleting the project replica.

The cwd is not:

- the Loro replica owner,
- the app metadata database,
- a project lock,
- an asset content store,
- a session database.

This is the same broad separation users expect from tools like Codex: there is
global app/session state, and there is also a concrete workdir for the current
task.

## Target Layout

Recommended v1 target. `~/.clash` below means the default
`${CLASH_HOME:-~/.clash}` root:

```text
~/.clash/
  credentials.json
  machine-id
  local-api/
    local.sqlite
  assets/
    blobs/
      <sha256>/
        original.ext
    thumbnails/
      <sha256>.webp
  projects/
    <projectId>/
      project.toml
      .clash/
        project.toml
      loro/
        snapshot.bin
        updates.log
      assets/
        links/
          <assetId> -> ../../../assets/blobs/<sha256>/original.ext
      projections/
        timelines/
        text/
        storyboards/
        prompts/
        metadata/
      drafts/
      sessions/
        <sessionId>/
      runtime/
  workspaces/
    <workspaceId>/
      .clash/project.toml
      drafts/
      projections/
```

Notes:

- `CLASH_HOME` may override the root for testing, local isolation, and
  user-managed installs. All local app state, project workspaces, actions,
  sockets, cache, and host discovery should derive from that same root unless
  an explicit environment variable such as `CLASH_LOCAL_DATA_DIR` overrides a
  specific subsystem.
- `local-api/local.sqlite` is the alpha path for local metadata because it
  matches the current local-api data boundary.
- Current local-api Loro persistence also lives under the local-api data
  boundary. Until it is migrated, `clash project status --json` exposes the
  actual `loro.replicaRoot` separately from the project workspace root.
- `clash project status --json` also exposes `storage.canonicalReplica` as the
  machine-scoped canonical local replica and `storage.workspace` as the
  agent-editable draft/projection surface. Agents should use those structured
  roles instead of inferring ownership from path names.
- `storage.canonicalReplica.contentBlobs.textRevisions` and
  `storage.canonicalReplica.contentBlobs.timelineRevisions` expose the
  protected content-addressed roots for applied Markdown/YAML revision bodies.
  They are recovery/provenance stores referenced by SQLite revision indexes and
  API/CLI descriptors, not agent-writable projection folders.
- A future project-export feature may materialize project rows into
  `<projectId>/local.sqlite` or an export bundle, but that is not required for
  v1 alpha.
- Project `assets/links` is optional if CLI/API can resolve asset ids directly.
  It is useful for agent inspection, but it must not become the canonical blob
  owner.

### Revision And History Storage

Canonical collaborative history should remain in Loro binary storage, not in
agent-editable JSON files:

- `loro/snapshot.bin` is the compact checkpoint for project state.
- `loro/updates.log` is the append-friendly binary update stream.
- compaction controls growth by replacing the checkpoint and truncating update
  records covered by that checkpoint.
- user-visible revision rows should be milestone indexes, not one file per
  operation.

`local-api/local.sqlite` is the right place for queryable metadata indexes such
as timeline revision rows, asset dependency summaries, export provenance, and
searchable project metadata. Agents should inspect and mutate those through
CLI/local-api actions, not by editing SQLite directly.

Large or human-readable revision bodies that need deterministic recovery can
live beside SQLite as immutable content-addressed blobs when they are not media
assets. Current examples are applied text Markdown under
`local-api/text-revision-blobs/` and applied timeline YAML under
`local-api/timeline-revision-blobs/`. The rows in SQLite are the index; the blob
files are the immutable payloads; cwd projection files remain the editable
draft surface that must be applied back through CAS. Doctor treats existing
blob files as unsafe if they have writable permission bits or if their path hash
does not match the text content hash / semantic timeline hash.

JSON/YAML remains appropriate only for:

- agent-editable projections under `projections/`,
- drafts and session/config files intentionally owned by agents,
- export/package manifests that travel with produced assets.

## Project Marker

`.clash/project.toml` is a reference:

```toml
schema_version = 1
project_id = "project_123"
store = "managed"

[sync]
mode = "local"
```

Rules:

- Marker can exist in user cwd, project cwd, or generated workspaces.
- Marker does not create a project replica.
- Marker does not lock the project.
- Marker does not decide whether cloud sync is active by itself.
- `sync.mode` is a local hint/status field, not proof that cloud has all data.

## Agent CWD Policy

### Alpha acceptable path

For v1 alpha, it is acceptable to keep spawned agents in:

```text
~/.clash/projects/<encodedProjectId>/
```

This is already implemented and avoids making every session a new project copy.

Required alpha limits:

- document protected internal paths,
- put editable work under `drafts/` and `projections/`,
- keep Loro/SQLite/assets mutation behind commands,
- do not teach agents to edit root internals directly.

### Preferred long-term path

Longer term, spawned agents should default to a workspace/draft cwd:

```text
~/.clash/workspaces/<workspaceId>/
```

or:

```text
~/.clash/projects/<encodedProjectId>/sessions/<sessionId>/
```

That directory contains `.clash/project.toml` pointing back to the project.

Benefits:

- agents see fewer protected internals,
- session scratch files are easier to clean,
- project replica remains clearly owned by the host,
- multiple agents can work without sharing one filesystem scratch root.

The product can still expose project-level projections into that workspace.

## Asset Storage

Assets need two levels:

1. Blob storage.
2. Project references.

Recommended local model:

```text
~/.clash/assets/blobs/<sha256>/original.ext
~/.clash/assets/thumbnails/<sha256>.webp
~/.clash/projects/<encodedProjectId>/assets/links/<assetId>
```

SQLite owns the metadata:

- asset id,
- user id,
- kind,
- local blob key,
- optional remote R2 key,
- content hash,
- dimensions/duration/metadata,
- provenance,
- created/updated timestamps.

`asset_refs` owns project membership:

- asset id,
- project id,
- imported timestamp.

`mutation_audit` owns bounded local destructive/forced mutation evidence:

- operation and entity id,
- actor client type,
- forced/accepted flags,
- reason/result/error summary,
- sanitized mutation JSON without receipt-bearing read tokens.

This avoids copying the same blob for every project or session.

Alpha CLI behavior:

- `clash asset import --file <path>` stores bytes under
  `~/.clash/assets/blobs/<sha256>/original.ext`.
- The local asset id is `local:sha256:<sha256>`.
- The imported blob is made read-only.
- Unless `--no-link` is passed, the command creates a project inspection link
  under `~/.clash/projects/<encodedProjectId>/assets/links/`.
- Unless `--no-register` is passed, the command registers the blob with
  local-api as an immutable `assets` row plus a project `asset_refs` row.
- Identical content deduplicates to the existing blob path.

The alpha local-api GC removes asset rows with no SQLite `asset_refs` and
deletes `local-blobs/...` files that are no longer referenced by any remaining
asset row. It also accepts protected asset ids from live canvas/project state
and can scan requested project ids' Loro canvas nodes for `assetId` references.
When project ids are omitted, local-api discovers local project replica
directories and scans their Loro canvas nodes before deleting local blobs.
The scan treats fields ending in `AssetId` or `AssetIds` as first-pass
downstream metadata references. On non-dry-run GC, known assets discovered
through that scan are written back into SQLite `asset_refs`, so `asset_refs`
acts as the project-level materialized reference projection. The same refresh
writes `asset_node_refs` rows with project id, node id, node type, asset id,
field path, and first-pass reference role such as `source`, `reference`, or
`required-reference`. Agents and UI inspect that projection through
`GET /api/v1/assets/:id/references` or `clash asset refs`; they can explicitly
refresh it through `POST /api/v1/assets/:id/references/refresh` or
`clash asset refs --refresh`. They should not read SQLite or `snapshot.bin`
directly. A richer dependency graph with a stable role ontology, source
provenance, and UI-visible reference history remains host/API work, not
filesystem conventions.

## Symlink Policy

Symlinks are acceptable as a convenience layer, not as a safety model.

Allowed:

- project asset links pointing to immutable local blobs,
- doctor validation for broken or invalid project asset links,
- workspace links pointing to projection files,
- read-only inspection links for agents.

Not allowed:

- symlink targets inside `loro/`,
- symlink targets inside SQLite directories,
- symlink targets that bypass project permission checks,
- using symlink mutation as an apply mechanism.

Every apply/import command must resolve real paths and validate that the final
target is allowed.

If symlinks are unavailable on a platform, use hard links or generated copies
for inspection, but keep metadata and copy-on-write semantics the same.

## Copy-On-Write

Canonical assets and referenced content are immutable once downstream outputs
depend on them.

Rules:

- Editing an image/video/audio file creates a new asset.
- Editing text feeding materialized downstream state creates a new text asset
  or copied text node; text feeding only unmaterialized action drafts can still
  update in place.
- Editing a timeline with downstream render outputs should create a new
  timeline version or require explicit force/replace.
- Old assets remain until no `asset_refs` or downstream node refs point to
  them.

No in-place overwrite of referenced blobs.

## Sessions

Sessions should not create project replicas.

Session state splits into:

- metadata and chat messages in local SQLite,
- raw ACP/tool traces local by default,
- scratch files in session/workspace draft directories,
- human-visible room messages as project conversation.

Recommended alpha:

```text
~/.clash/projects/<encodedProjectId>/sessions/<sessionId>/
```

Recommended long-term if project root becomes protected:

```text
~/.clash/workspaces/<workspaceId>/
```

Both contain `.clash/project.toml`.

## Cloud Sync

Cloud is layered on the same project identity.

Local-only:

- one local project replica,
- local assets,
- local SQLite,
- local runtime sessions,
- no web-openable claim.

Synced:

- project status reports `syncReadiness.ready: true`,
- canvas updates have a remote persistence path,
- asset metadata and required blobs are uploaded or lazily fetchable,
- room messages sync,
- local-only runtime traces remain local unless opted in.

Shared:

- cloud ProjectRoom sequences real-time canvas updates,
- permission checks happen at cloud boundary,
- local agents/custom actions are user-owned runtime endpoints,
- if the machine is offline, those endpoints are unavailable unless an explicit
  cloud worker alternative exists.

## What Agents May Edit

Agents may edit:

- files in `drafts/`,
- generated reports/scripts,
- projection files after pull,
- Markdown/YAML/JSON files whose command contract says they are editable.

Agents may not edit directly:

- `loro/snapshot.bin`,
- `loro/updates.log`,
- `local.sqlite`,
- credential files,
- raw provider/OAuth secrets,
- canonical asset blobs,
- project marker if doing so changes project identity accidentally.

Changing project identity should be done through a CLI command:

```text
clash project link <projectId>
```

not by silently editing the marker.

## Required Commands

Project/context:

```text
clash project status --json
clash doctor storage --json
clash doctor storage --repair
clash project link <projectId>
```

Projection:

```text
clash timeline pull/apply
clash text pull/apply
clash storyboard pull/apply
clash projections status
```

Assets:

```text
clash asset get --asset <assetId> --json
clash asset import --file <path>
clash asset link --asset <assetId>
clash asset replace --node <nodeId> --file <path>
clash asset cover set --asset <assetId> --cover-key <storageKey> --if-match <readToken> --json
clash asset ref get --asset <assetId> --project <projectId> --json
clash asset ref delete --asset <assetId> --project <projectId> --if-match <readToken> --yes --json
clash asset refs --asset <assetId> --json
clash asset refs --asset <assetId> --project <projectId> --json
clash asset refs --asset <assetId> --project <projectId> --refresh --json
clash asset gc --dry-run
clash asset gc --delete
clash asset gc --delete --protect-asset <assetId>
clash asset gc --delete --project <projectId>
```

Storage/debug:

```text
clash doctor storage
clash doctor storage --repair
clash doctor storage-recovery list --json
clash doctor storage-recovery compare --manifest <path> --json
clash doctor storage-recovery restore --manifest <path> --if-match <readToken> --yes --json
clash project export <projectId>
clash project repair <projectId>
```

Debug commands can inspect internals, but product workflows should not depend
on editing internals.
`storage-recovery list` is read-only inventory tooling: it lists quarantined
secondary-canvas recovery manifests under the host-owned runtime recovery root
so agents do not have to discover protected paths manually. List uses the same
manifest containment checks as compare before treating a recovery set as valid:
the manifest must be a real file under the current project's protected recovery
root and every quarantined file path must stay inside that recovery set without
symlink indirection. Invalid entries are reported separately instead of being
blessed as recovery sets. List also exposes local `restoreReceipts` summaries
for successful restores found under the recovery set's
`canonical-before-restore/` directory, after applying the same regular-file and
realpath containment checks, so agents can review prior explicit promotions
without scanning protected internals directly. `storage-recovery compare` is read-only evidence
tooling for one manifest: it reports quarantined and canonical file existence,
size, and hash. Compare is bound to the current project status: the manifest
must be the real `manifest.json` under that project's protected runtime recovery
root, must match the current project id and canonical replica paths, and each
quarantined file path must stay inside the same recovery set without symlink
indirection. This keeps the command from becoming a generic file hash oracle.
`storage-recovery restore` is the only promotion path for quarantined Loro
bytes: it requires a prior compare `readToken`, explicit `--yes`, re-runs the
same manifest/path checks, backs up existing canonical files when present, and
rejects stale tokens if either the quarantined bytes or canonical bytes changed
after compare. A successful restore writes a durable local
`restore-receipt.json` under the recovery set's `canonical-before-restore/`
directory with the project id, manifest path, expected/before/after read
tokens, restored file evidence, and post-restore canonical hashes. Automatic
import remains disabled. All `storage-recovery` JSON reports include a
`recoveryPolicy` object that binds the operation to the local canonical
replica, records the current collaboration mode/room authority, states that no
cloud state is included or mutated, and marks `cloud-sync` restores as requiring
cloud conflict review. `shared` projects use `cloud-sequencer` authority, so
their manifests can be listed/compared for evidence but local restore is
rejected; shared recovery must use a cloud/shared conflict path instead.

## Migration From Current State

1. Keep `${CLASH_HOME:-~/.clash}/projects/<encodedProjectId>` as the alpha agent cwd.
2. Create explicit `drafts/`, `projections/`, `sessions/`, and `assets/links/`
   directories.
3. Keep local metadata in `local-api/local.sqlite`; treat `db.json` only as a
   legacy import/debug artifact.
4. Align local-api Loro store and bridge project cwd documentation around the
   same project id and directory model.
5. Ensure every local subsystem derives paths from `CLASH_HOME` or an explicit
   subsystem override.
6. Keep global content-addressed asset blob import aligned with the local API
   asset metadata model.
7. Generate project asset links only as inspection/projection convenience.
8. Add storage doctor checks for:
   - legacy `.clash/project.json` markers, reported as ignored old-layout
     cleanup/migration evidence rather than project context,
   - multiple snapshots for one project (`secondary-canvas-replica` first pass),
   - broken asset links,
   - missing local SQLite core metadata tables, provider auth tables/primary keys, and
     projection indexes for asset references and text/timeline revisions,
   - unexpected writes in protected directories,
   - missing project marker,
   - mismatched marker/env project id.
9. Add storage doctor repair for safe host-owned fixes:
   - create the standard agent workspace roots (`drafts/`,
     `projections/{text,timelines,storyboards,prompts,metadata}/`,
     `sessions/`, `assets/links/`, and protected `runtime/`),
   - ensure the local SQLite core metadata tables, provider auth tables/primary keys, plus
     `asset_refs`, `asset_node_refs`, `text_revisions`, and
     `timeline_revisions` lookup indexes exist,
   - restore read-only permissions on hash-valid text/timeline revision blob
     files that drifted writable,
   - quarantine secondary `snapshot.bin` / `updates.log` files under
     `runtime/recovery/secondary-canvas-replicas/` with durable `manifest.json`
     source-path and destination-path evidence, without applying them to
     canonical state,
   - do not delete `db.json`, canonical asset blobs, canonical `snapshot.bin`,
     or broken links without a separate explicit destructive command.
     Deleted-project recovery points use `clash project purge <projectId>
     --yes --if-match <deletedReadToken>` / `DELETE
     /api/v1/projects/:id/purge`, which rejects active projects, defaults to a
     7-day delay unless `--force` is explicit, removes project-scoped SQLite
     rows and the canonical Loro replica, clears project ownership from retained
     immutable asset rows, and leaves retained asset blobs/rows for asset GC.
10. Move default agent session cwd to workspace/session draft dirs after alpha,
   if protected-root incidents become common.

## Completion Criteria

This layout is implemented when:

- each local project has one canonical Loro replica per machine,
- user cwd can reference a project without owning a replica,
- agent-created drafts and projections have explicit editable roots,
- local metadata is SQLite, not broad JSON,
- asset blobs are not duplicated per project/session,
- symlinks are optional read conveniences, not write semantics,
- copy-on-write protects referenced content,
- storage/debug commands can diagnose path drift,
- `clash audit mutations` can inspect sanitized destructive/forced mutation
  evidence without reading SQLite directly,
- local-only/synced/shared project modes do not blur storage ownership.
