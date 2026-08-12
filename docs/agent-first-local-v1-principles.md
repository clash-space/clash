# Agent-First Local v1 Principles

Status: Accepted

Last updated: 2026-07-11

## Product Boundary

Clash is local-first. The normal command path is:

```text
marker cwd/.clash/project.toml
-> discovered local-api Local Host
-> one machine-local Project Loro replica
```

Local commands do not require cloud authentication. OAuth is an optional
product-managed remote-sync capability. Enabling sync must not introduce a
second project directory, mutation API, Canvas model, Timeline model, or agent
workflow.

## Ownership

- A human owns their computer and working directories.
- An agent owns its cwd and may use native tools there.
- The product owns canonical Project state, indexes, secrets, and immutable
  blobs below `$CLASH_HOME`.
- A Canvas is a synchronized view of part of Project state, not the whole
  workspace.
- Scratch files, plans, source code, analysis, and tool traces remain in cwd
  unless explicitly applied or admitted to cloud sync.

## Project Identity

`.clash/project.toml` is a pointer, analogous to Git worktree metadata. The v1
marker contains only stable identity fields:

```toml
schema_version = 1
project_id = "project-id"
```

It does not grant permissions, enable sharing, store credentials, declare
canonical paths, or carry mutable sync state. Commands discover the nearest
marker and operate without a status preflight.

`$CLASH_HOME/projects/<project-id>` is the default managed cwd when Clash
creates one. Any other marker cwd is equally valid as an agent draft and
projection workspace. Deleting a cwd never deletes canonical Project state.

## Canonical State

One Project has one canonical Loro replica per machine. It contains Canvases,
nodes, graph references, Project Timelines, Timeline ownership, and other
collaborative product state. `snapshot.bin` and `updates.log` are host-owned
storage details; agents do not edit them directly.

Cloud sync replicates admitted Loro updates from this local replica to the
hosted sequencer. The cloud does not become an alternate local authority.

## Agent-Editable Files

The marker cwd may contain:

```text
drafts/
projections/
  text/<node-id>.md
  timelines/*.timeline.yaml
timelines/<timeline-id>.timeline.yaml
sessions/
assets/links/
.clash/observed.json
```

These files are drafts, projections, links, and local observation evidence.
They are not a second copy of canonical Project state.

The standard structured-edit workflow is:

```text
CLI pull/read -> native file edit -> explicit CLI apply
```

The host validates identity, path containment, current revision, semantic
shape, immutability, and downstream references before committing.

## Read Before Write

Agent reads record an opaque entity observation in `.clash/observed.json` with
owner-only permissions. A connected host may bind an unforgeable receipt to
that observation. Writes consume the observation internally.

Public commands never require callers to pass a read token, compare token, or
lock sidecar. On conflict, the agent reads again, reconciles its draft, and
retries. There is no mutation override path.

## Immutability and Copy on Write

- Media bytes are content-addressed and immutable.
- Applied text content creates an immutable text revision and host-owned
  content blob.
- A Canvas node with downstream references is immutable as a whole.
- `clash canvas copy` creates a new node when an immutable node must evolve.
- `clash text replace` creates a copy-on-write text node and revision.
- Existing downstream references remain pinned until explicitly rewired.

Timeline is different from an immutable media asset. It is an editable Project
entity whose state evolves in Loro. Each committed state has a stable revision
identity. Rendering creates a new immutable asset that pins the exact Project
Timeline revision. Timeline does not have a second SQLite revision registry,
revision blob store, or node-local history.

## Actions, Metadata, Assets, and Views

- A Skill describes workflow knowledge and artifact contracts. It does not
  mutate Canvas internals directly.
- An Action is the host mutation/execution boundary.
- Analysis fills typed Asset metadata through an Action.
- Generated or transformed media becomes a new immutable Asset.
- Canvas and Timeline are concrete product Views over Project entities.
- A Timeline Action references a Project Timeline by `timelineId`; tracks and
  items are not nested mutable Canvas-node state.
- React/Remotion compositions are Timeline item capabilities. Rendering them
  still produces immutable assets with source provenance.

## Local and Cloud Collaboration

Local-only, synced, and shared projects use the same local replica and CLI.
Product-internal state owns remote admission, OAuth, membership, sync
readiness, Web access, and conflict UI. The marker and cwd cannot self-enable
those capabilities.

Raw agent traces, secrets, local paths, scratch context, and machine-local
configuration stay local by default. Only explicitly admitted product state is
eligible for remote replication.

## Persistence Formats

- SQLite: machine-local metadata, sessions, indexes, provider state, audit
  evidence, and sync configuration.
- Loro: collaborative Project state and Timeline history.
- Content-addressed files: immutable media and text revision bodies.
- TOML: the small stable project pointer.
- JSON/YAML/Markdown: agent-editable drafts, projections, manifests, and
  configuration that is intentionally reviewable or modifiable.

There is no broad mutable JSON database persistence path.

## Diagnostic Surfaces

`project status` is diagnostic. It reports the current marker workspace and
host-owned canonical locations, but agents need not call it before reading or
writing. `doctor storage` checks and repairs storage layout; it is not a
permission gate.

## V1 Restrictions

- No direct edits to `snapshot.bin`, `updates.log`, `local.sqlite`, secrets, or
  immutable blob stores.
- No canonical Project state in cwd.
- No duplicate media blobs per Project or cwd.
- No Timeline state nested as an independently editable Canvas-node payload.
- No Timeline revision sidecars, lock sidecars, SQLite history table, or
  revision-content endpoint.
- No cloud credential requirement for the local host.
- No local room persistence or raw trace synchronization.
- No public mutation tokens or hidden override commands.
