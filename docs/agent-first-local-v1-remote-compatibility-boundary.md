# Agent-First Local v1 Remote Compatibility Boundary

Last updated: 2026-07-05

## Purpose

Define which legacy/local surfaces should be removed or kept unavailable, and
which remote/cloud surfaces must be preserved while Clash moves to a
local/agent-first v1 architecture.

The core rule is:

```text
Make local primary without deleting remote collaboration/runtime capabilities.
```

## Vocabulary

`Local primary`

: Desktop/local-api path that works without cloud for one user on one machine.

`Remote compatibility`

: Cloud/web/worker behavior that existing remote or shared workflows still
  require. It may be non-primary for local v1, but it is not dead code.

`Local legacy`

: Old local endpoint, command, or secret model that preserves a cloud-shaped
  abstraction locally even though v1 has a better local model.

`Remote-only`

: A capability that exists only when cloud/sync/shared/worker mode is active.
  Local code should present it as unavailable or mode-gated, not silently
  emulate it with weak local semantics.

## Preserve These Remote Surfaces

### Cloud ProjectRoom

Keep:

- `apps/api-cf/src/agents/project-room.ts`
- cloud WebSocket sync path,
- cloud snapshot/update persistence,
- presence/sideband behavior,
- shared project sequencing.

Reason:

- Shared projects need a cloud sequencer.
- Web clients need cloud admission and a durable cloud copy.
- Local Host and Cloud ProjectRoom should converge on shared mutation semantics,
  not replace one another.

Restriction:

- Local-only projects must not pretend to be web-openable.
- Local refactors must not remove cloud ProjectRoom behavior.

### Cloud `room_message`

Keep:

- cloud `room_message` schema,
- cloud room GET/POST routes,
- web group chat behavior,
- ProjectRoom broadcast/mention behavior.

Reason:

- Room is project-visible conversation.
- Shared projects need cloud room authority.
- Local v1 should add local room persistence, not delete room.

Restriction:

- Room is not raw ACP trace.
- Raw agent logs/tool paths stay local by default.

### Cloud `user_variable`

Keep while remote worker actions need it:

- `user_variable` table,
- `/api/v1/vars`,
- web settings variable UI,
- worker-action secret injection.

Reason:

- Remote worker actions still need a secret injection mechanism.
- Existing cloud routes/tests may depend on it.

Restriction:

- Do not present variables as the local v1 auth path.
- Do not reintroduce local `/api/v1/vars` or local action-secret endpoints.
- CLI should be mode-aware:
  - local provider/model auth: provider accounts/OAuth/local runtime setup,
  - remote worker action: vars compatibility.

### Remote action secret injection

Keep for remote worker actions only.

Reason:

- Worker-hosted custom actions need cloud-side secret injection.

Restriction:

- Local custom actions should use local runtime auth/capability registration.
- Local machine offline means local action unavailable or explicitly queued,
  not silently run as a cloud worker.

### ACP registry archives

Keep:

- ACP registry `archive` fields,
- checksum/download/extract/install flow,
- versioned install directories.

Reason:

- These are remote install artifacts for local ACP tools.
- They are not project storage archives.

Restriction:

- Do not confuse registry archives with project archive/migration state.
- Project backup/export should use explicit project export terminology.

### Cloud D1 provider/account tables

Keep:

- cloud provider account/OAuth schema,
- cloud D1 tables used by web/shared routes.

Reason:

- Cloud and local should share names/shapes where possible.
- Local SQLite migration should mirror cloud, not delete cloud.

Restriction:

- Local provider secrets should be encrypted or keychain-backed.
- Public DTOs never expose raw credentials/tokens.

### Web shared-project UX

Keep:

- web project lists for synced/shared projects,
- web room and canvas views for cloud-backed projects,
- shared project membership/presence UI.

Reason:

- Cloud is additive, not removed.

Restriction:

- Web must not show local-only projects as openable unless sync is enabled.

## Remove Or Keep Unavailable Locally

### Local variables endpoints

Keep unavailable locally:

- `/api/settings/variables`
- `/api/v1/vars`

Current evidence:

- local-api tests assert 404.

Reason:

- Local v1 auth should not route through generic user variables.
- Provider accounts/OAuth/local runtime auth are the local path.

Allowed replacement:

- local provider account config,
- local OAuth/device auth,
- OS keychain or encrypted SQLite credentials.

### Local action-secret endpoints

Keep unavailable locally:

- `/api/settings/action-secrets`
- `/api/v1/action-secrets`

Current evidence:

- local-api tests assert 404.

Reason:

- Local custom actions are user-machine runtime capabilities.
- They should not need a cloud-like action-secret API.

Allowed replacement:

- local-api auth/runtime setup,
- provider accounts/OAuth,
- action-specific local setup with explicit user consent.

### Broad local `db.json`

Remove as product DB:

- projects,
- assets,
- asset refs,
- sessions,
- session messages,
- agent members,
- provider accounts,
- provider OAuth.

Reason:

- This is relational/queryable product state.
- JSON makes the app database look agent-editable.

Allowed replacement:

- local SQLite; existing `db.json` is ignored and reported only as a
  cleanup/secrets warning.
- narrow JSON config only when intentionally user/agent editable.

### Local project room behavior

Do not route raw ACP traces through room.

Current evidence:

- local-api tests cover SQLite-backed local room persistence, pagination,
  idempotency, and mention dispatch.
- CLI `clash room say/read` already exists and expects room endpoints.
- cloud route tests now keep client-provided room ids idempotent only for the
  same normalized sender/text/mentions payload, matching local conflict
  semantics.
- local-api room sync tests now cover deterministic mirror planning: local-only
  export, remote-only import, already-mirrored same-id rows, and same-id content
  conflicts.
- local-api app tests cover explicit room sync metadata, remote-only import,
  local-only export, accepted `room_sync` mutation records, and same-id conflict
  rejection without local overwrite.
- room message read/send responses carry `sync.admission`, so local-only clients
  can see `remote-room-not-configured`/`enable-sync` before attempting explicit
  room sync, while cloud-configured reads expose allowed admission.
- local-api room sync now checks active project existence before remote
  admission, and local-only sync rejection returns a machine-readable admission
  gate (`remote-room-not-configured`, requiring `enable-sync`).
- `clash room sync --json` exposes the mirror action to agents with
  exported/imported/matched/conflict ids and accepted/rejected mutation
  evidence; denied local-only sync also prints the structured admission body
  on stdout while retaining stderr compatibility.

v1 decision:

- Keep local room as project-visible SQLite rows.
- Keep cloud room routes compatible.
- Treat cloud sync as a separate boundary with explicit conflict/idempotency and
  mirror-sequencing tests. Cloud-configured local room reads report
  `remote_room.enabled=true` with `status=pending`; only explicit sync action
  results can report `mirrored` or `failed`.
- Do not introduce background room sync until admission controls beyond the
  first local-only gate, conflict recovery, and live room parity are designed
  and tested.

Reason:

- Room is a product concept, not a remote-only accident.

### Direct local snapshot editing

Never support as product workflow.

Reason:

- `snapshot.bin` is CRDT persistence, not an editable document.

Allowed replacement:

- CLI/API projection commands,
- host mutation API,
- debug/recovery tools only.

## Mode Matrix

| Capability | Local-only | Synced | Shared |
| --- | --- | --- | --- |
| Canvas state | local Loro replica | local + cloud mirror | cloud ProjectRoom sequenced, local cache |
| Web open | no | yes, from cloud copy | yes, from cloud copy |
| Room messages | local SQLite | local + cloud append log | cloud authoritative, local cache |
| Asset metadata | local SQLite | synced metadata | cloud/shared metadata |
| Asset blobs | local disk | uploaded/lazy as policy | uploaded/streamed for collaborators |
| Local agents | user machine only | user machine, sync-visible outputs | user-owned runtime endpoint |
| Remote worker actions | unavailable unless cloud action chosen | available if configured | available if configured/permissioned |
| User variables | unavailable locally | remote worker compatibility | remote worker compatibility |
| Raw ACP traces | local/private | local unless opt-in | local unless team policy opt-in |
| Provider credentials | local encrypted/keychain | local or cloud depending account type | per-user credential boundary |

## Deprecation Rules

### Rule 1: Do not delete remote before local replacement exists

If a capability is remote/shared-only today, local cleanup may hide it in local
mode, but should not delete cloud code unless a separate cloud migration
replaces it.

### Rule 2: Local legacy may fail loudly

For local v1, unsupported legacy surfaces should return explicit errors or 404
with tests.

Examples:

- local vars/action-secrets,
- older local-api targets that do not expose room endpoints.

### Rule 3: Compatibility must be mode-gated

CLI and UI copy should say which mode a feature belongs to.

Bad:

```text
Set variables with clash vars set <KEY>
```

Good:

```text
Local provider auth: configure a provider account.
Remote worker action secret: use cloud vars.
```

### Rule 4: Shared project local runtime is availability-bound

Local agents/actions in shared projects are allowed only while the owning
machine/runtime is available.

If offline:

- show unavailable,
- queue only if queueing is explicitly implemented,
- or require a remote worker alternative.

### Rule 5: Do not encode secrets in projections

Remote compatibility does not justify placing secrets in agent-editable files.

Projection files should contain references/status only.

## Regression Tests To Preserve

Local tests:

- local variables endpoints remain unavailable,
- local action-secret endpoints remain unavailable,
- provider public DTOs do not expose secrets,
- local room SQLite persistence, pagination, idempotency, and mention dispatch
  remain covered.

Cloud tests:

- `/api/v1/vars` routes continue to work,
- cloud room GET/POST continue to work,
- ProjectRoom sync behavior remains unchanged,
- remote custom action secret injection remains covered.

CLI tests:

- local-mode help does not direct users to vars as default auth,
- local vars 404 is explained as remote-only/local-auth boundary,
- remote vars compatibility remains callable with cloud target,
- room 404 is explained as missing API support for older local-api/cloud
  targets.

## Implementation Consequence

Local v1 cleanup should not be a broad delete pass.

It should be three separate operations:

1. Remove/disable local legacy surfaces that contradict the local model.
2. Preserve remote/cloud surfaces that still power sync/shared/worker mode.
3. Add mode gates so CLI/UI stop presenting remote-only mechanisms as local
   defaults.
