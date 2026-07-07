# Agent-First Local v1 Traceability Matrix

Last updated: 2026-07-07

## Purpose

Map the active v1 local/agent-first goal into concrete requirements, current
evidence, gaps, and restrictions.

This document is the completion-audit entry point. It prevents the architecture
work from looking complete just because the principles have been written down.

Companion evidence inventories:

- `agent-first-local-v1-code-audit.md`
- `agent-first-local-v1-cli-cas-audit.md`
- `agent-first-local-v1-api-surface-inventory.md`
- `agent-first-local-v1-remote-compatibility-boundary.md`

## Status Legend

- `Aligned in code`: current implementation already satisfies the requirement.
- `Partially aligned`: current implementation points in the right direction but
  has known gaps.
- `Spec only`: architecture is documented but implementation remains.
- `Conflict`: current implementation contradicts the v1 target.
- `Remote only`: the capability exists in cloud/remote path but not local.

## Requirement Matrix

| Requirement | v1 decision | Current evidence | Status | Required next action |
| --- | --- | --- | --- | --- |
| Local is primary path | Desktop/local-api must work without cloud for a single-user project | `docs/local-first-cloud-product-guide.md`; local-api routes; bridge local cwd; CLI project status roots; `project status.collaboration` marks local projects as not web-openable/shared; local SQLite metadata/provider/room stores | Partially aligned | Finish deeper asset path policy and live mode-gate UI coverage |
| Cloud collaboration is additive | Cloud adds sync/web/multiplayer, not default truth | Cloud ProjectRoom docs and routes remain; new docs warn not to delete remote paths; `project status.collaboration` normalizes local/synced/shared gates without removing cloud/shared code, and `syncReadiness` keeps `cloud-sync` pending/not web-openable until canvas, room, and asset-metadata sync capabilities are explicitly ready | Partially aligned | Wire gates into Web/Desktop affordances and shared-project admission |
| One local project replica per machine | One logical local project store per project id; cwd never owns a second snapshot | `packages/shared-runtime/src/project-status.ts` exposes `storage.canonicalReplica` as the machine-scoped SQLite + Loro replica and marks it non-agent-writable; `clash doctor storage` validates the storage role contract, local SQLite asset reference index schema, and `secondary-canvas-replica` detection for stray cwd/project-workspace `snapshot.bin` or `updates.log` files; `clash doctor storage --repair` repairs the local asset reference index schema and quarantines secondary canvas replica files under protected runtime recovery with durable `manifest.json` source-path evidence, without making canonical state agent-writable; `clash doctor storage-recovery compare --manifest ... --json` compares quarantined bytes against canonical paths/state with size/hash evidence and keeps automatic import disabled; `packages/clash-bridge/src/lib/session-cwd.ts`; `packages/cli/src/lib/project-context.ts`; `docs/local-project-storage-layout-spec.md` | Partially implemented | Add broader migration/recovery checks and explicit import/review tooling for quarantined replicas |
| CWD is reference/draft surface | CWD may hold marker, drafts, projections, not canonical DB/snapshot | `.clash/project.toml` resolver; bridge writes marker and initializes draft/projection/session dirs; `CLASH_HOME` override covers CLI config/status/actions/cache/socket/host paths, bridge cwd/actions, and local-api default data/run dirs; `clash project status --json` exposes editable/protected roots plus `storage.workspace` with `ownsCanonicalSnapshot: false` and `ownsCanonicalMetadata: false`; bundled AGENTS.md tells agents to use `editablePaths` and avoid `protectedPaths`/`runtimeRoot`; `clash doctor storage` checks declared roots, broken asset links, protected cwd, stray canvas replica files in cwd/project workspace, unsafe storage-role contracts, and local SQLite asset reference schema; `clash doctor storage --repair` initializes missing standard workspace roots and quarantines stray canvas replica files into protected runtime recovery; direct real Codex E2E verifies roots and status runtime protection in the spawned agent cwd | Partially implemented | Add workspace migration and broader recovery UX |
| `snapshot.bin` is internal | Agents must not read/write Loro snapshot directly | `apps/local-api/src/loro/file-replica-store.ts`; `storage.canonicalReplica.canvas.agentWritable: false`; `clash doctor storage` fails if canonical canvas paths become agent-editable; Loro host docs | Aligned in direction | Add deeper product reliance checks and recovery UX |
| Agent-readable files are projections | Files are generated from product entities and applied through commands | Timeline YAML implementation; shared projection CAS helper rejects projection files and generated/explicit lock sidecars outside the current agent/project cwd, including forced writes and symlink escapes; shared agent-file path guards also reject review/stage gate JSON, lock sidecars, production QA/report/action-plan outputs, and receipts before those files can approve or justify downstream work; asset metadata action preflights metadata projection and lock paths before mutating `assets/manifest.json`; text Markdown projection with CAS and materialized-checkpoint rejection; text/timeline/storyboard prompt-pack, primary asset metadata, editable metadata apply, and `apply-metadata` JSON-derived lock sidecars share the generic projection envelope (`projectionKind`, `entity`, `contentHash`) while parsing legacy locks where applicable; `clash production apply-metadata-projection` applies edited primary metadata JSON back to `assets/manifest.json` only after lock file-path and stale-hash checks; explicit `clash text replace` and `clash timeline replace` create COW replacement nodes from locked projection files; explicit `clash canvas replace-asset` creates a COW media node from a fresh read token; explicit `clash asset refs` reads node/field/role asset usage through local-api instead of direct SQLite or snapshot access, and `clash asset refs --refresh` refreshes that projection as a host-recorded metadata mutation without GC deletion; `clash asset replace --node --file` first imports a local file as an immutable content-addressed asset, then invokes the same COW media replacement path; local-api `/api/v1/assets/replace` applies a registered immutable asset to a canvas media node through the same host-enforced read-proof COW semantics; `clash asset import --file` creates immutable content-addressed blobs, project inspection links, and local-api asset/ref registration; `clash asset gc` calls host GC instead of deleting files directly, dry-run returns a receipt-bearing `asset-gc` read token for the deletion plan, agent `--delete` can pass it through `--if-match`, and host GC can pass protected canvas asset ids, requested project ids, rely on host-side project replica discovery, scan `*AssetId` / `*AssetIds` downstream metadata fields in Loro canvas state, refresh known scanned refs into SQLite `asset_refs`, and refresh node/field/role usage into `asset_node_refs` on non-dry-run GC | Partially implemented | Extend the generic projection envelope to future non-JSON/storyboard/editor projections; add richer role ontology/provenance asset dependency UI |
| Every read-edit-apply projection uses CAS | Pull/export + edit + apply must compare semantic hash/version; direct agent patch writes must carry a read token from a prior explicit read | `packages/shared-types/src/agent-read-proof.ts` provides stable read-token CAS plus receipt-bearing read proof support through `agentReadReceiptToken` and `validateAgentReadProof({ requireReceipt })`; supplied `expectedReadToken` values are now always compared as CAS preconditions, while host-issued receipts remain mandatory for agent writes; `packages/shared-types/src/host-mutation-envelope.ts` provides the shared host mutation record contract; text and timeline pulls now resolve projection files through the shared cwd-contained projection path helper, write lock-sidecar `readToken` values derived from the same entity hash used for CAS, preserve daemon-issued receipt tokens when available, and parsers keep legacy hash-only locks compatible; daemon timeline/text CAS/COW, media asset COW, and direct canvas update/delete use the shared host mutation envelope; daemon `canvas get` now returns receipt-bearing node read tokens and daemon agent `update`/`delete`/`asset_cow_replace` require valid host-issued receipts in addition to base-token CAS; daemon `get` now also returns receipt-bearing text/timeline projection read tokens for `clash text pull` and `clash timeline pull`, and daemon agent text/timeline apply/replace reject bare synthesized CAS tokens; no-daemon one-shot fallback is human-oriented, so spawned-agent canvas update/delete/media replacement and text/timeline apply/replace now reject instead of silently downgrading to hash-only fallback unless `--force` is explicit; storyboard prompt-pack locks now include source storyboard action hashes so apply/replace rejects stale source actions even before a managed prompt-pack projection exists; local-api project create/get/list/update/delete responses now use receipt-bearing project read tokens, and `GET /api/v1/projects/:id?includeDeleted=true` exposes deleted-project restore receipts; agent project update/delete/restore rejects missing, bare, or stale project receipts and records expected receipt plus current base CAS token; local sync and audio config reads now return receipt-bearing local-config tokens, agent config writes reject missing, bare, or stale tokens before changing local-only/cloud-sync mode or local ASR settings, and agent local audio model install now requires the audio read receipt before invoking the install hook; local-api session list responses now return receipt-bearing session read tokens, and agent session delete plus runtime-session attach reject missing, bare, or stale session tokens while preserving ordinary non-agent delete/attach compatibility; local harness and custom agent-server config reads now return receipt-bearing local-config tokens, agent config writes reject missing, bare, or stale tokens before changing local runtime capabilities, and agent local harness install/install-adapter/upgrade/uninstall/authenticate actions now require the same harness-list receipt before invoking the local ACP adapter; local provider account list reads now return receipt-bearing provider-accounts collection tokens plus per-account provider-account tokens, `clash models providers --json` exposes the collection receipt, and `clash models provider set --if-match` lets agent provider account updates pass that proof before changing SQLite provider/OAuth rows; local OAuth list reads now return receipt-bearing provider-oauth tokens, agent OAuth start over an existing row and complete reject missing, bare, or stale row tokens before invoking the OAuth driver, OAuth complete/delete reject missing targets when a CAS/read-proof precondition is supplied, and agent OAuth deletion rejects missing, bare, or stale tokens before deleting local token rows; local-api `/api/v1/projects/:projectId/canvas/nodes/:nodeId` now returns receipt-bearing node read tokens, and `/api/v1/assets/replace` requires those receipts for agent media COW writes; `clash asset get` and local-api `GET /api/v1/assets/:id` now return receipt-bearing asset read tokens, `clash asset cover set --if-match` exposes asset metadata updates to agents without direct DB writes, and agent `/api/v1/assets/:id/cover` writes reject missing or bare asset CAS tokens; local-api `GET /api/v1/assets/:id/ref?projectId=...` now returns receipt-bearing asset-ref relation tokens, `clash asset ref get/delete --if-match --yes` exposes that read-delete flow to agents without SQLite access, and agent ref deletes reject missing or bare relation CAS tokens; `/api/v1/assets/gc` dry-run now returns a receipt-bearing `asset-gc` plan token, `clash assets gc --delete --if-match <readToken>` passes it back, and agent destructive GC rejects missing, bare, or stale dry-run tokens before deleting rows/blobs; `clash canvas edges --json` and local-api `GET /api/v1/projects/:projectId/canvas/edges` now expose graph and per-edge read tokens for graph-structure CAS; local-api edge `POST` requires the graph receipt, while edge `PATCH`/`DELETE` require the per-edge receipt before saving the Loro snapshot; `clash canvas delete-plan --node <id> --node <id> --json` now exposes graph-aware batch delete read tokens and `clash canvas delete-batch --if-match` applies them; Web UI add/update/delete node, timeline apply, and add/update/delete edge can emit the same envelope through `useLoroSync.onMutation`; runtime ACP `delete_node`, `timeline_apply`, `add_edge`, `update_edge`, and `delete_edge` patches can carry `ifMatch`, and `ChatbotCopilot` treats writes to pre-existing nodes/edges as agent writes that must pass `useLoroSync` read-token CAS while allowing create-and-consume operations inside the same patch event; asset create/ref-delete/cover-update, generic blob upload, custom-action upload, session create/delete, runtime session create/attach success, validation rejection, and ACP failure, provider account update/delete, provider OAuth start/complete/delete, local sync/audio/runtime config update/install, local audio transcription actions, and local harness action responses include mutation records | Partially aligned | Extend the same receipt/read-proof contract to remaining local-api mutating endpoints, Web UI direct write exits, and direct admin operations |
| CAS is host-enforced | CLI preflight is not enough; host must validate expected hash/read token and checkpoint references | Daemon validates timeline/text hashes; daemon timeline/text CAS update and COW replace responses now include `mutation.beforeHash`, `mutation.afterHash`, `mutation.beforeReadToken`, `mutation.expectedReadToken` when a new lock supplies it, `mutation.afterReadToken`, `mutation.entity`, `mutation.accepted`, and `mutation.forced`; daemon direct `update`/`delete`, `delete_batch`, and `asset_cow_replace` responses include `mutation.beforeReadToken`, `mutation.expectedReadToken`, `mutation.afterReadToken` where applicable, `mutation.entity`, `mutation.accepted`, and `mutation.forced`, with agent writes requiring a daemon-issued receipt token from `canvas get`; local-api project update/delete validates agent receipt-bearing read proof inside the serialized SQLite metadata update path and records `expectedReadToken`, base `beforeReadToken`, and receipt-bearing `afterReadToken`; local-api project restore validates an agent deleted-project receipt from `GET /api/v1/projects/:id?includeDeleted=true` inside the serialized SQLite metadata update path and records `expectedReadToken`, base `beforeReadToken`, and receipt-bearing `afterReadToken`; local-api session delete validates agent receipt-bearing session read proof inside the serialized SQLite metadata update path and records `expectedReadToken` plus base `beforeReadToken` before deleting the session and local messages; local-api runtime-session attach validates the same session receipt before invoking the local ACP attach hook for agent requests and records `expectedReadToken`, base `beforeReadToken`, and receipt-bearing `afterReadToken`; local sync and audio config updates plus local audio model install validate agent receipt-bearing local-config read proof before changing local runtime state and record `expectedReadToken`, base `beforeReadToken`, and receipt-bearing `afterReadToken`; local harness enablement, local harness install/install-adapter/upgrade/uninstall/authenticate actions, and custom agent-server config updates validate agent receipt-bearing local-config read proof before changing local runtime capabilities and record `expectedReadToken`, base `beforeReadToken`, and receipt-bearing `afterReadToken`; local provider account updates validate agent receipt-bearing provider-accounts read proof before writing provider settings and record `expectedReadToken`, base `beforeReadToken`, and receipt-bearing `afterReadToken`; local provider account deletes validate agent receipt-bearing provider-account read proof before deleting provider/OAuth rows and record `expectedReadToken` plus base `beforeReadToken`; local OAuth start over an existing row and complete validate agent receipt-bearing provider-oauth read proof before invoking the OAuth driver and record `expectedReadToken`, base `beforeReadToken`, and receipt-bearing `afterReadToken`; local OAuth delete validates the same proof before deleting OAuth token rows and records `expectedReadToken` plus base `beforeReadToken`; local-api `/api/v1/assets/replace` rejects missing/stale/bare agent source-node read proofs from `/api/v1/projects/:projectId/canvas/nodes/:nodeId` and records receipt-bearing `expectedReadToken`, base `beforeReadToken`, and receipt-bearing `afterReadToken` before writing a COW node into the Loro replica; local-api `/api/v1/assets/:id/cover` validates agent receipt-bearing asset read proof inside the serialized SQLite metadata update path, `clash asset cover set --if-match` passes that proof from the CLI, and the mutation records receipt-bearing `expectedReadToken`, base `beforeReadToken`, and receipt-bearing `afterReadToken`; local-api `/api/v1/assets/:id/ref` validates agent receipt-bearing asset-ref relation read proof inside the serialized SQLite metadata update path and records receipt-bearing `expectedReadToken` plus base `beforeReadToken` before deletion; local-api `/api/v1/assets/gc` validates agent destructive GC against the current dry-run plan token, rejects missing/bare/stale receipts, and records receipt-bearing `expectedReadToken` plus base `beforeReadToken` before deleting SQLite rows and local blobs; local-api edge `POST`/`PATCH`/`DELETE /api/v1/projects/:projectId/canvas/edges/:edgeId` validate receipt-bearing graph/per-edge read proofs before saving the Loro snapshot and record expected/base/after read-token evidence; `FileReplicaStore.updateSnapshotAtomic` serializes recover, read-proof validation, mutation, and snapshot save for local-api Loro writes, with a `save:false` path for rejected mutations; Web UI `useLoroSync` emits accepted/rejected host mutation records around shared guardrails for node add/update/delete, batch delete, timeline apply, and edge add/update/delete; local-api v1 project create/delete/restore, legacy project create/update/delete, asset create/ref-delete/cover-update, generic blob upload, custom-action upload, session create/delete, runtime session create/attach success, validation rejection, and ACP failure, provider account update/delete, provider OAuth start/complete/delete, local sync/audio/runtime config update/install, local audio transcription actions, and local harness action responses use the same accepted/rejected mutation envelope; daemon timeline/text mutations reject materialized downstream checkpoint references by default, honor explicit force, and report `forced: true`; daemon COW replace actions require the same lock/read proof before creating replacement nodes; canvas, asset, asset-ref, asset-gc, project, session, local-config, provider-account, provider-accounts, and provider-oauth read-token validation use the shared `agentReadToken`/`agentReadReceiptToken`/`validateAgentReadProof` primitive from `@clash/shared-types` | Partially implemented | Turn receipt verification on for remaining direct admin exits and any local-api mutation that still accepts client-synthesized state proof |
| Direct patch commands are not projection apply | `canvas update` and Web UI direct node patches can exist only as explicit patch/admin paths | `packages/shared-types/src/canvas-update-guardrails.ts`; `packages/shared-types/src/host-mutation-envelope.ts`; `packages/cli/src/lib/canvas-update-guardrails.ts`; `packages/cli/src/commands/canvas.ts`; daemon `update`/`ensure_edge`; local-api `/api/v1/assets/replace` and `/api/v1/projects/:projectId/canvas/edges/:edgeId`; Web UI `useLoroSync.updateNode/removeNode/removeNodes/addEdge/updateEdge/removeEdge`; Web timeline editor uses `useLoroSync.applyTimelineDsl`; shared guardrails reject timeline/provenance fields, text feeding materialized downstream state, referenced media `assetId` replacement after fulfillment, materialized downstream action checkpoint semantic patches, referenced node deletes, batch deletes that would orphan downstream references outside the deleted set, and checkpoint lineage edge add/update/delete while allowing closed-subgraph deletes and draft/idle downstream placeholders; CLI/daemon agent `update`/`delete` require `--if-match` read tokens and daemon responses return structured mutation records; Web direct commit exits can report structured mutation records through `onMutation`; runtime ACP `timeline_apply` is routed through `useLoroSync.applyTimelineDsl` instead of generic `data.timelineDsl` patching, and runtime ACP writes against pre-existing nodes/edges now pass `actorClientType: agent` plus `ifMatch` into `useLoroSync` so missing-read-proof deletes and edge graph writes are rejected in the live browser smoke; Web multi-node deletion uses `useLoroSync.removeNodes` to validate the whole delete set before mutating Loro, and agent batch deletion uses `canvas delete-plan` plus `canvas delete-batch --if-match` with graph-aware read tokens; `npm --prefix apps/web run test:e2e:host-mutation` covers live browser node add/update/delete, rejected agent delete without read proof, timeline apply, and agent/runtime edge add/update/delete CAS and mutation observability; `canvas replace-asset`, local-api `/api/v1/assets/replace`, and `asset replace --file` are explicit media COW paths; storyboard prompt-pack replacement has an explicit COW projection path | Partially implemented | Add remaining storyboard recovery/rewire guards, force/recovery UX, richer recovery UI, and CI/manual release gating for the live browser mutation suite |
| Materialized checkpoints are protected | Downstream-referenced text/assets/timeline/action semantic content cannot be silently mutated once downstream state is materialized | Text apply rejects materialized downstream references by default while allowing action-draft references and explicit force; explicit `clash text replace` creates a COW text node and leaves existing materialized downstream refs on the old node; timeline apply and legacy push reject materialized downstream render/checkpoint references by default and honor explicit force; explicit `clash timeline replace` creates a COW video-editor node/revision and leaves existing materialized render refs on the old node; direct media `assetId` replacement is blocked once fulfilled; explicit `clash canvas replace-asset` and `clash asset replace --node --file` create COW image/video/audio nodes and leave old downstream refs on the old node; imported local asset files become immutable `local:sha256:<hash>` blobs with SQLite refs, and local-api import rejects same asset id plus different blob identity instead of rewriting an existing row; custom action binary outputs now store a content hash and reject same task/output id with different checkpoint bytes before writing the file; GC removes assets only after SQLite refs are gone, protects explicit ids plus requested or automatically discovered project Loro canvas asset references, refreshes known scanned refs back into `asset_refs`, refreshes node/field/role rows into `asset_node_refs`, and includes first-pass `sourceAssetId`, `referenceAssetId`, and `requiredReferenceAssetIds` style metadata fields | Partially implemented | Add richer version UI/history plus role ontology/provenance materialized dependency index |
| Text nodes become file-editable | Text content should be Markdown projection or text asset | `clash text pull/apply/replace`; daemon `text_cas_update` and `text_cow_replace`; generic text projection lock envelope with legacy sidecar parsing; materialized-reference apply rejection by default with explicit force; COW replacement records source node and content hashes | Partially implemented | Add durable text asset/SQLite model and richer UI/version history |
| Timeline is agent-editable | Timeline can be pulled, edited, applied through CAS and materialized-checkpoint protection | `clash timeline pull/apply/replace`; legacy `canvas timeline pull/push`; daemon `timeline_cas_update` and `timeline_cow_replace`; generic timeline projection lock envelope with `timelineHash` compatibility alias; materialized downstream render/checkpoint rejection; COW replacement records source timeline hash and applied revision lineage | Aligned in code | Add richer version UI/history and extend the same projection envelope to adjacent timeline/editor projections |
| Asset blobs are not duplicated per cwd | Use asset identity/blob store/project refs/links | Local assets exist; `clash asset import --file` stores bytes once under `assets/blobs/<sha256>/original.ext`, returns `local:sha256:<sha256>`, deduplicates identical content, makes blobs read-only, creates optional project `assets/links`, and by default registers local-api `assets`/`asset_refs` metadata; `clash asset replace --node --file` reuses that immutable import path and then forks a COW media node; `/api/v1/assets/import` resolves `/assets/local-blobs/<sha256>/original.ext` back to the global blob store, treats same asset id plus same immutable blob identity as idempotent ref registration, and rejects same asset id plus different content; `/api/v1/assets/replace` binds a registered immutable asset to a new COW media node in the persisted Loro replica and refreshes project asset refs without duplicating blobs; `clash asset gc` and `/api/v1/assets/gc` remove unreferenced SQLite asset rows plus unreferenced `local-blobs` files while preserving explicit protected asset ids and requested or automatically discovered project Loro canvas asset references, including first-pass downstream metadata keys ending in `AssetId`/`AssetIds`, refresh known scanned project refs into SQLite `asset_refs`, and refresh node/field/role usage rows into SQLite `asset_node_refs`; `GET /api/v1/assets/:id/references`, `POST /api/v1/assets/:id/references/refresh`, and `clash asset refs --refresh` expose and refresh that projection without direct DB access or blob deletion, with refresh recorded as an accepted host mutation; `clash asset link` creates project inspection links; symlink fallback copies are forced read-only; `clash canvas replace-asset` forks media nodes without duplicating blobs; `clash doctor storage` reports broken/invalid asset links | Partially implemented | Add role ontology/provenance dependency UI and live UI/E2E evidence |
| JSON/YAML only for agent-editable projections/config | Product DB should not be broad JSON | `apps/local-api/src/local-metadata-store.ts`; `apps/local-api/src/local-provider-store.ts`; new writes go to `local.sqlite`; `db.json` is ignored if present | Aligned for local-api active writes | Keep ignored-legacy tests and avoid new db.json readers/writers |
| Local metadata is SQLite | Projects/assets/sessions/providers/room rows move to local SQLite | Local project, asset, session, message, agent-member, provider, OAuth, room, asset ref, and asset node ref rows now use `local.sqlite`; `clash doctor storage` warns when the asset reference index schema is missing `asset_node_refs`, `reference_role`, or required indexes; `clash doctor storage --repair` ensures that asset reference index schema for old or partial SQLite files; cloud D1 schema exists | Mostly implemented | Add broader schema migration repair and sync-boundary tests |
| Secrets are not projection files | Provider/OAuth/API tokens stay out of agent-editable projections | Local variables endpoints are 404; provider/OAuth sensitive values are encrypted in SQLite, not projections; CLI `config.json` is file-backed but written `0600` | Mostly aligned | Keychain/token-store hardening |
| Remote `user_variable` is compatibility | Keep remote vars for worker actions; not local v1 auth model | Cloud `user_variable`; local endpoints 404; CLI has `vars` scoped to remote worker action variables | Partially aligned | Keep cloud routes; keep local endpoints unavailable |
| Local custom actions are local runtime capabilities | No action-secret shortcut for local; machine must be online | Bridge action host and local action install exist; local-api custom action binary uploads are checkpoint assets and reject same task/output id with different content | Partially aligned | Clarify local auth/runtime setup, shared-project availability, and explicit replacement/version UX |
| Room is project chat, not ACP trace | Keep room as user-visible conversation; raw traces stay private | Cloud `room_message`; CLI `room`; local-api SQLite room endpoints; local room POST returns accepted/rejected mutation records; local and cloud same project/id replays are idempotent only for identical normalized content and reject conflicting content; mirror planner classifies import/export/conflict without overwriting; local responses mark remote room sync disabled; local ACP mention dispatch; raw ACP traces remain separate | Local baseline implemented | Add admission-controlled sync loop, conflict recovery UI, and live room parity tests |
| Raw agent traces stay local by default | Session logs/tool paths not synced unless opt-in | Docs distinguish room vs trace; local session messages now store in `local.sqlite`; local session list returns receipt-bearing session read tokens and agent session delete must present that token before deleting persisted session messages | Partially aligned | Split public metadata from raw trace retention/sync policy |
| Project delete/destructive ops need guardrails | Direct delete must confirm and, for agents, prove a fresh read | `clash projects get --json` exposes active-project `readToken`; `clash projects delete --if-match` passes the token for agent read-before-write CAS and still requires `--yes`; `clash projects get --include-deleted --json` exposes deleted-project restore/purge receipts; `clash projects restore --if-match` passes that receipt for agent restore CAS; local-api soft-deletes projects and preserves sessions/messages; `DELETE /api/v1/projects/:id/purge` plus `clash project purge --yes --if-match` permanently removes deleted local recovery points only after explicit purge confirmation, defaults to a 7-day delay unless `--force` is passed, deletes project-scoped rows and the canonical Loro replica, clears project ownership from retained immutable asset rows, and leaves retained asset blobs/rows for asset GC; accepted v1/legacy project delete plus accepted project restore/purge, session delete, provider account delete, provider OAuth delete, asset-ref delete, asset GC delete, and local-api canvas edge delete write sanitized local mutation audit evidence readable through `GET /api/v1/mutation-audit` and `clash audit mutations` without exposing read receipts; local-api project delete/restore/purge responses include accepted/rejected mutation records; canvas delete rejects downstream-referenced nodes unless `--force` is passed | Partially implemented | Add cloud/shared-project recovery parity, conflict recovery, and broader destructive mutation audit coverage |
| Black-box E2E uses an agent harness | Use `codex exec` with schema artifacts to simulate QA | `docs/agent-first-local-v1-blackbox-e2e-spec.md`; schema JSON; `apps/desktop/e2e/qa-agent-codex.mjs`; short-drama timeline smoke; `apps/desktop/e2e/agent-first-cas-smoke.mjs` covers missing/stale/wrong-file read-proof rejection, text/timeline outside-cwd and symlink-outside-cwd projection path rejection including forced apply, text/timeline, storyboard prompt-pack, and review-gate symlinked lock-sidecar rejection, pipeline validation symlinked QA report rejection, daemon direct canvas read-token rejection/acceptance, public `clash canvas get/update/delete` read-token enforcement through a daemon socket, plus prompt-pack COW source preservation; `apps/desktop/e2e/agent-first-asset-receipt-smoke.mjs` covers local sync/audio/runtime/provider config get/patch/delete, derived agent read-only views, provider model test action mutation recording, local audio install receipt enforcement, local audio transcription action mutation recording, local harness action install/uninstall receipt enforcement, provider OAuth start/complete/delete, immutable asset import, custom action checkpoint overwrite rejection, asset get/cover, asset-ref get/delete plus sanitized audit evidence, asset reference-index refresh mutation recording, asset GC dry-run/delete plus sanitized audit evidence, local-api canvas edge list/delete plus sanitized audit evidence, legacy project delete audit, project restore/purge including restore audit, delayed-purge, replica-removal, and sanitized audit evidence, session list/delete plus sanitized audit evidence, runtime-session attach read-receipt enforcement, and local room message id replay conflict rejection through local-api plus CLI helper paths; `apps/desktop/e2e/storage-doctor-repair-smoke.mjs` covers public CLI project init, read-only storage doctor, parseable failed doctor JSON, repair, secondary canvas replica quarantine, recovery compare, durable recovery manifest/inventory, local-only collaboration mode gates, cloud-sync pending/not-web-openable gates, and post-repair verification for workspace/schema readiness; `npm --prefix apps/web run test:e2e:runtime` passes with runtime ACP same-patch edge create/update/delete host mutation events; latest agent-first CAS run `.tmp/agent-first-cas/2026-07-07T15-10-50-779Z/agent-first-cas-report.json` passed 34 checks; latest storage repair run `.tmp/storage-doctor-repair/2026-07-07T14-04-04-724Z/storage-doctor-repair-report.json` passed 40 checks; latest sync/audio/runtime/provider/OAuth/asset/project/session/room/edge receipt run `.tmp/agent-first-asset-receipts/2026-07-07T13-53-58-435Z/agent-first-asset-receipt-report.json` passed 128 checks through `npm --prefix apps/desktop run test:e2e:asset-receipts`; stub run `.tmp/qa-agent-codex/2026-07-05T06-36-57-683Z/qa-report.json` passed; latest real Codex ACP QA run `.tmp/qa-agent-codex/2026-07-05T07-04-03-855Z/qa-report.json` passed and recorded session cwd plus timeline artifact; direct real layout run `.tmp/real-codex-layout/` passed; real resume layout run `.tmp/real-codex-layout-resume/` passed | Partially implemented | Promote direct canvas patch/read-token from daemon-socket smoke into a live desktop/API project fixture, add more product fixtures beyond pwd/timeline/CAS smoke, and run in CI/manual release gate |

## Code Evidence Index

### Local metadata SQLite

Authoritative code:

- `apps/local-api/src/app.ts`
- `apps/local-api/src/local-metadata-store.ts`
- `apps/local-api/src/local-provider-store.ts`

Evidence:

- `LocalDb` remains the route DTO shape for projects, assets, refs, sessions,
  agent members, messages, provider accounts, and provider OAuth.
- `createDb(dataDir)` reads/writes metadata through `local-metadata-store` and
  provider/OAuth through `local-provider-store`.
- New route and workflow writes use `<dataDir>/local.sqlite`.
- Mutating route writes go through `db.update()`; focused tests cover
  concurrent project, provider, session, and asset requests.
- Metadata/provider SQLite stores use WAL, a 5s busy timeout, foreign keys, and
  `BEGIN IMMEDIATE` write/schema transactions.
- `db.json` is ignored by local-api and reported only as cleanup/secrets risk.

Conclusion:

- Active local-api product DB writes are aligned with v1 storage direction.
- Remaining follow-ups are constraining future cross-process direct writers to
  the same store contract, local room sync, CLI config credential hardening, and
  deeper migration tooling/doctor checks.

### Project context and cwd

Authoritative code:

- `packages/cli/src/lib/project-context.ts`
- `packages/clash-bridge/src/lib/session-cwd.ts`
- `packages/clash-bridge/src/lib/platform.ts`

Evidence:

- Project context resolves from explicit `--project`, marker, then env.
- Marker/env conflicts are rejected.
- Spawned ACP agents currently run in
  `${CLASH_HOME:-~/.clash}/projects/<encodedProjectId>/`.
- The bridge writes `.clash/project.toml`.

Conclusion:

- Direction is correct for alpha.
- `packages/cli/src/commands/projects.ts` now exposes Clash home, editable draft,
  projection, asset-link, and explicit runtime roots plus protected local
  DB/snapshot/runtime paths through `clash project status --json`.
- local-api `GET /api/v1/projects/:id/status` exposes the same path contract
  for explicit project ids.
- `packages/cli/src/commands/doctor.ts` adds read-only storage health checks
  for project context, marker, protected cwd, declared editable roots,
  protected runtime root, Loro replica, SQLite target, local SQLite asset
  reference index schema, broken/invalid asset links, and legacy `db.json`.
- Direct real Codex E2E now fails unless the actual spawned cwd contains
  `drafts`, `projections/text`, `projections/timelines`, `assets/links`,
  `sessions`, and `runtime`, and unless local-api project status exposes
  `runtimeRoot` inside `protectedPaths`.
- Bundled AGENTS.md now tells agents to write only under `editablePaths` and to
  avoid `protectedPaths`, `runtimeRoot`, `snapshot.bin`, `updates.log`, SQLite,
  and legacy `db.json` as direct state surfaces.
- Missing: automatic repair/migration for older layouts and broader store
  recovery validation.

### Loro snapshot/update log

Authoritative code:

- `apps/local-api/src/loro/file-replica-store.ts`
- `apps/local-api/src/sync.ts`

Evidence:

- Loro persistence uses `snapshot.bin` and `updates.log`.
- Snapshot writes are atomic.
- Update log is replayed for recovery.

Conclusion:

- Internal persistence is correct.
- Agent-facing mutation must remain via product commands.

### Timeline CAS

Authoritative code:

- `packages/cli/src/lib/timeline-projection.ts`
- `packages/cli/src/commands/timeline.ts`
- `packages/cli/src/commands/canvas.ts`
- `packages/cli/src/lib/daemon.ts`

Evidence:

- Pull writes YAML and lock.
- Apply reads lock.
- Semantic hash rejects stale writes.
- Daemon path validates expected hash.
- Stdin push requires lock or force.
- Apply/push rejects materialized downstream render/checkpoint references by
  default in daemon-backed and one-shot paths, with draft/idle placeholders and
  explicit force allowed.
- Web timeline editor save uses `useLoroSync.applyTimelineDsl`, not generic
  `updateNode`, and shares the same materialized-checkpoint guard.

Conclusion:

- Timeline is the reference implementation for projection CAS plus first-pass
  materialized-checkpoint protection. Text and timeline now both have explicit
  first-pass COW replacement commands, and text/timeline/storyboard prompt-pack
  plus `apply-metadata` asset metadata locks share the generic projection
  envelope, and edited metadata JSON has an explicit CAS apply command. The
  remaining gap is richer version UI/history plus adoption by future
  non-JSON/storyboard/editor projections.

### Storyboard prompt-pack CAS

Authoritative code:

- `packages/cli/src/lib/storyboard-prompt-pack-projection.ts`
- `packages/cli/src/commands/production.test.ts`

Evidence:

- `clash production project-storyboard-prompt-pack` writes an editable
  prompt-pack JSON plus a sidecar lock.
- The lock uses the generic projection envelope and must include the source
  storyboard action path and source action hash. Apply/replace reject stale
  source actions before any managed prompt-pack exists.
- Apply/replace reject locks with stripped source action proof; an agent cannot
  bypass source CAS by deleting proof fields from the lock JSON.
- Apply/replace reject locks whose generic entity identity disagrees with the
  storyboard asset compatibility field.
- `replace-storyboard-prompt-pack` writes a copy-on-write replacement projection
  instead of mutating the existing managed prompt-pack projection.

Conclusion:

- Prompt-pack editing has first-pass CAS and COW semantics. Remaining storyboard
  work is host/UI integration plus recovery/rewire UX, not blind lock bypass.

### Direct patch/update risk

Authoritative code:

- `packages/cli/src/commands/canvas.ts`
- `packages/cli/src/lib/daemon.ts`

Evidence:

- `clash canvas update` can patch label/content/asset id/arbitrary data.
- Daemon `update` calls `client.updateNode`.
- Web UI `useLoroSync.updateNode` is the browser's central local commit exit.
- Web UI `useLoroSync.applyTimelineDsl` is the explicit local timeline apply
  exit used by `VideoEditorContext`; generic `updateNode` still rejects
  projection-owned `timelineDsl` patches.
- Shared guardrails reject projection/runtime fields, content patches to text
  feeding materialized downstream state, and semantic patches to materialized
  downstream action checkpoints across CLI/daemon/Web UI. Draft/idle downstream
  placeholders remain editable before adoption/run. Web UI node deletion uses
  the shared referenced-delete guard; multi-node deletion validates the whole
  delete set before mutating Loro, allowing closed-subgraph deletes while
  rejecting deletes that would orphan downstream references outside the set.
  Agent batch deletion now has a formal graph-aware read-proof contract:
  `clash canvas delete-plan --node <id> --node <id> --json` reads the target
  node set plus current edge graph, and `clash canvas delete-batch --if-match
  <readToken> --yes` applies it. Daemon agent writes require the host-issued
  receipt; Web `removeNodes` rejects missing or stale batch tokens before
  mutating Loro. Web UI edge add/update/delete and daemon `ensure_edge` block
  input/output mutation of materialized action checkpoint lineage. Existing
  runtime ACP edge add/update/delete paths preserve `ifMatch`/`force` and require
  graph or edge read tokens for agent writes.

Conclusion:

- Useful for direct patching, but cannot be the agent-first file apply path.
- Daemon direct update/delete and media COW replacement now return the same
  structured mutation record used by projection CAS commands.
- Web UI direct node add/update/delete, timeline apply, and edge add/update/delete
  emit the same structured mutation record through `useLoroSync.onMutation`;
  `ProjectEditor` dispatches those records as `clash:host-mutation` browser
  events with `projectId` for desktop/E2E observers.
- `clash canvas edges --json` exposes graph and edge read tokens, `clash canvas delete-plan` exposes graph-aware batch delete tokens, and `useLoroSync`
  rejects missing or stale agent `addEdge`/`updateEdge`/`removeEdge`/`removeNodes` proofs before
  mutating Loro.
- `npm --prefix apps/web run test:e2e:host-mutation` now drives the real
  ProjectEditor in headless Chrome/CDP through mock local runtime canvas writes
  and observes accepted `canvas_add_node`, `canvas_update`, and
  `canvas_delete`, `timeline_apply`,
  `canvas_add_edge`/`canvas_update_edge`/`canvas_delete_edge` events with
  `projectId`; node add/update and timeline records include `afterReadToken`,
  and a separate runtime ACP delete against a pre-existing node without
  `ifMatch` is rejected with `beforeReadToken` and a missing-read-proof error.
- local-api v1 project create/delete/restore, asset create/ref-delete/cover
  update, session create/delete, runtime session create/attach success plus
  validation rejection and ACP start/attach failure, provider account
  update/delete, provider OAuth start/complete/delete, local sync/audio config
  update/install, local harness/agent-server writes, custom-action upload, and
  generic blob upload responses include accepted/rejected mutation records while
  preserving existing list/read response fields and readable UI error copy.
- Agent runtime-session attach now requires the session read receipt before
  invoking the local ACP attach hook; missing/bare/stale session tokens are
  rejected with the same host mutation envelope as session delete.
- Agent local harness install/install-adapter/upgrade/uninstall/authenticate now
  validates the receipt-bearing `GET /api/v1/local/harnesses` read token before
  invoking the local ACP adapter; stale install-state tokens are rejected.
- Still needs storyboard recovery/rewire guards, force/recovery UX, remaining
  local-api endpoint parity, and direct admin operation parity.

### Variables and secrets

Authoritative code:

- `apps/local-api/src/app.test.ts`
- `packages/cli/src/commands/vars.ts`
- `apps/api-cf/src/routes/v1/vars.ts`
- `apps/web/app/lib/db/app.schema.ts`
- `packages/cli/src/lib/config.ts`

Evidence:

- Local variables/action-secret endpoints are tested as 404.
- Cloud still has `user_variable` and `/api/v1/vars`.
- CLI exposes `clash vars` as remote worker action variables and maps 404 to
  an explicit remote-only/local-auth message.
- CLI config stores API key in `${CLASH_HOME:-~/.clash}/config.json` with
  owner-only file permissions.

Conclusion:

- Local vars/action secrets should stay unavailable.
- Remote vars are compatibility, and CLI copy now scopes them to remote worker
  action variables.
- CLI auth/config storage needs secret handling.

### Room

Authoritative code:

- `packages/cli/src/commands/room.ts`
- `apps/api-cf/src/routes/v1/projects.ts`
- `apps/web/app/lib/db/app.schema.ts`
- `apps/local-api/src/app.test.ts`
- `apps/local-api/src/local-acp.ts`

Evidence:

- CLI expects `/api/v1/projects/:pid/room/messages`.
- `clash room read --json` preserves response-level `sync` metadata, including
  `remote_room.enabled=false` for local room reads.
- Cloud schema/routes implement room messages.
- Local-api tests cover SQLite room persistence, same-second pagination,
  duplicate-id protection, same-project same-id content conflict rejection,
  accepted/rejected mutation records, and local ACP mention dispatch.
- Cloud route tests now reject same-project room-message id replays with
  different normalized content, matching the local idempotency/conflict rule.
- Local room sync tests now cover deterministic mirror planning for
  import/export ordering, already-mirrored rows, and same-id content conflicts.
- `apps/local-api/src/room-cli.e2e.test.ts` drives `clash room say/read`
  through a spawned CLI process against a real local-api loopback server and
  asserts `sync.remote_room.enabled=false`.
- CLI reports a generic missing-room-API message on 404 for older targets.
- Local ACP can dispatch room mentions into sessions.

Conclusion:

- Do not remove room.
- Local room persistence/routing baseline is implemented; cloud sync policy is
  narrowed to admission-controlled sync loop wiring, conflict recovery, and live
  UI parity.

## Restriction Matrix

| Capability | Allow in v1? | Required restriction |
| --- | --- | --- |
| Direct `snapshot.bin` access | No product workflow | Debug/recovery only |
| Direct SQLite edit | No product workflow | Admin/debug export/import only |
| Projection file edit | Yes | Pull/edit/apply with lock and CAS |
| Stale projection apply | No by default | `--force` explicit and audited |
| Direct node patch | Limited | Safe fields only; projection/runtime fields and materialized-checkpoint semantic fields guarded |
| Materialized referenced text edit | Yes through COW | No in-place semantic mutation |
| Referenced asset edit | Yes through new asset | No in-place blob overwrite |
| Local room message | Yes | SQLite/D1 rows, not raw trace |
| Raw ACP trace sync | No by default | Explicit opt-in/team policy |
| Local vars/action secrets | No | Provider/OAuth/local runtime auth |
| Remote vars | Compatibility | Remote worker actions only |
| Local custom action in shared project | Yes while machine online | Show unavailable/queue explicitly when offline |
| Project delete | Yes | CLI `--yes` implemented; agent delete uses `clash project get --json` plus `delete --if-match`; local-api soft delete is recoverable through `clash project get --include-deleted --json` plus `restore --if-match`; local purge is a separate confirmed permanent deletion through `clash project purge --yes --if-match`, delayed by default and force-only for explicit admin purge; v1 project delete/restore/purge returns mutation records, legacy delete still returns the same project delete envelope, and accepted v1/legacy project delete plus project restore/purge, session delete, provider account delete, provider OAuth delete, asset-ref delete, asset GC delete, and local-api canvas edge delete write sanitized local audit records; canvas node refs are protected by default |
| Symlinked asset path | Yes as convenience | Resolve and validate real path; immutable target |

## Completion Audit Checklist

The active goal can be marked complete only when these are true:

1. Product principles are documented.
2. local/cloud collaboration boundaries are documented.
3. file projection/CAS boundary is documented.
4. project/cwd/global storage split is documented.
5. db/json/sqlite classification is documented.
6. snapshot/assets/text/timeline entity relationship is documented.
7. current code and CLI/API surfaces have been audited.
8. concrete implementation gaps are listed.
9. restrictions/degradations are explicit.
10. follow-up tasks and test gates are executable.
11. docs are cross-linked from older architecture docs.
12. consistency checks and black-box QA pass.

Current status:

- Items 1-10 are satisfied at the documentation/spec level.
- Item 11 is satisfied at the documentation level; old local/cloud/Loro docs
  link to the v1 docs and this traceability matrix.
- Item 12 is checked with `git diff --check`, JSON parse for schema, desktop
  agent-browser smoke, short-drama timeline smoke, and the Codex QA harness.
- Code implementation remains incomplete for automatic SQLite repair, local
  room sync policy, copy-on-write UI/history, remaining storyboard/asset
  projection adoption, and deeper guardrails.
- Stub ACP, real Codex ACP, direct real Codex layout, and real Codex ACP resume
  layout QA paths passed. The real runs recorded session cwd under
  `~/.clash/projects/<encodedProjectId>` before and after restart and verified the v1
  editable/protected roots existed on disk.

This means the architecture/product-goal deliverable is close, but the broader
implementation state is not v1-complete.
