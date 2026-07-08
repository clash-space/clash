# Agent-First Local v1 CLI CAS Audit

Last updated: 2026-07-07

## Purpose

Audit current CLI command surfaces against this rule:

```text
If a command exports/reads product state into a file, lets an agent edit it,
then applies it back, it needs CAS.
```

This audit also separates CAS from other limits. Not every mutation needs CAS,
but destructive or broad mutations still need validation, confirmation,
permissions, or copy-on-write rules.

There are two v1 CAS shapes:

- file projection CAS: `pull/export -> edit file -> apply/push` carries a lock
  and expected semantic hash,
- direct agent patch CAS: `read/inspect -> update/delete` carries a read token
  from the prior read, so the host can reject missing, stale, or wrong-entity
  writes.

For new agent write paths, that read token should be receipt-bearing whenever
the host controls the read endpoint. CAS then covers concurrency, while the
receipt proves the agent actually performed the read before writing. Bare hash
tokens remain a compatibility surface, not the preferred v1 agent contract.
The one-shot CLI fallback is therefore human-oriented: agent writes that reach
an existing canonical entity should use daemon/local-api receipt verification,
or explicitly opt into `--force`.

## Rule Of Thumb

### Needs CAS

Command shape:

```text
pull/export -> edit file -> apply/push
```

Examples:

- timeline YAML,
- text Markdown,
- storyboard YAML,
- prompt/script packs,
- editable asset metadata projection.

### Does not need CAS

Command shape:

```text
append-only create
read-only inspect
poll status
local install idempotency
```

Examples:

- `clash room say`,
- `clash tasks status/wait`,
- `clash canvas add`,
- `clash action install <id>` local package install.

### Needs other guardrails

Command shape:

```text
direct patch/delete/replace
secret/config mutation
project action registration
```

Examples:

- `clash canvas update`,
- `clash canvas delete`,
- `clash project delete`,
- `clash auth login/logout`,
- project-level action install/remove,
- model provider config changes.

## Current Command Matrix

| Command | Current behavior | CAS status | v1 decision |
| --- | --- | --- | --- |
| `clash timeline pull/apply` | Writes YAML + generic projection lock envelope, apply checks hash and lock file path, parser normalizes legacy locks | OK | Keep; use the same lock envelope for adjacent timeline/editor projections |
| `clash timeline replace` | Creates a COW video-editor node/revision from a locked YAML projection and refreshes the lock to the new node | OK | Keep explicit; do not make `apply` silently fork |
| `clash text pull/apply` | Writes Markdown + generic projection lock envelope, apply checks hash and lock file path, parser normalizes legacy locks | OK | Keep; use the same lock envelope for durable text asset projections |
| `clash text replace` | Creates a COW text node from a locked Markdown projection and refreshes the lock to the new node | OK | Keep explicit; do not make `apply` silently fork |
| `clash canvas timeline pull/push` | Legacy timeline YAML + lock, stale and file-path mismatch reject | OK | Keep as compatibility, prefer `clash timeline` |
| `clash canvas update` | Direct node data patch with field guardrails, materialized-reference text content rejection, and agent `--if-match <readToken>` stale-read guard | Read-token CAS for agents | Not projection apply; keep blocking projection/runtime-owned fields and materialized-checkpoint semantic fields |
| Daemon `update` action | Direct `client.updateNode` wrapper using shared guardrails and host-side agent read-token validation | Read-token CAS for agents | Same guardrails as `canvas update`; do not use for file apply |
| `clash canvas add` | Creates node and optional edges | Not needed | Host validation and actor attribution are enough |
| `clash canvas delete` | Deletes node by id, requires `--yes`, rejects downstream-referenced nodes unless `--force` is passed, and requires agent `--if-match <readToken>` unless forced | Read-token CAS for agents | Add recoverability/API-side protection |
| `clash canvas execute` | Starts product execution | Not CAS | Requires task/actor/permission validation |
| `clash canvas get/list/search` | Read-only | Not needed | Safe inspection surface |
| `clash action install <id>` | Writes local action package under `${CLASH_HOME:-~/.clash}/actions` | Not product CAS | Keep idempotent version/`--force`; preserve path traversal checks |
| `clash action install --project --repo/--url` | Registers project action over WebSocket | Not file apply | Needs permission/version conflict semantics, not projection CAS |
| `clash action remove --project` | Removes project action over WebSocket | Not CAS | Destructive; should confirm or require explicit action id/permission |
| `clash action uninstall` | Removes local action package | Not CAS | Confirmation/`--yes` already exists |
| `clash projects init/link` | Writes `.clash/project.toml` marker | Not CAS | Marker write is allowed; project identity changes should be explicit |
| `clash projects create` | API create | Not CAS | Store in SQLite; response should expose project store/status |
| `clash projects delete` | Local API soft-delete, preserves project sessions/messages, and requires `--yes` in CLI | Read-token CAS for agents | Use `clash project get --json` then `clash project delete --if-match <readToken> --yes`; permanent removal is a separate purge action |
| `clash projects restore` | Restores a soft-deleted local project through the local recovery endpoint | Read-token CAS for agents | Use `clash project get --include-deleted --json` then `clash project restore --if-match <readToken>`; keep cloud/shared-project recovery parity separate |
| `clash projects purge` | Permanently removes a deleted local recovery point after explicit confirmation | Deleted-project read-token CAS for agents | Use `clash project get --include-deleted --json` then `clash project purge <projectId> --if-match <readToken> --yes`; defaults to delayed purge unless `--force` is explicit |
| `clash room say` | Append-only project chat | Not CAS | Store locally in SQLite and cloud D1; validate sender |
| `clash room read` | Read-only | Not needed | Safe inspection |
| `clash tasks status/wait` | Read-only/polling | Not needed | Safe inspection |
| `clash models provider set` | Provider account config mutation | Read-token CAS for agents | Use `clash models providers --json` then `clash models provider set <PROVIDER> --if-match <readToken>`; `--force` is the explicit overwrite escape hatch |
| `clash production plan-review-gate/approve-review-gate` | Writes local review gate JSON plus lock; approval checks lock file path and hash | OK | Keep as read-proof CAS for review decisions; durable DB/multi-user review UI is separate |
| `clash production` QA/report/receipt/export outputs | Writes agent-facing evidence under `qa/*`, `reviews/*`, `actions/*`, reference receipt paths, caption sidecars, timeline handoff CSV/provenance manifests, text-cut media-cut packages/plans, or caption-burn packages/plans | Path-guarded + source provenance | Use shared cwd plus realpath/symlink guard before writing or reading provenance roots; representative pipeline validation, dry-run gate, reference-role action, text-cut action/export, caption export, timeline handoff export, and caption-burn sidecar symlink escapes are rejected. Text-cut media export records `sourceActionPath`/`sourceActionHash` in the CLI result, ffmpeg plan, cut package, and output asset metadata |
| `clash production apply-metadata` | Applies action metadata to an asset manifest and writes the primary metadata projection plus generic lock sidecar; JSON-derived projections also get generic lock sidecars with source metadata/action hashes | Partial | Keep the generic lock envelope and source-action hash; host-issued receipt remains separate |
| `clash production apply-metadata-projection` | Applies an edited primary asset metadata projection back to `assets/manifest.json`, checks lock file path and stale metadata hash, refreshes the lock on success | OK for file CAS | Keep explicit; do not let agents mutate the manifest directly for projection edits |
| `clash production apply-storyboard-prompt-pack` | Applies edited prompt-pack JSON through a generic projection lock envelope plus source-action proof | OK | Keep hash, entity, source-action, and file-path mismatch rejection; host-issued receipt remains separate |
| `clash production replace-storyboard-prompt-pack` | Creates a versioned COW prompt-pack projection from a locked prompt-pack JSON file | OK | Same generic lock as read proof; source managed prompt-pack stale rejection; does not move existing downstream references |
| `clash vars set/delete` | Remote variable compatibility | Not local CAS | Remote-only compatibility; not local v1 auth path |
| `clash auth login/logout` | Writes `${CLASH_HOME:-~/.clash}/config.json` API key with owner-only permissions | Not CAS | Secret/config store; keychain/token store remains a hardening follow-up |

## Findings

### Timeline is complete; text is first-pass projection CAS

Timeline already has:

- projection file,
- lock file,
- semantic hash,
- stale reject,
- force escape hatch,
- daemon-side CAS validation,
- explicit `clash timeline replace` COW creation from the projection file, with
  source timeline hash, applied revision lineage, and a refreshed lock pointing
  at the new video-editor node.

Text now has:

- Markdown projection file,
- lock file,
- content hash,
- stale reject,
- force escape hatch,
- daemon-side CAS validation,
- materialized downstream reference rejection for text projections,
- explicit `clash text replace` COW creation from the projection file, with
  source node/content-hash lineage and a refreshed lock pointing at the new
  text node.

The direct read-token primitive is now shared in
`packages/shared-types/src/agent-read-proof.ts`. Text, timeline, storyboard
prompt-pack, primary asset metadata, editable metadata apply, and
`apply-metadata` JSON-derived projections now also share the projection lock
identity envelope through `packages/cli/src/lib/projection-cas.ts`. The
remaining duplication is in
future non-JSON/storyboard/editor projections that still need to adopt that
envelope instead of growing one-off lock formats.

### Direct node patch is the main bypass risk

`clash canvas update` can patch:

- `label`,
- `content`,
- `assetId`,
- arbitrary `data` key/value.

This is useful for admin and quick patching, but unsafe as a structured edit
path.

Current first-pass guardrails:

- The guardrail helper now lives in `@clash/shared-types`, with CLI keeping a
  compatibility re-export. CLI, daemon, and Web UI `useLoroSync.updateNode`
  use the same semantics for direct node patches.
- The host mutation envelope now lives in `@clash/shared-types`, with CLI
  keeping a compatibility re-export. Daemon responses and Web UI
  `useLoroSync.onMutation` records share the same accepted/rejected shape.
- `data.timelineDsl` is rejected; use `clash timeline apply` so CAS is
  enforced.
- `data.actorType`, `data.actorUserId`, and `data.actorAgentId` are rejected;
  provenance is runtime-owned.
- content patching a text node feeding materialized downstream state is
  rejected; use text projection or copy-on-write/replace workflow.
- fulfilled media `assetId` replacement on a referenced image/video/audio node
  is rejected through `canvas update`; use `clash canvas replace-asset` to fork
  an explicit copy-on-write media node with lineage.
- semantic patches to materialized downstream action checkpoints are rejected,
  including action/model/prompt/output fields such as `prompt`, `modelId`,
  `modelParams`, `customActionId`, `assetId`, `status`, `content`, and
  pending/error provider state. Treat the referenced action as a checkpoint and
  use copy-on-write/replace workflow instead.
- Downstream `draft`/`idle` placeholders do not make an action a materialized
  checkpoint; agents and users can still edit the action before adoption/run.
- Web UI nested patches like `{ data: { prompt: ... } }` are normalized to the
  same field set as CLI top-level patch payloads.
- Web UI node and edge deletion use the same shared guardrail family for
  referenced nodes and checkpoint lineage edges. Web UI edge add/update also
  blocks checkpoint input rewrites while allowing draft-placeholder lineage
  edits.
- Daemon direct update/delete, media COW replacement, and timeline/text CAS/COW
  mutations now return a structured `mutation` record describing the entity,
  expected hash or read token, observed before value, resulting after value when
  applicable, force state, and accepted/rejected outcome.
- Web UI direct node add/update/delete, timeline apply, and edge add/update/delete
  can emit the same mutation record through `useLoroSync.onMutation`;
  `ProjectEditor` now dispatches those records as `clash:host-mutation`
  browser events for desktop/E2E observers. `npm --prefix apps/web run
  test:e2e:host-mutation` now verifies this in headless Chrome/CDP by observing
  real ProjectEditor local-runtime canvas node add/update/delete, timeline
  apply, and edge add/update/delete writes with `projectId`; node add/update
  and timeline records include `afterReadToken`.
- Empty updates are rejected in both daemon and one-shot paths.

Remaining guardrails:

- Text, timeline, media asset, and storyboard prompt-pack replacement have
  first-pass explicit COW commands. They create new nodes/projections and
  lineage while leaving existing materialized downstream refs on the old source
  where applicable.
- Storyboard panel recovery/rewire flows and deeper asset import/GC semantics
  still need explicit policy.
- Delete now has default downstream-reference protection for canvas nodes.
  Project delete is a local-api soft delete with `clash project restore`;
  `clash project get --json` exposes a project metadata `readToken`, and
  `clash project delete --if-match <readToken>` passes that read proof for
  agent callers while still requiring `--yes`. `clash project get
  --include-deleted --json` exposes a deleted-project restore receipt, and
  `clash project restore --if-match <readToken>` passes that proof for agent
  callers. The same deleted-project receipt gates
  `clash project purge <projectId> --if-match <readToken> --yes`; the host
  rejects active projects, defaults to a 7-day purge delay, and treats
  `--force` as the explicit admin purge override. v1 project create/delete/restore/purge,
  legacy project create/update/delete, asset create/ref-delete/cover-update, and
  session create/delete responses include accepted/rejected mutation records.
  Accepted v1/legacy project delete plus accepted project restore/purge writes
  first-pass sanitized local audit records readable through `clash audit
  mutations --operation project_delete --entity <projectId> --json`,
  `clash audit mutations --operation project_restore
  --entity <projectId> --json` or `clash audit mutations --operation
  project_purge --entity <projectId> --json` without exposing receipt-bearing
  read tokens or raw SQLite.
  Local room message POST responses also include accepted/rejected mutation
  records while keeping `sync.remote_room.enabled=false` until remote sync is
  implemented.
  Runtime session create/attach success and validation rejections also include
  mutation records. Provider account update/delete responses include mutation
  records. Provider OAuth start/complete/delete responses include mutation
  records; completion failures record the local error state as an accepted local
  mutation. Local sync/audio config update and audio model install responses
  include mutation records. Local harness/agent-server write responses include
  mutation records. Custom-action upload responses include mutation records for
  text action results and asset-backed media results. Generic local `/upload`
  responses include mutation records for asset-blob writes without registering
  project-visible asset rows. Runtime ACP start/attach failure responses include
  mutation records and preserve readable UI error copy through the JSON `error`
  field. Delayed purge/admin hard-delete policy remains.
- Batch delete, force/recovery UX, and broader API mutation audit coverage remain
  follow-ups.

Required change:

```text
canvas update may patch safe metadata; projection-owned semantic fields require
projection apply or explicit copy-on-write/replace flags.
```

### Delete is not CAS, but needs reference protection

Delete should not require stale-read CAS by default, because it is not a
read-edit-apply file workflow. But deleting a referenced node or project is
destructive.

Required change:

- detect downstream refs (implemented in CLI/daemon),
- require confirmation/`--yes` (implemented in CLI),
- require explicit `--force` to orphan downstream references (implemented in
  CLI/daemon),
- report what will be orphaned,
- preserve recoverability where possible.

### Local package install is not projection apply

`clash action install <id>` writes files under
`${CLASH_HOME:-~/.clash}/actions/<id>`.
This is not project state and does not need CAS.

It does need:

- package integrity/checksum where available,
- safe path extraction,
- idempotent reinstall behavior,
- explicit `--force`.

### Project-level action registration needs version semantics

`clash action install --project --repo/--url` and `clash action remove
--project` mutate project action registration through ProjectRoom sideband.

This is not file projection CAS, but it is a concurrent project mutation.

Required change:

- actor attribution,
- permission check,
- action id/version conflict handling,
- remove confirmation or explicit id requirement,
- do not resurrect action-secret local semantics.

### CLI config contains a secret

`packages/cli/src/lib/config.ts` stores `apiKey` in:

```text
${CLASH_HOME:-~/.clash}/config.json
```

This is a local config file, but it contains a credential. It should not be
treated as an agent-editable JSON file.

Required behavior:

- `packages/cli/src/lib/config.ts` writes file-backed config with `0600`,
- prefer OS keychain/token store as future hardening,
- do not expose this file in projection/draft roots,
- do not ask agents to edit it directly.

## Required Implementation Changes

### P0

- Keep `packages/cli/src/lib/projection-cas.ts` as the shared projection CAS
  helper for content hashing, default lock sidecars, and path-bound lock
  checks for text, timeline, and storyboard prompt-pack projections; broaden it
  as more projection types move over.
- Keep text/timeline lock `readToken` fields as the agent-facing read proof for
  file-backed host-backed projections, while accepting legacy hash-only locks.
- Keep timeline CAS behavior and legacy lock compatibility.
- Keep timeline/text/storyboard prompt-pack lock identity and file-path
  mismatch rejection on every file-backed apply path.
- Keep storyboard prompt-pack lock entity/file-path mismatch rejection before
  managed projection writes and before copy-on-write prompt-pack replacement.
- Keep current `canvas update` guardrails for timeline/provenance and text
  feeding materialized downstream state; keep agent `--if-match` read-token
  enforcement; keep explicit text, media asset, and storyboard prompt-pack COW
  replacement, and add remaining storyboard/asset semantic guards.
- Make CLI help distinguish local provider auth from remote vars.
- Keep local variables/action-secret endpoints disabled.

### P1

- Add local room SQLite persistence.
- Add project-level action version/conflict semantics.
- Move CLI auth token storage to a safer local store if/when keychain support is
  added; current file-backed storage is strict-permission `0600`.

### P2

- Add admin/debug commands for explicit low-level patching.
- Extend first-pass local mutation audit beyond project delete/restore/purge,
  session delete, provider account delete, provider OAuth delete, asset-ref
  delete, asset import, asset cover update, asset reference refresh, asset GC delete, local-api canvas node update/delete, local-api canvas batch delete, and local-api canvas edge delete to the remaining
  force/destructive mutation surfaces.
- Broaden direct canvas read-token fixtures beyond the live local-api node/batch/edge
  project fixture into fuller desktop UI/product editing flows.

## Test Requirements

### CAS

- timeline fresh apply succeeds,
- timeline stale apply fails,
- timeline force apply succeeds and is reported,
- text stale apply fails,
- storyboard prompt-pack missing/stale lock fails,
- review gate wrong-file lock fails,
- COW prompt-pack replacement preserves the managed source projection.

### Direct Patch Guardrails

- safe label update works,
- text content update feeding materialized downstream state is rejected,
- arbitrary `data.timelineDsl=...` is rejected or routed,
- daemon and fallback paths match.

### Destructive Commands

- deleting referenced node fails without explicit reference acknowledgement,
- forced referenced-node delete reports intentional force,
- project delete requires `--yes` and remains recoverable through restore,
- action remove requires explicit action id and reports missing action.

### Secret/Config

- local vars/action-secret endpoints remain 404,
- remote vars routes remain available in cloud tests,
- CLI config file permissions are strict if file-backed token storage remains.

## Bottom Line

The correct v1 rule is not "CAS everything".

The correct rule is:

```text
CAS every read-edit-apply projection.
Guard every direct patch/delete according to its product risk.
Keep secrets out of agent-editable files.
```
