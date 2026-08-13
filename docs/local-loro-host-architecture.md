# Local Loro Host Architecture

Last updated: 2026-08-13

## Purpose

This document defines the local-first Loro architecture for Clash v0 alpha.
It is the implementation contract for Desktop, local-api, CLI, ACP agents,
and the existing cloud ProjectRoom code.

The key decision is:

```text
Local Host is the only local persistent Loro replica for a project.
Desktop UI, CLI, and local ACP agents are actors in v0, not direct Loro peers.
Cloud ProjectRoom remains a cloud persistent replica and admission point.
```

Status boundary: this document defines the replica and admission topology. For
media identity, replication order, deletion, and multi-device availability,
[`apps/docs/guide/asset-system.md`](../apps/docs/guide/asset-system.md) is the
canonical contract. For Provider execution ownership and recovery,
[`apps/docs/guide/durable-run-protocol.md`](../apps/docs/guide/durable-run-protocol.md)
is canonical. The Cloud Asset and Durable Run adapters described by those
documents are target design only; the current delivery implements their Local
ports and preserves the existing hosted `ProjectRoom` infrastructure.

v1 follow-up docs:

- `agent-first-local-v1-principles.md`
- `agent-first-local-v1-traceability-matrix.md`
- `agent-first-local-v1-remote-compatibility-boundary.md`
- `local-project-storage-layout-spec.md`
- `agent-file-projection-cas-spec.md`

The local persistence layout in this document describes the Loro replica shape.
The full v1 project storage layout, local SQLite placement, asset link policy,
and agent-editable projection roots are defined in
`local-project-storage-layout-spec.md`.

## Vocabulary

`LoroDoc`

: The CRDT document that stores canvas graph state.

`Loro peer`

: A running entity that owns a `LoroDoc` and exchanges Loro updates.
Loro peer ids are operation-source ids. They are not product identities.

`Persistent replica`

: A `LoroDoc` plus durable storage: snapshot, update log, and recovery.

`Local Host`

: The single local process that owns the persistent replica for a project.
The process name is `clashd`. Desktop embeds the same host shape; headless
operation is still `clashd`, not a separate legacy daemon model.

`Actor`

: A product identity that performs work: Desktop user, CLI, Codex agent,
Claude agent, cloud agent, etc. Actors are not the same as Loro peer ids.

`Mutation envelope`

: Durable attribution around a canvas mutation:
actor id, session id, command type, update hash, before/after version,
timestamp, and optional tool/task ids.

## Planes

Clash should keep these concerns separate.

| Plane          | Owns                                                                                       | Persistence                          |
| -------------- | ------------------------------------------------------------------------------------------ | ------------------------------------ |
| Control Plane  | identity, membership, auth, billing, quotas, cloud room admission                          | Cloud DB / local auth state          |
| Runtime Plane  | ACP sessions, agent runs, leases, tool logs, transcripts, cancel/error state               | Local DB / cloud DB as policy allows |
| Data Plane     | canvas nodes, edges, stable layout, ProjectAsset entries, Action bindings, task projection | Loro snapshot + update log           |
| Presence Plane | cursor, selection, online actors, current tool/action                                      | Ephemeral sideband                   |
| Audit Plane    | actor/session to mutation/update mapping                                                   | Append-only local/cloud log          |

## Data Ownership

Store in Loro:

- Canvas nodes keyed by stable node id.
- Canvas edges keyed by stable edge id.
- Stable committed layout.
- Asset references: stable resource id, asset id, and immutable descriptive metadata.
- Task projections that need to appear on the canvas.

Do not store in Loro:

- Asset blobs.
- Local paths, object-storage keys, signed URLs, and per-device transfer state.
- ACP transcript and raw tool logs.
- Session history.
- Billing, permissions, API tokens.
- Presence, cursors, transient drag positions.
- Task lease/execution ownership.

## Local Runtime Shape

```text
Desktop UI
CLI
Local ACP agents
        |
        | actor commands / sideband status
        v
Local Host
  - LoroDoc
  - Canvas mutation SDK
  - Actor presence table
  - Mutation envelope log
  - snapshot.bin
  - updates.log
  - user-level host discovery record
        |
        | future sync
        v
Cloud ProjectRoom
```

The Local Host is the only v0 local process that writes durable Loro updates.
CLI and local ACP agents must call the Local Host as actors. This prevents
schema drift, duplicate command paths, and untracked mutations.

## Host Discovery and Lifecycle Ownership

Desktop and headless operation bootstrap the same detached `local-api` host
artifact:

```text
Local Host Process = local-api daemon
Desktop = GUI/lifecycle client + bundled local-api artifact
Headless Clash = CLI/MCP clients + the same bundled local-api artifact
```

CLI, GUI, and local agents are clients/actors. They do not acquire a project
lock and they do not become direct Loro peers.

Rules:

- Each `CLASH_HOME` and runtime profile has one active compatible Local Host
  discovery record.
- Clients discover the current host through `~/.clash/run/host.json`.
- `.clash/project.toml` is only a project marker. It does not lock or own a
  local replica.
- Desktop, CLI, or MCP may bootstrap the detached host, but the published
  process uses `launchMode=user-service` and is not owned by that client.
- Closing Desktop, a CLI command, or an MCP stdio session never stops the
  shared daemon.
- A platform service manager may launch the same host artifact; it must use
  the same discovery lock, data directory, and compatibility checks.

Discovery record path:

```text
~/.clash/run/host.json
```

The discovery record includes `hostId`, `endpoint`, `pid`, protocol/data schema
versions, `launchMode`, `startedBy`, optional `ownerClientId`, and timestamps.
Clients must treat a record whose pid no longer exists as stale and remove it.
Record removal must match `hostId` so an exiting host cannot delete a newer
host record.

## Local Persistence

Do not rely on snapshots alone.

Persistent replica storage:

```text
~/.clash/local-api/projects/<encodedProjectId>/
  project.toml
  loro/
    snapshot.bin
    updates.log
  assets/
  runtime/
```

Write flow:

```text
receive actor command
  -> validate command with shared Canvas mutation SDK
  -> capture before version/frontiers
  -> mutate LoroDoc
  -> export local update
  -> append updates.log
  -> append mutation envelope
  -> broadcast binary update
  -> maybe compact snapshot
```

Recovery flow:

```text
load snapshot.bin if present
import updates.log records in order
rebuild LoroDoc
start sync host
```

Snapshot writes must be atomic: write temp file, fsync if practical, rename.
Compaction must never delete update records that are newer than the compacted
snapshot version.

## Cloud Runtime Shape

Cloud project state remains decentralized:

```text
Local Host persistent replica <-> Cloud ProjectRoom persistent replica
Cloud agent sandbox peer       <-> Cloud ProjectRoom persistent replica
Other devices                  <-> Cloud ProjectRoom persistent replica
```

Cloud ProjectRoom is not the semantic source of truth for canvas state, but it
is not a dumb peer either. It is the cloud admission gate and durable mailbox:

- Authenticates project access.
- Rate-limits and enforces quota.
- Persists cloud snapshot/update log.
- Boots web clients and remote agents.
- Stores accepted mutation envelopes.
- Relays updates to other authorized peers.

Future cloud agents may have lightweight persistent replicas in their sandbox.
That is a later path. v0 local ACP agents remain Local Host actors.

## Presence

Presence is not Loro document state.

v0 local presence is host-managed actor presence:

```ts
type ActorPresence = {
  actorId: string;
  actorType: "user" | "agent" | "cli";
  displayName: string;
  sessionId?: string;
  runtimeId?: string;
  cwd?: string;
  status: "idle" | "thinking" | "running_tool" | "editing" | "error";
  currentAction?: string;
  cursor?: { x: number; y: number; nodeId?: string };
  updatedAt: number;
};
```

Presence updates use sideband JSON. They may later use Loro EphemeralStore for
true peer-to-peer cursor/selection state, but they must not be persisted into
the canvas LoroDoc.

## CWD Project Context

The current working directory does not own a Loro replica. It only points to a
project.

Marker:

```text
<cwd>/.clash/project.toml
```

Example:

```toml
schema_version = 1
project_id = "proj_123"
workspace_id = "local_ws_123"
store = "managed"
```

This marker resolves project identity for CLI/agent commands. It does not imply
filesystem ownership, store locking, host lifecycle ownership, replication
state, cloud capability, or permissions.

Resolver priority:

```text
1. --project <id>
2. nearest .clash/project.toml
3. CLASH_PROJECT_ID
4. error with guidance
```

If marker and `CLASH_PROJECT_ID` conflict, fail unless `--project` is explicit.

## Canvas Schema Rules

- Use maps keyed by stable ids: `nodes[id]`, `edges[id]`.
- Avoid lists for position data. Store `position.x` and `position.y` fields.
- Use soft delete/tombstones before hard delete when concurrent updates matter.
- Keep transient drag positions in presence; write only committed layout to Loro.
- Store immutable asset refs, not mutable URLs as truth.
- Task execution ownership must live in Runtime Plane, with only display
  projection in Loro.

## Team Asset Replication (target contract)

> Design only: team upload, Registry claims/readiness, verified multi-device
> download, and physical OSS reclamation are not implemented by the current
> Local delivery.

An Asset carries one stable, storage-neutral `resourceId`. Local files, cloud
objects, and their URLs are Host projections of that identifier, not alternate
Asset identities. `ProjectAssetEntry` is Project membership;
`ActionAssetBinding` is the authoritative media-use reference. GUI, CLI, MCP,
renderers, and plugins consume the same read-only `ResolvedAsset` contract and
must not inspect storage keys.

For a **local-origin** Asset, the creating Host verifies and installs immutable
bytes in Local CAS first, then commits the ProjectAsset and optional Action
binding to its local Loro replica. That metadata may replicate through
`ProjectRoom` immediately, before OSS upload finishes. Peers show the shared
structure with an uploading/unavailable projection and enqueue a download only
after the Resource Registry reports the `resourceId` ready. The creator's
Resource replicator uploads silently, verifies digest and size, and records the
replaceable OSS binding in the Registry; it does not add an OSS key or URL to
Loro and does not require a second Project mutation.

For a future **Cloud/Web-origin** Action output, OSS is the only durable byte
store. The Cloud owner may synchronize the ActionRun/placeholder structure
early, but it writes and verifies an idempotent staging object before publishing
the output ProjectAsset and Action binding through `ProjectRoom`. Registry
reconciliation derives the Project claim from that admitted Project state. A
crash before publication leaves only TTL-bound staging; a crash after
publication is repaired by claim reconciliation while the staging lease
protects the bytes.

Every receiving Host downloads asynchronously, verifies the Resource, and
atomically installs it in Local CAS before reporting `ready`. Upload/download
progress, retry state, local availability, loopback URLs, signed cloud URLs,
and object keys remain per-device or Registry state. Project sync never waits
for media transfer, and media bytes never travel through Loro.

Logical Asset deletion is a Loro `active -> trashed` transition and remains
undoable/restorable during the recovery window without an OSS operation.
Terminal purge later releases the Project claim; physical deletion is an
asynchronous Registry consequence allowed only after a current zero-claim
check. Failure may retain extra bytes but cannot change synchronized Project
state or resurrect a purged Asset.

## Existing Code To Reuse

Cloud-first code should be refactored downward into shared core, not replaced.

Current reusable assets:

- `apps/api-cf/src/agents/project-room.ts`: ProjectRoom, cloud Loro room.
- `apps/loro-sync-server/src/LoroRoom.ts`: older standalone room implementation.
- `packages/shared-types/src/canvas-ops.ts`: Canvas operation API.
- `packages/shared-types/src/loro-client.ts`: LoroSyncClient.
- `packages/shared-types/src/presence.ts`: sideband presence/activity types.
- `apps/local-api/src/sync.ts`: current local Loro room, to be split.

Target shared modules:

```text
packages/loro-runtime/
  replica-store.ts
  sync-host-core.ts
  mutation-host.ts
  presence.ts
  audit.ts
  project-context.ts
```

Cloud and local should be adapters over the same core:

```text
Future Cloud adapter: Workflow/ProjectRoom + hosted DB/OSS + hosted auth
Current Local adapter: Node ws + filesystem + local user/scoped token
```
