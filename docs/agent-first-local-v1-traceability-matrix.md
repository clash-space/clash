# Agent-First Local v1 Traceability Matrix

Last updated: 2026-07-10

| Product principle | Implementation | Verification | Status |
| --- | --- | --- | --- |
| One canonical local replica per project/machine | Host-owned Loro replica and SQLite metadata; cwd contains project pointer, drafts, projections, and observations only | Storage doctor, project context tests, secondary replica checks | Implemented |
| Agent owns cwd | Native draft/source/projection files under the linked working tree | Path tests and black-box native edit flows | Implemented |
| Marker is only a project pointer | `.clash/project.toml` accepts only identity/store fields and rejects removed sync/auth sections | Project context tests | Implemented |
| Observation state stores versions only | `worktree-observations.ts` atomic `.clash/observed.json` | Observation unit tests | Implemented |
| Read-before-write is implicit | CLI read adapters record versions; mutations require and compare them internally | Unit plus real CLI missing/stale/re-read tests | Implemented |
| No public mutation bypass | Normal commands expose no manual compare, lock-file, or overwrite option | Command registration tests, skill market tests | Implemented |
| Loro remains canonical collaboration history | Canvas mutations use shared Loro operations/daemon; files are projections | Daemon, shared canvas, Web sync tests | Implemented |
| Downstream reference makes node immutable | Shared `isCanvasNodeImmutable` and host mutation guards | Shared/daemon/black-box immutable tests | Implemented |
| Uniform COW escape hatch | `clash canvas copy`; typed media/text/prompt-pack replacements; Timeline Action copy creates a new Timeline identity | CLI and lineage E2E | Implemented |
| Text is agent-readable/editable | Markdown pull/apply/replace plus host revision index/content | Text command and revision tests | Implemented |
| Timeline is agent-readable/editable | Project Timeline create/list/attach/detach/copy plus YAML pull/apply | Timeline command and daemon tests | Implemented |
| Applied timeline versions are export-pinned | Project Timeline revision ID and semantic hash read from Loro; no sidecar/index | Caption, burn, handoff unit/E2E | Implemented |
| Asset blobs are immutable | Content-addressed storage; metadata/reference operations move pointers | Asset/local API tests | Implemented |
| Editable metadata is a projection | Primary metadata JSON plus source-provenance manifest and cwd observation | Production metadata unit/CLI tests | Implemented |
| Review and prompt-pack writes are stale-safe | Path-bound cwd observations, explicit apply/approve/replace | Production tests and black-box E2E | Implemented |
| Skills remain portable | Skills own cwd artifacts; Clash actions own product apply/collaboration | Registry schema/test and production artifact E2E | Implemented |
| Local and cloud use one mutation model | Local host owns the replica; cloud adds product-internal replication/admission over the same semantics | Local no-auth and remote collaboration tests | Implemented for v1 contract |
| Cloud admission remains product-internal | `SettingsClient` owns **Cloud mirror readiness**, **Canvas mirror ready**, **Asset metadata mirror ready**, and **Revision content mirror ready** switches used by Share/Open-in-Web gates; none of these capabilities come from cwd files or change local CLI semantics | Settings sync-readiness contract and remote-boundary tests | Retained remote behavior |
| Secrets and raw traces stay local by default | Host-owned encrypted/provider stores; no secret projection/room default | Storage/provider/auth tests | Implemented with ongoing hardening |
| `project status` is diagnostic only | Normal commands resolve marker directly; doctor owns deep inspection/repair | CLI docs and project context tests | Implemented |
| Raw replica recovery is separate | `doctor storage-recovery` support surface with compare/confirmation and cloud policy checks | Doctor/recovery tests | Implemented, UX incomplete |

## Open Limits

- Reference rewiring after COW is explicit but still needs richer product UI.
- Revision history is host-indexed but visual diff/restore UX is first-pass.
- Cloud conflict/admission UX must mature without creating a second local model.
- New command families require the same observation adapter and black-box race
  coverage before release.
