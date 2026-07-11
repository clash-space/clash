# Agent-First Local v1 Code Audit

Last updated: 2026-07-10

## Scope

Audit the current repository against the local/agent-first product contract in
`AGENTS.md`, `agent-first-local-v1-principles.md`, and
`agent-file-projection-cas-spec.md`.

## Aligned

### Project and cwd

- `.clash/project.toml` is a project pointer rather than mutable project state.
- `.clash/observed.json` stores only per-entity semantic versions.
- Observation writes are atomic and scoped to one agent cwd.
- Normal commands do not require `project status` as a preflight.

### Persistence

- Loro remains canonical for collaborative canvas state/history.
- SQLite owns relational metadata, config, provider accounts, OAuth state,
  sessions, asset references, and revision indexes.
- Media and applied text revision bodies use immutable, content-addressed
  storage. Timeline revisions live only in the Project Loro replica.
- Broad mutable JSON database state is not part of the local architecture.

### Agent mutation contract

- CLI reads record cwd observations.
- Mutations check read presence and compare the observed/current semantic
  version before changing canonical state.
- Public command syntax and JSON do not expose internal receipt fields.
- There is no overwrite/force bypass.
- Shared canvas guardrails are used by CLI, daemon, local API, and Web paths.

### Immutable/COW behavior

- Any downstream edge makes a canvas node immutable as a whole.
- Reads expose `immutable`.
- In-place writes fail with `IMMUTABLE_NODE`.
- `clash canvas copy` provides the uniform node-level COW action.
- Media, text, and storyboard prompt-pack typed replacements preserve source
  lineage and leave existing downstream references pinned. Timeline Action copy
  creates a distinct Project Timeline identity.

### Editable projections

- Text: Markdown pull/edit/apply/replace.
- Timeline: Project-scoped create/list/attach/detach/copy plus YAML pull/edit/apply.
- Storyboard prompt packs: JSON project/edit/apply/replace.
- Review gates: plan/edit/approve with path-bound observation.
- Asset metadata: action apply/materialize/edit/apply with source provenance.
- Projection and output paths use cwd/realpath/symlink containment guards.
- Current projection workflows do not create lock sidecars.

### Revision provenance

- Applied text revisions are indexed by the host with immutable bodies.
- Timeline apply advances the Timeline revision atomically inside Loro; there is
  no sibling revision manifest, SQLite Timeline table, or Timeline blob store.
- Caption export, caption burn, and NLE handoff pin the matching Project Timeline
  revision ID and semantic hash.

### Local/cloud boundary

- Local-only, synced, and shared modes use the same local replica and mutation
  semantics.
- Cloud code remains valid replication/collaboration infrastructure.
- Cwd files, raw agent traces, secrets, and local runtime paths are not
  implicitly admitted to cloud sync.
- Host receipts remain an internal transport detail behind cwd observations.

## Restricted By Design

- Agents cannot edit `snapshot.bin`, SQLite, Loro blobs, canonical media blobs,
  revision blobs, credentials, or runtime secrets.
- Direct canvas updates cannot patch timeline/provenance-owned fields.
- A copied file is not automatically an observed product entity.
- Local custom actions depend on the local runtime; they do not become remote
  workers or require a project secret.
- Offline storage recovery remains support tooling, not a normal mutation API.

## Remaining Risks

1. **Adapter coverage**: every new read/mutation family must use the shared cwd
   observation adapter; one-off implementations can reintroduce blind writes.
2. **Transport parity**: daemon, local API, Web, and cloud paths must preserve
   the same immutable/COW rules while retaining their own auth/admission logic.
3. **Observation invalidation**: project relink and entity deletion must not
   leave observations that can target a different identity.
4. **Revision provenance**: new exporters must pin the exact source revision,
   not only the latest node or asset ID.
5. **Path containment**: new production planners/exporters need the shared
   realpath guard before any partial canonical write.
6. **Concurrency**: SQLite read-modify-write paths need serialized update APIs
   and deterministic concurrent-write tests.
7. **Recovery separation**: support-only raw-replica restore commands must stay
   out of agent skills and normal command guidance.

## Evidence

- Shared observation unit tests.
- Canvas guardrail and daemon command tests.
- Canvas/text/timeline/project/asset/model CLI tests.
- Local API observed-version, internal receipt, and no-cloud-auth tests.
- Production metadata, review gate, prompt-pack, and timeline provenance tests.
- Skill registry/schema tests and multi-category production artifact E2E.
- Real CLI subprocess E2E covering missing read, stale read, re-read, immutable
  rejection, COW lineage, projection apply, revision pinning, and local no-auth.

## Decision

The v1 architecture is coherent when the cwd is treated as an agent-owned
working tree and Clash product state is changed only through explicit host
actions. New work should extend this contract rather than adding another local
store, project directory, lock format, or privileged mutation mode.
