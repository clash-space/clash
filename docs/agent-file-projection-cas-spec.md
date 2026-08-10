# Agent File Projection And CAS Spec

Last updated: 2026-07-10

## Purpose

Define the v1 contract for product state that agents can read or materialize as
normal files, edit with native filesystem tools, and apply through Clash.

```text
read or pull -> edit in cwd -> explicit CLI mutation -> host validation -> CRDT/SQLite state
```

The agent owns its cwd. Clash owns canonical product state. Files become product
state only through an explicit host action.

## Product Objects

1. Canonical entity
   - Canvas node, edge graph, timeline, text node, asset metadata, review gate,
     or managed production projection.
2. Editable projection
   - YAML, Markdown, or JSON materialized in the agent cwd.
3. Cwd observation
   - The canonical entity version observed by a successful CLI read.
4. Mutation command
   - An explicit CLI action that validates the observation and applies a
     semantic change.
5. Provenance manifest
   - Optional system-written metadata describing where a projection or export
     came from. It is not write authority.

`snapshot.bin`, Loro internals, SQLite files, canonical media blobs, revision
blobs, credentials, and runtime secrets are not agent editing surfaces.

## Cwd State

`.clash/project.toml` is only a project pointer. It may contain project and
workspace identity, but not mutable project state, credentials, permissions,
sync readiness, or canonical storage paths.

`.clash/observed.json` is the only cwd state used for implicit read-before-write
CAS. It stores versions, not entity content:

```json
{
  "schemaVersion": 1,
  "projectId": "project-1",
  "versions": {
    "canvas-node:node-1": "node-v1:...",
    "timeline:episode-1": "timeline-v1:...:receipt:...",
    "text:script-1": "text-v1:..."
  }
}
```

The file is written atomically with owner-only permissions. The current desktop
bridge may share one managed Project cwd across multiple sessions, so v1 read
presence is workspace-scoped rather than session-scoped. Separate external
working trees have separate observation files. The CLI serializes concurrent
rewrites so independent reads do not lose observations. Any filesystem
mutex used during that rewrite is transient internal machinery: it is not
persisted agent state, mutation authority, or an agent-facing lock contract.

The observation file must not cache product bodies, command descriptors,
mutation reasons, permissions, or per-node mutable-field policy.

## Read Contract

A successful agent read must:

1. Resolve the project from the cwd marker.
2. Read the canonical entity through CLI/host APIs.
3. Return the user-visible entity without internal receipt fields.
4. Record the entity's current observation in `.clash/observed.json`. A local
   host observation includes an opaque receipt bound to the semantic version.
5. For file projections, write the editable file inside the cwd.

Representative reads are:

```text
clash canvas get
clash canvas edges
clash canvas delete-plan
clash timeline pull
clash text pull
clash projects get
clash asset get
clash asset ref get
clash models providers
clash assets metadata kinds
clash assets metadata list
clash assets metadata get
```

Reads expose semantic state needed to choose an operation. Canvas node reads
include `immutable: boolean`. They do not expose a command to run, a reason
string, a mutable-field list, or a write token.

## Mutation Contract

A mutation of an existing entity performs these checks in order:

1. **Read presence**: the cwd has an observation for the target entity.
2. **CAS**: the observed version equals the current canonical version.
3. **Semantic rules**: immutability, reference, schema, permission, path, and
   destructive-confirmation checks pass.
4. **Host mutation**: the semantic operation is applied through the canonical
   Loro/SQLite owner.
5. **Refresh**: the cwd observation is updated to the resulting version.

Failures are structured and recoverable:

- `READ_REQUIRED`: read or pull the target through the CLI first.
- `STALE_READ`: re-read, reconcile the intended change, and retry.
- `IMMUTABLE_NODE`: copy the node, edit the copy, and explicitly rewire selected
  references if needed.

Pure creation of a new entity or immutable fact does not require a prior target
read. Stable IDs, content hashes, idempotency, and collision rejection still
apply.

## Public CLI Boundary

The agent-facing CLI must not expose or require:

- a manual read token,
- an `if-match` mutation option,
- a projection lock sidecar,
- a lock-file argument,
- a force or overwrite bypass.

The agent expresses intent with normal commands. The CLI supplies the observed
version and any host receipt internally. Public JSON output strips internal
semantic versions and receipt fields while preserving user-owned fields that
happen to be named `version` inside entity data. Copying or editing the
observation file does not grant product permission; forged receipts fail.

Remote and older hosts may still accept internal receipt-bearing requests for
protocol compatibility. That transport detail must not become an agent command
argument or a file the agent manages.

## File Projection Families

### Timeline

```bash
clash timeline pull --timeline <timeline-id> --json
# edit timelines/main.timeline.yaml
clash timeline apply --timeline <timeline-id> --json
```

`pull` records `timeline:<timeline-id>`. `apply` parses and normalizes YAML,
performs implicit CAS, and advances the canonical Project Timeline revision.
A Timeline Action references that Timeline; timeline content is not embedded in
the Canvas node. Copying a Timeline Action to another Canvas creates a new
Timeline and Action node so the source continues to evolve independently.

### Text

```bash
clash text pull --node <text-node-id> --json
# edit projections/text/<text-node-id>.md
clash text apply --node <text-node-id> --json
```

`pull` records `text:<node-id>`. `apply` uses the Markdown body and implicit CAS.
`replace` creates a copy-on-write text node when the original must remain pinned.

### Asset metadata

`clash assets metadata set` attaches a declared kind, stores any body as an
immutable content-addressed blob, materializes the editable metadata JSON,
writes a source-provenance manifest, and records
`asset-metadata:<projection-path>`. After native editing,
`clash assets metadata apply` consumes that observation -- or an explicit
`--expect-version` token outside a linked worktree -- and updates the asset row.
The fill envelope is synthesized internally; there is no action file to author.

A metadata body is an output, not editable state: it is addressed by hash and
rewritten only by attaching a new one.

### Storyboard prompt packs and review gates

`project-storyboard-prompt-pack` and `plan-review-gate` are their read/materialize
steps. They record path-bound observations. Their apply/replace/approve commands
consume those observations implicitly. Copying a file to a new path does not
copy read authority.

## Copy-On-Write

A canvas node with any downstream edge is immutable as a whole. In-place node
update, delete, or text apply fails with `IMMUTABLE_NODE`.

```bash
clash canvas copy --node <node-id> --json
```

Copy keeps existing downstream references on the source, creates source-to-copy
lineage, and returns a mutable node. Media replacement, text replacement, and
storyboard prompt-pack replacement follow the same rule with type-specific data
validation. Timeline content follows Timeline identity and revision rules.

Applied text revisions and media assets are immutable facts. A Timeline edit
advances its Loro revision; downstream outputs retain the exact Timeline
revision they rendered from.

## Path Safety

All agent input/output paths must remain inside the resolved cwd after realpath
and symlink checks. Commands reject:

- `..` traversal outside cwd,
- absolute paths under another project,
- symlinks that escape cwd or enter protected storage,
- mismatched projection/manifest source paths,
- attempts to edit canonical blobs or database files.

Path checks run before canonical mutation. A rejected path must not leave a
partially changed asset manifest, canvas, gate, or managed projection.

OS permissions are defense in depth. Product safety comes from path validation,
implicit CAS, semantic guardrails, COW, and host-owned mutation APIs.

## Collaboration

Local-only, synced, and shared projects use the same local replica and mutation
contract. Cloud sync replicates product-internal state; it does not define a
second agent filesystem workflow or grant authority through cwd files.

Loro remains canonical for collaborative canvas history and conflict merging.
JSON/YAML/Markdown are editable projections and provenance, not replacement
event logs.

## Recovery Exception

Offline `doctor storage-recovery compare/restore` may use an explicit compare
value because it promotes quarantined raw canonical bytes while normal product
state is unavailable. It is support tooling, requires explicit confirmation,
and is not a normal agent mutation surface. It must not be copied as a pattern
for canvas, asset, project, text, timeline, metadata, or review commands.

## Required Tests

- read creates/refreshes only the expected cwd observation,
- mutation before read returns `READ_REQUIRED`,
- concurrent canonical change returns `STALE_READ`,
- re-read then mutation succeeds without a manual token,
- public output contains no internal receipt or version fields,
- downstream-referenced nodes return `immutable: true` and reject in-place
  mutation,
- copy preserves old references and creates mutable lineage,
- text/timeline projections create no lock sidecars,
- rendered outputs pin the source Timeline revision,
- path and symlink escapes fail before mutation,
- legacy remote receipt requests remain compatible,
- black-box CLI subprocess tests cover the complete workflow.
