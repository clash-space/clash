# Agent File Projection CAS Spec

Last updated: 2026-07-08

## Purpose

Define the v1 contract for files that agents can read and edit with normal
filesystem tools, then apply back into Clash product state.

The rule is:

```text
Agent-editable files are projections, not independent source of truth.
Every read-edit-apply projection must use CAS.
Every agent write to existing product state must prove a prior product read.
```

This keeps Clash local/agent-first without turning `snapshot.bin`, SQLite, or
canonical asset blobs into unvalidated editing surfaces.

## Product Model

There are five distinct objects:

1. Canonical entity
   - Canvas node, timeline field, text asset, storyboard, prompt pack, or asset
     metadata record owned by Clash.
2. Projection file
   - YAML, Markdown, JSON, or another human-readable file generated from the
     canonical entity.
3. Lock file
   - Sidecar record proving what canonical state the projection was pulled
     from.
4. Apply command
   - CLI/local-api command that parses the projection and validates the lock.
5. Host mutation
   - The only operation that changes canonical project state and emits Loro or
     SQLite updates.

Agents may edit item 2. Agents may not mutate items 1 or 5 directly.

## Current Baseline

Timeline already has the first concrete implementation:

- `packages/cli/src/lib/timeline-projection.ts`
- `packages/cli/src/commands/timeline.ts`
- `packages/cli/src/commands/canvas.ts`
- `packages/cli/src/lib/daemon.ts`

Existing behavior:

- `clash timeline pull` writes `timelines/main.timeline.yaml`.
- Pull also writes `timelines/main.timeline.lock.json`.
- The lock contains the generic projection envelope plus timeline-specific
  compatibility fields: project id, `projectionKind: "timeline"`, entity id,
  file path, `contentHash`, `timelineHash`, optional read token, hash algorithm,
  and pull timestamp.
- `clash timeline apply` refuses stale writes unless `--force` is used.
- If a canvas daemon is running, daemon command `timeline_cas_update` also
  validates the expected hash before mutating the node. For agent callers, the
  daemon now requires the receipt-bearing `readToken` written by `clash
  timeline pull`; a bare synthesized timeline CAS token is rejected unless the
  caller explicitly forces the write.
- Timeline apply is rejected when the video-editor node feeds materialized
  downstream checkpoint/render nodes; draft/idle downstream placeholders remain
  editable.
- The legacy `clash canvas timeline pull/push` path has the same CAS and
  materialized-checkpoint behavior.
- `clash timeline history` lists host-indexed applied milestones, and `clash
  timeline content --revision <id> [--out <path>]` fetches the immutable YAML
  body for a selected revision without direct SQLite or snapshot access. `--out`
  paths are checked against the current cwd, including symlink escape checks.

Text nodes now have a first-pass Markdown projection too:

- `packages/cli/src/lib/text-projection.ts`
- `packages/cli/src/commands/text.ts`
- daemon command `text_cas_update`

Existing text behavior:

- `clash text pull` writes `projections/text/<node-id>.md`.
- Pull also writes `projections/text/<node-id>.lock.json`.
- Text locks use the same generic projection envelope with
  `projectionKind: "text"`, entity id, file path, content hash, optional read
  token, hash algorithm, and pull timestamp.
- `clash text apply` refuses stale writes unless `--force` is used.
- The daemon validates the expected text hash before mutating. For agent
  callers, the daemon now requires the receipt-bearing `readToken` written by
  `clash text pull`; a bare synthesized text CAS token is rejected unless the
  caller explicitly forces the write.
- Successful `clash text apply` and `clash text replace` create a
  `clash.text.revision` milestone. The revision records the source projection
  path, content hash, parent revision id when present, and actor attribution;
  refreshed lock sidecars store the applied revision so the next apply has a
  stable parent. Copy-on-write replacement nodes also store the same text
  revision in node data.
- `clash text history` reads the host-owned text revision index through the
  local API, so agents can inspect applied text revisions without direct DB
  access. History entries with stored Markdown bodies include an immutable
  `text-revision-content` descriptor, making text revision content addressable
  without treating it as a media asset row. The descriptor includes
  `storage.registry: "text_revisions"`, `storage.mediaAsset: false`, and
  `storage.agentWritable: false` so agents know to use text revision recovery
  APIs instead of asset import/replace/GC commands.
- `project status.storage.canonicalReplica.contentBlobs.textRevisions` exposes
  the protected content-addressed blob root for those bodies, and
  `doctor storage` treats moving that root into an agent-editable path as an
  unsafe storage contract.
- `clash text content --revision <id> [--out <path>]` fetches the immutable
  Markdown body for a selected applied revision through the host API. `--out`
  paths are checked against the current cwd, including symlink escape checks.
- In-place apply is rejected by default when the text node feeds materialized
  downstream state; text feeding only unmaterialized action drafts remains
  editable. `clash text replace` creates a copy-on-write text node from the
  locked Markdown projection and keeps existing materialized downstream refs on
  the old node. `--force` remains an explicit checkpoint rewrite escape hatch.

Storyboard prompt packs now have a first-pass JSON projection:

- `clash production project-storyboard-prompt-pack` writes an editable
  `plans/*.prompt-pack.json` file plus a lock sidecar.
- The lock uses the same generic projection envelope with
  `projectionKind: "storyboard-prompt-pack"`,
  `entity: { kind: "storyboard-asset", id: ... }`, and `contentHash`, while
  keeping compatibility fields such as `storyboardAssetId` and
  `promptPackHash`.
- `clash production apply-storyboard-prompt-pack` applies reviewed edits into
  the managed `projections/storyboards/<asset>.prompt-pack.json` projection
  only if the lock still matches both the current managed prompt-pack and the
  source storyboard action hash that produced the editable file.
- `clash production replace-storyboard-prompt-pack` uses the same lock as read
  proof and writes a versioned copy-on-write projection at
  `projections/storyboards/<asset>.prompt-pack.<hash>.cow.json` without moving
  existing downstream references.

Asset metadata generated by `clash production apply-metadata` writes the same
generic projection envelope next to
`projections/metadata/<asset>.<metadata-kind>.json`, with compatibility fields
for `targetAssetId`, `metadataKind`, `metadataHash`, `sourceActionPath`, and
`sourceActionHash`. JSON projections derived by the same command, such as beat
hints, transcript cut plans, rights ledgers, storyboard summaries, reference
reviews, QA reports, and provenance reports, write
`clash.asset.metadata.projection.lock` sidecars with their own
`projectionKind`, `contentHash`, source metadata path/hash, and source action
path/hash.

Agents can edit the primary metadata projection JSON with native file tools and
then run `clash production apply-metadata-projection --file ...`. The command
uses the `clash.asset.metadata.lock` sidecar as CAS proof: the lock hash must
match the current asset metadata in `assets/manifest.json`, the lock path must
match the edited file, and a successful apply refreshes the lock to the new
metadata hash.

Export outputs that materialize an action decision should carry the same
source-action proof even when they are not themselves editable projections. For
example, `clash production export-text-cut-media` validates the source action
path through the project cwd plus realpath boundary, computes a stable
`sourceActionHash`, and writes `sourceActionPath` / `sourceActionHash` into the
CLI result, ffmpeg plan, media-cut package, and output asset metadata. This lets
agents and users inspect a rendered talking-head cut and recover which ASR/text
cut action version produced it without reading SQLite or canvas internals.

The remaining v1 gap is that storyboard prompt packs and asset metadata still
run as file-only CAS paths rather than host-issued receipt paths, and the
mechanism does not yet cover non-JSON storyboard files or future editor
timeline projections.

## Lock Envelope

New projection sidecar locks should share this identity shape:

```json
{
  "schemaVersion": 1,
  "kind": "clash.<projection>.lock",
  "projectionKind": "<projection-kind>",
  "projectId": "<project-id>",
  "entity": { "kind": "<canonical-entity-kind>", "id": "<entity-id>" },
  "filePath": "<projection-path>",
  "contentHash": "<semantic-hash>",
  "readToken": "<optional-host-issued-read-proof>",
  "hashAlgorithm": "sha256-64",
  "pulledAt": "<iso-timestamp>"
}
```

Projection families may keep compatibility aliases such as `nodeId`,
`timelineHash`, `storyboardAssetId`, or `promptPackHash`, but
`projectionKind`, `entity`, and `contentHash` are the generic agent-facing
identity. Text, timeline, and storyboard prompt-pack parsers normalize legacy
sidecars that do not yet contain those fields, so existing local draft folders
do not fail solely because the lock shape was upgraded. Asset metadata
projections are generated with the same envelope for new sidecars.

## Required Invariants

### Projection is not truth

Deleting or editing a projection file does not change the project. Only an
apply command changes the project.

### CAS is semantic

CAS must compare a canonical semantic hash, not file mtime and not byte-for-byte
projection formatting.

Examples:

- Timeline hash is computed from normalized timeline DSL.
- Text hash should be computed from normalized editable text payload and
  node-level editable fields.
- Asset metadata hash should ignore non-editable storage paths and derived
  thumbnails.

### CAS is enforced by the host

The CLI may preflight stale locks, but the host mutation endpoint must also
validate `expectedHash` against current canonical state.

This matters for:

- concurrent human canvas edits,
- another agent applying a projection,
- cloud shared projects,
- a stale local CLI process,
- a malicious or buggy client skipping local preflight.

### Force is explicit

`--force` may bypass stale-read protection, but it must be treated as a
destructive operation:

- require the flag,
- report that CAS was bypassed,
- attribute the actor,
- write an audit entry when audit exists,
- never make force the default for stdin.

### Read proof is CAS evidence

For agent callers, "write only after reading" is layered on the same CAS
surface, but it has two strengths:

- Legacy CAS proof: a stable semantic token or hash proves the write is based on
  the current entity version, but a client that knows the hash algorithm could
  theoretically synthesize it.
- Strong read proof: the explicit read returns the semantic token plus an
  opaque host-issued receipt. The write passes that receipt-bearing token as
  `ifMatch`, `expectedHash`, or equivalent. The host first compares the base
  semantic token against current state, then verifies the receipt was issued by
  the host read path.

Missing, stale, or invalid proofs are rejected unless the caller uses an
explicit force flag. New agent mutation paths should prefer strong read proof;
legacy hash-only locks remain CAS-compatible while old projections migrate.

The v1 policy is: when the host can issue receipts, agent-facing writes should
require the receipt-bearing token by default. A bare semantic hash/token is a
compatibility path for older projections or non-agent callers, not the target
agent write contract. This means `--if-match` is not just "compare this version";
for agents it should normally mean "compare this version and verify I received
it from an explicit Clash read."

If the CLI cannot reach a receipt-verifying host, it must not silently downgrade
agent writes to hash-only one-shot fallback. Human CLI callers can still use the
fallback CAS path, but spawned agents must start `clash canvas connect` or use
the local-api host and re-read the entity, unless they pass an explicit
`--force`.

For non-file entities such as project metadata, `readToken` should be derived
from the entity's durable metadata fields and returned by GET/list APIs. Where
the host can issue receipts, GET/list APIs should return receipt-bearing read
proofs to agents. Agent update/delete routes then use that token as the CAS
expected value and record `expectedReadToken`, `beforeReadToken`, and
`afterReadToken` in the host mutation envelope.

Supplying an `expectedReadToken` is always a CAS request: hosts compare its base
token against the current base token even for non-agent callers. Agent callers
add one stricter requirement: unless the operation is explicitly forced, their
token must also carry a host-issued receipt.

For file-backed projections, the lock sidecar is the read proof. New text and
timeline pulls write a `readToken` next to their semantic hash. When the pull
runs through the daemon, that token is receipt-bearing, and apply/replace
commands pass both the semantic hash and the token to the host. The host still
validates hash CAS for legacy locks, but mutation records expose the read-proof
shape consistently: `expectedReadToken` when present, `beforeReadToken`, and
receipt-bearing `afterReadToken` where a host can issue one.
When receipt mode is enabled for a projection family, the lock sidecar should
carry the receipt-bearing token and the host should reject agent writes that
only provide the bare hash token.

Storyboard prompt-pack projections currently run as local file projections
without a host-issued receipt. Their lock uses the generic projection envelope
and also records semantic CAS for both the editable prompt pack and the source
storyboard action. Apply/replace rejects stale source actions even on the first
apply when no managed prompt-pack projection exists yet. This is stronger than
hash-only managed-state CAS, but it is still not equivalent to a host receipt.

For direct canvas entities without a projection file, the read proof is the
`readToken` returned by the matching read command. Node writes use
`clash canvas get --json`; graph writes use `clash canvas edges --json`, which
returns both per-edge tokens for update/delete and a graph token for adding a
new relationship among existing nodes. HTTP clients use the same contract through
local-api `GET /api/v1/projects/:projectId/canvas/edges`: edge add sends the
receipt-bearing graph token to `POST /api/v1/projects/:projectId/canvas/edges/:edgeId`,
and edge update/delete send the receipt-bearing per-edge token to `PATCH` or
`DELETE` on that edge URL. Batch node deletion uses
`clash canvas delete-plan --node <id> --node <id> --json` to read the target
node set plus current edge graph, then `clash canvas delete-batch --if-match
<readToken> --yes` to apply the closed-subgraph delete. Media asset replacement
keeps asset bytes immutable: `clash asset replace --node <id> --file <path>`
first imports the file into content-addressed asset storage, then uses the same
copy-on-write canvas replacement path as `clash canvas replace-asset`, guarded
by the source node `readToken`. Local-api `/api/v1/assets/replace` provides the
same host-enforced COW path for already registered immutable assets; it does
not let clients patch `snapshot.bin` or mutable blob bytes directly.

Runtime ACP canvas patches use the same rule when they target pre-existing
canvas state. `delete_node`, `timeline_apply`, `add_edge`, `update_edge`, and
`delete_edge` operations may carry `ifMatch`/`readToken`; the Web UI routes
them through `useLoroSync` as agent writes and rejects missing/stale read proof
before mutating the Loro document.
The only v1 exception is create-and-consume inside the same
`clash.canvas.patch` event: a node created by that event can be deleted, have
its initial timeline filled, or be connected by an edge in the same patch
without prior read proof because no previous project state for that new entity
is being overwritten.

### Snapshot remains internal

Projection commands may read canvas state through product APIs. They must not
parse or write `snapshot.bin` directly.

### SQLite remains internal

Projection commands may read and write product metadata through local-api/store
methods. They must not instruct agents to edit `local.sqlite` directly.

## Canonical Layout

Recommended project-local layout:

```text
${CLASH_HOME:-~/.clash}/
  local-api/
    local.sqlite
  projects/
    <projectId>/
      project.toml
      loro/
        snapshot.bin
        updates.log
      assets/
        links/
      projections/
        timelines/
        text/
        storyboards/
        prompts/
        metadata/
      drafts/
      runtime/
```

Protected paths:

- `${CLASH_HOME:-~/.clash}/local-api/local.sqlite`
- `loro/`
- `runtime/`
- internal asset blob storage
- lock files not matching their projection type

Agent-editable paths:

- `projections/**` through pull/edit/apply workflows,
- `drafts/**` as scratch space,
- explicit user-selected files only when they resolve inside the current
  agent/project cwd; the lock must still point back to the project and entity.

If v1 keeps agent cwd as `${CLASH_HOME:-~/.clash}/projects/<encodedProjectId>`,
commands must clearly document protected vs editable subdirectories.

## Generic Lock Schema

New projections should use a generic lock shape:

```json
{
  "schemaVersion": 1,
  "kind": "clash.projection.lock",
  "projectId": "project_123",
  "projectionType": "text-node",
  "entity": {
    "type": "canvas-node",
    "id": "node_abc",
    "field": "content"
  },
  "filePath": "/abs/path/to/projections/text/node_abc.md",
  "contentHash": "5f2e4c...",
  "hashAlgorithm": "sha256",
  "source": {
    "loroFrontier": null,
    "sqliteUpdatedAt": null,
    "version": null
  },
  "pulledAt": "2026-07-05T00:00:00.000Z",
  "tool": {
    "name": "clash",
    "version": "0.0.0"
  }
}
```

Rules:

- `projectId` must match resolved project context.
- `projectionType` determines parser, validator, and apply target.
- `entity` must identify the product entity, not just the file path.
- `filePath` must be absolute in lock files and resolve inside the current
  agent/project cwd for local v1 projection commands.
- `contentHash` is the semantic hash of the canonical entity at pull time.
- `hashAlgorithm` should be full `sha256` for new projections.
- `source` can carry Loro frontier, SQLite version, or other version hints, but
  hash equality is the required v1 guard.

Timeline compatibility:

Current timeline locks use:

```json
{
  "kind": "clash.timeline.lock",
  "timelineHash": "...",
  "hashAlgorithm": "sha256-64"
}
```

Keep reading this format for compatibility. New timeline pull can either keep
the current format for one release or write the generic lock with a
`projectionType: "timeline"` adapter.

## Pull Contract

Every projection pull command must:

1. Resolve project context.
2. Resolve entity id/type explicitly.
3. Read canonical state through local-api or host commands.
4. Normalize canonical state into an editable DTO.
5. Validate the DTO against the projection schema.
6. Reject projection output paths that resolve outside the current
   agent/project cwd.
7. Write the projection file atomically.
8. Write the lock file atomically.
9. Print both paths in text mode and include both paths in JSON mode.

Atomic write means:

```text
write temp file in same directory
fsync if available
rename temp file to final path
```

If a command supports stdout output, it must warn that no sidecar lock was
written. Applying from stdin must require `--lock` or `--force`.

## Apply Contract

Every projection apply command must:

1. Resolve project context.
2. Read the projection file.
3. Parse and validate the projection format.
4. Read the lock unless `--force` is present.
5. Verify lock kind, project id, projection type, entity id, file path, and
   cwd-contained projection path.
6. Read current canonical state from the host.
7. Normalize and hash current canonical state.
8. Reject if current hash differs from lock hash.
9. Validate immutability and copy-on-write rules.
10. Send a host mutation with actor context and `expectedHash`.
11. Host validates the same CAS check.
12. Host emits the canonical mutation.
13. Command reports the resulting entity id, new hash, and any copy-on-write
    result.

Apply may refresh the lock after a successful write, but it must not hide that
an apply happened. The response should include enough detail for agents to
continue without guessing.

## Path Safety

Projection commands must reject unsafe paths:

- projection files that resolve outside the current agent/project cwd,
- path traversal outside the selected projection root when the command writes
  into the canonical project root,
- symlink traversal into outside/protected directories after realpath
  resolution,
- lock sidecar paths that resolve outside cwd or traverse symlinks outside
  cwd,
- lock file whose `filePath` does not resolve to the applied file,
- lock/project mismatch,
- lock/entity mismatch,
- lock kind mismatch,
- absolute output paths under another project root unless explicitly allowed
  and validated.

In local v1, explicit `--file /some/path` is supported only when the resolved
path stays inside the current agent/project cwd. `--force` bypasses stale CAS
or lock-path mismatch only where documented; it must not bypass the cwd path
boundary.

The same path rule applies to default sidecars generated from a projection path
and explicit `--lock` arguments. Production projections such as storyboard
prompt packs and asset metadata must use the same guard before mutating managed
state; a rejected lock sidecar must not leave a partially applied manifest
change behind.

The broader agent-file CAS family follows the same rule. Review/stage gate JSON
files and their `*.lock.json` sidecars, production QA reports, action-plan
reports, and receipts are not canonical project truth, but they can block,
approve, or justify downstream actions, so their paths must be checked with cwd
plus realpath/symlink guards before writing or approving.

Do not rely only on OS file permissions. Permissions are a useful second layer,
not the product safety model.

## Text Node Projection

Text should become a first-class file-backed projection or text asset.

Recommended command surface:

```text
clash text pull --node <text-node-id>
clash text apply --node <text-node-id>
```

Default path:

```text
projections/text/<nodeId>.md
projections/text/<nodeId>.lock.json
```

Recommended Markdown shape:

```markdown
---
schemaVersion: 1
kind: clash.text-node
nodeId: node_abc
label: Scene 3 Voiceover
contentAssetId: text_asset_123
---

The editable text body goes here.
```

Editable fields:

- `label`
- Markdown body
- narrow text settings explicitly included in schema

Non-editable fields:

- `nodeId`
- `contentAssetId` unless an explicit replace/create mode is used
- upstream provenance,
- generated result ids,
- downstream refs,
- secret/runtime fields.

### Text Copy-On-Write

Text content should be versioned like other assets, but it should not be
forced into the existing image/video/audio `assets` row shape. The v1 path is a
text/content revision milestone created by apply/replace plus a host-owned
SQLite `text_revisions` index exposed through explicit local-api endpoints.
When the apply/replace client sends the Markdown body, the host validates the
revision hash and stores that body as an immutable content-addressed text
revision blob. The SQLite index remains a query surface for the host and UI; it
is not an agent-editable database or JSON log, and these blobs do not make
canvas `data.content` a canonical file-backed text asset yet.

If a text node has no downstream references:

- apply creates a new `clash.text.revision` milestone,
- refreshes the projection lock with that applied revision,
- keeps the same node id.

If a text node has downstream references:

- default apply must not mutate the existing node in place,
- `clash text replace` creates a copied text node from the locked projection,
- copied entity records source node/content hashes and the applied text
  revision,
- downstream references remain attached to the original unless the user passes
  an explicit replace flag.

Possible explicit flags:

```text
--copy
--replace-node
--replace-downstream-ref <nodeId>
--force
```

The exact flag names can change, but the default must protect downstream
reproducibility.

## Timeline Projection

Timeline v1 should keep existing commands:

```text
clash timeline pull --node <video-editor-node-id>
clash timeline apply --node <video-editor-node-id>
```

Needed improvements:

- Keep generic projection lock helpers shared by timeline, text, and storyboard
  prompt-pack projections.
- Keep legacy `clash.timeline.lock` reader normalization.
- Host mutation must keep `expectedHash` validation.
- Stdin apply remains blocked without `--lock` or `--force`.
- Keep materialized downstream checkpoint protection on every timeline mutation
  path, including daemon-backed apply and legacy push.

The current in-place timeline apply is acceptable for alpha only while the node
does not have materialized downstream outputs. Once it does, v1 rejects the
in-place mutation and should later grow an explicit copy-on-write/versioned
timeline workflow.

### Timeline Revision Storage

Timeline revision history must not be implemented as unbounded JSON or JSONL
files in the agent workspace. Canonical collaborative history belongs to the
Loro replica:

- `snapshot.bin` stores compact document state/history checkpoints.
- `updates.log` stores binary incremental updates.
- compaction/shallow-snapshot policy controls growth.

The product may keep a queryable revision index in SQLite for milestones only:

- `timelineId`
- `revisionId`
- `parentRevisionId`
- `timelineHash`
- Loro `frontiers` for local checkpoint/time-travel
- Loro `versionVector` for sync/comparison/export provenance
- `sourceFilePath`
- `createdAt`
- actor/source metadata
- dependency summaries for assets, text nodes, and composition components

The current local v1 implementation exposes that index explicitly:

- `POST /api/v1/timeline-revisions`
- `GET /api/v1/projects/:projectId/timeline-revisions`
- `GET /api/v1/projects/:projectId/timeline-revisions/:revisionId/content`
- `clash timeline history`
- `clash timeline content --revision <id> [--out <path>]`

`clash timeline apply/replace` registers the applied
`clash.timeline.revision` after the canvas mutation succeeds. If an older host
does not expose the index endpoint, the CLI keeps the canvas mutation result and
reports the index miss as a compatibility warning. When the host receives the
applied YAML body, it parses the YAML, validates the semantic timeline hash, and
stores that body as an immutable content-addressed timeline revision blob. The
timeline body itself is not written to SQLite; SQLite stores only milestone
metadata and provenance. History entries with stored YAML bodies include an
immutable `timeline-revision-content` descriptor, making applied timeline
content addressable without treating it as a media asset row. The descriptor
includes `storage.registry: "timeline_revisions"`,
`storage.mediaAsset: false`, and `storage.agentWritable: false` so agents use
timeline revision recovery APIs instead of asset import/replace/GC commands.
`project status.storage.canonicalReplica.contentBlobs.timelineRevisions`
exposes the protected content-addressed blob root for those bodies, and
`doctor storage` treats moving that root into an agent-editable path as an
unsafe storage contract.

Do not record every keystroke or every CRDT operation as a user-visible JSON
revision. Fine-grained history is already in Loro. Timeline revision records
should be created for explicit milestones such as `apply`, review approval,
render/export, and publish.

Downstream render/export artifacts must carry source provenance because they
can outlive the current timeline head:

```json
{
  "sourceTimelineId": "timeline:projections/timelines/main.timeline.yaml",
  "sourceTimelinePath": "projections/timelines/main.timeline.yaml",
  "sourceTimelineHash": "<sha256-64>",
  "sourceTimelineRevisionId": "tlrev-<sha256-64>",
  "sourceTimelineRevisionStatus": "draft-file"
}
```

`sourceTimelineRevisionStatus: "draft-file"` means the export came directly
from an agent projection file and is content-addressed by hash, but it is not
yet pinned to an applied Loro/SQLite milestone. Once host apply returns a real
revision record, downstream artifacts should use
`sourceTimelineRevisionStatus: "applied"` and include the Loro frontier and/or
version vector when available.

## Storyboard And Script Projection

Short-drama or video-agent workflows need structured files before they need
canvas internals.

Recommended projections:

```text
projections/storyboards/<storyboardId>.yaml
projections/prompts/<packId>.yaml
projections/scripts/<scriptId>.md
```

These should map to product entities:

- script asset,
- storyboard asset,
- shot list,
- generation plan,
- timeline plan.

Apply rules:

- script/storyboard edits create new asset versions when referenced,
- generation plan apply can create/update planned canvas nodes,
- timeline plan apply must eventually call timeline CAS mutation,
- prompt packs must never include secrets.

## Asset File Policy

Image/video/audio binaries should not be edited in place as canonical truth.

Recommended model:

- canonical blobs are content-addressed or otherwise immutable,
- project-visible asset paths are links or projections,
- editing an asset file produces a new asset,
- old asset remains while any project or downstream node references it,
- GC runs only after no references remain.

Agent-facing commands:

```text
clash asset pull --asset <id>
clash asset import --file <path> --kind image
clash asset replace --node <nodeId> --file <path>
```

If symlinks are used:

- symlink targets should point to immutable blobs,
- apply/import must resolve and validate real paths,
- agents should not be asked to mutate symlink targets directly,
- broken links must fail loudly.

## Host Mutation Envelope

All projection apply commands should converge on a host-owned mutation shape:

```json
{
  "action": "projection_apply",
  "projectId": "project_123",
  "actor": {
    "type": "agent",
    "id": "agent_member_123",
    "runtimeId": "runtime_123"
  },
  "projectionType": "text-node",
  "entity": {
    "type": "canvas-node",
    "id": "node_abc"
  },
  "expectedHash": "5f2e4c...",
  "force": false,
  "payload": {}
}
```

The host decides whether the mutation writes:

- Loro canvas updates,
- SQLite metadata rows,
- both in one ordered operation,
- or a rejected error.

The CLI should not duplicate product mutation rules in multiple commands.

## Cloud And Collaboration

The same projection CAS model applies to cloud shared projects.

Differences:

- shared project CAS validation happens at the cloud sequencer/ProjectRoom or
  trusted API boundary,
- stale errors may include remote actor/timestamp metadata,
- local-only projection files are not automatically synced,
- cloud workers may read projections only if the project has been synced and
  the user granted access to the relevant assets.

Local-only custom actions are user-machine capabilities. They should not rely
on action secrets or run as hidden cloud workers.

## Variables And Secrets

Projection files must never contain:

- provider credentials,
- OAuth tokens,
- local action API keys,
- ACP auth state,
- user variable values,
- remote worker secrets.

`user_variable` may remain as a cloud compatibility table while remote worker
actions still require it. It must not be the main local auth model.

For local-first v1, provider accounts/OAuth and local runtime auth should live
in encrypted local SQLite or OS keychain-backed storage.

## Room And Agent Trace Boundary

Room messages are project-visible conversation.

Agent traces are runtime/session internals.

Projection apply may post a room message only if the agent/user explicitly
requests human-visible communication. It should not dump raw tool traces,
local file paths, or lock files into room.

Room persistence belongs in SQLite/D1. It is not a projection file and should
not be edited through Markdown/YAML apply commands.

## Required CLI Surface

Keep ergonomic typed commands:

```text
clash timeline pull/apply
clash text pull/apply
clash storyboard pull/apply
clash asset import/replace
```

Add a generic inspection layer:

```text
clash projections status
clash projections list
clash projections locks
clash projections diff --lock <path>
```

Do not require agents to understand Loro internals or database layouts to use
these commands.

## Required Errors

Errors should be explicit and recoverable:

- `Missing projection lock. Run <pull command> first, or pass --force.`
- `Stale apply rejected. Current hash is X, lock hash is Y.`
- `Lock belongs to project A, current project is B.`
- `Lock belongs to entity A, command targeted entity B.`
- `Projection file path does not match lock path.`
- `Projection file path must stay inside the current project cwd.`
- `Projection file path must not traverse a symlink outside the current project cwd.`
- `Projection lock sidecar path must stay inside the current project cwd.`
- `Projection lock sidecar path must not traverse a symlink outside the current project cwd.`
- `This node has downstream references. Use copy-on-write or explicit replace.`
- `Projection contains a non-editable field.`
- `Projection would expose a secret.`

## Tests

### Unit

- generic lock parse/serialize,
- stable semantic hash,
- path traversal/outside-cwd rejection, including `--force` not bypassing the
  cwd boundary,
- symlink-to-protected-dir rejection,
- lock sidecar path and symlink escape rejection,
- stale hash rejection,
- force bypass reporting,
- legacy timeline lock compatibility,
- projection schema validation.

### Integration

- timeline pull/apply still passes existing tests,
- timeline stale apply rejected through CLI fallback path,
- timeline stale apply rejected through daemon path,
- timeline apply rejected when materialized downstream checkpoint/render nodes
  depend on the current timeline,
- text pull/apply creates Markdown and lock,
- text apply rejects stale lock,
- text apply rejects materialized downstream refs by default and permits
  explicit `--force` checkpoint rewrites,
- storyboard prompt-pack apply rejects stale managed prompt-pack and stale
  source storyboard action locks,
- asset import creates new asset rather than overwriting referenced blob.

### Black-Box E2E

Use an external agent-style test harness to simulate the real workflow:

1. Create or restore a project.
2. Pull text, storyboard, and timeline projections.
3. Modify files with normal filesystem writes.
4. Apply them with locks.
5. Make a concurrent canvas edit.
6. Verify stale apply fails.
7. Force apply and verify it is reported as forced.
8. Restart local-api.
9. Verify project state, projection locks, SQLite rows, and canvas state remain
   coherent.

## Completion Criteria

This spec is implemented when:

- there is one shared projection lock/hash/path library,
- timeline uses or adapts through that library,
- text nodes have a readable file projection and CAS apply,
- timeline/text edits feeding materialized downstream state are protected by
  rejection first and copy-on-write/versioned replacement later,
- every pull/edit/apply command has stale-write protection,
- host mutation endpoints validate CAS, not only CLI code,
- projection paths are protected against traversal and unsafe symlinks,
- canonical blobs, SQLite, and `snapshot.bin` are not advertised as direct
  agent editing surfaces,
- local and cloud shared projects use the same stale-write semantics.
