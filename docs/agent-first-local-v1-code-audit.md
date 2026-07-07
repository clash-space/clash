# Agent-First Local v1 Code Audit

Last updated: 2026-07-07

## Purpose

Ground the local/agent-first product principles in the current repo state.

This audit is intentionally narrower than the architecture docs. It answers:

- what is already aligned,
- what is still only partially implemented,
- what should be restricted rather than generalized,
- what is remote compatibility and should not be deleted during local cleanup.

Companion docs:

- `agent-first-local-v1-principles.md`
- `agent-first-local-v1-traceability-matrix.md`
- `agent-first-local-v1-api-surface-inventory.md`
- `agent-first-local-v1-remote-compatibility-boundary.md`
- `agent-first-local-v1-cli-cas-audit.md`
- `agent-first-local-v1-implementation-plan.md`
- `agent-first-local-v1-blackbox-e2e-spec.md`
- `local-sqlite-migration-spec.md`
- `local-project-storage-layout-spec.md`
- `agent-file-projection-cas-spec.md`

## Summary

The repo is already moving toward the right v1 shape:

- local Loro replica is file-backed under the app data root,
- project cwd is stable under `${CLASH_HOME:-~/.clash}/projects/<encodedProjectId>`,
- project cwd now materializes first-pass editable roots and a protected
  runtime root,
- `.clash/project.toml` is a project reference marker,
- local variables/action-secret endpoints are intentionally not exposed,
- timeline pull/apply has CAS,
- cloud still has ProjectRoom, room messages, and remote user variables.

The main v1 gaps are:

- local-api metadata now writes to `local.sqlite`, and provider credential /
  OAuth token payloads are encrypted before SQLite persistence,
- local-api mutating routes now use queued `db.update` read-modify-write for
  project, provider, OAuth, session, and asset metadata writes; regression
  tests cover concurrent create/update requests that previously lost writes,
- agent cwd currently points at the canonical project root with first-pass
  editable/protected root checks, but not a full workspace migration model,
- timeline has projection CAS plus explicit first-pass COW replacement through
  `clash timeline pull/apply/replace`,
- text nodes now have first-pass Markdown projection CAS plus explicit COW
  replacement through `clash text pull/apply/replace`, but are not yet durable
  text assets,
- shared projection path resolution now keeps text/timeline projection files
  inside the current agent/project cwd and rejects symlinked parents that
  resolve outside it, and applies the same cwd/realpath guard to generated
  lock sidecars and explicit `--lock` paths; `--force` does not bypass that
  boundary,
- local room POST/GET now persists to SQLite, keeps raw ACP traces separate,
  and dispatches mentions best-effort to local ACP sessions,
- CLI keeps `clash vars` for remote worker compatibility; current copy scopes
  it to remote worker action variables instead of local provider auth,
- generic `clash canvas update` remains a direct patch/admin path rather than
  projection apply; it now blocks projection/provenance fields, text feeding
  materialized downstream state, fulfilled referenced media `assetId`
  replacement, materialized downstream action checkpoint semantic fields, and
  batch deletes that would orphan downstream references outside the deleted set.
  Agent CLI/daemon direct update/delete also require a `readToken` from
  `canvas get --json` through `--if-match`, unless explicitly forced.
  Fulfilled media replacement now has a first-pass explicit
  `clash canvas replace-asset` COW path; storyboard prompt-pack replacement now
  has a first-pass explicit `clash production replace-storyboard-prompt-pack`
  path. Prompt-pack locks now require source action path/hash proof and reject
  locks with stripped source proof. Text, timeline, storyboard prompt-pack,
  primary asset metadata, editable metadata apply, and `apply-metadata`
  JSON-derived projection locks share a generic projection identity envelope
  while keeping legacy sidecar parsing where applicable. Generated and
  explicit production projection lock sidecars now use the shared cwd/realpath
  guard, and asset metadata projection lock rejection happens before manifest
  mutation. Broader storyboard
  host/UI integration, recovery/rewire flows, host-issued receipt paths, and
  adoption of the generic lock envelope by future non-JSON/editor projections
  remain pending.

## Evidence Snapshot

### Local `db.json`

`apps/local-api/src/app.ts` still uses a route DTO shape `LocalDb` with:

- `projects`
- `assets`
- `assetRefs`
- `sessions`
- `agentMembers`
- `sessionMessages`
- `providerAccounts`
- `providerOAuth`

`createDb(dataDir)` now routes non-provider metadata through
`apps/local-api/src/local-metadata-store.ts`, backed by `<dataDir>/local.sqlite`.
Project rows, assets, asset refs, runtime sessions, agent members, and local
session messages are stored as SQLite rows. Field-level JSON remains only for
structured columns such as asset metadata, asset sources, and message events.
`GET /api/v1/agents` now returns derived built-in local agents without inserting
`agent_member` rows; write paths that need ownership records seed them inside
explicit runtime-session or room-message mutations.

Provider account and OAuth state route through
`apps/local-api/src/local-provider-store.ts`:

- canonical new writes go to `<dataDir>/local.sqlite`,
- credentials, supported models, model priorities, and OAuth records are stored
  as rows rather than one JSON blob,
- provider credential values and OAuth access/refresh/user/device codes are
  stored as `enc:v1:` AES-256-GCM payloads with row/field AAD,
- local secret-key resolution prefers explicit environment keys, then macOS
  Keychain for real local data dirs, with a `0600` machine-local key file only
  for test/temp/fallback paths,
- legacy provider rows from `db.json` are ignored,
- provider-only writes no longer create a fresh `db.json`.

The metadata store no longer keeps a legacy `db.json` importer:

- if SQLite does not exist yet, routes start from an empty local metadata
  state instead of reading `db.json`,
- after a metadata write, `local_migration.metadata-sqlite-v1` marks SQLite as
  authoritative,
- new project/session/asset/provider writes do not create a fresh `db.json`.

Conclusion:

- `db.json` is now an ignored cleanup/secrets-risk file, not an active local
  product DB or importer.
- Do not document `db.json` as agent-editable.
- Do not add new route or processor writes to `db.json`.
- Do not bypass `local-provider-store` for provider credential/OAuth writes;
  direct SQL would bypass encryption and migration handling.
- Do not reintroduce `db.load()` followed by `db.save(state)` in request
  handlers. Route writes must go through `db.update()` or a narrower store
  transaction so concurrent local API requests cannot overwrite each other.

Spec: `local-sqlite-migration-spec.md`.

### Project cwd and marker

`packages/clash-bridge/src/lib/session-cwd.ts` writes:

```text
.clash/project.toml
store = "managed"
[sync]
mode = "local"
```

It also creates:

```text
drafts/
projections/text/
projections/timelines/
projections/storyboards/
projections/prompts/
projections/metadata/
assets/links/
sessions/
runtime/
```

The same file says v1 does not auto-migrate old cwd layouts into a hidden
archive directory and that project cwd creation is explicit and stable under
`${CLASH_HOME:-~/.clash}/projects/<encodedProjectId>`.

Conclusion:

- This matches the principle that cwd is a reference/draft surface.
- The unresolved question is whether the agent cwd should be the canonical
  project root or a draft workspace that references it.
- If canonical root remains the alpha default, protected directories must be
  documented and apply commands must be the mutation boundary.
- A real E2E bug was found where TypeScript source created the roots but
  desktop executed stale `@clash-space/bridge/dist` code. The desktop real
  Codex scripts now build the bridge before launching Electron, and real E2E
  asserts the OS-level cwd layout.

### Loro snapshot

Local Loro persistence uses `snapshot.bin` plus an update log. Architecture docs
already identify the snapshot as an internal persistence artifact.

`apps/local-api/src/loro/file-replica-store.ts` now supports compacting a
covering snapshot and truncating update records that are included in that
snapshot. `LocalLoroRoom` appends updates first for crash recovery, then
periodically compacts by update count or byte threshold so a long-running
project does not retain one update-log record per edit indefinitely.

Conclusion:

- Do not expose `snapshot.bin` as an editable product file.
- All canvas edits must go through host mutation APIs or typed CLI commands.
- Loro update logs are CRDT persistence internals. User-visible revision rows
  should remain milestone indexes, not every operation.

### Timeline CAS

`packages/cli/src/lib/timeline-projection.ts` implements:

- timeline YAML normalization,
- semantic timeline hash,
- `clash.timeline.lock`,
- stale apply rejection,
- `--force` bypass.

`packages/cli/src/lib/daemon.ts` implements `timeline_cas_update`, which
validates the expected timeline hash in the running daemon path.

Conclusion:

- Timeline has the right v1 pattern.
- Text, timeline, storyboard prompt-pack, primary asset metadata, editable
  metadata apply, and `apply-metadata` JSON-derived projections now use a
  generic projection lock identity shape (`projectionKind`, `entity`,
  `contentHash`) instead of only projection-specific fields, and production
  projection lock sidecars share the same cwd/realpath guard used by
  text/timeline sidecars.
- Remaining non-JSON storyboard/editor projection families should adopt that
  envelope rather than copying one-off lock formats.

Spec: `agent-file-projection-cas-spec.md`.

### Generic canvas update

`packages/cli/src/commands/canvas.ts` still has `clash canvas update` with:

- `--label`
- `--content`
- `--asset-id`
- arbitrary `--data key=value`

It updates via daemon action `update` or a one-shot `client.updateNode`.
Both paths now share the `@clash/shared-types` canvas update guardrail through
the CLI compatibility re-export at
`packages/cli/src/lib/canvas-update-guardrails.ts`. Web UI
`useLoroSync.updateNode` also calls the shared guardrail before committing a
local node patch.
Agent CLI direct updates additionally require `--if-match <readToken>` from a
fresh `clash canvas get --json`; the daemon validates the token again before
mutating.

Current first-pass limits:

- `data.timelineDsl` is rejected; timeline writes must use projection apply.
- `data.actorType`, `data.actorUserId`, and `data.actorAgentId` are rejected;
  runtime provenance cannot be patched through canvas update.
- `content` patches to text nodes whose outgoing canvas references feed
  materialized downstream state are rejected in both daemon and one-shot paths;
  text feeding only unmaterialized action drafts remains editable.
- `assetId` replacement on fulfilled media nodes with outgoing canvas edges is
  rejected in both daemon and one-shot paths; first fulfillment of pending media
  nodes is still allowed.
- `clash canvas replace-asset` and daemon `asset_cow_replace` create a new
  image/video/audio node with copy-on-write lineage and keep old downstream
  references attached to the old media node.
- semantic patches to materialized downstream action checkpoints are rejected
  in both daemon and one-shot paths. This covers action/model/prompt/output
  fields such as `prompt`, `modelId`, `modelParams`, `customActionId`,
  `assetId`, `status`, `content`, and pending/error provider state. Downstream
  `draft`/`idle` placeholders remain editable before adoption/run.
- agent direct `update`/`delete` requires a node `readToken`; stale tokens are
  rejected host-side before mutation unless the caller explicitly passes
  `--force`.
- Web UI nested `data` patches are normalized through the same helper, so
  referenced action-badge prompt/model/reference edits do not persist as blind
  in-place Loro writes.
- Web UI `removeNode`, `removeNodes`, `addEdge`, `updateEdge`, `removeEdge`,
  and daemon `ensure_edge` also use shared guardrails for referenced-node
  deletes, atomic closed-subgraph batch deletes, and materialized checkpoint
  lineage mutation. Existing agent edge add/update/delete writes now also
  require graph or edge read tokens from `clash canvas edges --json`, except
  same-patch create-and-consume edges that connect a newly created node. Agent
  batch deletion now has a formal graph-aware read-proof contract through
  `clash canvas delete-plan --node <id> --node <id> --json` followed by
  `clash canvas delete-batch --if-match <readToken> --yes`; daemon writes
  require the host-issued receipt and Web `removeNodes` rejects missing/stale
  batch tokens before mutating Loro.
- Web UI asset-ref cleanup only runs for nodes whose Loro deletion was accepted,
  so a guard-rejected delete no longer removes the project asset reference while
  the node is restored.
- Local API asset-ref deletion now requires `projectId` and only removes that
  project reference; it no longer treats a missing project id as "delete all
  refs for this asset".
- Empty updates are rejected consistently in daemon and one-shot paths.

Conclusion:

- This command is useful as a direct patch/admin operation.
- It is not safe as the future file-projection apply path.
- It should not be used for text/timeline/storyboard read-edit-apply workflows.
- Text content feeding materialized downstream state, materialized downstream
  action checkpoint semantic fields, and downstream-referenced node deletes are
  now rejected by default across CLI/daemon/Web UI. Web UI atomic batch delete
  allows closed-subgraph deletion, rejects external downstream orphaning, and
  accepts agent batch delete only with a matching graph-aware batch token from
  `canvas delete-plan`. Web UI and daemon `ensure_edge` also block checkpoint
  lineage edge add/update/delete while allowing draft-placeholder lineage edits.
  Existing Web/runtime edge add/update/delete requires matching graph/edge read
  tokens for agent writes; local-api `GET /api/v1/projects/:projectId/canvas/edges`
  plus `POST`/`PATCH`/`DELETE /api/v1/projects/:projectId/canvas/edges/:edgeId`
  now mirrors the same receipt-bearing graph/per-edge CAS for HTTP actions.
  Edge writes and local-api media COW replacement use
  `FileReplicaStore.updateSnapshotAtomic`, so recover, read-proof validation,
  mutation, and snapshot save run inside the same per-project write queue.
  Specialized COW/replace workflows and force/recovery UX still need deeper
  protection.

Required limit:

```text
Any command that reads a current entity, lets an agent edit a file, then writes
back must use CAS. Direct patch commands may exist, but must not bypass
immutability rules for referenced content.
```

### Variables and action secrets

Local-api tests assert these local endpoints return 404:

- `/api/settings/variables`
- `/api/settings/action-secrets`
- `/api/v1/vars`
- `/api/v1/action-secrets`

Cloud still has:

- `user_variable` table,
- `/api/v1/vars`,
- worker-action secret injection,
- web settings variable UI.

CLI still includes `clash vars`, but local-provider copy now points users to
`clash models provider set <PROVIDER>`, while `vars` copy is scoped to
remote/cloud worker action secrets. A 404 from `/api/v1/vars` is reported as
an explicit remote-only/local-auth boundary.

Conclusion:

- Do not delete remote variables while remote worker actions still use them.
- Do not reintroduce local variables/action secrets as the local v1 auth model.
- Keep CLI/help mode-aware:
  - local mode: provider accounts/OAuth/local runtime setup,
  - remote worker mode: vars compatibility,
  - shared mode: explicit remote-secret boundary.

Required limit:

```text
Only remote worker-action compatibility may use user variables. Local custom
actions use local-api auth/runtime setup, not action secrets.
```

### Room

Current facts:

- CLI has `clash room say/read` and expects
  `/api/v1/projects/:pid/room/messages`.
- CLI catches 404 from that endpoint and reports missing API support for older
  targets.
- Web UI hooks and cloud routes use project room message semantics.
- Cloud schema has `room_message`.
- Local-api tests cover local project room SQLite persistence, restart
  recovery, same-second pagination, duplicate-id protection, same-project
  same-id content conflict rejection, sender validation, and mention dispatch.
- Local ACP can push room mentions into matching project agent sessions.

Conclusion:

- Room should not be deleted as a product concept.
- Local persistence/routing baseline is implemented.
- Remaining local v1 work is sync policy, route parity, and UI/live behavior
  coverage.

Required limit:

```text
Room is project-visible conversation. It is not raw ACP trace and not a
projection file.
```

### Archive

Current `archive` references are mainly:

- ACP registry install archive URLs,
- checksum/extract/install flow for local ACP registry binaries,
- a comment saying v1 does not auto-migrate old cwd layouts into a hidden
  archive directory.

Conclusion:

- There is no broad project "archive storage" concept to migrate.
- ACP registry archives are remote install artifacts and should not be removed
  as part of local storage cleanup.
- If old-project migration returns later, name it explicitly as migration
  backup, not archive-as-product-state.

## Restrictions To Add Before v1

### Restrict local DB editing

- Do not document `db.json` or `local.sqlite` as agent-editable.
- Provide admin/debug export/import commands if needed.
- Keep product mutations behind API/store methods.

### Restrict projection writes

- File apply requires a lock unless `--force`.
- Host validates CAS, not only CLI.
- Stdin apply requires `--lock` or `--force`.
- Lock must match project, entity, projection type, and file path. Timeline,
  text, and storyboard prompt-pack apply now reject mismatched lock identities
  or file paths before writing projections; prompt-pack apply/replace also
  reject locks missing source storyboard action proof.

### Restrict action writes

- Agent action writes that are semantically `read host state -> write host state`
  must use the same receipt-bearing read-token contract as file projections.
- Local audio model install now requires a receipt-bearing
  `GET /api/v1/local/audio` token before the model install hook is invoked;
  ordinary non-agent UI calls remain compatible.
- Local harness install/install-adapter/upgrade/uninstall/authenticate now
  requires a receipt-bearing `GET /api/v1/local/harnesses` token before the local
  ACP adapter is invoked; ordinary non-agent UI calls remain compatible.
- Provider OAuth restart of an existing row and completion now require a
  receipt-bearing `GET /api/v1/provider-oauth` token for agent calls before the
  OAuth driver is invoked; ordinary non-agent UI start/complete remains
  compatible, and first-time start of a missing row remains a create path.
- The audio read token hashes the public ASR setup state, including install
  availability, so a successful install can make old install tokens stale.
- The harness read token hashes a stable harness projection, including installed
  and version/source fields, so an install can make an old uninstall token stale.
- Provider OAuth read tokens hash pending/authorized status and token metadata
  without exposing secrets, so a completed OAuth flow makes the pending receipt
  stale.

### Restrict direct node patching

- `canvas update --data` should not be the agent-first way to edit structured
  entities.
- Projection-owned and runtime-owned fields are blocked first.
- For fields that feed materialized downstream checkpoints, require projection
  apply or explicit copy-on-write/versioned replacement.

### Restrict local secrets

- No provider credentials, OAuth tokens, ACP auth state, or local action keys in
  projection files.
- No local action-secret compatibility endpoints.
- Use encrypted local SQLite or OS keychain-backed storage.

### Restrict room/traces

- Room messages can sync.
- Raw ACP traces, tool logs, local paths, and scratch context stay local by
  default.
- Projection apply should not auto-post raw diffs to room.

### Restrict cloud labels

- Local-only projects are not web-openable.
- `Synced` means canvas, room, and needed asset metadata have an actual sync
  path.
- Local-only custom actions are unavailable when the owner's machine is offline.

## Near-Term Implementation Order

1. SQLite local store with ignored-legacy-JSON regression tests.
2. Generic projection lock/hash/path library.
3. Text node Markdown pull/apply/replace with copy-on-write.
4. Mode-aware CLI help for vars/provider auth.
5. Local room SQLite endpoints or clear local-only unsupported errors.
6. Direct `canvas update` guardrails for materialized checkpoint references.
7. Asset link/projection policy and GC rules.
8. Real Codex ACP black-box path test for spawned agent cwd.

## E2E Evidence

Current deterministic coverage includes:

- focused unit/type tests for CLI, bridge, local-api, remotion timeline, web UI,
  shared model routing, and desktop startup,
- `apps/desktop/e2e/agent-browser-smoke.mjs`, now failing on forbidden React
  renderer lifecycle warnings,
- `apps/desktop/e2e/short-drama-timeline-smoke.mjs`, which creates and restores
  a deterministic 9:16 short-drama timeline,
- `apps/desktop/e2e/qa-agent-codex.mjs`, which launches a nested Codex QA
  agent and requires a schema-valid JSON report.

Latest stub-agent QA report:

```text
.tmp/qa-agent-codex/2026-07-05T06-36-57-683Z/qa-report.json
```

Latest real Codex ACP QA report:

```text
.tmp/qa-agent-codex/2026-07-05T07-04-03-855Z/qa-report.json
```

Latest real Codex ACP resume artifacts:

```text
.tmp/real-codex-resume/
```

Latest direct real Codex ACP layout run:

```text
.tmp/real-codex-layout/
```

Latest direct real Codex ACP resume layout run:

```text
.tmp/real-codex-layout-resume/
```

Latest local-api receipt smoke:

```text
.tmp/agent-first-asset-receipts/2026-07-07T04-22-16-630Z/agent-first-asset-receipt-report.json
```

Conclusion:

- Stub ACP black-box paths are passing.
- Real Codex ACP desktop path is passing and records spawned agent cwd under
  `~/.clash/projects/<encodedProjectId>`.
- The latest real Codex ACP QA report records project
  `55647743-1c58-4a8e-af4a-52fcdd69bfbf`, persisted runtime session
  `58286658-8c52-417d-8c39-c5794bb3664a`, direct ACP runtime session
  `acp-1783235078122-1`, and cwd
  `/Users/xiaoyang/.clash/projects/55647743-1c58-4a8e-af4a-52fcdd69bfbf`.
- Real Codex ACP resume path is passing: one session survives restart and
  records two `pwd` tool outputs under the same project cwd.
- The direct real Codex layout runs verify that `drafts`, `projections/text`,
  `projections/timelines`, `assets/links`, `sessions`, and `runtime` exist in
  the actual spawned agent cwd before the test can pass.
- Session rows and local transcript messages now store in `local.sqlite`;
  direct real Codex layout runs remain the end-to-end evidence for cwd shape.
- Timeline create/restore smoke is passing in both QA harness targets.
- Local-api package tests are passing with 268 tests, and the receipt smoke is
  passing with 108 checks, including read-only
  derived agent views, provider model test action mutation records, local audio
  model install, local audio transcription action mutation records, local harness
  install, provider OAuth restart/complete
  missing/bare/current receipt handling, missing-target CAS rejection,
  deleted-row stale rejection, and stale
  action rejection. Agent runtime-session attach now requires the session
  read receipt before invoking the local ACP attach hook. Asset reference-index
  refresh now records an accepted host metadata mutation. It also covers immutable
  asset import: same-id different content is rejected and must use a new asset id
  plus COW replacement. Custom action binary checkpoint outputs now reject same
  task/output reruns with different content before overwriting the checkpoint
  file. Focused Web/CLI/shared-type tests now cover graph/edge read-token CAS
  for runtime ACP edge add/update/delete plus `clash canvas edges --json`.
  Local room message client-id replays with different content are rejected and
  preserve the original message.

## What Not To Delete

Do not delete these remote/cloud surfaces while making local v1 cleaner:

- cloud ProjectRoom,
- cloud `room_message`,
- cloud `user_variable` compatibility for worker actions,
- remote action secret injection,
- ACP registry archive installation,
- cloud D1 provider/account tables,
- web shared-project UX.

Instead, make the local path explicit and prevent remote-only mechanisms from
being presented as the local default.
