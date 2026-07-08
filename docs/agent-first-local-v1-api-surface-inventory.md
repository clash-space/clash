# Agent-First Local v1 API Surface Inventory

Last updated: 2026-07-08

## Purpose

Inventory the current local API, cloud API, and CLI surfaces that matter for
the v1 local/agent-first architecture.

This is not a full API reference. It is a gap map for product architecture.

## Local API Surface

Authoritative file:

- `apps/local-api/src/app.ts`

### Local product metadata routes

Current routes:

- `GET /api/v1/projects`
- `POST /api/v1/projects`
- `GET /api/v1/projects/:id`
- `DELETE /api/v1/projects/:id`
- legacy-compatible `/api/projects`
- legacy-compatible `/api/projects/:id`
- `GET /api/v1/sessions`
- `POST /api/v1/sessions`
- `DELETE /api/v1/sessions`
- `GET /api/v1/local-sessions/:sessionId/messages`
- `POST /api/v1/local-sessions/:sessionId/_attach`

Current storage:

- local SQLite via `apps/local-api/src/local-metadata-store.ts`.
- local metadata/provider schema bootstraps upgrade old partial
  core/provider/projection SQLite tables before route reads or writes.
- legacy `db.json` is ignored; SQLite starts empty until first local write.
- `POST /api/v1/sessions` and `DELETE /api/v1/sessions` now include
  accepted/rejected host mutation records. Session create keeps
  `threadId`/`title`; session delete returns JSON `{ ok: true, mutation }`.

v1 decision:

- keep route identity and existing creation/list DTOs,
- keep storage in local SQLite,
- split project-visible metadata from raw/private session traces.

### Local assets routes

Current routes:

- `GET /assets/sign`
- `POST /assets/sign-batch`
- `POST /api/custom-action/upload`
- `POST /upload`
- `GET /assets/*`
- `POST /api/v1/assets`
- `GET /api/v1/assets/:id`
- `GET /api/v1/assets/:id/references`
- `POST /api/v1/assets/:id/references/refresh`
- `POST /api/v1/assets/batch`
- `DELETE /api/v1/assets/:id/ref`
- `PATCH /api/v1/assets/:id/cover`

Current storage:

- local asset files plus asset rows and project refs in `local.sqlite`.
- `POST /api/v1/assets`, `DELETE /api/v1/assets/:id/ref`,
  `PATCH /api/v1/assets/:id/cover`,
  `POST /api/v1/assets/:id/references/refresh`,
  `POST /api/custom-action/upload`, and `POST /upload`
  preserve their existing response fields and now include accepted/rejected host
  mutation records for v1 auditability. For text custom-action results, the
  mutation records the action result without writing an asset row. For binary
  custom-action results, the uploaded file is a checkpoint asset: repeating the
  same task/output id with different content is rejected before overwrite, and
  accepted uploads write sanitized local mutation audit evidence.
  Generic `/upload` records an `asset-blob` write; project-visible asset rows are
  still created through `/api/v1/assets` or `/api/v1/assets/import`.

v1 decision:

- metadata in SQLite,
- blobs in canonical local asset store,
- project refs in `asset_refs`,
- node/field refs in `asset_node_refs`, exposed through
  `GET /api/v1/assets/:id/references`, explicit
  `POST /api/v1/assets/:id/references/refresh`, and `clash asset refs`, not
  direct SQLite reads, with first-pass `referenceRole` values; refresh is a
  host-owned metadata mutation and returns a host mutation record,
- project-visible links/projections optional,
- no in-place overwrite of referenced blobs.

### Local canvas routes

Current routes:

- `GET /api/v1/projects/:projectId/canvas/nodes/:nodeId`
- `GET /api/v1/projects/:projectId/canvas/edges`
- `POST /api/v1/projects/:projectId/canvas/edges/:edgeId`
- `PATCH /api/v1/projects/:projectId/canvas/edges/:edgeId`
- `DELETE /api/v1/projects/:projectId/canvas/edges/:edgeId`

Current mutation envelope status:

- node reads return receipt-bearing node `readToken` values used by
  `/api/v1/assets/replace` media COW writes,
- edge reads return a receipt-bearing graph `readToken` plus receipt-bearing
  per-edge `readToken` values,
- agent edge `POST` requires the graph receipt before creating an edge,
- agent edge `PATCH` and `DELETE` require that edge's receipt before updating or
  deleting it,
- edge writes use the shared canvas guardrails for checkpoint lineage mutation
  and return accepted/rejected host mutation records,
- local-api node/edge/batch-delete writes and media COW replacement run through
  `FileReplicaStore.updateSnapshotAtomic`, so the route re-recovers the latest
  project Loro snapshot and validates CAS inside the per-project write queue
  before saving.

v1 decision:

- `snapshot.bin` stays internal,
- HTTP canvas writes are explicit host actions,
- agent writes must prove a prior host read with receipt-bearing CAS.

### Local provider/auth routes

Current routes:

- `GET /api/v1/model-providers`
- `PATCH /api/v1/model-providers`
- `DELETE /api/v1/model-providers/:accountId`
- `POST /api/v1/model-providers/test`
- `GET /api/v1/provider-oauth`
- `POST /api/v1/provider-oauth/:providerId/start`
- `POST /api/v1/provider-oauth/:providerId/complete`
- `DELETE /api/v1/provider-oauth/:providerId`
- `GET /api/v1/models/catalog`

Current storage:

- provider accounts/OAuth rows in `local.sqlite`.

Current mutation envelope status:

- `GET /api/v1/model-providers` returns a receipt-bearing provider-accounts
  collection `readToken` plus receipt-bearing provider-account `readToken`
  values on each public account row. These tokens bind only public provider
  config such as enabled state, model filters, credential key names, OAuth
  availability, priority/weight, and timestamps; they do not expose or hash raw
  secrets in the API response,
- `clash models providers --json` returns the full provider response, including
  the top-level collection `readToken`; agent writes can pass it through
  `clash models provider set <PROVIDER> --if-match <readToken>`,
- agent `PATCH /api/v1/model-providers` requires the top-level
  provider-accounts receipt token before changing local provider account
  settings; missing, bare, or stale tokens are rejected before SQLite writes,
- agent `DELETE /api/v1/model-providers/:accountId` requires that account's
  provider-account receipt token before deleting local provider account/OAuth
  rows; ordinary non-agent UI writes remain compatible,
- provider account `PATCH /api/v1/model-providers` and
  `DELETE /api/v1/model-providers/:accountId` preserve their read/list fields
  and add accepted/rejected host mutation records with expected/before/after
  read-token evidence where applicable,
- `POST /api/v1/model-providers/test` is a local provider action, not a provider
  account metadata write; valid tests return accepted `provider_model_test`
  host mutation records even when the test result is `ok: false`, while invalid
  request bodies return rejected mutation records,
- `GET /api/v1/provider-oauth` returns receipt-bearing provider-oauth
  `readToken` values on each public OAuth row. The token binds public OAuth
  state and update version, not raw access or refresh token material,
- provider OAuth start/complete preserve their public DTO fields and add
  accepted/rejected host mutation records. Agent start is allowed without a
  receipt only when it creates a missing row; restarting an existing row requires
  that row's receipt token before invoking the OAuth driver. Completion failures
  return HTTP 502 plus an accepted local mutation record because the row records
  `status: "error"`,
- agent `DELETE /api/v1/provider-oauth/:providerId` requires that OAuth row's
  receipt token before deleting local OAuth tokens; missing, bare, or stale
  tokens are rejected while ordinary non-agent UI deletes remain compatible.

v1 decision:

- provider account/OAuth rows stay in SQLite,
- credential/token payloads encrypted or OS-keychain backed,
- public routes never return raw secrets,
- local custom actions should use local runtime auth, not action-secret vars.

### Local runtime/agent routes

Current routes:

- `GET /api/v1/agents`
- `GET /api/v1/runtimes`
- `POST /api/v1/runtimes/:runtimeId/sessions`
- `GET /api/v1/runtimes/:runtimeId/local-sessions/scan`
- local harness and agent-server routes under `/api/v1/local/*`

v1 decision:

- runtime/session metadata in SQLite,
- raw ACP/tool traces local by default,
- local agents are user-owned runtime endpoints,
- local runtime availability must be visible in shared projects,
- `GET /api/v1/agents` is a derived read view: built-in local agents can be
  returned without persisting `agent_member` rows. Session create and room
  message write paths can still seed owned agent members inside their explicit
  mutation transactions.

Current mutation envelope status:

- runtime session create/attach success responses preserve `session_id`, add
  accepted host mutation records, and write sanitized local mutation audit
  evidence without persisting reusable read receipts. Agent attach of an existing runtime session
  requires that session's receipt-bearing `GET /api/v1/sessions?...` read token
  before invoking the local ACP attach hook; ordinary non-agent UI attach remains
  compatible,
- synchronous validation rejections return rejected host mutation records,
- `GET /api/v1/local/harnesses` returns a receipt-bearing local-config
  `readToken` derived from stable harness enablement state. Agent
  `PUT /api/v1/local/harnesses` rejects missing, bare, or stale tokens before
  changing which local agent harnesses are enabled, while ordinary non-agent UI
  writes remain compatible,
- `GET /api/v1/local/agent-servers` returns a receipt-bearing local-config
  `readToken` for custom agent server definitions. Agent
  `PUT /api/v1/local/agent-servers` rejects missing, bare, or stale tokens
  before changing custom agent server definitions,
- harness install/install-adapter/upgrade/uninstall and harness authenticate
  remain explicit local runtime actions; their responses preserve public DTO
  fields and add accepted/rejected host mutation records,
- ACP start/attach failures return JSON `503` responses with readable `error`
  text and host mutation records. Failures that write a local runtime-session
  error checkpoint are accepted local mutations; validation/no-row failures are
  rejected mutations. Web UI reads the `error` field so user-facing copy stays
  readable.

### Local config routes

Current routes:

- `GET/PATCH /api/v1/local/sync`
- `GET/PATCH /api/v1/local/audio`
- `POST /api/v1/local/audio/install`
- `POST /api/v1/local/audio/transcriptions`

Current storage:

- narrow JSON config files through local config stores.

Current mutation envelope status:

- `GET /api/v1/local/sync` returns a receipt-bearing local-config `readToken`,
  and agent `PATCH /api/v1/local/sync` writes reject missing, bare, or stale
  tokens before changing local-only/cloud-sync mode,
- `GET /api/v1/local/audio` returns a receipt-bearing local-config `readToken`,
  and agent `PATCH /api/v1/local/audio` writes reject missing, bare, or stale
  tokens before changing local ASR settings,
- `POST /api/v1/local/audio/install` preserves its public config DTO fields and
  adds accepted/rejected host mutation records,
- `POST /api/v1/local/audio/transcriptions` remains a runtime transcription
  action response, not a persistent config mutation, and now returns
  accepted/rejected host mutation records for observability.

v1 decision:

- these can remain JSON only if deliberate agent/user editing is a product
  feature,
- otherwise migrate richer settings to SQLite settings rows later,
- never mix relational product state into these config files.

### Local routes intentionally absent

Regression tests assert these are 404 locally:

- `/api/settings/variables`
- `/api/settings/action-secrets`
- `/api/v1/vars`
- `/api/v1/action-secrets`

v1 decision:

- keep local variables/action-secret endpoints unavailable,
- do not silently reintroduce local action secrets.

## Cloud API Surface

Authoritative files:

- `apps/api-cf/src/routes/v1/projects.ts`
- `apps/api-cf/src/routes/v1/vars.ts`
- `apps/api-cf/src/routes/v1/index.ts`
- `apps/web/app/lib/db/app.schema.ts`

### Cloud projects

Current routes:

- `GET /api/v1/projects`
- `POST /api/v1/projects`
- `GET /api/v1/projects/:id`
- `DELETE /api/v1/projects/:id`

v1 local/cloud decision:

- keep cloud project metadata,
- do not treat cloud project row as required for Local-only desktop project,
- Synced/Shared modes decide when cloud rows are authoritative.

### Cloud room

Current routes:

- `GET /api/v1/projects/:pid/room/messages`
- `POST /api/v1/projects/:pid/room/messages`

Current schema:

- `room_message`
- `room_sync_conflict_resolution`

v1 local/cloud decision:

- keep room as project-visible conversation,
- local should converge on the same row shape,
- room is not raw ACP trace.

### Cloud vars

Current routes:

- `PUT /api/v1/vars/:key`
- `GET /api/v1/vars`
- `DELETE /api/v1/vars/:key`

Current schema:

- `user_variable`

v1 local/cloud decision:

- keep as remote worker-action compatibility,
- do not use as local v1 auth model,
- CLI should be mode-aware so local users are not pointed to vars as default.

## CLI Surface

Authoritative files:

- `packages/cli/src/index.ts`
- `packages/cli/src/commands/*`

Registered commands:

- `auth`
- `init`
- `projects` / `project`
- `canvas`
- `tasks`
- `action`
- `vars`
- `models`
- `room`
- `doctor`
- `timeline`
- `text`
- `assets` / `asset`

### CLI surfaces aligned with v1 direction

- `project init/link/status` resolves project context with marker/env conflict
  checks.
- `doctor storage` reports path-boundary, storage-role contract, local SQLite
  core metadata/provider auth table-key/projection schema, and protected-store health without mutating
  project state.
- `canvas get/list/search` provide read-only inspection.
- `timeline pull/apply/replace` implements CAS; daemon-backed pulls preserve a
  receipt-bearing timeline read token in the lock, and daemon agent
  apply/replace rejects bare synthesized timeline CAS tokens.
- `canvas timeline pull/push` implements legacy-compatible CAS.
- `text pull/apply/replace` implements body-only Markdown projection CAS for
  text node `data.content`, preserves daemon receipt read tokens in the lock,
  rejects bare synthesized text CAS tokens for daemon agent writes, and rejects
  in-place apply when the text node has downstream canvas references.
- `production project/apply/replace-storyboard-prompt-pack` implements
  storyboard prompt-pack projection CAS with a managed prompt-pack hash plus the
  source storyboard action hash. It is still a file-only CAS path rather than a
  host-issued receipt path.
- `asset link --asset <id>` creates an agent-readable file under the project
  `assets/links/` directory through the immutable global asset cache. It is
  read-only inspection convenience, not a write/apply path.
- `doctor storage` validates `assets/links/` entries and reports broken
  symlinks, directories, or non-file entries as project storage errors.
- `action install <id>` installs local action packages under
  `${CLASH_HOME:-~/.clash}/actions` with idempotency and `--force`.

### CLI surfaces that need v1 guardrails

- `canvas update`
  - direct node patch/admin path;
  - guardrail logic lives in `@clash/shared-types` and is reused by CLI,
    daemon, and Web UI local commits;
  - now rejects `timelineDsl` and runtime actor/provenance data fields;
  - now rejects content patches to text nodes feeding materialized downstream
    state;
  - now rejects semantic patches to materialized downstream action checkpoints,
    including prompt/model/action/output/status/asset fields;
  - downstream `draft`/`idle` placeholders keep the action editable until the
    output is materialized;
  - Web UI local node deletion uses the shared referenced-delete guard;
  - Web UI local edge add/update/delete and daemon `ensure_edge` block
    checkpoint lineage input/output mutation while leaving unreferenced action
    draft and draft-placeholder pipeline edits editable;
  - still must not become a file apply path, and still needs specialized
    COW/replace commands for referenced asset/storyboard changes plus batch
    delete and force/recovery UX.

- daemon `update`
  - direct node patch;
  - shares the same first-pass guardrail helper as `canvas update`.

- `canvas delete`
  - destructive;
  - CLI now requires `--yes`;
  - CLI/daemon now reject downstream-referenced nodes unless `--force` is
    passed;
  - still needs recoverability and API-side protection.

- `projects delete`
  - destructive;
  - CLI now requires `--yes`;
  - local-api now soft-deletes projects, preserves persisted sessions/messages,
    and exposes explicit restore;
  - still needs delayed purge/admin hard-delete policy and cloud/shared-project
    recovery semantics.

- `vars`
  - cloud compatibility remains,
  - local help/copy should not advertise vars as local auth path.

- `auth login/logout`
  - writes `${CLASH_HOME:-~/.clash}/config.json` with owner-only permissions;
  - OS keychain/token store remains future hardening.

- `room say/read`
  - CLI exists,
  - local API has SQLite-backed room POST/GET,
  - local room POST returns accepted/rejected host mutation records and first-create
    sanitized audit records,
  - local room client ids are idempotent only when the normalized content
    matches; same project/id with different content is rejected, and identical
    replay does not create another audit record,
  - local room responses explicitly report `remote_room.enabled=false`,
  - `clash room read --json` preserves response-level `sync` metadata instead
    of returning only the message list,
  - CLI maps 404 to a generic missing-room-API message for older targets,
  - needs cloud sync conflict policy and deeper route parity tests.

## Mismatch Matrix

| Surface | Current mismatch | Product risk | Required fix |
| --- | --- | --- | --- |
| Local metadata | `db.json` is ignored if present | stale docs/tools may treat legacy DB as editable truth | keep ignored-legacy tests and doctor cleanup warnings |
| Local room | SQLite-backed local room POST/GET exists; POST carries accepted/rejected mutation records and POST/GET `sync.admission`; local-only room message responses expose `remote-room-not-configured` with `enable-sync`, same project/id with different content is rejected; cloud room route matches the idempotency rule; cloud-configured local reads mark explicit room sync `pending` with allowed admission; `POST /api/v1/projects/:id/room/sync` and `clash room sync` run the mirror planner, export local-only rows, import remote-only rows, write sanitized audit evidence after accepted mirror actions, and reject same-id conflicts without overwriting; conflict plans include local/remote message snapshots plus content hashes for review; `POST /api/v1/projects/:id/room/sync/conflicts/:messageId/resolve` and `clash room resolve-conflict` record hash-checked `accept-divergence` receipts so later sync can continue without overwriting either side | conflict recovery UI, broader admission controls, and live parity are not wired yet | conflict recovery UI, live room parity, admission policy |
| Vars | CLI exposes remote worker vars; local-api 404; cloud supports vars | future copy/API changes may blur local auth boundary | keep mode-aware CLI copy and local 404 tests |
| Provider auth | local provider/OAuth rows live in SQLite and sensitive credential/token payloads are encrypted before persistence; public DTOs expose configured credential names/status/read tokens rather than raw values | key-source hardening and future OS keychain migration remain local-compromise risk reducers | keep encrypted SQLite, add keychain/token-store hardening when available, and keep projection paths secret-free |
| Project status | CLI and local-api return roots/protected paths; CLI status also exposes `currentWorkspace` so the active cwd/marker root is visible as a reference workspace separate from the canonical project workspace/store, including the marker's stable `workspace_id` as `markerWorkspaceId` when present; `storage.canonicalReplica` includes SQLite metadata, Loro canvas replica, protected immutable media asset blob root, and protected content-addressed text/timeline revision blob roots; `storage.contentModel` makes text/timeline live state vs projection vs host-indexed revision content explicit and marks text/timeline revision bodies as non-media assets; `storage.localSecrets` identifies local-only `config.json` and `credentials.json` secret files as non-agent-writable protected paths; `doctor storage` validates path boundaries, broken asset links, legacy `.clash/project.json` markers as ignored old-layout evidence, stray secondary canvas replica files, protected media/revision content roots, content-model contracts, local secret file contracts, existing text/timeline revision blob hash/permission integrity, existing recovery manifests, and local SQLite core metadata tables, provider auth tables/primary keys, plus asset/text/timeline projection indexes; `doctor storage --repair` creates missing workspace roots, repairs the local SQLite core metadata tables, provider auth tables/primary keys, plus asset/text/timeline projection indexes, and quarantines secondary canvas replica files into protected runtime recovery with manifest evidence; `doctor storage-recovery list --json` exposes quarantined recovery manifest inventory plus prior restore receipt summaries only after current-project recovery-root, destination containment, and symlink/non-regular-file checks pass, otherwise reporting invalid entries; `doctor storage-recovery list/compare/restore --json` include `recoveryPolicy` so agents can see that recovery is scoped to the local canonical replica, cloud state is neither imported nor mutated, `cloud-sync` needs cloud conflict review, and `shared`/`cloud-sequencer` projects can be compared but cannot be locally restored; `doctor storage-recovery compare --manifest ... --json` reports quarantined-vs-canonical file evidence plus a restore read token without import only after current-project recovery-root, project/canonical-replica, destination containment, and symlink/non-regular-file checks pass; `doctor storage-recovery restore --manifest ... --if-match <readToken> --yes --json` is the explicit promotion path and rejects stale compare tokens plus shared/cloud-sequencer recovery before overwriting canonical bytes | agents can inspect paths and host-owned repair can initialize safe workspace/schema prerequisites without blessing legacy JSON markers, cwd snapshots, cloud sequencer state, media blobs, revision blobs, text/timeline content, or local secret files as agent-writable truth | broader migration/recovery UX and old-layout checks |
| Canvas update | direct patch/admin path still exists | broad patch exits can bypass projection workflow if guardrails drift | keep shared field/checkpoint guards plus agent read-token CAS |
| Project delete | Local API soft-deletes and CLI requires `--yes`; `clash project get --json` returns active-project `readToken`; `clash project delete --if-match` passes agent read proof; `clash project get --include-deleted --json` returns a deleted-project restore/purge receipt; `clash project restore --if-match` requires that receipt for agent restores; `DELETE /api/v1/projects/:id/purge` and `clash project purge <projectId> --yes --if-match <readToken>` permanently remove only deleted local recovery points after explicit `confirm: "purge"`, default to a 7-day delay unless `--force` is used, remove project-scoped sessions/messages/room rows/asset refs plus the canonical Loro replica, clear project ownership from retained immutable asset rows, and leave retained asset blobs/rows for asset GC; accepted v1 project create/delete, accepted legacy project create/update/delete, accepted project restore/purge, session create/delete, runtime session create/attach, local room message create, local sync config update, local audio config update/install, local harness enablement/install/install-adapter/upgrade/uninstall/authenticate, local agent-server config update, provider account update/delete, provider OAuth start/complete/delete, asset import, asset cover update, asset reference refresh, asset-ref delete, asset GC delete, local-api canvas node update/delete, local-api canvas batch delete, and local-api canvas edge delete write sanitized local mutation audit evidence readable through `GET /api/v1/mutation-audit` and `clash audit mutations` without exposing read receipts; local-api canvas node patch/delete requires receipt-bearing node reads for agent writes and rejects downstream text content patches unless the caller uses the explicit COW/projection path; local-api canvas batch delete uses an explicit delete-plan receipt and rejects orphaning external references before deleting a closed subgraph; v1 create/delete/restore/purge and legacy create/update/delete responses include accepted/rejected mutation records, with legacy delete now returning JSON evidence instead of empty 204 | cloud/shared recovery and purge parity are not specified; audit coverage is first-pass for these destructive local exits | remote parity, conflict recovery, and broader destructive mutation audit coverage |
| Assets | local files plus SQLite rows/refs, optional project links, alpha `clash asset import --file` content-addressed blobs, `clash asset replace --node --file` import-plus-COW replacement, local-api `/api/v1/assets/import` registration into `assets`/`asset_refs` with immutable same-id content checks and sanitized local mutation audit evidence, local-api asset create/cover storage-key validation before SQLite persistence, asset create sanitized local mutation audit evidence, local-api blob upload with sanitized audit evidence, workflow generated asset writes with sanitized audit evidence, and `/assets/*` reads validating real filesystem containment so symlinked storage roots or parents cannot escape local asset storage, `GET /api/v1/assets/:id` receipt-bearing asset read plus agent-guarded `/api/v1/assets/:id/cover` metadata update, `GET /api/v1/assets/:id/ref?projectId=...` receipt-bearing project asset-ref read plus agent-guarded ref delete exposed through `clash asset ref get/delete --if-match`, local-api `/api/v1/projects/:projectId/canvas/nodes/:nodeId` receipt-bearing node read plus `/api/v1/assets/replace` registered-asset COW replacement, and `clash asset gc` / `/api/v1/assets/gc` for unreferenced local blobs with explicit protected asset ids, automatic or requested-project Loro canvas scans, first-pass `*AssetId` / `*AssetIds` downstream metadata scanning, dry-run receipt read tokens for the current deletion plan, `clash assets gc --delete --if-match` for agent destructive GC, guarded local-blob deletion, non-dry-run refresh of known scanned refs back into SQLite `asset_refs`, first-pass node/field/role projection rows in `asset_node_refs`, host-readable reference lookup through `GET /api/v1/assets/:id/references` / `clash asset refs`, and explicit reference-index refresh through `POST /api/v1/assets/:id/references/refresh` / `clash asset refs --refresh` with an accepted host metadata mutation, sanitized local mutation audit evidence, and without running GC deletion | richer role ontology/provenance UI/E2E evidence remains incomplete | richer materialized ref index + live replace/UI parity |
| Sync status | marker has local hint but not authoritative cloud state | false `Synced` claims | explicit project mode/status model |

## API Requirements For v1

### `GET /api/v1/projects/:id/status` or `clash project status --json`

Agents need a stable inspection payload:

```json
{
  "projectId": "project_123",
  "mode": "local",
  "syncMode": "local",
  "collaboration": {
    "schemaVersion": 1,
    "mode": "local-only",
    "rawMode": "local",
    "webOpenable": false,
    "multiUser": false,
    "roomAuthority": "local",
    "cloudProjectRoom": "disabled",
    "syncReadiness": {
      "status": "disabled",
      "ready": false,
      "required": ["canvas", "room", "asset-metadata", "revision-content"],
      "missing": ["canvas", "room", "asset-metadata", "revision-content"]
    },
    "syncPolicy": {
      "schemaVersion": 1,
      "cloudAdmission": "disabled-until-enable-sync",
      "mirror": {
        "canvas": {
          "requirement": "canvas",
          "source": "loro-canvas-replica",
          "conflictPolicy": "loro-crdt"
        },
        "room": {
          "requirement": "room",
          "source": "sqlite-room-messages",
          "conflictPolicy": "same-message-id-same-normalized-content-idempotent-conflict-otherwise",
          "rawAgentTrace": false
        },
        "assetMetadata": {
          "requirement": "asset-metadata",
          "source": "sqlite-asset-indexes",
          "registries": ["assets", "asset_refs", "asset_node_refs"],
          "mediaBlobsIncluded": false,
          "conflictPolicy": "host-indexed-content-addressed-assets"
        },
        "revisionContent": {
          "requirement": "revision-content",
          "source": "sqlite-index-and-content-addressed-revision-blobs",
          "registries": ["text_revisions", "timeline_revisions"],
          "contentKinds": ["text-revision-content", "timeline-revision-content"],
          "mediaAsset": false,
          "agentWritable": false,
          "conflictPolicy": "same-revision-id-same-hash-idempotent-conflict-otherwise"
        }
      },
      "excluded": {
        "rawAgentTraces": {
          "syncDefault": "local-only",
          "optInRequiredForSync": true
        },
        "localRuntimeSecrets": {
          "syncDefault": "local-only",
          "optInRequiredForSync": true
        }
      }
    },
    "tracePolicy": {
      "schemaVersion": 1,
      "roomMessages": {
        "kind": "project-chat",
        "syncDefault": "sync-when-project-sync-enabled",
        "rawAgentTrace": false
      },
      "agentSessionMetadata": {
        "kind": "public-session-metadata",
        "syncDefault": "sync-when-project-sync-enabled",
        "rawAgentTrace": false
      },
      "rawAgentTraces": {
        "kind": "private-runtime-trace",
        "syncDefault": "local-only",
        "optInRequiredForSync": true,
        "excludedFromRoom": true,
        "sensitiveFields": ["tool-logs", "local-file-paths", "scratch-context"]
      }
    },
    "localAgentRuntime": {
      "requiredForLocalActions": true,
      "availability": "owner-machine-online"
    }
  },
  "clashHome": "${CLASH_HOME:-~/.clash}",
  "projectStore": "${CLASH_HOME:-~/.clash}/projects/project_123",
  "projectWorkspaceRoot": "${CLASH_HOME:-~/.clash}/projects/project_123",
  "currentWorkspace": {
    "schemaVersion": 1,
    "role": "project-reference-workspace",
    "currentWorkingDirectory": "/path/to/user/workspace",
    "markerPath": "/path/to/user/workspace/.clash/project.toml",
    "markerRoot": "/path/to/user/workspace",
    "markerStore": "managed",
    "markerWorkspaceId": "managed:0123456789abcdef",
    "projectWorkspaceRoot": "${CLASH_HOME:-~/.clash}/projects/project_123",
    "locatedInProjectWorkspace": false,
    "ownsCanonicalSnapshot": false,
    "ownsCanonicalMetadata": false,
    "deletionDeletesProjectState": false
  },
  "localApiDataDir": "${CLASH_HOME:-~/.clash}/local-api",
  "localSqlitePath": "${CLASH_HOME:-~/.clash}/local-api/local.sqlite",
  "legacyDbJsonPath": "${CLASH_HOME:-~/.clash}/local-api/db.json",
  "loro": {
    "replicaRoot": ".../loro",
    "snapshotPath": ".../snapshot.bin",
    "updatesLogPath": ".../updates.log"
  },
  "roots": {
    "drafts": ".../drafts",
    "projections": ".../projections",
    "timelines": ".../timelines",
    "sessions": ".../sessions",
    "assetLinks": ".../assets/links",
    "runtime": ".../runtime"
  },
  "draftsRoot": ".../drafts",
  "projectionsRoot": ".../projections",
  "assetLinksRoot": ".../assets/links",
  "runtimeRoot": ".../runtime",
  "protectedPaths": ["..."],
  "editablePaths": ["..."],
  "storage": {
    "schemaVersion": 1,
    "context": {
      "role": "project-reference",
      "projectId": "project_123",
      "source": "marker",
      "markerPath": ".../.clash/project.toml"
    },
    "workspace": {
      "role": "agent-draft-and-projection-workspace",
      "root": "${CLASH_HOME:-~/.clash}/projects/project_123",
      "ownsCanonicalSnapshot": false,
      "ownsCanonicalMetadata": false,
      "editablePaths": [".../drafts", ".../projections", ".../timelines", ".../sessions", ".../assets/links"],
      "protectedPaths": [".../runtime"],
      "viewFiles": {
        "texts": {
          "kind": "agent-editable-projection-files",
          "path": ".../projections/text",
          "defaultFilePattern": "<node-id>.md",
          "applyCommand": "clash text apply",
          "casRequired": true,
          "ownsCanonicalState": false
        },
        "timelines": {
          "kind": "agent-editable-view-files",
          "path": ".../timelines",
          "defaultFile": "main.timeline.yaml",
          "applyCommand": "clash timeline apply",
          "casRequired": true,
          "ownsCanonicalState": false
        },
        "timelineProjections": {
          "kind": "agent-editable-projection-files",
          "path": ".../projections/timelines",
          "applyCommand": "clash timeline apply",
          "casRequired": true,
          "ownsCanonicalState": false
        }
      }
    },
    "canonicalReplica": {
      "role": "single-machine-project-replica",
      "scope": "machine",
      "projectId": "project_123",
      "metadata": {
        "kind": "sqlite",
        "path": "${CLASH_HOME:-~/.clash}/local-api/local.sqlite",
        "agentWritable": false
      },
      "canvas": {
        "kind": "loro",
        "replicaRoot": ".../loro",
        "snapshotPath": ".../snapshot.bin",
        "updatesLogPath": ".../updates.log",
        "agentWritable": false
      },
      "mediaAssets": {
        "kind": "content-addressed-files",
        "path": "${CLASH_HOME:-~/.clash}/assets/blobs",
        "storageKeyPrefix": "local-blobs/",
        "immutable": true,
        "deduplicatedBy": "sha256",
        "agentWritable": false,
        "referencedBy": "sqlite-asset-rows-and-project-asset-links"
      },
      "contentBlobs": {
        "textRevisions": {
          "kind": "content-addressed-files",
          "path": "${CLASH_HOME:-~/.clash}/local-api/text-revision-blobs",
          "mediaType": "text/markdown",
          "immutable": true,
          "agentWritable": false
        },
        "timelineRevisions": {
          "kind": "content-addressed-files",
          "path": "${CLASH_HOME:-~/.clash}/local-api/timeline-revision-blobs",
          "mediaType": "application/yaml",
          "immutable": true,
          "agentWritable": false
        }
      }
    },
    "contentModel": {
      "role": "agent-projections-with-host-indexed-revision-content",
      "textNodes": {
        "liveState": "loro-canvas-text-node-data",
        "editableProjection": "storage.workspace.viewFiles.texts",
        "projectionPath": "${CLASH_HOME:-~/.clash}/projects/<project-id>/projections/text",
        "applyCommand": "clash text apply",
        "replaceCommand": "clash text replace",
        "casRequired": true,
        "copyOnWriteWhenReferenced": true,
        "revisionRegistry": "text_revisions",
        "revisionBlobPath": "${CLASH_HOME:-~/.clash}/local-api/text-revision-blobs",
        "mediaAsset": false,
        "agentWritableCanonicalState": false
      },
      "timelines": {
        "liveState": "loro-canvas-video-editor-node-data",
        "editableProjection": "storage.workspace.viewFiles.timelines",
        "projectionPath": "${CLASH_HOME:-~/.clash}/projects/<project-id>/timelines",
        "applyCommand": "clash timeline apply",
        "replaceCommand": "clash timeline replace",
        "casRequired": true,
        "copyOnWriteWhenReferenced": true,
        "revisionRegistry": "timeline_revisions",
        "revisionBlobPath": "${CLASH_HOME:-~/.clash}/local-api/timeline-revision-blobs",
        "mediaAsset": false,
        "agentWritableCanonicalState": false
      }
    },
    "localSecrets": {
      "role": "machine-local-secret-files",
      "syncDefault": "local-only",
      "agentWritable": false,
      "files": {
        "cliConfig": {
          "kind": "cli-api-key-config",
          "path": "${CLASH_HOME:-~/.clash}/config.json",
          "agentWritable": false
        },
        "bridgeCredentials": {
          "kind": "local-runtime-credentials",
          "path": "${CLASH_HOME:-~/.clash}/credentials.json",
          "agentWritable": false
        }
      }
    }
  }
}
```

This is implemented in `packages/cli/src/commands/projects.ts` and local-api
`GET /api/v1/projects/:id/status`, backed by the shared-runtime project status
path builder. The `roots.runtime`/`runtimeRoot` field is explicit so agents do
not need to infer the protected runtime directory by scanning `protectedPaths`.
The `collaboration` object is the machine-readable local/cloud mode gate:
`local`/`local-only` normalize to `local-only` and are not web-openable;
`cloud-sync`/`synced` normalize to `synced` but remain `webOpenable: false`
with `syncReadiness.status: "pending"` until canvas, room, asset-metadata, and
revision-content sync capabilities are explicitly ready in local sync config
and passed through the status builder; only ready synced projects may use
`roomAuthority: "local-with-cloud-mirror"`. The same payload exposes
`tracePolicy` so room chat/public session metadata and raw agent traces do not
share an accidental sync surface. Only `shared` enables
`cloudProjectRoom: "sequencer"` and `multiUser: true`. Local actions still
require the owner's machine-local agent runtime in every mode.
`syncPolicy` is the machine-readable mirror contract behind those gates:
canvas means the Loro canvas replica, room means SQLite-backed project chat
without raw agent traces, asset metadata means SQLite asset indexes without
media blob bytes, and revision content means immutable text/timeline revision
indexes plus content-addressed revision blobs. It also records that raw agent
traces and local runtime secrets are local-only by default and require explicit
opt-in before any future sync path may include them.
The `storage` object is the machine-readable role contract: the workspace is
for drafts/projections and does not own canonical snapshot/metadata; the
canonical replica is protected SQLite + Loro state plus immutable
content-addressed text/timeline revision body stores. Those revision blobs are
addressable through history `content` descriptors and content endpoints, not by
direct agent writes to the protected store.
`clash doctor storage --json` adds first-pass read-only health checks and fails
if that storage contract makes canonical state or revision content blobs
agent-writable, or if the cwd / project workspace contains stray `snapshot.bin`
or `updates.log` files outside the canonical Loro replica. When protected
revision blob files exist, doctor also verifies that Markdown/YAML filenames
match their content hash, timeline YAML hashes are semantic timeline hashes,
and the files have no writable permission bits. It warns when local SQLite is
initialized without the core metadata tables, provider auth tables/primary keys, and
projection indexes needed for projects, assets, sessions, provider accounts,
OAuth rows, room messages, mutation audit, agent-readable asset references,
and revision lookups. `clash doctor storage --repair` creates the standard workspace roots,
repairs the local SQLite core metadata tables, provider auth tables/primary keys, plus
`asset_refs`, `asset_node_refs`, `text_revisions`, and `timeline_revisions` indexes,
restores read-only permissions on hash-valid writable revision blobs, and moves secondary canvas replica files into
`runtime/recovery/secondary-canvas-replicas/` with durable manifest evidence
that records source paths, destination paths, and the canonical replica paths.
It does not apply those bytes to canonical state. Follow-up doctor runs report
that recovery inventory as a warning, `clash doctor storage-recovery list
--json` exposes all valid manifests plus invalid entries for review after
checking manifest containment and recovery-file destinations, and includes
prior restore receipt summaries discovered under each recovery set's
`canonical-before-restore/` directory after regular-file and realpath
containment checks. `compare` can inspect one manifest without losing
provenance after verifying it belongs to the current project's protected
recovery root, matches the current canonical replica, and does not point at
out-of-set or symlinked recovery files. Compare also returns the read token
required by `clash doctor storage-recovery restore --manifest ... --if-match
<readToken> --yes --json`, which re-checks the same paths, backs up existing
canonical files when present, and rejects stale tokens before promotion.
Successful restore writes a local `restore-receipt.json` under the recovery
set's `canonical-before-restore/` directory so the explicit promotion can be
audited without adding a broad append-only product log.
The recovery JSON payloads expose `recoveryPolicy`, derived from the same
shared-runtime `ProjectStatus.collaboration` helper used by local-api project
delete/restore/purge: local-only restores remain manual, `cloud-sync` restores
are local-replica promotions that require cloud conflict review, and
`shared`/`cloud-sequencer` projects are evidence-only for local recovery
because restore is rejected before overwrite. Broader recovery UX and
old-layout migration checks are still needed.

### Local room endpoints

Implemented locally in SQLite:

- `GET /api/v1/projects/:pid/room/messages`
- `POST /api/v1/projects/:pid/room/messages`

Rules:

- append-only,
- stable message ids,
- sender validation,
- mention validation,
- same-id replay is accepted only when normalized sender/text/mentions match,
- SQLite persistence,
- accepted/rejected host mutation records on POST,
- no raw trace dumps.
- Cloud room POST matches the same same-project/id idempotency rule and rejects
  changed content instead of returning the old row as a silent success.
- Local room sync code includes a pure mirror planner that sorts import/export
  candidates by append order and classifies same-id content mismatches as
  conflicts instead of overwrites.
- Local-api exposes explicit `POST /api/v1/projects/:projectId/room/sync`;
  the CLI exposes `clash room sync --json` so agents can mirror only through
  an auditable action result.
- Same-id room sync conflicts expose local/remote message snapshots and content
  hashes in the public plan, so failed sync output is inspectable without
  mutating either side.
- Local-api exposes explicit
  `POST /api/v1/projects/:projectId/room/sync/conflicts/:messageId/resolve`,
  and the CLI exposes `clash room resolve-conflict --local-hash --remote-hash`.
  The only first-pass strategy is `accept-divergence`; it writes the resolution
  to SQLite `room_sync_conflict_resolution` and records a mutation audit receipt
  only when the supplied local/remote hashes still match the current conflict.
  Later sync reports that id in `resolvedConflictIds` instead of overwriting
  either message.
- Room sync now checks active project existence before remote admission, so a
  missing project returns 404 instead of being hidden by cloud configuration.
- Local-only room sync rejection includes a machine-readable `admission` gate
  with `allowed: false`, `reason: "remote-room-not-configured"`, and
  `requirements: ["enable-sync"]`.
- Room message read/send responses now include `sync.admission` too, so agents
  and UI can inspect local-only admission requirements before invoking the
  explicit mirror action.
- `clash room sync --json` preserves that rejected API body on stdout while
  keeping the nonzero exit and stderr error text, so agents can parse the
  admission/mutation evidence even when sync is denied.

Remaining:

- conflict recovery UI and broader admission policy,
- richer conflict recovery UX across local and remote,
- live room UI parity in local desktop.

### Local text revision endpoints

Implemented locally in SQLite:

- `POST /api/v1/text-revisions`
- `GET /api/v1/projects/:projectId/text-revisions`
- `GET /api/v1/projects/:projectId/text-revisions/:revisionId/content`

Rules:

- stores applied and workflow-generated text revision metadata in host-owned SQLite `text_revisions`,
- does not create media `assets` rows for text revisions,
- validates project-relative source paths and hash consistency before indexing,
- when content is supplied by `POST /api/v1/text-revisions` or generated by a
  host workflow, stores the Markdown body as an immutable app-owned
  content-addressed text blob and serves it through the content GET endpoint,
- text revision history entries with stored bodies expose a `content` descriptor
  (`kind: "text-revision-content"`, `stored: true`, hash, media type, URL,
  immutable flag, and `storage: { kind: "content-addressed-revision-blob", registry:
  "text_revisions", mediaAsset: false, agentWritable: false }`), so agents can
  discover recovery content without direct DB/filesystem access or treating it
  as a media asset row,
- rejects same revision id with different payloads,
- returns an accepted host mutation record for successful index writes,
- keeps text body editing behind `clash text pull/apply/replace` CAS rather
  than direct SQLite writes.
- `clash text history` reads the GET endpoint as the agent-facing history
  surface instead of opening SQLite.
- `clash text content --revision <id> [--out <path>]` reads the content GET
  endpoint as the agent-facing revision recovery surface; `--out` writes are
  cwd-contained.

Remaining:

- richer visual text revision UI/history,
- canonical file-backed text asset mode,
- local-to-cloud text revision mirror policy.

### Local timeline revision endpoints

Implemented locally in SQLite:

- `POST /api/v1/timeline-revisions`
- `GET /api/v1/projects/:projectId/timeline-revisions`
- `GET /api/v1/projects/:projectId/timeline-revisions/:revisionId/content`

Rules:

- stores applied timeline revision milestone metadata in host-owned SQLite
  `timeline_revisions`,
- does not create media `assets` rows for timeline revisions,
- validates project-relative source paths and hash consistency before indexing,
- when content is supplied, parses the applied YAML, validates its semantic
  timeline hash, stores it as an immutable app-owned content-addressed timeline
  revision blob, and serves it through the content GET endpoint,
- timeline revision history entries with stored bodies expose a `content`
  descriptor (`kind: "timeline-revision-content"`, `stored: true`, hash, media
  type, URL, immutable flag, and `storage: { kind: "content-addressed-revision-blob",
  registry: "timeline_revisions", mediaAsset: false, agentWritable: false }`),
  so agents can discover recovery/provenance YAML without direct DB/filesystem
  access or treating it as a media asset row,
- rejects same revision id with different payloads,
- returns an accepted host mutation record for successful index writes,
- keeps timeline body editing behind `clash timeline pull/apply/replace` CAS
  rather than direct SQLite writes.
- `clash timeline history` reads the GET endpoint as the agent-facing history
  surface instead of opening SQLite. Loro remains the canonical fine-grained
  document history.
- `clash timeline content --revision <id> [--out <path>]` reads the content GET
  endpoint as the agent-facing revision recovery surface; `--out` writes are
  cwd-contained.

Remaining:

- richer visual timeline revision UI/history,
- local-to-cloud timeline revision mirror policy,
- export/render UI that pins output artifacts to timeline revision ids.

### Projection apply endpoints/commands

Every projection apply must carry:

- project id,
- projection type,
- entity id,
- expected hash,
- force flag,
- actor context,
- validated payload.

Host validates before mutation.

local-api v1 project create/delete/restore, legacy project
create/update/delete, local room message create, asset create/ref-delete/cover
update plus invalid storage-key rejection, session create/delete, runtime session create/attach success plus
validation rejection, provider account update/delete, provider OAuth
start/complete/delete, local sync/audio/runtime config update/install, and local
harness/agent-server action responses now use the same host mutation record
shape; project read/get/list responses include `readToken`, and agent project
update/delete writes compare `ifMatch` against current state inside the write
path. Session list responses now include receipt-bearing session `readToken`
values, and agent session delete plus runtime-session attach require that token
while preserving ordinary non-agent delete/attach compatibility. Local sync,
audio, harness enablement, and
custom agent-server config reads also return receipt-bearing local-config
`readToken` values, and agent config writes reject missing, bare, or stale
tokens before changing local-only/cloud-sync mode, local ASR settings, enabled
local agent harnesses, or custom agent server definitions. The shared
read-proof primitive now supports receipt-bearing tokens so a
host can require "this exact token came from a read path" in addition to hash
CAS; the CLI daemon uses this for direct canvas `get -> update/delete/media COW`
agent writes and for daemon-backed `text pull -> apply/replace` plus
`timeline pull -> apply/replace` projection writes; storyboard prompt-pack
projections stay file-only for now, but lock both the editable prompt-pack hash
and the source storyboard action hash so stale source reads are rejected;
local-api uses this for project create/get/list/update/delete read tokens, session
list/delete read tokens, local sync/audio/runtime config read/update tokens, `clash asset get` /
`GET /api/v1/assets/:id` ->
`clash asset cover set --if-match` / `PATCH /api/v1/assets/:id/cover`
asset metadata updates, `GET /api/v1/assets/:id/ref?projectId=...` ->
`DELETE /api/v1/assets/:id/ref?projectId=...` project asset-ref deletes, plus the `/api/v1/projects/:projectId/canvas/nodes/:nodeId` ->
`/api/v1/assets/replace` media COW read-write chain, and
`GET /api/v1/projects/:projectId/canvas/edges` ->
`POST`/`PATCH`/`DELETE /api/v1/projects/:projectId/canvas/edges/:edgeId`
edge graph actions,
`clash assets gc --dry-run --json` / `POST /api/v1/assets/gc {dryRun:true}` ->
`clash assets gc --delete --if-match <readToken>` / destructive
`POST /api/v1/assets/gc {dryRun:false}` asset garbage collection. custom-action
upload uses the same shape for text action results and asset-backed media
results with sanitized local audit evidence, and generic `/upload` uses it for
blob writes.
Remaining local-api mutating endpoints still need parity before this is a full
local API contract.

## Test Requirements

### Local route parity

- Projects/assets/sessions/providers keep existing response shapes after SQLite.
- Local vars/action-secret endpoints remain 404.
- Local room endpoint persistence tests replace the old 404 expectation.

### Cloud compatibility

- Cloud vars routes remain green.
- Cloud room routes remain green.
- Cloud ProjectRoom behavior remains untouched by local storage cleanup.

### CLI contract

- `clash project status --json` exposes roots and mode.
- `clash timeline apply/replace` rejects stale locks and daemon agent writes
  with bare synthesized timeline CAS tokens.
- `clash text apply/replace` rejects stale locks and daemon agent writes with
  bare synthesized text CAS tokens.
- `clash room say/read` works against current local-api/cloud APIs and reports
  a generic missing-room-API message for older targets.
- A focused local-api e2e starts a real loopback server and drives
  `clash room say/read` through a spawned CLI process, including local-only
  sync metadata assertions.
- `clash vars` does not claim to be local auth default.
- `clash audit mutations --operation project_create --entity <projectId>
  --json`, `clash audit mutations --operation project_update --entity <projectId>
  --json`, `clash audit mutations --operation project_restore --entity <projectId>
  --json`, `clash audit mutations --operation project_purge --entity <projectId>
  --json`, `clash audit mutations --operation asset_gc --entity local --json`,
  `clash audit mutations --operation local_sync_config_update --entity sync
  --json`, `clash audit mutations --operation local_audio_config_update --entity audio
  --json`, `clash audit mutations --operation local_audio_model_install --entity audio
  --json`, `clash audit mutations --operation local_harness_enablement_update --entity enabled
  --json`, `clash audit mutations --operation local_harness_install --entity <harnessId>
  --json`, `clash audit mutations --operation local_harness_upgrade --entity <harnessId>
  --json`, `clash audit mutations --operation local_harness_uninstall --entity <harnessId>
  --json`, `clash audit mutations --operation local_harness_authenticate --entity <harnessId>
  --json`, `clash audit mutations --operation local_agent_servers_update --entity agent-servers
  --json`, `clash audit mutations --operation provider_accounts_update --entity <userId>
  --json`, `clash audit mutations --operation provider_account_delete --entity <accountId>
  --json`, `clash audit mutations --operation provider_oauth_start --entity <providerId>[:<accountId>]
  --json`, `clash audit mutations --operation provider_oauth_complete --entity <providerId>[:<accountId>]
  --json`, `clash audit mutations --operation provider_oauth_delete --entity <providerId>[:<accountId>]
  --json`,
  `clash audit mutations --operation asset_create --entity <assetId> --json`,
  `clash audit mutations --operation asset_import --entity <assetId> --json`,
  `clash audit mutations --operation custom_action_upload --entity <resultId>
  --json`,
  `clash audit mutations --operation asset_cover_update --entity <assetId>
  --json`, `clash audit mutations --operation asset_references_refresh
  --entity <assetId> --json`,
  `clash audit mutations --operation session_create --entity <threadId>
  --json`, and `clash audit mutations --operation session_delete --entity <threadId>
  --json`; `clash audit mutations --operation canvas_delete_edge --entity
  <edgeId> --json` reads sanitized local host mutation audit evidence without
  exposing read receipts or raw SQLite when the write went through local-api.
- `clash asset get -> clash asset cover set --if-match` and
  `clash asset ref get -> clash asset ref delete --if-match` reject missing or
  bare agent read proofs, accept host-issued receipts, and record mutation
  envelopes plus sanitized mutation audit evidence for accepted cover updates.
  `clash assets gc --dry-run --json -> clash assets gc --delete
  --if-match` applies the same missing/bare/stale receipt checks to destructive
  local asset GC; deterministic coverage lives in
  `apps/desktop/e2e/agent-first-asset-receipt-smoke.mjs`.

## Bottom Line

The API surface gap is not that local and cloud are different. They should be
different in authority.

The gap is that some local surfaces still look cloud-shaped without local
persistence (`room`), while legacy `db.json` is ignored and only reported as a
cleanup/secrets warning. v1 needs to make both truths explicit:

- local owns a complete single-user path,
- cloud owns sync/shared authority,
- agents use commands and projections rather than editing internals.
