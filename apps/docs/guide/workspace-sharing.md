# Portable Workspace bundles

Clash Workspaces can be exported, inspected, shared, and imported as auditable
directory bundles. A bundle is product content, not a backup of one Host's
storage layout.

## Public v1 layout

```text
workspace.json
project.bin
objects/sha256/<64 lowercase hex>
workspace/<working-tree path>
```

`workspace.json` is the strict, canonical manifest. It records the source
Project identity, safe Project display metadata, the tagged
`loro-shallow-snapshot@1` codec for `project.bin`, portable text
revision records, immutable Resource/Document/text body descriptors, semantic
Generator/model readiness hints, excluded working-tree paths, and every payload
file's relative path, portable mode, byte length, and SHA-256.

`project.bin` is a current-frontier portable clone of Project authority. It
preserves current semantic IDs, active and tombstoned relationships, Timeline
and Director current revisions, Generator runs, Asset bindings, and Document
relationships. Workspace v1 deliberately garbage-collects source-local undo
and superseded Canvas/Timeline/Stage operation history. A future Git-like full
history format is deferred. The shallow snapshot is still audited for retained
CRDT register conflicts and machine-private values before export.

`objects/sha256` is one self-contained content-addressed namespace. The same
object may satisfy Resource, Document body, and text body descriptors. Resource
facts are still re-established by receiver-side staging, asset-inspection/v4,
and sealing; a manifest is never trusted as media inspection authority.

The `workspace/` subtree is the agent-owned working tree. Export excludes Git
internals, the source marker, observations, runtime/cache paths, and generated
Asset links. Secret-like files such as `.env*`, `.npmrc`, private keys, and
credential/token paths fail export rather than being silently shared.

## Import semantics

Import accepts only a new target directory and a Project identity not already
owned by the receiver Host. It verifies the strict manifest, canonical digest,
declared file closure, byte hashes, modes, path traversal, symlinks, hardlinks,
Unicode/case collisions, and the same working-tree deny policy used by export.

The source `projectId` and all semantic entity/revision/resource IDs are
preserved. A source Workspace ID is used only during the live export handshake;
it is not written into the bundle or import receipt. The target marker gets a
new path-derived Workspace ID and never grants remote membership or cloud
capability.

The Host validates `project.bin` as portable product authority, reconstructs
receiver-local Project/text indexes, and never imports SQLite tables, owner or
receiver account configuration, provider credentials, device/runtime/session
state, installation receipts, sockets, locks, caches, or raw traces.
Schema-declared product-visible authored-by attribution may remain as portable
Project history; it is not receiver ownership or account configuration.
Project snapshot publication
and receiver-local metadata commit are protected by a durable import
reservation so ordinary rooms cannot observe a half-imported Project.

Export requires a serial checkpoint and quiescent public work. Pending/running
Generator runs and legacy pending/generating nodes block export. Non-empty
legacy `customActions` also block v1 export because those records embed an old
execution environment; legacy private `tasks` and unknown Loro root containers
also fail closed instead of riding inside an opaque snapshot. They must migrate
to a recognized portable product authority before export.

## CLI

```bash
clash workspace export --out ./portable-workspace
clash workspace inspect ./portable-workspace --json
clash workspace import ./portable-workspace --into ./new-worktree
```

The CLI moves worktree files and streams opaque Host capabilities. It never
reads `local.sqlite`, the Resource store, or the replica directory directly.
There are no merge, overwrite, force, or naive fork modes in v1.
