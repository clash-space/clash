# Agent-First Local v1 Black-Box E2E Spec

Last updated: 2026-07-08

## Purpose

Define a black-box QA harness that uses an agent to test Clash like a user or
spawned local agent would:

- create or restore projects,
- verify project/cwd/global storage paths,
- edit projected files,
- apply with CAS,
- exercise text/storyboard/timeline workflows,
- report machine-readable evidence.

This is not a unit test replacement. It is a product-level smoke and regression
test for whether the local/agent-first surface actually moves.

## Runner

Use Codex CLI non-interactively:

```bash
codex exec \
  --cd /Users/xiaoyang/Proj/clash-space/clash \
  --sandbox workspace-write \
  --add-dir "$HOME/.clash" \
  --ask-for-approval never \
  --output-schema docs/schemas/agent-first-local-v1-e2e-result.schema.json \
  --output-last-message artifacts/e2e/agent-first-local-v1/<runId>/result.json \
  --json \
  - < artifacts/e2e/agent-first-local-v1/<runId>/prompt.md
```

Notes:

- `codex -p` is profile selection in current Codex CLI. Use `codex exec` for
  non-interactive prompt execution.
- Use `--add-dir "$HOME/.clash"` because the test must inspect managed local
  project state.
- Prefer `workspace-write` plus explicit `--add-dir` over unconstrained access.
- Use `--sandbox danger-full-access` only for a manually supervised run that
  needs to start desktop services outside the allowed directories.

## Artifact Layout

Each run writes:

```text
artifacts/e2e/agent-first-local-v1/<runId>/
  prompt.md
  result.json
  events.jsonl
  screenshots/
  files/
  logs/
```

`runId` format:

```text
YYYYMMDD-HHMMSS-<short-name>
```

`result.json` must match:

```text
docs/schemas/agent-first-local-v1-e2e-result.schema.json
```

## Agent Rules

The QA agent must behave as a black-box tester:

- Prefer public CLI/API surfaces.
- Do not edit `snapshot.bin`.
- Do not edit SQLite directly.
- Do not edit provider credentials or secrets.
- Do not patch application code to make the test pass.
- Do not skip failed assertions silently.
- Record every command it runs.
- Store created scratch files under the run artifact directory unless a product
  command creates them elsewhere.

Allowed inspection:

- `clash project status --json`
- `clash canvas list/get`
- `clash timeline pull/apply`
- `clash text pull/apply`
- local-api public endpoints
- filesystem `ls/stat/readlink/shasum` for path verification
- app screenshots where needed

Forbidden as pass criteria:

- reading/writing `snapshot.bin` as a product format,
- reading legacy `db.json` as authoritative product state,
- editing `db.json` or `local.sqlite`,
- asserting only that a command printed success without checking product state,
- using mocks when the case is marked black-box.

## Prompt Template

Use a prompt with this shape:

```markdown
# Role

You are a black-box QA agent for Clash local/agent-first v1.

# Repo

/Users/xiaoyang/Proj/clash-space/clash

# Artifact Directory

artifacts/e2e/agent-first-local-v1/<runId>

# Required Output

Return only JSON matching:
docs/schemas/agent-first-local-v1-e2e-result.schema.json

# Rules

- Use public Clash CLI/API surfaces.
- Do not edit snapshot.bin, local.sqlite, db.json, or app source code.
- Record every command with cwd, exit code, and concise output excerpts.
- If a product surface is missing, mark the assertion failed or skipped with a
  precise reason.

# Scenario

<one of the suites below>
```

## Suites

### Suite A: Project Path Creation

Goal:

- Verify a new project creates one canonical local project store.
- Verify cwd contains only a marker/draft surface.
- Verify no per-session snapshot is created.

Assertions:

- project id is resolved by CLI,
- project store path is under `~/.clash/projects/<encodedProjectId>`,
- cwd marker points at the same project id,
- Loro snapshot/update log path is under the canonical project store or
  documented local-api project store,
- no second `snapshot.bin` appears under the user cwd,
- draft/projection roots are discoverable or clearly missing as a current gap.

### Suite B: Project Restore

Goal:

- Verify an existing project opens/restores without creating a new replica.

Assertions:

- reopened project id matches original,
- snapshot/update log is reused,
- project marker still resolves,
- session metadata survives local-api restart once SQLite migration lands,
- created asset refs still resolve.

### Suite C: Timeline CAS

Goal:

- Verify timeline projection protects against stale writes.

Assertions:

- pull writes timeline YAML,
- pull writes lock,
- apply succeeds with fresh lock,
- concurrent canvas edit changes timeline hash,
- stale apply fails,
- force apply succeeds only when explicitly requested and is reported as
  forced.

### Suite C2: Agent-First CAS Smoke

Goal:

- Verify public CLI projection writes reject missing, stale, wrong-file, or
  outside-cwd read/apply paths.
- Verify direct agent canvas mutations require a fresh read-token before write.
- Verify COW replacement does not overwrite existing downstream-facing
  projections.

Current deterministic smoke:

```bash
pnpm --filter @master-clash/desktop test:e2e:agent-first-cas
```

Assertions:

- storyboard prompt-pack apply without a lock is rejected,
- storyboard prompt-pack stale apply is rejected,
- storyboard prompt-pack apply is rejected when the source storyboard action
  changed after projection,
- review gate approval with a copied-file lock is rejected,
- direct canvas update without a read-token is rejected,
- direct canvas update with a stale read-token is rejected after a concurrent
  edit,
- direct canvas update with a fresh read-token is accepted,
- accepted direct canvas updates include a host mutation envelope with the
  expected/before/after read tokens,
- direct canvas delete without a read-token is rejected,
- public `clash canvas get/update/delete` commands enforce the same read-token
  behavior and mutation envelope through a daemon socket,
- public `clash text pull`, `clash text apply --force`, `clash timeline pull`,
  and `clash timeline apply --force` reject projection files outside the
  current cwd,
- public text/timeline projection commands reject symlinked projection parents
  that resolve outside the current cwd,
- public text/timeline projection commands reject symlinked lock sidecars that
  resolve outside the current cwd,
- public `clash text apply` registers an applied revision with the host text
  revision index, and `clash text history` reads that same host index without
  direct SQLite access,
- public `clash timeline apply` registers an applied revision with the host
  timeline revision index, and `clash timeline history` reads that same host
  index without direct SQLite access,
- public storyboard prompt-pack production projection rejects symlinked lock
  sidecars that resolve outside the current cwd,
- public review gate planning rejects symlinked lock sidecars that resolve
  outside the current cwd,
- public pipeline validation rejects symlinked QA report outputs that resolve
  outside the current cwd,
- public reference-role action planning rejects symlinked action outputs that
  resolve outside the current cwd,
- public caption sidecar export rejects symlinked caption outputs that resolve
  outside the current cwd,
- public timeline handoff export rejects symlinked CSV and provenance manifest
  outputs that resolve outside the current cwd,
- local-api asset blob upload and `/assets/*` reads reject symlinked storage
  roots or parents that resolve outside local asset storage,
- local workflow generated asset writes accept agent generation with sanitized
  audit evidence and reject symlinked `generated/` parents that resolve outside
  local asset storage,
- storyboard prompt-pack COW replacement writes a versioned projection while
  the managed projection remains unchanged.

Latest deterministic report:

```text
.tmp/agent-first-cas/2026-07-09T02-41-08-674Z/agent-first-cas-report.json
```

Result:

- `status: pass`
- 56 checks passed,
- `projectionPathOutsideCwdRejected: true`.
- `textHistoryReadsHostRevisionIndex: true`.
- `textRevisionContentStorageContract: true` with `content.stored: true`.
- `textContentRestoresHostRevisionBody: true`.
- `timelineHistoryReadsHostRevisionIndex: true`.
- `timelineRevisionContentStorageContract: true` with `content.stored: true`.
- `timelineContentRestoresHostRevisionBody: true`.
- `captionExportTimelineRevisionPinned: true`,
  `timelineHandoffExportTimelineRevisionPinned: true`, and
  `captionBurnExportTimelineRevisionPinned: true`, proving caption/handoff
  manifests plus caption-burn package, ffmpeg plan, and derived asset metadata
  point at the applied timeline revision id.

### Suite C3: Local API Receipt CAS Smoke

Goal:

- Verify local sync/audio/runtime/provider config, asset metadata, project
  membership, and local session writes use the same read-before-write receipt
  contract as canvas/text/timeline paths.
- Verify a matching bare CAS token is not enough for agent writes when the
  host requires proof that the agent actually read the entity.

Current deterministic smoke:

```bash
pnpm --filter @master-clash/desktop test:e2e:asset-receipts
```

Direct runner equivalent:

```bash
./node_modules/.bin/tsx apps/desktop/e2e/agent-first-asset-receipt-smoke.mjs
```

Assertions:

- `clash asset get`/`GET /api/v1/assets/:id` returns a receipt-bearing asset
  read token,
- `clash asset cover set`/`PATCH /api/v1/assets/:id/cover` rejects missing
  read proof for agent writes,
- cover update rejects a bare CAS token even when the hash matches,
- cover update accepts a host-issued receipt token, records a mutation envelope,
  and writes sanitized local mutation audit evidence,
- cover update rejects a stale receipt after a concurrent host-state change,
- asset create and cover update reject storage keys that escape local asset
  storage before those keys can persist in SQLite,
- `GET /api/v1/local/sync` returns a receipt-bearing local-config token,
- agent `PATCH /api/v1/local/sync` rejects missing, bare, and stale local-config
  tokens before changing the local/cloud sync boundary,
- sync config update accepts a host-issued receipt token while ordinary
  non-agent UI writes remain compatible,
- `GET /api/v1/local/audio` returns a receipt-bearing local-config token,
- agent `PATCH /api/v1/local/audio` rejects missing, bare, and stale
  local-config tokens before changing local ASR settings,
- audio config update accepts a host-issued receipt token while ordinary
  non-agent UI writes remain compatible,
- `GET /api/v1/local/harnesses` returns a receipt-bearing local-config token
  derived from the stable harness enablement view,
- agent `PUT /api/v1/local/harnesses` rejects missing, bare, and stale
  local-config tokens before changing which local agent harnesses are enabled,
- `GET /api/v1/local/agent-servers` returns a receipt-bearing local-config token
  for custom agent server definitions,
- agent `PUT /api/v1/local/agent-servers` rejects missing, bare, and stale
  local-config tokens before changing custom agent server definitions,
- harness install/upgrade/authenticate remain explicit local runtime actions,
  not read-edit-write config applies in v1,
- `GET /api/v1/model-providers` returns a receipt-bearing provider-accounts
  collection token and receipt-bearing provider-account tokens,
- agent `PATCH /api/v1/model-providers` rejects missing, bare, and stale
  provider-accounts tokens before changing local provider account settings,
- provider account update accepts a host-issued collection receipt token while
  ordinary non-agent UI writes remain compatible,
- agent `DELETE /api/v1/model-providers/:accountId` rejects missing, bare, and
  stale provider-account tokens before deleting local provider account/OAuth
  rows,
- provider account delete accepts a host-issued account receipt token and the
  account no longer appears afterward,
- `GET /api/v1/provider-oauth` returns receipt-bearing provider-oauth tokens
  for local OAuth authorization rows,
- agent `DELETE /api/v1/provider-oauth/:providerId` rejects missing, bare, and
  stale provider-oauth tokens before deleting local OAuth token rows,
- provider OAuth start/complete remain explicit external authorization actions;
  only destructive deletion is modeled as read-before-write CAS in v1,
- provider OAuth delete accepts a host-issued OAuth receipt token and the row no
  longer appears afterward,
- `clash asset ref get`/`GET /api/v1/assets/:id/ref?projectId=...` returns a
  receipt-bearing relation token,
- `clash asset ref delete`/`DELETE /api/v1/assets/:id/ref?projectId=...`
  rejects missing and bare relation tokens,
- ref delete accepts a host-issued receipt token and the relation no longer
  reads afterward,
- `GET /api/v1/sessions?projectId=...` returns receipt-bearing session read
  tokens,
- agent `DELETE /api/v1/sessions?threadId=...` rejects missing and bare session
  tokens,
- session delete accepts a host-issued receipt token while ordinary non-agent UI
  deletes remain compatible.

### Suite C4: Storage Doctor Repair Smoke

Goal:

- Verify project storage repair is a public host/CLI action, not an agent
  editing canonical files by hand.
- Verify `doctor storage --repair` initializes agent workspace roots and local
  SQLite reference-index schema while preserving the workspace/canonical
  replica split.

Current deterministic smoke:

```bash
pnpm --filter @master-clash/desktop test:e2e:storage-doctor-repair
```

Direct runner equivalent:

```bash
node apps/desktop/e2e/storage-doctor-repair-smoke.mjs
```

Assertions:

- `clash init --project ... --json` writes a project marker in the test
  workspace,
- `clash doctor storage --json` reports missing workspace/schema prerequisites
  before repair,
- `clash doctor storage --repair --json` reports explicit repair actions,
- editable roots exist for drafts, projections, sessions, and asset links,
- protected runtime root exists but remains protected,
- local SQLite exists and reports the core metadata, provider auth table/key,
  and projection schema as ready,
- project status collaboration mode is `local-only`, not web-openable, not
  multi-user, and does not claim cloud ProjectRoom sequencing,
- local project action gates deny `openInWeb`/`shareProject` with
  `project-is-local-only`, allow `enableSync`, and keep local agent execution
  tied to `owner-machine-online`,
- local project sync policy keeps cloud admission disabled, treats
  text/timeline revision content as non-media revision content, and keeps raw
  agent traces plus local runtime secrets local-only by default,
- project status identifies the current cwd/marker root as a reference
  workspace, reports stable `markerWorkspaceId`,
  `deletionDeletesProjectState: false`, and keeps canonical state ownership
  false for the reference workspace,
- after the original marker workspace is deleted, `clash project status
  --project ... --json` from a detached cwd still resolves the same
  `projectWorkspaceRoot` and local SQLite path,
- canonical Loro snapshot path is protected and outside the editable project
  workspace root,
- a `cloud-sync` marker keeps `openInWeb`/`shareProject` denied with
  `cloud-sync-not-ready` until canvas, room, asset metadata, and revision
  content mirrors are ready,
- cloud-sync sync policy names the required mirrors and admits ready
  `cloud-sync` projects as `ready-local-with-cloud-mirror`, not as cloud
  sequencer authority,
- a follow-up read-only `doctor storage --json` reports repaired prerequisites
  as ok.

### Suite C5: Web UI Host Mutation Event Smoke

Goal:

- Verify browser/runtime canvas mutation records are observable outside the
  React hook layer, so desktop E2E and agent QA harnesses can inspect accepted
  and rejected Web UI writes without reading `snapshot.bin`.

Current deterministic coverage:

```bash
./node_modules/.bin/vitest run packages/web-ui/src/lib/hostMutationEvents.test.ts packages/web-ui/src/components/ProjectEditor.toolbarPrimitives.test.ts
npm --prefix apps/web run test:e2e:host-mutation
npm --prefix apps/web run test:e2e
```

Assertions:

- `ProjectEditor` wires `useLoroSync.onMutation` into
  `dispatchHostMutationEvent(project.id, mutation)`,
- `dispatchHostMutationEvent` emits `clash:host-mutation` with `{ projectId,
  mutation }`,
- the headless Chrome/CDP local-runtime smoke installs a browser listener,
  drives the real ProjectEditor through mock local runtime canvas writes, and
  observes accepted `canvas_add_node`, `canvas_update`, `canvas_delete`,
  `timeline_apply`, `canvas_add_edge`, `canvas_update_edge`, and
  `canvas_delete_edge` mutation records with matching `projectId`; node
  add/update/timeline records carry `afterReadToken`.
- the same local-runtime smoke also sends a separate runtime agent patch that
  attempts to delete an existing node without `ifMatch`; the browser-visible
  `clash:host-mutation` stream must include a rejected `canvas_delete` record
  with `beforeReadToken` and a missing-read-proof error. Nodes created and
  consumed inside the same `clash.canvas.patch` event remain allowed because
  they do not overwrite pre-existing user/project state.
- the full web E2E entry also passes after the same Vite/local-api harness
  change, covering local-runtime, GUI smoke, and ACP setup smoke through
  headless Chrome.

E2E harness note:

- `apps/web/e2e/local-runtime-smoke.mjs` starts Vite directly from the workspace
  Vite CLI and sets `CLASH_WEB_E2E_NO_CLOUDFLARE=1`; this suite talks to
  `apps/local-api`, so it does not need the Cloudflare dev plugin or its
  Node-version-sensitive loader hooks.

### Suite D: Text Projection

Goal:

- Verify text nodes are editable through Markdown projection.

Assertions:

- pull writes Markdown,
- pull writes lock,
- apply updates unreferenced text,
- stale apply fails,
- text feeding materialized downstream state triggers copy-on-write or explicit
  rejection; text feeding only action drafts remains editable,
- projection does not contain secrets.

### Suite E: Short-Drama Creative Flow

Goal:

- Test the expected agent-first creative workflow, not only tiny CRUD.

Scenario:

1. Generate N short-drama storyboard beats.
2. Create or update text/storyboard projection files.
3. Create prompt/image/video generation nodes through public commands.
4. Assemble a timeline projection.
5. Apply the timeline.
6. Verify canvas nodes, asset refs, and timeline state exist.

Assertions:

- storyboard/script files are under projection or draft roots,
- generated asset nodes have stable ids,
- timeline contains references to created asset/text nodes,
- timeline apply creates visible canvas state,
- no direct snapshot or SQLite edits were used.

### Suite F: Local/Remote Boundary

Goal:

- Verify local-only behavior does not pretend to be synced/cloud.

Assertions:

- local project reports local-only mode unless sync is enabled,
- web-openable action is hidden or blocked for local-only project,
- local vars/action-secret endpoints are unavailable,
- remote vars compatibility is not deleted from cloud-targeted CLI behavior,
- local custom action availability is tied to local runtime state.

## Result Schema

The final message must be a single JSON object matching:

```text
docs/schemas/agent-first-local-v1-e2e-result.schema.json
```

The schema intentionally requires:

- project paths, including the explicit protected runtime root,
- command evidence,
- assertion statuses,
- created files,
- product gaps,
- final summary.

This prevents passing with only a natural-language "looks good" report.

## Pass Criteria

A run can pass only when:

- The generated report matches the JSON schema.
- The primary desktop command exits 0.
- The timeline command exits 0.
- Project/session/timeline paths are recorded with evidence.
- Restored/history sessions remain attached to the same project id.
- Real Codex desktop runs build `@clash-space/bridge` before launching Electron
  so the test exercises current bridge runtime code, not stale `dist`.
- Real Codex desktop runs verify declared project workspace roots exist on disk
  in the spawned agent cwd.
- Real Codex QA reports include project status evidence proving `runtimeRoot` is
  explicit and listed under `protectedPaths`.
- No product assertion relies on editing `snapshot.bin`, `db.json`, or SQLite.
- Renderer logs do not contain React lifecycle errors such as
  `Cannot update a component while rendering a different component`.

The current implemented harness is:

```bash
node apps/desktop/e2e/qa-agent-codex.mjs
```

It writes a run under:

```text
.tmp/qa-agent-codex/<runId>/
  qa-agent-prompt.md
  qa-report.json
  stdout.jsonl
  stderr.log
  command-logs/
  screenshots/
  local-api-data/
  short-drama-timeline/
  agent-first-cas/
```

The harness uses `codex exec` with `--output-schema` and
`--output-last-message`, then validates the generated report shape. It also has
a watchdog: if a valid pass report exists but the nested Codex process does not
exit promptly, the harness stops the child and returns success.

Latest verified stub run:

```text
.tmp/qa-agent-codex/2026-07-05T06-36-57-683Z/qa-report.json
```

Result:

- `status: pass`
- desktop agent-browser command passed,
- short-drama timeline command passed,
- one local project was created,
- two DB-backed runtime sessions were created and restored through history,
- one created timeline JSON and one restored timeline JSON were recorded,
- issues list was empty.

Latest verified real Codex ACP run:

```text
.tmp/qa-agent-codex/2026-07-05T07-04-03-855Z/qa-report.json
```

Result:

- `status: pass`
- target runtime was `real-codex-acp`,
- desktop real Codex ACP command passed,
- short-drama timeline command passed,
- created project `55647743-1c58-4a8e-af4a-52fcdd69bfbf`,
- created runtime session `58286658-8c52-417d-8c39-c5794bb3664a`,
- recorded session cwd
  `/Users/xiaoyang/.clash/projects/55647743-1c58-4a8e-af4a-52fcdd69bfbf`,
- recorded direct Codex ACP runtime session `acp-1783235078122-1` with the same
  cwd,
- recorded short-drama timeline artifact
  `.tmp/qa-agent-codex/2026-07-05T07-04-03-855Z/short-drama-timeline/timeline/created/short-drama-timeline.json`,
- desktop real Codex command built `@clash-space/bridge` before launching
  Electron and reported the required project workspace layout roots,
- issues list was empty.

Latest verified real Codex ACP resume run:

```text
.tmp/real-codex-resume/
```

Result:

- `test:startup:real-codex-resume` passed,
- created project `06cb2be7-6dac-46fa-a52f-0856ba9a1ea3`,
- restored the same runtime session after Electron/local-api restart,
- the resumed Codex ACP session kept cwd
  `/Users/xiaoyang/.clash/projects/06cb2be7-6dac-46fa-a52f-0856ba9a1ea3`,
- two `pwd` tool outputs were persisted in the same session,
- screenshots captured first turn, reopened history, resumed session, and
  second turn final state.

Latest verified direct real Codex ACP layout run:

```text
.tmp/real-codex-layout/
```

Result:

- `test:startup:real-codex` passed,
- created project `36db65cd-4e36-43af-aa7f-07fe5b8a01e3`,
- created runtime session `e8da6f61-3e54-4806-9216-2a66785f42fd`,
- recorded spawned cwd
  `/Users/xiaoyang/.clash/projects/36db65cd-4e36-43af-aa7f-07fe5b8a01e3`,
- verified `drafts`, `projections/text`, `projections/timelines`,
  `assets/links`, `sessions`, and `runtime` exist in that cwd.

Latest verified direct real Codex ACP resume layout run:

```text
.tmp/real-codex-layout-resume/
```

Result:

- `test:startup:real-codex-resume` passed,
- created project `8fe54e27-ae8c-4af0-9231-c5690282c50c`,
- restored the same runtime session after Electron/local-api restart,
- recorded resumed spawned cwd
  `/Users/xiaoyang/.clash/projects/8fe54e27-ae8c-4af0-9231-c5690282c50c`,
- verified the same workspace roots before and after restore.

Latest verified asset receipt CAS smoke:

```text
.tmp/agent-first-asset-receipts/2026-07-08T15-41-03-104Z/agent-first-asset-receipt-report.json
```

Result:

- `status: pass`,
- 192 checks passed through `npm --prefix apps/desktop run test:e2e:asset-receipts`,
- derived agent reads stayed read-only, provider model tests and local audio
  transcription actions recorded host mutation envelopes, and local sync, audio,
  harness, custom agent-server, provider account, provider OAuth, asset
  upload/read symlinked-root/parent rejection plus workflow-generated asset
  acceptance, sanitized audit evidence, and symlinked-parent rejection,
  workflow-generated text host revision indexing, immutable content endpoint body
  retrieval, and sanitized audit evidence,
  metadata/ref/GC, project delete/restore/purge, and session delete agent writes
  rejected missing or bare read proofs; asset create/cover rejected invalid
  storage keys before metadata persistence; accepted sync config updates, audio
  config updates, audio installs, harness enablement/install/upgrade/authenticate/uninstall, custom agent-server
  updates, provider account updates, provider OAuth start/complete, and asset
  cover updates and generic asset blob uploads write sanitized local mutation audit
  evidence; the same run also proved the restore
  path's sanitized audit evidence, v1/legacy project create audit evidence,
  legacy project update/delete audit evidence, session create audit evidence,
  local room message create audit evidence,
  project purge's default delayed purge window,
  explicit force override, deleted recovery point removal,
  canonical project replica deletion, and sanitized local mutation audit
  evidence without reusable read receipts; runtime session create/attach now
  write sanitized local mutation audit evidence without reusable read receipts; local-api canvas node update/delete
  now requires receipt-bearing node reads, rejects downstream text content patch,
  local-api canvas batch delete now requires a graph-aware delete-plan receipt,
  rejects orphaning external references and bare CAS tokens, and writes sanitized
  audit evidence; accepted room sync mirrors local/remote room messages through
  the explicit action and writes sanitized local mutation audit evidence; room
  sync conflict recovery exposes local/remote hashes, rejects stale hash
  resolution, accepts inspected divergence, preserves local text on later sync,
  and writes sanitized mutation audit evidence;
  session create/delete, runtime session create/attach, local room message create, local sync config update, local audio config update/install, local harness enablement/install/upgrade/authenticate/uninstall, local agent-server config update, provider account
  update/delete, provider OAuth start/complete/delete, asset-ref delete, asset GC delete, and local-api canvas edge delete also write sanitized local mutation audit
  evidence after accepted agent writes,
- stale provider, OAuth, asset GC, project restore, and session receipts were
  rejected,
- fresh host-issued receipts were accepted and reported mutation envelopes,
- restored project status preserved the local storage path contract,
- room sync checked project existence before remote admission, local-only room
  sync returned a machine-readable admission gate requiring `enable-sync`, and
  conflict recovery preserved local divergence without overwriting either side.

Latest verified storage doctor repair smoke:

```text
.tmp/storage-doctor-repair/2026-07-09T02-53-42-505Z/storage-doctor-repair-report.json
```

Result:

- `status: pass`,
- 86 checks passed,
- `clash init`, `clash doctor storage --json`,
  failing `clash doctor storage --json` with a parseable JSON report,
  `clash doctor storage --repair --json`,
  `clash doctor storage-recovery list --json`,
  successful and rejected
  `clash doctor storage-recovery compare --manifest ... --json` calls, and
  follow-up read-only doctor commands produced the expected exit codes,
- workspace roots and local SQLite core metadata tables, provider auth
  tables/primary keys, plus asset/text/timeline projection indexes were
  repaired through public CLI commands,
- legacy `.clash/project.json` was reported as ignored old-layout evidence
  while the v1 `.clash/project.toml` marker remained the actual project
  context,
- a hash-valid writable text revision blob was repaired back to read-only
  permissions through the public `doctor storage --repair --json` path,
- doctor detected a cwd secondary canvas replica before repair, then
  quarantined it under host-owned runtime recovery while preserving bytes,
- repair wrote a durable recovery manifest and follow-up doctor reported that
  recovery inventory,
- recovery list exposed quarantined manifest inventory without import,
- recovery compare reported quarantined file evidence against the canonical
  path/state, emitted a restore read token, and kept
  `safeToImportAutomatically: false`,
- recovery restore required explicit `--yes` confirmation plus
  `--if-match <readToken>`, promoted quarantined snapshot/update-log bytes into
  the protected canonical replica through public CLI, and rejected stale tokens
  before overwriting canonical bytes,
- recovery restore wrote a durable local `restore-receipt.json` under the
  recovery set's `canonical-before-restore/` directory with project id,
  manifest path, expected/before/after read tokens, restored file evidence, and
  post-restore canonical hashes,
- recovery list after restore exposed the prior restore receipt summary without
  requiring agents to discover the protected receipt path directly,
- recovery compare rejected a valid-looking manifest outside the current
  project's protected recovery root,
- recovery list and doctor storage reported invalid manifest inventory instead
  of treating out-of-set recovery paths as valid sets,
- doctor reported no secondary canvas replica after repair,
- project status reported `collaboration.mode: local-only`,
  `webOpenable: false`, `multiUser: false`, and no cloud ProjectRoom
  sequencing,
- local action gates reported `openInWeb.allowed: false`,
  `shareProject.allowed: false`, `enableSync.allowed: true`, and
  `runLocalAgent.allowed: true`,
- local sync policy reported `cloudAdmission:
  disabled-until-enable-sync`, revision content as non-media, non-agent-writable
  `text_revisions`/`timeline_revisions`, and raw traces/runtime secrets as
  local-only,
- project status exposed `currentWorkspace` for the actual cwd/marker root,
  marked it as a `project-reference-workspace`, surfaced `markerWorkspaceId`,
  and reported that deleting that workspace does not delete project state,
- after deleting the original marker workspace, explicit project status from a
  detached cwd still found the canonical project store and SQLite state,
- a `cloud-sync` marker stayed `syncReadiness.status: pending`,
  `webOpenable: false`, and `roomAuthority: local` until the full sync
  capabilities are ready,
- cloud-sync pending action gates reported `cloud-sync-not-ready` for web and
  sharing admission with `canvas`, `room`, `asset-metadata`, and
  `revision-content` requirements,
- cloud-sync pending sync policy named canvas, room, asset metadata, and
  revision content mirrors while keeping media blob bytes outside the asset
  metadata mirror,
- a separate cwd marker for the same project with `[sync.capabilities]`
  declaring canvas, room, asset metadata, and revision content ready changed
  project status to `syncReadiness.status: ready`, `webOpenable: true`, and
  `roomAuthority: local-with-cloud-mirror` while keeping
  `multiUser: false` and local agent execution allowed,
- cloud-sync ready sync policy reported `cloudAdmission:
  ready-local-with-cloud-mirror`, so Web/share admission does not imply shared
  cloud-sequencer authority,
- cloud-sync recovery list exposed `recoveryPolicy` showing recovery is a local
  replica promotion, does not include or mutate cloud state, and requires cloud
  conflict review,
- shared recovery compare remained available for evidence, but reported
  `cloud-sequencer` authority and `localRestoreAllowed: false`; public CLI
  restore with the shared compare read token was rejected before overwrite,
- canonical Loro snapshot path remained protected and outside the editable
  workspace root,
- text/timeline revision content blob roots were exposed through
  `storage.canonicalReplica.contentBlobs`, marked immutable/non-agent-writable,
  included in `protectedPaths`, and kept outside the editable workspace root,
- local secret files were exposed through `storage.localSecrets` as protected
  local-only storage rather than agent-editable projections,
- `storage.contentModel` separated text/timeline projection files from non-media
  host-indexed revision blobs and confirmed text/timeline bodies are not media
  asset rows, while pinning the explicit `restore`, `history`, and `content`
  CLI commands agents use to recover/read revisions,
- doctor rejected tampered/writable text and timeline revision blobs with a
  parseable JSON report that identified `text-revision-blob-integrity` and
  `timeline-revision-blob-integrity` failures.

Target boundary:

- The default target is `stub-acp`. It verifies UI/session storage paths and
  local project path stability.
- `CLASH_QA_AGENT_TARGET=real-codex-acp` verifies spawned real-agent cwd
  behavior. The harness now rejects a pass report for this target unless at
  least one session observation includes a `cwdPath` under `/.clash/projects/`.

A suite passes only when:

- all required assertions are `pass`,
- every command used to support the pass is recorded,
- created paths are absolute,
- result JSON validates,
- the agent did not use forbidden internals.

A suite may return `skip` only when the product surface is not implemented yet.
Skips must name the missing command/API and should map to the implementation
plan.

## CI/Local Modes

Local manual mode:

```bash
RUN_ID="$(date +%Y%m%d-%H%M%S)-timeline-cas"
mkdir -p "artifacts/e2e/agent-first-local-v1/$RUN_ID"
$EDITOR "artifacts/e2e/agent-first-local-v1/$RUN_ID/prompt.md"
codex exec --cd "$PWD" \
  --sandbox workspace-write \
  --add-dir "$HOME/.clash" \
  --ask-for-approval never \
  --output-schema docs/schemas/agent-first-local-v1-e2e-result.schema.json \
  --output-last-message "artifacts/e2e/agent-first-local-v1/$RUN_ID/result.json" \
  --json \
  - < "artifacts/e2e/agent-first-local-v1/$RUN_ID/prompt.md" \
  > "artifacts/e2e/agent-first-local-v1/$RUN_ID/events.jsonl"
```

CI mode should use a temporary Clash home:

```bash
CLASH_HOME="$(mktemp -d)"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
```

and pass that home through the local-api/CLI configuration once Clash supports
an explicit home override.

Current status:

- `CLASH_HOME` is supported by CLI project status/doctor/config paths, bridge
  project cwd creation, and local-api default data dir.
- `CLASH_LOCAL_DATA_DIR` still takes precedence for local-api.

## Open Implementation Gaps

- `clash project status --json` now has first-pass stable fields for project
  workspace, current cwd/marker reference workspace, projection root, draft
  root, explicit runtime root, local SQLite path, protected paths, and sync
  mode.
- Black-box storage/project smokes now assert these fields against initialized,
  restored, and deleted-marker-workspace local project paths; broader UI release
  gates still need to carry the same evidence.
- `clash doctor storage --json` now has first-pass read-only path checks, and
  `clash doctor storage --repair` can initialize missing workspace roots plus
  the local SQLite core metadata, provider auth table/key, and projection
  schema.
- Direct real Codex E2E now asserts the happy-path workspace roots. Storage
  doctor smoke asserts secondary replica/recovery behavior through public CLI,
  while focused CLI tests cover protected cwd plus legacy `db.json`/schema
  warnings.
- Local room endpoints now exist as a SQLite local-only baseline, and
  `apps/local-api/src/room-cli.e2e.test.ts` starts a real local-api HTTP server
  while driving `clash room say/read/sync/resolve-conflict --json` through a
  spawned CLI process, including denied local-only sync with parseable stdout
  admission evidence, remote/local conflict hash inspection, stale-hash
  rejection, explicit divergence recovery persistence, and later sync
  continuation without overwriting local text. `GroupChatPanel` also exposes
  first-pass conflict id/hash/CLI recovery details from that sync plan and
  gates its Sync room action when `sync.admission.allowed=false`. Remaining
  work is remote sync loop wiring beyond the UI admission gate, fuller
  local/remote recovery workflow, and broader live UI parity.
- `apps/desktop/e2e/agent-first-cas-smoke.mjs` now covers public CLI
  read-proof rejection for missing/stale/wrong-file locks, text/timeline
  outside-cwd and symlink-outside-cwd projection path rejection including
  forced apply, text/timeline/storyboard prompt-pack/review-gate symlinked
  lock-sidecar rejection, pipeline validation symlinked QA report rejection,
  reference-role symlinked action-plan rejection, caption sidecar export
  symlinked output rejection, text-cut media export source-action provenance
  in the CLI result/ffmpeg plan/package/asset metadata, and text-cut media
  export rejection for symlinked source actions outside cwd,
  daemon direct canvas read-token
  rejection/acceptance, public
  `clash canvas get/update/delete` read-token and mutation-envelope enforcement
  through a daemon socket, and prompt-pack COW preservation; QA agent reports
  must include `cas.*` evidence from that smoke.
- `apps/desktop/e2e/agent-first-asset-receipt-smoke.mjs` now covers
  `local sync get -> local sync patch`, `local audio get -> local audio patch`,
  `asset get -> asset cover set`, `asset ref get -> asset ref delete`, and
  `session list -> session delete` receipt enforcement against missing, bare,
  stale, and accepted tokens where each entity supports the state transition,
  plus local-api canvas node read/update/delete receipt enforcement,
  downstream text content patch rejection, local-api canvas batch delete
  plan/apply receipt enforcement, external orphan rejection, local-api canvas edge list/delete
  receipt enforcement, and sanitized audit evidence for accepted v1/legacy
  project create, legacy project update, asset create, asset import, custom
  action checkpoint upload, asset cover updates, asset reference refresh, asset
  GC, session creation/deletion, node update/delete, batch deletion, and edge deletion;
  broader live UI asset/session/settings editing still needs product fixture
  coverage.
- `clash text pull/apply/replace` exists, and web canvas text/timeline nodes now
  show first-pass read-only revision history panels through `useRevisionHistory`,
  including explicit CLI content recovery commands and `clash text/timeline
  restore --mode replace` COW commands. `agent-first-cas-smoke` now gates both
  text and timeline restore commands as host-content-backed COW actions. Suite
  D still needs optional direct visual restore affordances beyond the
  deterministic command smoke and read-only panel.
- Short-drama/storyboard prompt-pack and timeline projection commands exist;
  Suite E still needs a fuller canvas/asset/provider fixture beyond timeline
  JSON creation/restore.
- Need broader storage doctor coverage for richer migration/recovery UX,
  stronger path assertions across old layouts, and destructive repair
  boundaries.
