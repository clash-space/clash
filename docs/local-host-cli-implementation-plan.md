# Local Host and CLI Implementation Plan

Last updated: 2026-06-20

This plan turns `local-loro-host-architecture.md` into implementation work.
It is intentionally staged so v0 alpha can ship without opening direct Loro
peer writes from every local agent or CLI process.

v1 product/storage follow-up docs:

- `agent-first-local-v1-principles.md`
- `agent-first-local-v1-traceability-matrix.md`
- `agent-first-local-v1-implementation-plan.md`
- `agent-first-local-v1-remote-compatibility-boundary.md`
- `local-project-storage-layout-spec.md`
- `agent-file-projection-cas-spec.md`

This document remains the lower-level Local Host/CLI plan. The v1 docs define
the broader product constraints around local SQLite, cwd as draft/reference
surface, and agent file projection CAS.

## Non-Goals

- Do not redesign Copilot UI.
- Do not move ACP transcript/session history into Loro.
- Do not make CLI a direct Loro peer in v0.
- Do not remove the existing cloud ProjectRoom path.
- Do not introduce a separate local canvas command truth that diverges from
  shared Canvas operations.

## Stage 1: Project Context

Add a shared resolver for project context.

Files/modules:

- `packages/cli/src/lib/project-context.ts`
- `packages/cli/src/lib/project-context.test.ts`
- `packages/clash-bridge/src/lib/session-cwd.ts`

Required behavior:

- Search upward from cwd for `.clash/project.toml`.
- Resolve project id using:
  1. explicit `--project`
  2. nearest marker
  3. `CLASH_PROJECT_ID`
  4. error
- Fail on marker/env conflict unless explicit `--project` is provided.
- Desktop-created project roots automatically get `.clash/project.toml`.
- External folders can be linked without taking ownership of the directory.

CLI commands:

```bash
clash init
clash project link <projectId>
clash project status
clash project unlink
clash project open
```

v0 minimum:

```bash
clash init
clash project link <projectId>
clash project status
```

## Stage 2: Local Host Discovery and Lifecycle Ownership

Add a minimal user-level discovery record for the current local host. This
replaces the older project-lock direction.

New module targets:

```text
packages/shared-runtime/src/index.ts
apps/local-api/src/host-discovery.ts
packages/cli/src/lib/host-discovery.ts
packages/cli/src/commands/host.ts
```

Required behavior:

- Local Host Process is `clashd`.
- Desktop is `clashd + GUI shell`.
- CLI, GUI, and local agents are clients/actors.
- `.clash/project.toml` is only a project marker and never a lock.
- The active local host is discovered through `~/.clash/run/host.json`.
- Discovery writes are atomic: temp file then rename.
- Discovery reads validate schema/protocol fields.
- Stale records are removed when their pid no longer exists.
- Record removal matches `hostId` to avoid deleting a newer host record.
- `launchMode` is one of `desktop`, `cli-once`, `user-service`, `launchd`.
- Desktop close only shuts down a `launchMode=desktop` host with the same
  owner client id.
- Desktop must not shut down `user-service` or `launchd` hosts.

Discovery record:

```ts
type LocalHostDiscoveryRecord = {
  schemaVersion: 1;
  protocolVersion: number;
  dataSchemaVersion: number;
  hostId: string;
  endpoint: string;
  pid: number;
  launchMode: "desktop" | "cli-once" | "user-service" | "launchd";
  startedBy: "desktop" | "cli" | "user-service" | "launchd";
  ownerClientId?: string;
  startedAt: string;
  updatedAt: string;
};
```

Test first:

- Pure helper allows Desktop owner shutdown only for its own desktop host.
- Pure helper rejects Desktop shutdown for `user-service` and `launchd`.
- local-api writes, reads, validates, and removes matching host records.
- local-api stale cleanup removes records whose pid no longer exists.
- `startLocalApiServer` writes `host.json` after listen with the actual port.
- server close best-effort removes only the matching host record.
- `clash host status --json` reports stable active/inactive JSON.

## Stage 2b: Local Replica Store

Split local persistence out of `apps/local-api/src/sync.ts` after discovery is
in place. This stage must not reintroduce project locks.

New module target:

```text
apps/local-api/src/loro/
  file-replica-store.ts
  file-replica-store.test.ts
```

Required behavior:

- `loadSnapshot(projectId)`
- `appendUpdate(projectId, update)`
- `loadUpdateLog(projectId)`
- `saveSnapshotAtomic(projectId, snapshot, version)`
- `recover(projectId)` returns a `LoroDoc` built from snapshot + updates.

Storage shape:

```text
~/.clash/local-api/projects/<encodedProjectId>/loro/
  snapshot.bin
  updates.log
```

## Stage 3: Shared Sync Host Core

Extract common sync behavior from cloud/local room implementations.

Candidate package:

```text
packages/loro-runtime/
  replica-store.ts
  sync-host-core.ts
  sync-host-core.test.ts
  mutation-envelope.ts
```

Core responsibilities:

- Serially import Loro updates.
- Append updates through `ReplicaStore`.
- Broadcast binary updates to connected clients.
- Broadcast sideband JSON.
- Produce mutation envelopes for host-originated actor commands.
- Expose hooks for Runtime Plane task projection.

Cloud adapter:

- `apps/api-cf/src/agents/project-room.ts` should keep its public behavior.
- D1 snapshot/update storage implements `ReplicaStore`.

Local adapter:

- `apps/local-api/src/sync.ts` uses the same core with `FileReplicaStore`.

## Stage 4: Host Mutation API

Add a v0 host-owned canvas mutation endpoint/protocol.

The command shape should be shared by CLI and ACP agents:

```ts
type CanvasMutationCommand =
  | { type: "canvas.list"; args: { nodeType?: string } }
  | { type: "canvas.get"; args: { nodeId: string } }
  | { type: "canvas.createNode"; args: { nodeType: string; data: unknown } }
  | { type: "canvas.updateNode"; args: { nodeId: string; updates: unknown } }
  | { type: "canvas.deleteNode"; args: { nodeId: string } };
```

Each command carries actor metadata:

```ts
type ActorContext = {
  actorId: string;
  actorType: "user" | "agent" | "cli";
  sessionId?: string;
  runtimeId?: string;
  cwd?: string;
};
```

Implementation rule:

- Host uses `packages/shared-types/src/canvas-ops.ts`.
- Host validates command payloads before mutating.
- Host writes mutation envelope after successful mutation.
- Host returns clear errors; no silent no-op.

## Stage 5: CLI Main Path

Refactor `packages/cli/src/commands/canvas.ts`.

Behavior:

- `--project` becomes optional.
- Default context comes from `.clash/project.toml`.
- CLI finds active Local Host for local projects.
- CLI sends host mutation commands.
- If no Local Host exists:
  - start daemon if configured, or
  - print actionable error: `Run clash host start` or open Desktop.
- `canvas connect` / `canvas disconnect` become hidden or legacy debug commands.

New Local Host commands:

```bash
clash host start
clash host stop
clash host status
clash host logs
clash host doctor
```

v0 minimum:

```bash
clash host status
clash host doctor
```

## Stage 6: Actor Presence

Extend sideband presence from connection presence to actor presence.

Reuse:

- `packages/shared-types/src/presence.ts`
- `apps/api-cf/src/agents/project-room.ts` sideband patterns.
- `apps/local-api/src/sync.ts` sideband JSON path.

Add:

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

Rules:

- Actor presence is ephemeral.
- It is broadcast via sideband JSON.
- It is not imported into LoroDoc.
- It has heartbeat/TTL cleanup.
- Tool calls update presence status and current action.

## Stage 7: Cloud Alignment

Do not fork cloud and local behavior.

Cloud ProjectRoom should gradually adopt the shared core:

- D1 update log.
- Accepted mutation envelope log.
- Same sideband actor presence type.
- Same Canvas mutation SDK for cloud agents.
- Same asset ref shape.

The existing cloud code remains the reference path while local adapter catches
up. Avoid deleting cloud behavior during local refactors.

## Tests

Use TDD for behavior changes.

Minimum test slices:

- `project-context.test.ts`: resolver priority and conflict behavior.
- `host-discovery.test.ts`: discovery record validation, stale cleanup, and lifecycle ownership.
- `file-replica-store.test.ts`: snapshot/update recovery and atomic snapshot.
- `canvas host mutation test`: actor command mutates LoroDoc and emits envelope.
- `CLI canvas test`: command resolves marker and calls host path.
- `CLI host status test`: reports active/inactive host discovery state.
- `presence test`: actor status updates and TTL cleanup.

## First Worker Scope

The first implementation worker should own only:

- project context resolver
- `.clash/project.toml` writer/reader
- CLI `project link/status`
- Desktop/session cwd marker writer

The worker should not touch:

- ProjectRoom cloud internals
- local-api Loro persistence
- Copilot UI
- ACP runtime
