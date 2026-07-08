# Agent-First Local v1 Product Principles

Last updated: 2026-07-07

## Purpose

This document consolidates the product principles that emerged from the
local-first / agent-first architecture review.

The central decision is:

```text
Clash v1 should treat local agents as first-class users, but agents should
mutate Clash project state through explicit product commands, not by writing
opaque CRDT internals directly.
```

This means:

- The user-facing local project has one durable local replica per machine.
- The current working directory is a project reference and editable draft
  workspace, not the owner of the replica.
- Agent-readable files are projections of product entities.
- Any projection that is read, edited on disk, then applied back to the
  project must use CAS.
- Cloud collaboration is a mode layered on the same project model, not a
  separate product truth.

Companion implementation specs:

- `agent-first-local-v1-code-audit.md`: current repo evidence for local DB,
  variables, room, archive, direct canvas update, and timeline CAS surfaces.
- `agent-first-local-v1-cli-cas-audit.md`: command-by-command distinction
  between projection CAS, append-only commands, direct patch guardrails, and
  secret/config limits.
- `agent-first-local-v1-traceability-matrix.md`: requirement-by-requirement
  mapping from product principle to current code evidence, gap, restriction,
  and next action.
- `agent-first-local-v1-api-surface-inventory.md`: local API, cloud API, and
  CLI surface inventory with mismatch matrix and v1 API requirements.
- `agent-first-local-v1-remote-compatibility-boundary.md`: remote/cloud
  surfaces to preserve, local legacy surfaces to remove/keep unavailable, and
  mode-gated deprecation rules.
- `agent-first-local-v1-implementation-plan.md`: prioritized P0/P1/P2 work
  with scope, acceptance criteria, and minimum tests.
- `agent-first-local-v1-blackbox-e2e-spec.md`: Codex-agent black-box QA
  harness, required artifacts, suites, and JSON schema output contract.
- `local-sqlite-migration-spec.md`: replace broad local `db.json` product
  state with local SQLite.
- `local-project-storage-layout-spec.md`: canonical app-root project store,
  cwd as draft/reference surface, asset blob/link policy, session/workspace
  layout, and sync-mode storage boundaries.
- `agent-file-projection-cas-spec.md`: generalize timeline-style
  pull/edit/apply into a safe projection framework for text, storyboard,
  timeline, and asset metadata workflows.

## Non-Negotiable Product Principles

### 1. Local is the primary v1 path

Desktop/local-api must be a complete product path:

- Project creation.
- Canvas editing.
- Local media assets.
- Local agent sessions.
- Local custom actions.
- Room messages.
- Provider configuration.
- Timeline editing.
- Recovery after restart.

Cloud adds sync, web access, backup, and multiplayer. It must not be required
for a single-user desktop project.

### 2. A project has one local durable replica per machine

For a given project id on a given machine, there should be one canonical local
project store under the Clash home root:

```text
${CLASH_HOME:-~/.clash}/projects/<encodedProjectId>/
```

The project store owns:

- Loro snapshot/update log.
- Project asset links/projections.
- Runtime/session workspace scaffolding.

The app-level local metadata DB may physically live at:

```text
${CLASH_HOME:-~/.clash}/local-api/local.sqlite
```

but its project rows must still be keyed to the same project id. The important
product constraint is one logical local project replica per machine, not that
every byte sits under one directory.

Multiple shell directories can point at the same project through
`.clash/project.toml`, but they must not create independent canvas replicas.

### 3. CWD is a reference and draft surface

`cwd` should behave like a working copy, not like the database.

It may contain:

- `.clash/project.toml`, pointing to a project id.
- Agent-created draft files.
- Agent-readable projections such as timeline YAML.
- Temporary generation plans, scripts, or reports.

It must not imply:

- Replica ownership.
- A project lock.
- A separate snapshot.
- Lifecycle ownership of the local host.

### 4. Snapshot is not an agent-editable format

`snapshot.bin` is a Loro persistence artifact. It is not a product document.

Agents should not read or write it directly. Direct snapshot editing would
remove validation, attribution, CRDT merge semantics, and schema control.

The agent-facing alternative is projection:

```text
canvas snapshot.bin
  -> projected files / CLI-readable JSON/YAML
  -> explicit CLI apply command
  -> validated host mutation
  -> new Loro update
```

### 5. Agents are users, not hidden background scripts

An agent mutation should be treated like a user mutation:

- It has actor identity.
- It can be concurrent with human edits.
- It must be visible in history/audit.
- It must participate in conflict handling.
- It can be blocked, rejected, or forced explicitly.

This does not mean agents can bypass product APIs. Human users also do not
edit `snapshot.bin` by hand.

### 6. Every read-edit-apply projection needs CAS

Any command with this shape must carry a stale-read guard:

```text
pull/export/read -> edit local file -> apply/push/write
```

The apply/replace step must compare the current project entity against the
version or hash that was pulled. In other words, overwrite/replacement writes
need a read proof: a lock sidecar, base hash, revision id, or `--if-match`
token produced by an explicit read. Strong agent paths should use a
host-issued receipt attached to the base read token: the base token provides
CAS, while the receipt proves the token came from a read path instead of being
synthesized by a client. Legacy hash-only tokens remain CAS-compatible during
migration, but they are not the final strong read-before-write contract.

The read-before-write rule applies to mutations whose correctness depends on a
previously observed entity state: update, replace, delete, restore, attach, or
metadata fill over an existing record. Pure creation/import/upload of a new
immutable fact does not need a prior target read; those paths must instead use
stable ids, content hashes, idempotency checks, and explicit COW replacement
when they need to affect existing references.

If the source entity changed after the read, or the receipt is missing/invalid
on a receipt-required path, the write must fail unless the caller passes an
explicit force/admin flag. Copy-on-write writes may be idempotent from the same
read proof when they write to content/version-addressed paths and do not move
existing references.

If a caller provides an `expectedReadToken`, the host must treat it as a CAS
precondition regardless of caller type. Agent callers have the additional
read-before-write rule: their token must be host-issued, receipt-bearing proof
unless the write is explicitly forced.

This now applies to timeline, text, storyboard prompt-pack projections, direct
canvas patch commands, and local runtime actions where an agent writes after
reading a host view:

```text
clash timeline pull
clash timeline apply
clash timeline replace
clash canvas timeline pull
clash canvas timeline push
clash text pull
clash text apply
clash text replace
clash text history
clash production project-storyboard-prompt-pack
clash production apply-storyboard-prompt-pack
clash production replace-storyboard-prompt-pack
clash canvas get -> clash canvas update --if-match
clash canvas get -> clash canvas delete --if-match
clash canvas get -> clash canvas replace-asset --if-match
clash canvas get -> clash asset replace --node <id> --file <path> --if-match
clash canvas edges -> runtime ACP add_edge/update_edge/delete_edge readToken
GET /api/v1/local/audio -> PATCH /api/v1/local/audio
GET /api/v1/local/audio -> POST /api/v1/local/audio/install
GET /api/v1/local/harnesses -> POST /api/v1/local/harnesses/:id/install
GET /api/v1/local/harnesses -> DELETE /api/v1/local/harnesses/:id/install
GET /api/v1/local/harnesses -> POST /api/v1/local/harnesses/:id/upgrade
GET /api/v1/local/harnesses -> POST /api/v1/local/harnesses/:id/authenticate
GET /api/v1/provider-oauth -> POST /api/v1/provider-oauth/:providerId/start
GET /api/v1/provider-oauth -> POST /api/v1/provider-oauth/:providerId/complete
```

The same rule applies to `apply-metadata` JSON asset metadata projections and
the explicit `clash production apply-metadata-projection` path. It should later
apply to remaining non-JSON storyboard files, style sheets, and any future
editor timeline projection.

### 7. Mutable files are product projections, not separate truth

Agent-readable files should be generated from product entities and applied
back through commands.

Examples:

- `timelines/main.timeline.yaml`
- `projections/text/<nodeId>.md`
- `storyboards/<id>.storyboard.yaml`
- `metadata/<assetId>.asset.json`, if asset metadata is intentionally
  editable

The path gives agents ergonomic read/write access, but the project store stays
authoritative. For asset metadata, the canonical record is still SQLite; the
JSON file is only a CAS-guarded projection.

### 8. Downstream references require copy-on-write

If a node or asset has downstream references, destructive mutation should not
rewrite it in place.

Rule:

```text
referenced entity + semantic content change = create new entity, preserve edge
lineage, optionally replace selected references
```

This is already natural for image/video/audio assets. It should also apply to
text assets and text-backed nodes once they become file-backed.

For text:

- Typo fixes on an unreferenced draft can update in place.
- A text node used by downstream generation should copy-on-write.
- The new node/file should record `derivedFrom` or equivalent lineage.

### 9. Assets are content-addressable or id-addressable, not duplicated per cwd

Assets should have one logical identity and one canonical local blob unless a
copy-on-write edit creates a new asset.

Multiple project/workspace paths may expose the same asset through:

- stable project-relative references,
- symlinks where safe,
- hard links where useful,
- or materialized cache copies only as an optimization.

The source of truth should remain an asset row plus storage key/content hash.

### 10. JSON/YAML is for agent-editable config, not app databases

Use JSON/YAML only when the product intentionally wants agents or humans to
open and edit the file.

Good JSON/YAML candidates:

- Project marker: `.clash/project.toml`.
- Agent session draft/config, if the agent is allowed to edit it.
- Timeline YAML projection.
- Text-node Markdown projection.
- Explicit local settings intended for agent edits.
- Lock sidecars for projected files.

Bad JSON/YAML candidates:

- Project database.
- Asset index.
- Asset refs.
- Room messages.
- Session rows and message history.
- Provider account rows.
- OAuth token state.
- Runtime/session indexes.

Those should live in SQLite locally, and D1/SQLite in cloud.

Classification rule:

| File or store | Agent direct read | Agent direct write | Reason |
| --- | --- | --- | --- |
| `.clash/project.toml` | Yes | Only through `clash project link/init` | It is a project reference, not a mutation surface |
| `drafts/*` | Yes | Yes | User/agent working area |
| `projections/**/*.{md,yaml,json}` | Yes | Yes, then explicit `apply` | Product projection with CAS |
| `sessions/*` | Yes | Yes, only for documented session artifacts | Agent-readable/editable session projections or configs |
| `*.lock.json` next to projections | Yes | No, except command-generated | CAS evidence; editing it bypasses stale-read safety |
| `sync.json`, `audio.json`, `harnesses.json` | Via settings/CLI for now | Only if documented as config | Narrow local config, not relational product data |
| `credentials.json`, CLI `config.json` | No by default | Auth/setup commands only | Contains bearer credentials or auth state |
| `host.json`, socket/pid files, runtime dirs | Debug only | No | Runtime discovery/ephemeral state |
| `local.sqlite` | No product workflow | No | Queryable product metadata; use API/CLI |
| `db.json` | Migration/debug only | No | Legacy database, not an editable product file |
| `snapshot.bin`, `updates.log` | Debug/recovery only | No | CRDT persistence internals |
| canonical asset blobs | Read through inspect/link commands | No in-place overwrite | Asset identity and downstream refs require COW |

### 11. Secrets are local runtime capabilities, not canvas content

Local custom actions should stay local unless explicitly published or synced.

For local use:

- The user installs or downloads local-api.
- The action goes through the standard local auth/OAuth setup flow.
- Secrets stay in the local runtime store.
- Shared projects can route to a user's local runtime only while that runtime
  is online or reachable.

Do not keep compatibility layers that preserve a secret API only for legacy
custom actions if v1 has no real shipped dependency on it.

### 12. Do not delete remote/cloud behavior while making local primary

Local-first does not mean cloud-hostile.

Cloud remains required for:

- Web access.
- Multi-device sync.
- Shared projects.
- Multiplayer presence.
- Cloud backup.
- Remote asset availability.

Local refactors must preserve cloud schema and cloud execution paths unless a
specific migration removes them intentionally.

### 13. Source-level correctness is not enough

The real desktop path may run generated or bundled artifacts, especially
workspace package `dist/` files.

Agent-first guarantees must be tested at the runtime boundary:

- build the local agent bridge before real desktop E2E,
- assert spawned agent cwd and filesystem layout from the OS,
- fail if declared editable roots are missing,
- fail on renderer lifecycle errors,
- keep stub and real-agent tests labeled separately.

This prevents a source-only fix from passing while the real Codex/ACP runtime
still executes stale code.

## Storage Classification

### Loro snapshot/update log

Use for:

- Canvas nodes.
- Canvas edges.
- Stable committed layout.
- Canvas-visible task projections.
- Shared custom action definitions that belong on the canvas.

Store as:

```text
${CLASH_HOME:-~/.clash}/projects/<encodedProjectId>/loro/snapshot.bin
${CLASH_HOME:-~/.clash}/projects/<encodedProjectId>/loro/updates.log
```

Current local-api may physically store the Loro replica under
`${CLASH_HOME:-~/.clash}/local-api/projects/<encodedProjectId>/loro/`; the
invariant is one logical local replica per project per machine, not that every
byte is under the agent cwd.

Restriction:

- Agents never edit these files directly.

### SQLite local database

Use for queryable local product state:

- Projects.
- Assets.
- Asset refs.
- Room messages.
- Runtime sessions.
- Chat/session messages.
- Agent members.
- Provider accounts.
- Provider OAuth.
- Runtime rows.
- API tokens.
- User variables if any remain.

Target shape should mirror the cloud D1 schema where possible.

Restriction:

- Agents should use CLI/API for normal mutations.
- Direct SQLite edits are debug/admin only, not a product workflow.

### Filesystem assets

Use for immutable or copy-on-write blobs:

- Images.
- Videos.
- Audio.
- Text assets if file-backed.
- Generated exports.

Restriction:

- Direct file overwrite is allowed only for unreferenced drafts.
- Referenced asset edits create a new asset.

### Agent-editable projection files

Use for product entities that benefit from native file tools:

- Timeline.
- Text nodes.
- Storyboards.
- Prompt packs.
- Maybe style/theme configs.

Required sidecar:

```text
<projection>.lock.json
```

Required apply behavior:

- validate schema,
- verify project id and entity id,
- compare CAS hash/version,
- write through host mutation API,
- emit actor attribution,
- fail stale writes unless `--force`.

Projection files are the only product files agents should edit with native
read/write tools. Draft files can be edited freely because they are not product
state yet. Databases, CRDT files, runtime files, credential files, and canonical
asset blobs must stay behind commands or APIs.

## Current State Assessment

### Already aligned

- Project context resolver treats `.clash/project.toml` as a marker, not a
  replica owner.
- Local bridge creates stable project cwd under
  `${CLASH_HOME:-~/.clash}/projects/<encodedProjectId>`.
- Local bridge materializes v1 workspace roots under that cwd:
  `drafts`, `projections/text`, `projections/timelines`,
  `projections/storyboards`, `projections/prompts`,
  `projections/metadata`, `assets/links`, `sessions`, and protected
  `runtime`.
- Real Codex desktop E2E now asserts that those roots exist in the spawned
  agent cwd, including after session restore.
- Local Loro persistence has `snapshot.bin` plus `updates.log`.
- Local host discovery is user-level, not cwd-level.
- Runtime capabilities distinguish local assets/local Loro from hosted cloud.
- Cloud schema already uses SQLite/D1 tables for projects, assets, asset refs,
  provider accounts, provider OAuth, runtime sessions, chat messages, room
  messages, and agent members.
- Agent runtime-session attach is a write to an existing session and therefore
  requires that session's read receipt before invoking the local runtime attach
  hook.
- Timeline projection now has CAS sidecars and stale-write rejection.
- Text projection now has body-only Markdown CAS and materialized-reference
  rejection.
- Review gates now use path-bound hash locks, so approval decisions require
  the lock generated for the same gate file and reject stale or copied-file
  lock reuse.
- Storyboard prompt-pack locks require source action path/hash proof; stripping
  those fields makes the lock invalid instead of weakening source CAS.
- Direct canvas delete now requires explicit confirmation and rejects
  downstream-referenced nodes unless forced; Web UI multi-node deletion validates
  the whole delete set atomically and allows only closed-subgraph deletes. Agent
  batch delete has a graph-aware read proof contract:
  `clash canvas delete-plan --node <id> --node <id> --json` reads the target
  node set plus current edge graph, and `clash canvas delete-batch --if-match
  <readToken> --yes` applies it through host CAS.

### Misaligned or incomplete

- Local-api product metadata has moved to `local.sqlite`; `db.json` is ignored
  by local-api and is only a cleanup/secrets warning if present.
- Provider credential/OAuth payloads are now encrypted before SQLite write;
  direct SQL writes must not bypass `local-provider-store`.
- Room messages exist in cloud schema, but local room persistence should be
  SQLite-backed and first-class rather than incidental local JSON state.
- Agent cwd currently is the canonical project directory. That is workable for
  v1 alpha, but the product model should distinguish canonical project store
  from draft/projection workspace.
- Asset files are stored under local-api `assets/`; first-pass project-visible
  links exist through `clash asset link --asset <id>`, but content-addressed
  dedupe, import, replace/COW, and GC policy are still incomplete.
- Text nodes now have first-pass Markdown projection commands
  (`clash text pull/apply/replace`) with CAS, default materialized-reference
  rejection, explicit COW replacement, and an explicit `--force` checkpoint
  rewrite escape hatch. Successful apply/replace creates an applied text
  revision milestone with source file path, content hash, parent revision, and
  actor attribution, and local-api indexes those applied revisions in
  host-owned SQLite for lookup by project/node. The displayed text content is
  still stored as canvas `data.content`; a canonical file-backed text asset
  mode and richer history UI remain future work.
- Timeline now has first-pass YAML projection commands
  (`clash timeline pull/apply/replace`) with CAS, default materialized-render
  rejection, explicit COW/video-editor revision replacement, and an explicit
  `--force` checkpoint rewrite escape hatch. The projection framework is still
  not generalized for storyboard/prompt/editor timeline families.
- Direct canvas update commands still exist as command-style patch/admin
  operations. Projection/provenance field guardrails, materialized text
  reference rejection, and first-pass atomic Web UI batch-delete guardrails are
  in place, but direct patching must not become a substitute for file projection
  apply semantics.
- Local custom action auth has moved conceptually toward local OAuth/local-api;
  local action-secret endpoints should stay unavailable, while remote worker
  variables remain cloud compatibility only.

## Required Restrictions

### Restrict raw snapshot access

No user-facing or agent-facing workflow should instruct agents to edit
`snapshot.bin`.

Allowed:

- export/import for backup,
- debug inspection tooling,
- recovery tooling,
- Loro-host internal persistence.

Not allowed:

- direct node edits by binary patch,
- direct timeline edits in snapshot,
- direct text-node edits in snapshot.

### Restrict blind apply

Every projection apply must require a lock unless `--force` is present.

`--force` should be explicit and logged as intentional overwrite. The local
API now has first-pass sanitized mutation audit evidence for v1/legacy project
delete plus project restore/purge, session delete, provider account delete,
provider OAuth delete, asset-ref delete, asset GC delete, and local-api canvas edge delete,
readable through `GET /api/v1/mutation-audit` and `clash audit mutations`;
broader forced projection/daemon/Web direct writes should join the same
audit model instead of generating unbounded generic edit logs. In shared
projects it may need stronger permission or UI confirmation.

### Restrict in-place mutation of referenced content

Referenced assets/text nodes should be immutable for semantic content changes.

Allowed in-place:

- metadata repair,
- label changes,
- unreferenced drafts,
- non-semantic formatting where product rules allow it.

Not allowed in-place:

- replacing the content of an image/video/audio asset,
- changing text content used by downstream generations,
- changing a storyboard/timeline segment that another entity derives from
  without copy-on-write or explicit replace semantics.

### Restrict filesystem projection scope

Agents can use native file tools only inside approved project/draft roots.

Projection paths must be derived from entity ids and sanitized. Apply commands
must reject paths that escape the project workspace or lock/entity mismatch.

### Restrict secrets in projections

Projected files should not include API keys, OAuth tokens, provider secrets,
runtime credentials, or private local paths unless the projection is explicitly
local-only and marked sensitive.

### Restrict cloud claims for local-only projects

Do not show local-only projects as web-openable. Do not label a project
`Synced` unless canvas, room messages, and needed asset metadata have a real
sync path.

### Restrict local-only actions in shared projects

Local custom actions and local agents can participate in shared projects only
as user-owned runtime endpoints.

If the owner's machine is offline:

- show unavailable,
- queue only if the product explicitly supports queueing,
- or require another user/runtime to take over.

Do not silently run them as cloud workers.

## Implementation Matrix

| Surface | Current state | v1 target | Required limit | Next step |
| --- | --- | --- | --- | --- |
| Canvas replica | Local Loro `snapshot.bin` + `updates.log` exists | One local durable replica per project per machine | No direct agent writes to `snapshot.bin` | Keep persistence internal; expose projections/CLI only |
| Project marker | `.clash/project.toml` resolves project id | CWD is a reference/draft workspace | Marker is not a lock or replica | Keep resolver priority and conflict errors |
| Agent cwd | `${CLASH_HOME:-~/.clash}/projects/<encodedProjectId>` is agent cwd with materialized editable roots and protected `runtime`; marker stores canonical id | Either canonical root with protected dirs, or separate draft workspace | Agents should not mutate internal dirs directly | Decide root vs draft model; add migration/repair and stronger enforcement |
| Local metadata | `local.sqlite`; legacy `db.json` ignored | `local.sqlite` matching cloud D1 schema | JSON is not app DB | Keep ignored-legacy tests and add doctor/schema checks |
| Assets | Local files + SQLite asset rows plus first-pass `clash asset link`; `clash asset get` / `GET /api/v1/assets/:id` returns receipt-bearing asset read tokens; `clash asset ref get` / `GET /api/v1/assets/:id/ref?projectId=...` returns receipt-bearing relation read tokens; `clash assets gc --dry-run --json` / `/api/v1/assets/gc` returns receipt-bearing `asset-gc` plan tokens; `/api/v1/assets/import` is idempotent for the same immutable blob identity and rejects reusing an asset id for different content; asset create/cover writes reject storage keys that escape local asset storage; blob upload, asset reads, workflow generated asset writes, local blob import reads, and GC deletion share real filesystem containment so symlinked storage roots or parents cannot escape local asset storage; agent cover metadata updates, ref deletes, and destructive GC deletes require the matching receipt | SQLite asset rows + canonical content-addressed blobs/links | No in-place overwrite of referenced blobs; content changes require new asset id plus explicit COW replacement; metadata fill/update, relation delete, and GC delete paths need CAS/read receipt | Define content id, import/replace COW, and remaining metadata guards |
| Text nodes | Canvas `data.content` with `clash text pull/apply/replace/history/content` Markdown CAS/COW projection plus `clash.text.revision` applied milestones, local SQLite `text_revisions` index/API, and immutable text revision content blobs | File-backed projection or text/content revision asset with CAS and COW | Text feeding materialized downstream state is copy-on-write; text feeding only action drafts remains editable | Add optional file-backed canonical mode, richer version UI/history, and sync mirror policy |
| Timeline | YAML projection with `clash timeline pull/apply/replace/history/content` CAS/COW workflow plus `clash.timeline.revision` applied milestones, local SQLite `timeline_revisions` index/API, and immutable timeline revision content blobs | Shared projection framework | No blind apply; materialized renders keep old timeline input unless explicitly replaced | Add richer version UI/history and export/render views pinned to revision ids |
| Room | CLI command + cloud schema + local SQLite endpoints; local and cloud same-project/id replays are idempotent only for identical normalized content; mirror planner classifies import/export/conflict without overwriting; `clash room resolve-conflict` records hash-checked accepted divergence receipts | Project chat in local SQLite and cloud D1 | Room is not raw agent trace; client ids cannot become blind overwrite handles | Wire broader admission controls, conflict recovery UI, and live parity |
| Agent session | SQLite session/chat rows; agent attach to an existing runtime session requires the session read receipt | SQLite session/chat rows, raw traces local by default | Do not sync raw traces by default; existing-session attach is not a blind write | Split public metadata from private raw event history |
| Provider auth | Provider accounts/OAuth in SQLite with encrypted sensitive values; agent OAuth restart/complete/delete over an existing row requires a receipt-bearing `GET /api/v1/provider-oauth` token before the OAuth driver or delete path is invoked | SQLite encrypted credential/OAuth rows | No secrets in projections/canvas; no agent reset of existing local auth state without read receipt | Keep key-source and migration tests |
| User variables | Legacy cloud table and CLI surface | Compatibility only, or removed | Do not make variables the main local auth model | Decide deprecate vs SQLite compatibility bridge |
| Local custom actions | Local runtime registration; binary uploads become checkpoint assets that reject same task/output id with different content | User-owned runtime capability | No secret-based cloud-like runtime shortcut; no silent overwrite of published checkpoint outputs | Require local-api auth/OAuth setup and explicit replacement/version UX |
| Direct canvas update/delete | Shared guardrails cover CLI/daemon/Web UI direct patches/deletes: safe metadata can be patched; timeline/provenance fields, text feeding materialized downstream state, referenced media `assetId` replacement, materialized downstream action checkpoint fields, referenced node delete, batch delete that would orphan downstream references outside the deleted set, and checkpoint lineage edge add/update/delete are blocked by default; `hasRun` alone does not lock an action, and pending media first fulfillment plus draft/idle downstream placeholders are allowed. CLI/daemon direct `update`/`delete` require an agent `readToken` from `canvas get --json` via `--if-match`, unless explicitly forced. Existing Web/runtime edge add/update/delete writes require graph or edge `readToken` values from `canvas edges --json` when the caller is an agent; ACP `add_edge`/`update_edge`/`delete_edge` preserves `ifMatch`/`force` into `useLoroSync`, with same-patch create-and-consume edges exempted when they connect a newly created node. Local-api edge HTTP actions mirror that contract: `GET /api/v1/projects/:projectId/canvas/edges` returns receipt-bearing graph/per-edge tokens, `POST` uses the graph token, and `PATCH`/`DELETE` use the per-edge token. In the daemon path, `canvas get` returns a host-issued receipt-bearing token, and agent `update`/`delete`/media COW writes reject bare hash tokens. Local-api project write paths also require receipt-bearing project read tokens for agent update/delete. Local-api media COW now uses `/api/v1/projects/:projectId/canvas/nodes/:nodeId` to issue receipt-bearing node read tokens, and `/api/v1/assets/replace` rejects agent writes with bare node CAS tokens. `canvas replace-asset` is the explicit COW path for fulfilled media asset replacement. Web UI multi-node deletion uses a single host mutation path that validates the whole delete set before mutating Loro, allowing closed-subgraph deletes while rejecting external orphaning. Agent batch delete uses `canvas delete-plan` plus `canvas delete-batch --if-match`, with daemon-issued receipt tokens required for spawned-agent writes and matching graph-aware tokens accepted by Web `useLoroSync.removeNodes`. | Explicit patch/admin command, not file apply path | No bypass of CAS/read-token or materialized-checkpoint protection | Add specialized storyboard replace/recovery guards, remaining direct/admin receipt coverage, and force/recovery UX |
| Cloud sync | Existing cloud paths | Optional Synced/Shared modes | Do not label partial sync as full sync | Add explicit project mode/status gates |

## Restriction Matrix

| Restriction | Why | Allowed escape hatch |
| --- | --- | --- |
| Agents cannot edit `snapshot.bin` | Opaque CRDT binary has no product validation or attribution | Debug/recovery tools only |
| Projection apply requires CAS lock | Prevents overwriting human/collaborator changes | Explicit `--force`; destructive/forced host exits should leave sanitized local audit evidence |
| Materialized checkpoints are protected | Downstream generations need stable inputs once outputs have materialized | Copy-on-write/versioned replacement and optional replace refs; custom action output reruns must use a new task/output id or explicit replacement |
| Secrets never appear in projections | Prevents accidental agent/file exfiltration | Local-only encrypted config store |
| Local-only projects are not web-openable | Web needs cloud copy and assets | Enable Sync |
| Local actions do not silently run in cloud | Runtime belongs to a user/machine | Explicit cloud worker action type |
| Raw agent traces stay local by default | Tool logs and paths are sensitive | User/team opt-in sync |
| SQLite is not an agent editing surface | Database edits bypass product rules | Admin/debug command with backup |
| Direct patch commands are not projection apply | Blind patches bypass stale-read semantics | Explicit debug/admin patch with checkpoint/reference checks |

## Needed v1 Work

### P0: Keep local `db.json` replaced by local SQLite

These have moved out of active `db.json` writes:

- projects,
- assets,
- assetRefs,
- sessions,
- sessionMessages,
- agentMembers,
- providerAccounts,
- providerOAuth.

Reuse the cloud D1 schema names where possible. Do not add `db.json` readers
or writers back into local-api; doctor may warn about an existing file only for
cleanup/secrets hygiene.

Keep JSON only for narrow, intended-to-edit config files such as `sync.json`
and `audio.json`, and revisit even those once settings become richer.

Implementation spec: `local-sqlite-migration-spec.md`.

### P0: Generalize projection CAS

Extract a shared projection framework:

```text
pull(entity) -> file + lock
apply(file + lock) -> validate + CAS + host mutation
```

Timeline and text are the first implementations. Next targets:

- storyboard YAML,
- editor timeline/project plan,
- prompt/script packs.

Implementation spec: `agent-file-projection-cas-spec.md`.

### P0: Text nodes as file-backed assets/projections

Define text-node storage:

- canvas node holds stable node id, label, content asset id, and display state;
- text content exists as a readable Markdown file projection;
- apply writes through CAS;
- downstream references trigger copy-on-write.

Current first pass:

- `clash text pull/apply` writes `projections/text/<nodeId>.md` and a sidecar
  CAS lock.
- daemon `text_cas_update` validates the expected content hash for persistent
  connection writes.
- Text apply rejects materialized downstream checkpoint rewrites by default,
  while allowing unmaterialized action-draft references and explicit `--force`
  checkpoint rewrites.
- Text apply/replace now records `clash.text.revision` milestones in refreshed
  locks and COW replacement node data, including source file path, content hash,
  parent revision, and actor attribution.
- Local-api persists applied text revision metadata in SQLite `text_revisions`
  through `POST /api/v1/text-revisions`, and exposes project/node lookup through
  `GET /api/v1/projects/:projectId/text-revisions`. `clash text apply/replace`
  registers the revision plus applied Markdown body with that host API after a
  successful canvas apply. The host stores the body as an immutable
  content-addressed text revision blob and exposes it through
  `GET /api/v1/projects/:projectId/text-revisions/:revisionId/content`.
- `clash text history` exposes the host-owned revision index to agents without
  making SQLite an editable or directly readable product surface.
- `clash text content --revision <id> [--out <path>]` exposes the immutable
  Markdown body for a selected revision through the same host boundary; output
  files must remain inside the agent cwd.
- Text is still stored in canvas `data.content`; optional file-backed canonical
  text mode, richer visual history UI, and local-to-cloud revision sync policy
  remain future work.

### P0: Timeline milestones as host-indexed revisions

Current first pass:

- `clash timeline pull/apply/replace` keeps the YAML projection and CAS lock
  as the agent-editable surface.
- Successful timeline apply/replace records a `clash.timeline.revision`
  milestone in refreshed locks and COW replacement node data, including source
  file path, timeline hash, parent revision, actor, Loro frontier/version
  metadata when available, and summarized dependencies.
- Local-api persists applied timeline revision metadata in SQLite
  `timeline_revisions` through `POST /api/v1/timeline-revisions`, and exposes
  project/node lookup through
  `GET /api/v1/projects/:projectId/timeline-revisions`.
- `clash timeline apply/replace` registers the revision plus applied YAML body
  with that host API after a successful canvas mutation. The host parses the
  YAML, validates the semantic timeline hash, stores the body as an immutable
  timeline revision blob, and exposes it through
  `GET /api/v1/projects/:projectId/timeline-revisions/:revisionId/content`.
  Older hosts remain compatible when the index endpoint is unavailable.
- `clash timeline history` exposes the host-owned milestone index to agents
  without making SQLite an editable or directly readable product surface.
- `clash timeline content --revision <id> [--out <path>]` exposes the immutable
  YAML body for a selected revision through the same host boundary; output
  files must remain inside the agent cwd.
- Timeline body/history remains canonical in the Loro canvas state; the SQLite
  index is only for query/provenance milestones, not a per-keystroke log.

### P1: Project directory layout policy

Define the final local shape:

```text
~/.clash/
  local-api/
    local.sqlite
  assets/
    blobs/
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
      drafts/
      sessions/
      runtime/
```

For v1 alpha, local SQLite should stay under the local-api data boundary and
key rows by `project_id`. A later export/portable-project feature may
materialize project rows into a bundle or project-scoped SQLite file, but cwd
must still not own the database.

Decide whether agent cwd is the canonical project root or a draft workspace
that references it. If it remains the canonical root for v1 alpha, document
which subdirectories are agent-editable and which are internal.

Implementation spec: `local-project-storage-layout-spec.md`.

### P1: Asset projection and link policy

Define whether project-visible asset paths are:

- canonical files,
- symlinks to content-addressed blobs,
- hard links,
- or generated projection copies.

Rules needed:

- no unnecessary duplication,
- safe path names,
- cross-project reference support,
- copy-on-write on edits,
- GC only after no refs remain, with agent deletion gated by a fresh dry-run
  receipt for the current deletion plan.

### P1: Local room persistence and routing

Local room messages should be SQLite rows matching cloud `room_message`.

Room messages are project-visible conversation. Agent session internals are
separate session/chat rows and remain local/private by default.

Local room create is append-first: a client-provided message id may replay only
the same normalized sender/text/mentions payload. Reusing the id for different
content is a conflict, not an update.

Cloud-configured local rooms expose sync as an explicit action, not an implicit
background write. Reads can report `remote_room.status=pending`; only
`clash room sync` / `POST /api/v1/projects/:projectId/room/sync` may import
remote-only rows, export local-only rows, or report `mirrored`/`failed` with a
host mutation envelope.

Same-id room conflicts remain append-only. A user or agent may explicitly
acknowledge an inspected conflict with `accept-divergence` only by presenting the
local and remote content hashes from the conflict plan. The resolution is stored
as SQLite room sync state, with mutation audit as evidence, so later sync can
unblock unrelated rows without overwriting either side.

### P1: Host-owned mutation API

CLI and local agents should converge on a host-owned mutation API:

- actor context,
- command validation,
- mutation envelope,
- Loro update emission,
- audit trail.

The current CLI still has legacy direct one-shot Loro paths. Those should
be hidden, removed, or kept as debug-only once local host is stable.

### P2: Sync mode boundaries

Implement explicit modes:

- Local-only,
- Synced,
- Shared.

Each mode should define:

- source of real-time sequencing,
- asset availability,
- room message authority,
- local runtime availability,
- what web can open.

## Design Decisions To Make Explicit

1. Is the default agent cwd the canonical project root or a draft workspace?

Current implementation uses the canonical
`${CLASH_HOME:-~/.clash}/projects/<encodedProjectId>`.
That is simple and probably acceptable for v1 alpha, but internal files
   must be protected by `project status`/`doctor` visibility, real E2E layout
   gates, and apply commands. This is not yet a full OS-level sandbox.

2. Should `sync.json` and `audio.json` remain JSON?

   They are local settings and are small. They can stay JSON if agent editing
   is a deliberate product feature. Otherwise they should eventually move to
   SQLite settings rows.

3. Are user variables still a product concept?

   Cloud schema still has `user_variable`, but local direction prefers provider
   accounts/OAuth and local runtime auth. If variables remain, they should be
   a compatibility bridge, not the main credential model.

4. Is `room` removed or kept?

   Keep room as project chat. Remove only legacy room assumptions if any.
   Room is not agent trace; it is the shared project conversation. Remote room
   mirroring is explicit and conflict-aware in v1, not background sync.

5. How much of an agent session is syncable?

   Default answer: sync room messages and high-level session metadata. Keep raw
   ACP events, tool logs, local paths, and scratch context local unless the user
   opts in.

## v1 Operating Contract For Agents

Agents should be taught:

1. Resolve project context with `clash project status --json`.
2. Inspect canvas with CLI commands.
3. For projected entities, use pull/edit/apply.
4. Never edit `snapshot.bin`.
5. Never overwrite a projection without its lock unless explicitly instructed.
6. Treat `--force` as destructive and explain it.
7. Use room messages for human-visible project communication.
8. Keep raw scratch files in draft/projection directories.
9. Use copy-on-write for referenced content.
10. Do not assume cloud availability for local-only projects.
