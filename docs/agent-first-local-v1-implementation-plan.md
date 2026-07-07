# Agent-First Local v1 Implementation Plan

Last updated: 2026-07-07

## Purpose

Turn the local/agent-first architecture decisions into executable engineering
work.

Inputs:

- `agent-first-local-v1-principles.md`
- `agent-first-local-v1-traceability-matrix.md`
- `agent-first-local-v1-code-audit.md`
- `agent-first-local-v1-cli-cas-audit.md`
- `agent-first-local-v1-api-surface-inventory.md`
- `agent-first-local-v1-remote-compatibility-boundary.md`
- `agent-first-local-v1-blackbox-e2e-spec.md`
- `local-sqlite-migration-spec.md`
- `local-project-storage-layout-spec.md`
- `agent-file-projection-cas-spec.md`

## Ordering Rule

Do not start by polishing UI labels.

The highest-risk work is storage and mutation semantics:

1. Local product state must stop living in broad JSON.
2. Agent file edits must have CAS.
3. Materialized downstream checkpoints must be protected, with copy-on-write or
   versioned replacement for edits that would invalidate them.
4. Local-only behavior must not pretend to be cloud-synced.

## P0 Work

### P0-01: Replace local `db.json` with SQLite

Scope:

- `apps/local-api/src/app.ts`
- new `apps/local-api/src/db/*`
- route tests for projects, assets, sessions, providers, agents

Implementation:

- Add local SQLite schema.
- Add `LocalStore` interface.
- Add SQLite implementation.
- Do not add or retain a `db.json` importer for alpha local state.
- Route local-api through `LocalStore`.
- Stop writing broad product state to `db.json`.

Acceptance:

- Existing local `db.json` is ignored by local-api and reported only as a
  cleanup warning by doctor.
- Route responses are unchanged.
- Restart preserves projects, assets, sessions, messages, providers, OAuth.
- Provider credentials/OAuth tokens are not exposed by public APIs.
- `db.json` is not a product backup or editable state surface.
- No local route imports the old JSON helper.

Minimum tests:

- `sqlite-store.test.ts`
- ignored-legacy-JSON regression tests
- local-api route parity test with SQLite store
- restart persistence test
- regression test that fails if route code uses old `createDb`

Current status:

- SQLite migration is implemented for local-api project, asset, asset ref,
  runtime session, agent member, local session message, provider account, and
  provider OAuth state.
- `apps/local-api/src/local-metadata-store.ts` owns metadata tables and no
  longer reads `db.json`.
- `apps/local-api/src/local-provider-store.ts` owns provider/OAuth tables and
  no longer reads legacy provider rows from `db.json`.
- New local-api and local workflow processor writes no longer create broad
  `db.json`; existing `db.json` is ignored and surfaced only as cleanup risk.
- Covered by `apps/local-api/src/app.test.ts`, `apps/local-api/src/sync.test.ts`,
  focused local-api store routes, typecheck, and daemon smoke.
- `sync.json`, `audio.json`, `harnesses.json`, `host.json`, credential JSON,
  provider test recordings, and projection lock sidecars are classified as
  narrow config/runtime/artifact/projection files, not product databases.

### P0-02: Create shared projection CAS library

Scope:

- `packages/cli/src/lib/projection-lock.ts`
- `packages/cli/src/lib/projection-paths.ts`
- `packages/cli/src/lib/projection-hash.ts`
- adapt `timeline-projection.ts`

Implementation:

- Generic lock parse/serialize.
- Stable semantic hash helper.
- Path safety helpers.
- Legacy timeline lock reader.
- Common stale-write errors.
- Common `--force` reporting behavior.

Acceptance:

- Current timeline CLI tests still pass.
- Legacy `clash.timeline.lock` still applies.
- New generic lock format round-trips.
- Unsafe lock/file/project/entity mismatches fail.
- Stdin apply still requires `--lock` or `--force`.

Minimum tests:

- lock parse/serialize
- stable hash
- path traversal rejection
- lock path mismatch rejection
- stale rejection
- forced apply reporting
- timeline compatibility

Current status:

- Timeline/text legacy lock helpers now reject projection file path mismatches
  before apply, including the daemon-backed apply path.
- `clash canvas timeline push` uses the same timeline file path check for
  file-backed input; stdin remains allowed only with explicit `--lock` or
  `--force`.
- Timeline/text apply and daemon mutation responses now report `forced: true`
  when `--force` bypasses stale-read or checkpoint protection.
- Storyboard prompt-pack apply now rejects lock/file mismatches before writing
  the managed projection, and `replace-storyboard-prompt-pack` creates a
  versioned copy-on-write prompt-pack projection from the same read-proof lock.
- The shared generic `projection-lock.ts` abstraction is still not extracted;
  timeline/text currently carry legacy-specific helpers.

### P0-03: Host-enforced CAS mutation path

Scope:

- `packages/cli/src/lib/daemon.ts`
- local-api/host mutation endpoints as they become available
- timeline/text/storyboard apply commands

Implementation:

- Define host mutation envelope with actor, entity, expected hash, force, and
  payload.
- Make host validate current hash before mutation.
- Keep CLI preflight as usability, not the only protection.
- Return new hash and resulting entity id after mutation.

Acceptance:

- Daemon path rejects stale timeline updates.
- One-shot fallback rejects stale timeline updates.
- Future text/storyboard apply uses the same host contract.
- Force bypass is explicit in response.

Minimum tests:

- daemon stale reject
- fallback stale reject
- force bypass response. Implemented for daemon timeline/text mutation
  responses, daemon COW/direct mutation responses, and propagated by CLI apply
  paths.
- actor attribution is preserved

Current status:

- `packages/shared-types/src/host-mutation-envelope.ts` defines the shared host
  mutation envelope for both projection CAS hash checks and agent read-token
  checks. `packages/cli/src/lib/host-mutation-envelope.ts` remains a
  compatibility re-export.
- `packages/shared-types/src/agent-read-proof.ts` now also exposes
  `projectReadToken()`. For project metadata, the read-before-write proof is
  the CAS expected value: GET/list returns `readToken`, agent writes pass it as
  `ifMatch`, and the host compares it against current state at write time.
- Daemon `timeline_cas_update`, `text_cas_update`, `timeline_cow_replace`, and
  `text_cow_replace` responses now include a `mutation` record with operation,
  entity, expected hash when present, `beforeHash`, `afterHash`,
  `resultEntityId`, `accepted`, and `forced`.
- Daemon direct `update`/`delete` and `asset_cow_replace` responses now include
  a `mutation` record with operation, entity, expected read token when present,
  `beforeReadToken`, `afterReadToken` where applicable, `resultEntityId`,
  `accepted`, and `forced`.
- Web UI `useLoroSync` can emit accepted/rejected mutation records through
  `onMutation` for node add/update/delete, timeline apply, and edge
  add/update/delete, using the same shared envelope around the existing shared
  guardrails. Existing edge update/delete now compare per-edge read tokens, and
  agent add-edge writes among existing nodes compare the graph read token, both
  from `clash canvas edges --json`.
- local-api v1 project create/delete/restore and legacy project
  create/update/delete responses include accepted/rejected project mutation
  records while preserving legacy response fields where possible. Project
  create/get/list responses include `readToken`; project update/delete reject
  agent callers with missing or stale `ifMatch` unless explicitly forced, and
  accepted/rejected records include `expectedReadToken`, `beforeReadToken`, and
  `afterReadToken` where applicable.
- local-api v1 asset create/ref-delete/cover-update responses include
  accepted/rejected asset mutation records while preserving legacy response
  fields.
- local-api v1 session create/delete responses include accepted/rejected
  session mutation records. Session create keeps `threadId`/`title`; session
  delete now returns JSON `{ ok: true, mutation }`, matching the cloud route's
  JSON-shaped delete response more closely than the old local-only 204.
- local-api runtime session create/attach success responses and synchronous
  validation rejections now include accepted/rejected mutation records while
  preserving `session_id` for callers.
- Agent attach of an existing runtime session now requires that session's
  receipt-bearing read token from `GET /api/v1/sessions?...` before the local
  ACP attach hook is invoked; ordinary UI attach remains compatible.
- local-api provider account update/delete responses now include accepted/rejected
  mutation records. PATCH keeps `providers`; DELETE now returns JSON
  `{ ok: true, mutation }`.
- local-api provider OAuth start/complete/delete responses now include
  accepted/rejected mutation records. OAuth completion failures still return
  HTTP 502, but include an accepted local mutation record because the local
  OAuth row is updated to `status: "error"`.
- Agent provider OAuth start over an existing row now requires that row's
  receipt-bearing `GET /api/v1/provider-oauth` token before invoking the OAuth
  driver; first-time start of a missing row remains a create path.
- local-api local sync/audio config update, local audio model install, and local
  audio transcription action responses now include accepted/rejected mutation
  records. Audio transcriptions remain runtime action responses, not config
  mutations.
- local-api local harness enablement, custom agent-server update, harness
  install/install-adapter/upgrade/uninstall, and harness authenticate responses
  now include accepted/rejected mutation records.
- local-api `POST /api/custom-action/upload` now includes accepted/rejected
  mutation records for missing-field rejections, text action-result uploads,
  and image/video/audio asset-result uploads.
- Custom action binary outputs are checkpoint assets: same task/output index
  plus identical content is idempotent, but same task/output index plus different
  content is rejected before the checkpoint file can be overwritten. Reruns that
  produce different content need a new task/output id or explicit replacement.
- local-api generic `POST /upload` now includes accepted/rejected mutation
  records for blob writes. It does not create project-visible asset rows; those
  still go through `/api/v1/assets`.
- runtime ACP start/attach failures now return JSON `503` responses with the
  original readable `error` text plus a mutation record. If a local runtime
  session row exists, the failure is recorded as an accepted local error
  checkpoint; otherwise the mutation is rejected. The Web UI extracts the
  `error` field instead of displaying raw JSON.
- local-api package scripts now build shared-types, CLI, and bridge through
  `npm --prefix ... run build` before local-api build/test/e2e, avoiding the
  current `pnpm --filter` install/status check failure while keeping runtime
  package `dist` entries fresh. local-api Vitest aliases `@clash/shared-types`
  and `@clash/shared-types/assets` to source so route tests do not depend on a
  stale ignored `dist/` directory.
- The envelope records rejected stale/checkpoint/read-token preconditions
  without mutating. Remaining local-api mutating endpoints and live UI/E2E
  evidence still need to move onto the same envelope.

### P0-04: Text node Markdown projection

Scope:

- new `packages/cli/src/commands/text.ts`
- shared text projection parser/serializer
- host/local mutation path
- canvas node data model if needed

Implementation:

- Add `clash text pull --node <id>`. Implemented.
- Add `clash text apply --node <id>`. Implemented.
- Markdown file containing the node body. Implemented as body-only Markdown for
  the first pass.
- Sidecar lock. Implemented.
- Semantic text hash. Implemented over exact file content.
- Reject non-editable fields. Deferred until frontmatter/metadata projection is
  introduced.

Acceptance:

- Pull writes `projections/text/<nodeId>.md`.
- Pull writes `projections/text/<nodeId>.lock.json`.
- Apply updates text through CAS.
- Stale apply is rejected.
- `--force` is explicit.
- Non-editable frontmatter changes are rejected once frontmatter exists.

Minimum tests:

- text path resolution
- text lock parse/serialize
- stale apply rejection
- forced apply
- command registration
- daemon-side CAS handler

Current status:

- `packages/cli/src/commands/text.ts` provides `clash text pull/apply/replace`.
- `packages/cli/src/lib/text-projection.ts` provides text hash, lock, path, and
  CAS helpers plus COW replacement node metadata helpers.
- daemon `text_cas_update` enforces the expected content hash for persistent
  connection writes.
- daemon `text_cow_replace` enforces the same CAS lock before creating a new
  text node with source node/content-hash lineage.
- Text apply rejects materialized downstream checkpoint rewrites by default,
  allows unmaterialized action-draft references, and permits explicit
  `--force` checkpoint rewrites.
- Text replace creates a copy-on-write text node from the edited Markdown file,
  refreshes the lock to point at the new node, and leaves existing materialized
  downstream outputs attached to the old text node.
- Covered by `packages/cli/src/commands/text.test.ts`.

Remaining gap:

- Text nodes are still canvas `data.content`; they are not yet durable text
  asset rows in SQLite.
- No text frontmatter metadata is projected yet.

### P0-05: Copy-on-write for referenced text/content

Scope:

- canvas graph utilities,
- text apply path,
- asset/text lineage metadata.

Implementation:

- Detect materialized downstream refs for a text node/content asset.
  Implemented for text projection apply and direct content patches; action-draft
  references remain editable before adoption/run.
- Default apply rejects in-place mutation for text feeding materialized
  downstream state. Explicit `clash text replace` creates copy-on-write.
- Record source node/content-hash lineage. Implemented for first-pass text COW
  replacement through `sourceTextNodeId`, source hash, replacement hash, and a
  lineage edge.
- Keep materialized downstream refs attached to old entity. Implemented for
  first-pass text COW replacement; it does not rewire old downstream action
  inputs.

Acceptance:

- Unreferenced text and text feeding only unmaterialized action drafts can
  update.
- Text feeding materialized downstream state does not mutate in place.
- Copy-on-write produces a new entity/version.
- Existing downstream outputs still point to old content.
- Explicit replace is separate and visible.

Minimum tests:

- downstream detection
- COW entity creation (implemented for explicit text replace)
- original entity unchanged (implemented for explicit text replace)
- lineage recorded (implemented for explicit text replace)
- explicit replace path

### P0-06: Storage layout guardrails

Scope:

- bridge project cwd creation,
- local-api project/loro path docs,
- CLI project status/doctor.

Implementation:

- Ensure `drafts/`, `projections/`, `sessions/`, and `assets/links/` exist.
- Document protected paths in generated agent instructions.
- Add `clash project status --json` fields for project store, projection root,
  draft root, protected runtime root, and sync mode.
- Add initial `clash doctor storage`.

Acceptance:

- Agents can discover editable roots without guessing.
- Project marker points to the project id.
- No second snapshot is created in cwd.
- Doctor reports missing marker, conflicting env/marker, missing Loro store, and
  protected-path anomalies.

Minimum tests:

- cwd creation creates expected dirs
- marker conflict remains rejected
- doctor detects missing/mismatched marker
- project status JSON is stable

Current status:

- `clash project status --json` now exposes:
  - selected project id/source/mode,
  - Clash home root,
  - alpha project workspace root,
  - local-api data dir,
  - future SQLite path,
  - ignored legacy `db.json` cleanup path,
  - Loro replica/snapshot/update-log paths,
  - editable draft/projection/asset-link roots,
  - explicit `roots.runtime`/`runtimeRoot`,
  - protected local DB/snapshot/runtime paths.
- The command treats a marker in the cwd as context only. If `--project`
  selects a different project, the status does not inherit the marker's sync
  mode.
- local-api `GET /api/v1/projects/:id/status` exposes the same path contract
  for explicit project ids through the shared-runtime status builder.
- `clash doctor storage --json` now runs read-only checks for project context,
  marker existence, editable/protected path separation, protected cwd, project
  workspace, editable draft/projection/session/asset-link roots, protected
  runtime root, Loro replica, local SQLite target, broken/invalid asset links,
  ignored legacy `db.json`, and the structured `storage` role contract that
  keeps agent workspace paths separate from the protected canonical replica.
- `packages/clash-bridge/src/lib/session-cwd.ts` now creates alpha agent
  workspace directories for `drafts`, `projections/text`,
  `projections/timelines`, `projections/storyboards`, `projections/prompts`,
  `projections/metadata`, `assets/links`, `sessions`, and protected
  `runtime`.
- Bundled AGENTS.md now instructs spawned agents to treat `editablePaths` as
  their writable surface and `protectedPaths`/`runtimeRoot`/Loro/SQLite/legacy
  `db.json` as internal state reachable only through explicit `clash` commands.
- `clash project status --json` and local-api project status now expose a
  structured `storage` contract: `storage.workspace` is the draft/projection
  surface and explicitly owns no canonical snapshot/metadata, while
  `storage.canonicalReplica` identifies the protected machine-scoped SQLite
  metadata store and Loro canvas replica.
- `clash asset link --asset <id>` now creates an agent-readable file under
  `assets/links/` via the immutable global asset cache.
- Desktop real Codex startup/resume scripts build `@clash-space/bridge` before
  launching Electron, preventing source/dist drift in the runtime path.
- Direct real Codex startup and resume E2E now assert the v1 workspace roots
  exist in the actual spawned agent cwd and that local-api project status
  reports `runtimeRoot` as protected.
- Covered by `packages/cli/src/commands/projects-status.test.ts` and
  `packages/cli/src/commands/doctor.test.ts`; bridge layout is covered by
  `packages/clash-bridge/src/lib/session-cwd.test.ts`; desktop script/layout
  gates are covered by `apps/desktop/src/startup-suite.test.ts` and the direct
  real Codex E2E runs.

Remaining gap:

- `clash doctor storage` does not create/migrate directories and does not yet
  validate downstream refs, canonical store initialization, or recoverability.
- `clash doctor storage` reports an ignored legacy `db.json` path only as a
  cleanup/secrets warning; it does not inspect SQLite schema deeply yet.

### P0-07: Local/remote variables boundary

Scope:

- `packages/cli/src/commands/vars.ts`
- CLI copy in actions/models commands
- local-api route tests
- cloud routes remain intact

Implementation:

- Keep local-api variable/action-secret endpoints 404.
- Do not delete cloud `/api/v1/vars`.
- Make CLI help mode-aware:
  - local provider auth: use provider account/OAuth commands,
  - remote worker action: vars compatibility,
  - unsupported local vars: clear error.
- Remove local default suggestions that tell users to use `clash vars set`.

Acceptance:

- Local API continues returning 404 for variables/action-secrets.
- Remote vars command remains available when pointed at cloud API.
- Local CLI no longer tells agents to use vars as the default auth path.
- Tests cover both local rejection and remote compatibility expectation.

Minimum tests:

- local 404 regression test remains
- CLI text snapshot or command test for local help
- cloud route tests unchanged

Current status:

- CLI copy now scopes `clash vars` to remote/cloud worker action variables.
- CLI `clash vars` maps 404 to an explicit remote-only/local-auth message.
- `models providers` now points local users to `clash models provider set`.
- Added `remote-compat-copy.test.ts` for the CLI copy contract.
- Local endpoint and cloud route regression coverage still need to remain in
  place while storage work continues.

## P1 Work

### P1-01: Local room persistence

Scope:

- local SQLite `room_message`,
- local-api project room endpoints,
- `clash room say/read`,
- web room hook behavior in local mode.

Implementation:

- Implement local `/api/v1/projects/:pid/room/messages`.
- Store room messages in SQLite.
- Keep room separate from raw ACP traces.
- Route mentions to local ACP sessions where supported.

Acceptance:

- `clash room say/read` works in local-only project.
- Room survives local-api restart.
- Room messages can later sync to cloud.
- Raw ACP trace is not dumped into room.

Current status:

- Local API implements SQLite-backed room POST/GET.
- Room survives local-api restart and does not dump raw ACP trace.
- Agent sender spoofing is rejected.
- Agent-member-only mentions are preserved and dispatched best-effort to local
  ACP sessions.
- Room POST success and validation/conflict rejections now return the shared
  host mutation envelope with `operation: "room_message_create"` while keeping
  the public room DTO and sync marker fields.
- Same project/id room replays are idempotent only when normalized sender, text,
  and mentions match; conflicting content is rejected before the original row can
  be overwritten.
- Cloud room POST now uses the same same-project/id replay rule, so local-to-cloud
  mirroring cannot silently turn a client id into an overwrite handle.
- `apps/local-api/src/room-sync.ts` now exposes a deterministic room mirror
  planner: local-only messages export oldest-first, remote-only messages import
  oldest-first, identical same-id rows are treated as already mirrored, and
  same-id content differences surface as conflicts without planning an overwrite.
- Room responses include `sync.remote_room.enabled=false` until remote room
  sync is explicitly implemented.
- CLI maps 404 to a generic missing-room-API message for older local-api/cloud
  targets.
- `apps/local-api/src/room-cli.e2e.test.ts` now starts a real local-api HTTP
  server and drives `clash room say/read` through a spawned CLI process, proving
  the agent-facing command path can post/read local-only room messages and see
  the response-level sync metadata.

Remaining gap:

- The planner still needs a real sync loop, mirror admission gates, conflict
  recovery UI, and live room UI parity before remote room sync can be exposed.

Minimum tests:

- local room POST/GET
- mention shape validation
- restart persistence
- local ACP mention dispatch
- same-second pagination and duplicate-id idempotency/conflict rejection
- cloud route duplicate-id idempotency/conflict parity
- deterministic room mirror planning for import/export/conflict classification
- spawned CLI `room say/read` against a real local-api loopback server

### P1-02: Real Codex ACP cwd verification

Scope:

- `apps/desktop/e2e/qa-agent-codex.mjs`
- `apps/desktop/e2e/real-codex-agent-browser.mjs`
- session cwd reporting in local runtime/session APIs

Implementation:

- Run the QA harness with `CLASH_QA_AGENT_TARGET=real-codex-acp`.
- Require the report to include actual spawned agent cwd observations.
- Verify the cwd points at the intended project workspace and does not create a
  second canvas replica.
- Keep the stub target for fast UI/session path regression.

Acceptance:

- real-codex target exits 0.
- report contains at least one non-null agent `cwdPath`.
- cwd marker resolves to the same project id as the UI route and local DB row.
- no extra `snapshot.bin` appears under a session-specific cwd.

Current status:

- Stub Codex QA passed at
  `.tmp/qa-agent-codex/2026-07-05T06-36-57-683Z/qa-report.json`.
- Stub ACP sessions are DB rows and correctly report `cwdPath: null`.
- Real Codex ACP QA passed at
  `.tmp/qa-agent-codex/2026-07-05T07-04-03-855Z/qa-report.json`.
- The real run recorded session cwd under
  `/Users/xiaoyang/.clash/projects/55647743-1c58-4a8e-af4a-52fcdd69bfbf`,
  persisted runtime session `58286658-8c52-417d-8c39-c5794bb3664a`, direct ACP
  runtime session `acp-1783235078122-1`, and the short-drama timeline artifact.
- Real Codex ACP resume passed at `.tmp/real-codex-resume/`; it restored the
  same session after restart and recorded two `pwd` outputs under
  `/Users/xiaoyang/.clash/projects/06cb2be7-6dac-46fa-a52f-0856ba9a1ea3`.
- Direct real Codex layout startup passed at `.tmp/real-codex-layout/` and
  verified the spawned agent cwd has `drafts`, `projections/text`,
  `projections/timelines`, `assets/links`, `sessions`, and `runtime`.
- Direct real Codex layout resume passed at `.tmp/real-codex-layout-resume/`
  and verified the same roots before and after session restore.
- Remaining work is to broaden real-agent fixtures beyond `pwd` and timeline
  create/restore.

### P1-03: Asset content store and project links

Scope:

- local asset upload/import,
- SQLite asset rows,
- local blob filesystem,
- project `assets/links`.

Implementation:

- Store blobs by content hash or stable local blob key.
- Store metadata in SQLite.
- Store project membership in `asset_refs`.
- Generate optional project links for inspection. First-pass CLI support exists
  through `clash asset import --file <path>` for content-addressed local blob
  import and through `clash asset link --asset <id>` for existing immutable
  assets.
- Register local imports with local-api `/api/v1/assets/import` so SQLite
  `assets` and `asset_refs` reflect the content-addressed blob instead of
  leaving product state to infer from the filesystem.
- Re-registering an existing asset id is idempotent only when kind, storage key,
  and known content metadata match; same id plus different blob identity is
  rejected and must use a new asset id plus COW replacement.
- Run local cleanup through `clash asset gc` or local-api `/api/v1/assets/gc`,
  not through direct file deletion by an agent.
- Preserve live canvas/project references during GC by passing protected asset
  ids into the host GC call.
- Scan requested project ids' Loro canvas replicas during GC so the host can
  protect persisted canvas `assetId` references without exposing
  `snapshot.bin` to the agent.
- Refresh known scanned Loro asset references into SQLite `asset_refs` on
  non-dry-run GC, making `asset_refs` the project-level materialized reference
  projection instead of a one-time import-only table.
- Refresh known scanned Loro node/field references into SQLite
  `asset_node_refs` on non-dry-run GC, so UI/agents can query which node and
  field references an asset without reading `snapshot.bin`.
- Store a first-pass `referenceRole` for scanned node/field references,
  including `source`, `reference`, `required-reference`, `derived`, `primary`,
  and fallback `asset`.
- Expose that query through `GET /api/v1/assets/:id/references` and
  `clash asset refs`, not through direct SQLite reads.
- Expose explicit projection refresh through
  `POST /api/v1/assets/:id/references/refresh` and
  `clash asset refs --refresh`, so agents can update the reference index
  without running GC deletion. The local-api refresh endpoint returns an accepted
  host mutation record because it mutates the SQLite reference projection.
- Never mutate referenced blobs in place.

Acceptance:

- Same blob used by multiple projects is not copied unnecessarily.
- Importing the same bytes twice returns the same `local:sha256:<hash>` asset
  id and blob path.
- Local import registration creates one immutable asset row and project
  membership in `asset_refs`.
- Existing asset rows are not rewritten to point at different bytes during
  import; new content requires a new content-addressed id.
- First-pass GC removes only asset rows with no SQLite refs and only deletes
  unreferenced `local-blobs/...` files.
- GC honors explicitly protected asset ids, so agents can preserve known live
  canvas references without touching SQLite or blobs directly.
- GC honors requested project ids by scanning their persisted Loro canvas nodes
  for `assetId`/`assetIds` references before deleting local blobs.
- When project ids are omitted, local-api GC discovers all local project replica
  directories and scans their persisted Loro canvas nodes before deleting local
  blobs.
- GC scans first-pass downstream metadata references by treating Loro canvas
  fields ending in `AssetId` or `AssetIds` as asset references. This covers
  fields such as `sourceAssetId`, `referenceAssetId`, and
  `requiredReferenceAssetIds`.
- Non-dry-run GC refreshes known scanned references back into `asset_refs`, so
  subsequent queries and GC runs can rely on SQLite for project membership.
- Non-dry-run GC refreshes known scanned node/field references back into
  `asset_node_refs`, including node id, node type, asset id, field path, and
  first-pass reference role.
- Agents can inspect those node/field references through `clash asset refs`
  without reading SQLite or Loro binary files.
- Agents can pass `--refresh --project <id>` to refresh the local reference
  projection from the Loro replica before reading, without deleting local blobs
  or mutating canvas state.
- Link breakage is detected by doctor.
- Editing/importing a file creates a new asset id.
- Full GC still needs a richer role ontology, provenance/history UI, and live
  UI/E2E evidence before it can be considered complete.

Minimum tests:

- duplicate import dedupe if hash matches,
- cross-project refs,
- broken link doctor,
- copy-on-write asset edit,
- Downstream-aware GC no-ref behavior.

### P1-04: Direct `canvas update` guardrails

Scope:

- `packages/cli/src/commands/canvas.ts`
- daemon `update` action
- one-shot `client.updateNode` path

Implementation:

- Mark broad `--data` updates as explicit patch/admin behavior.
- Block fields that feed materialized downstream checkpoints unless `--force`
  or specific replace/COW flags are added.
- Route structured text/timeline/storyboard edits through projection commands.

Acceptance:

- `canvas update --data timelineDsl=...` is rejected; timeline files must use
  timeline projection apply so CAS is enforced.
- `canvas update --data actorType=...` / `actorUserId=...` /
  `actorAgentId=...` are rejected; provenance is runtime-owned.
- Existing simple label/description patches still work where safe. `status` and
  `assetId` are only direct-patchable on unreferenced drafts; a referenced
  action node treats them as checkpoint-owned semantic fields.
- `canvas update --content` does not silently mutate text content feeding
  materialized downstream state through either daemon or one-shot paths. Text
  feeding only unmaterialized action drafts remains editable.
- `canvas update --asset-id` does not silently replace an already fulfilled
  media node with downstream references; first fulfillment of a pending media
  node is allowed.
- `clash canvas replace-asset` creates a copy-on-write image/video/audio node
  with source lineage from a fresh `canvas get --json` read token, and leaves
  old downstream references attached to the old media node.
- `clash asset replace --node <id> --file <path>` imports a local file as an
  immutable content-addressed asset, registers local metadata, and invokes the
  same copy-on-write media replacement path with the supplied read token.
- Local-api `/api/v1/assets/replace` accepts a registered immutable asset id,
  validates the source media node read token for agent callers, writes a COW
  media node into the persisted Loro replica, and returns the same mutation
  envelope/read-token evidence.
- `canvas update --data prompt=...`, model/action fields, output fields, and
  provider runtime fields do not silently mutate a downstream-referenced action
  checkpoint through either daemon or one-shot paths.
- `clash timeline apply` and legacy `clash canvas timeline push` do not
  silently mutate a timeline with materialized downstream render/checkpoint
  nodes through either daemon or one-shot paths.
- `clash timeline replace` creates a copy-on-write video-editor node/revision
  from the locked YAML projection, refreshes the lock to the new node, and
  leaves old materialized render refs attached to the old timeline node.
- Text COW replacement has a first-pass explicit CLI/daemon implementation.
  Current `apply` still rejects rather than copies by default and allows
  explicit `--force` checkpoint rewrites.

Minimum tests:

- safe metadata patch
- unsafe structured field reject
- runtime-owned provenance field reject
- daemon and fallback paths share the same guardrail helper
- materialized downstream text content patch rejection, with action-draft
  references allowed
- referenced media `assetId` replacement rejection, with pending fulfillment
  allowed
- materialized downstream timeline apply rejection, with draft placeholders and
  explicit force allowed
- agent direct `canvas update/delete` missing or stale `--if-match` read token
  rejection, with fresh token success and explicit force override
- media asset COW replacement preserving old downstream references and
  rejecting stale agent read tokens

Current status:

- `packages/shared-types/src/canvas-update-guardrails.ts` is the shared
  direct-patch guardrail. `packages/cli/src/lib/canvas-update-guardrails.ts`
  re-exports it for CLI compatibility. The stable read-token primitive lives in
  `packages/shared-types/src/agent-read-proof.ts` and is used by the canvas
  guardrail.
- `packages/cli/src/lib/projection-cas.ts` is the shared file-projection CAS
  helper for `sha256-64` content hashing, default `.lock.json` sidecar paths,
  and path-bound lock checks. Text, timeline, and storyboard prompt-pack
  projections now call it for those common pieces.
- The shared guardrail blocks projection-owned `timelineDsl` patches and
  runtime-owned actor/provenance fields.
- The shared guardrail rejects semantic patches on downstream-referenced action
  checkpoints, including prompt/model/action/output/status/asset fields. It
  handles both CLI top-level patches and Web UI nested `{ data: ... }` patches.
- `hasRun` alone does not lock an action. The lock starts only when that action
  feeds a pending/completed or otherwise materialized downstream checkpoint.
- Downstream `draft`/`idle` placeholders do not turn an action draft into a
  checkpoint; the action remains editable until the downstream output becomes
  pending/completed or otherwise materialized.
- The shared guardrail rejects fulfilled media `assetId` replacement on nodes
  with downstream references while allowing pending media nodes to receive
  their first completed asset.
- `packages/cli/src/commands/canvas.ts`, daemon `update`, and daemon
  `ensure_edge` all call the shared guardrail helpers.
- `clash canvas get --json` returns a node `readToken`; agent
  `clash canvas update/delete` calls must pass that token with `--if-match`.
  The CLI fallback path and daemon `update`/`delete` both reject missing or
  stale agent tokens unless explicitly forced.
- `clash canvas edges --json` returns edge read tokens plus a graph read token.
  Runtime ACP `add_edge`, `update_edge`, and `delete_edge` preserve
  `ifMatch`/`force` and route through `useLoroSync` as agent writes, so stale or
  missing graph/edge proofs are rejected before Loro mutation. Same-patch
  create-and-consume edges that connect a newly created node remain allowed
  without a prior graph read.
- Local-api `GET /api/v1/projects/:projectId/canvas/edges` returns the same
  receipt-bearing graph and per-edge read tokens for HTTP clients.
  `POST /canvas/edges/:edgeId` uses the graph token for edge creation, while
  `PATCH`/`DELETE /canvas/edges/:edgeId` use the per-edge token. Agent writes
  reject missing, bare, or stale receipt tokens before the Loro snapshot is
  saved. These writes and `/api/v1/assets/replace` run through
  `FileReplicaStore.updateSnapshotAtomic`, so the route re-reads and validates
  against the latest project snapshot inside the per-project write queue before
  saving.
- `clash canvas delete-plan --node <id> --node <id> --json` returns a
  graph-aware batch delete read token over the target node set and current edge
  graph. `clash canvas delete-batch --if-match <readToken> --yes` applies the
  closed-subgraph delete through daemon/CLI host CAS; daemon agent writes require
  a host-issued receipt, and Web `useLoroSync.removeNodes` rejects missing/stale
  batch proofs before mutating Loro.
- `clash text pull` and `clash timeline pull` now write `readToken` into their
  lock sidecars. Apply/replace still validate the legacy semantic hash, but new
  locks also flow through host mutation records as `expectedReadToken`,
  `beforeReadToken`, and `afterReadToken`.
- Shared read-proof validation now treats any supplied `expectedReadToken` as a
  CAS precondition, while keeping host-issued receipts mandatory only for agent
  writes.
- `clash canvas replace-asset`, `clash asset replace --node --file`, local-api
  `/api/v1/assets/replace`, and daemon `asset_cow_replace` create explicit
  copy-on-write media nodes for fulfilled image/video/audio asset replacement.
  They also require the source node read token for agent writes unless forced.
- `packages/cli/src/lib/timeline-projection.ts` now has a timeline-specific
  materialized downstream checkpoint guard backed by the shared canvas
  guardrail helper. `clash timeline apply`, daemon `timeline_cas_update`, and
  legacy `clash canvas timeline push` call it before mutating `timelineDsl`.
- `packages/web-ui/src/hooks/useLoroSync.ts` now calls the same guardrail before
  committing local node patches, so human UI edits and agent CLI edits share the
  first-pass checkpoint rule.
- `VideoEditorContext` saves through `useLoroSync.applyTimelineDsl`, so normal
  editor saves are explicit timeline applies while generic `updateNode` still
  rejects blind `timelineDsl` patches.
- Web UI `useLoroSync.removeNode` also uses the shared referenced-delete guard,
  matching CLI/daemon default behavior for nodes with downstream references.
- Empty update calls are rejected in both daemon and one-shot paths.
- Covered by `packages/shared-types/src/canvas-update-guardrails.test.ts`,
  `packages/cli/src/lib/canvas-update-guardrails.test.ts`, daemon
  direct read-proof tests, daemon batch delete tests, Web `useLoroSync`
  guardrail tests, local-api edge receipt-CAS tests, and daemon `ensure_edge`
  tests. `apps/local-api/src/loro/file-replica-store.test.ts` covers the
  serialized recover-mutate-save primitive and `save:false` rejection path.

Remaining gap:

- Text content COW has a first-pass explicit `clash text replace`
  implementation. It creates a copied text entity with lineage and keeps old
  materialized downstream refs attached to the old node. `clash text apply`
  still rejects in-place mutation by default; unmaterialized action-draft
  references can still be edited in place, and explicit `--force` can rewrite a
  checkpoint.
- Timeline COW/versioned replacement has a first-pass explicit
  `clash timeline replace` implementation. Current `apply` still detects
  materialized downstream render/checkpoint references and rejects the in-place
  mutation unless `--force` is used.
- Fulfilled media asset replacement and storyboard prompt-pack replacement now
  have first-pass explicit COW commands. `clash asset replace --node --file`
  adds the local-file import plus COW replacement surface. Remaining storyboard
  work is broader host/UI integration, recovery/rewire flows, and generic
  projection-lock extraction.
- Edge deletion now has a shared first-pass lineage rule in Web UI:
  input/output edges of materialized downstream action checkpoints are blocked,
  while unreferenced action draft input edges and draft-placeholder pipelines
  remain editable. Web UI edge add/update also rejects new input edges and
  endpoint rewrites that would mutate a materialized action checkpoint lineage.
  Existing agent edge add/update/delete writes now require graph/edge read
  tokens, except same-patch create-and-consume edges that connect a newly
  created node. Local-api HTTP edge actions now have receipt-bearing
  read-before-write CAS. Force/recovery UX is still a follow-up.

### P1-04b: Destructive delete guardrails

Scope:

- `packages/cli/src/commands/canvas.ts`
- `packages/cli/src/commands/projects.ts`
- local-api delete endpoints

Implementation:

- Require explicit CLI confirmation for destructive delete commands.
- Add downstream/reference checks for canvas node deletion.
- Soft-delete local projects so persisted sessions/messages survive deletion.
- Expose explicit restore through local-api and CLI.
- Add a separate delayed/admin hard purge for deleted local project recovery
  points.
- Keep API compatibility, but do not let local CLI delete look like a harmless
  patch.

Current status:

- CLI `clash canvas delete` requires `--yes`.
- CLI/daemon `clash canvas delete` rejects nodes with downstream references
  unless `--force` is passed with `--yes`.
- CLI `clash projects delete` requires `--yes`.
- local-api `DELETE /api/v1/projects/:id` marks local projects deleted instead
  of hard-deleting session/message history, and
  `POST /api/v1/projects/:id/restore` restores visibility.
- local-api v1 project create/delete/restore responses include accepted or
  rejected project mutation records while preserving existing response fields.
- CLI `clash project get --include-deleted --json` exposes the deleted-project
  restore receipt, and `clash project restore --if-match <readToken>` passes it
  for agent read-before-write CAS.
- local-api `DELETE /api/v1/projects/:id/purge` permanently removes only a
  deleted local recovery point after `confirm: "purge"`; it rejects active
  projects, defaults to a 7-day purge delay, accepts explicit `--force` admin
  purge, requires a deleted-project receipt for agent callers, removes
  project-scoped sessions/messages/room rows/asset refs and the canonical Loro
  replica, clears project ownership from retained immutable asset rows, and
  leaves retained asset blobs/rows for asset GC.
- CLI `clash project purge <projectId> --yes --if-match <readToken>` exposes the
  same deleted-project receipt flow; `--force` is the explicit delayed-purge
  override.
- Covered by `packages/cli/src/lib/destructive-guardrails.test.ts`.
- Recoverable project deletion is covered by `apps/local-api/src/app.test.ts`
  and SQLite persistence coverage in
  `apps/local-api/src/local-metadata-store.test.ts`.
- Referenced-node deletion is covered by
  `packages/cli/src/lib/canvas-update-guardrails.test.ts`.

Remaining gap:

- Cloud/shared-project delete recovery semantics are not specified.
- Cloud/shared-project purge parity and conflict recovery remain unspecified.

### P1-05: Agent workspace migration

Scope:

- `packages/clash-bridge/src/lib/session-cwd.ts`
- generated `AGENTS.md`
- project/workspace path docs

Implementation:

- Keep alpha cwd at project root if necessary.
- Add option or migration path to session/workspace draft cwd.
- Ensure workspace contains project marker.
- Keep project replica internal.

Acceptance:

- Agent sessions do not create new snapshots.
- Workspace deletion does not delete project state.
- Project status can identify current workspace and project store.

Current status:

- `CLASH_HOME` provides a first-pass isolated Clash root for CLI
  project/status/config/action/cache/socket/host paths, bridge project cwd and
  action host paths, and local-api default data/run dirs.
- `CLASH_LOCAL_DATA_DIR` still takes precedence for local-api.

Minimum tests:

- ensure cwd creates marker,
- workspace points to project,
- deleting workspace leaves project store,
- no per-session snapshot.

### P1-06: Black-box agent E2E harness

Scope:

- E2E runner using a real agent-style CLI invocation.
- Schema-defined artifacts.

Spec:

- `agent-first-local-v1-blackbox-e2e-spec.md`
- `docs/schemas/agent-first-local-v1-e2e-result.schema.json`

Implementation:

- Create and extend test prompts for:
  - project creation,
  - restoration,
  - text projection edit,
  - storyboard/script generation,
  - image/video node creation,
  - timeline edit,
  - stale apply conflict.
- Require structured JSON output from the testing agent.
- Validate app state through public commands/APIs.

Current status:

- `apps/desktop/e2e/qa-agent-codex.mjs` invokes `codex exec` with a schema
  output contract and artifact paths.
- `apps/desktop/e2e/short-drama-timeline-smoke.mjs` creates and restores a
  deterministic short-drama timeline artifact.
- `apps/desktop/e2e/agent-first-cas-smoke.mjs` runs public CLI projection
  commands, daemon direct-canvas commands, and public `clash canvas
  get/update/delete` commands through a daemon socket, then writes a
  deterministic CAS report covering missing read proof, stale read proof,
  wrong-file lock rejection, direct canvas read-token rejection/acceptance, and
  prompt-pack COW source preservation.
- The QA agent prompt now requires the CAS smoke command, and
  `qa-agent-report.schema.json` requires `cas.*` evidence to be true.
- The harness is not yet a complete product fixture suite; it still needs
  routine real-desktop runs and assertions for text projection/CAS conflicts
  inside a live project.

Acceptance:

- Harness fails when the app does not move.
- Harness checks paths for new project/session/restore flows.
- Harness checks timeline/text projection locks and includes deterministic
  CAS smoke evidence for missing/stale/wrong-file read proofs plus direct
  canvas read-token enforcement.
- Results are machine-readable.

Minimum schema:

```json
{
  "projectId": "string",
  "projectStore": "string",
  "workspaceCwd": "string",
  "createdFiles": ["string"],
  "commandsRun": ["string"],
  "assertions": [
    { "name": "string", "pass": true, "evidence": "string" }
  ]
}
```

### P1-07: Secret and local config storage hardening

Scope:

- `packages/cli/src/lib/config.ts`
- `packages/cli/src/commands/auth.ts`
- local provider/OAuth storage after SQLite migration

Implementation:

- Stop treating credential-bearing JSON files as agent-editable config.
- If `${CLASH_HOME:-~/.clash}/config.json` remains, write it with strict file
  permissions.
- Prefer OS keychain or a local token store for API keys.
- Keep provider credentials/OAuth encrypted in SQLite or keychain-backed
  storage.
- Ensure projection/draft commands never expose credential-bearing files.

Acceptance:

- CLI token file, if present, is not world/group readable.
- `clash auth status` does not print full secrets.
- Provider/OAuth public DTOs expose status/configuration only, not raw secrets.
- Docs and generated agent instructions do not tell agents to edit credential
  files directly.

Minimum tests:

- config file permission test where supported,
- auth status redaction test,
- provider DTO no-secret regression,
- projection no-secret regression.

## P2 Work

### P2-01: Explicit project modes

Modes:

- Local-only
- Synced
- Shared

Acceptance:

- UI and CLI show correct mode.
- Local-only is not web-openable.
- Synced means canvas, room, and required asset metadata have a real sync path.
- Shared means cloud ProjectRoom sequencing and permissions are active.

### P2-02: Project export/import

Acceptance:

- Export contains enough project rows, asset refs, and Loro state to restore.
- Export does not include raw provider secrets unless explicitly requested and
  encrypted.
- Import creates a new local project id unless user explicitly links/overwrites.

## Dependencies

Critical path:

```text
SQLite store
  -> local room persistence
  -> project mode/status

Projection CAS library
  -> text projection
  -> storyboard/script projection
  -> black-box agent E2E

Storage layout guardrails
  -> asset links
  -> doctor storage
  -> workspace migration
```

Do not implement text projection without CAS.
Do not implement asset editing without copy-on-write.
Do not expose local room as cloud-synced until the sync boundary is real.

## Done Criteria For v1 Local/Agent-First

v1 local/agent-first is credible when:

- local desktop can create, reopen, and mutate a project without cloud,
- local-api survives restart with SQLite state intact,
- one project has one local Loro replica per machine,
- cwd can reference project state without owning a snapshot,
- timeline and text can be edited through normal files and applied with CAS,
- text/assets feeding materialized downstream state are copy-on-write,
- local custom actions use local runtime auth, not action secrets,
- local room messages are persisted locally,
- cloud-only vars and room sync are not presented as local defaults,
- black-box agent E2E covers project creation, restoration, projection edit,
  stale conflict, generation, and timeline edit.
