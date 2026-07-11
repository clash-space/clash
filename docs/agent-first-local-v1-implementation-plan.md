# Agent-First Local v1 Implementation Plan

Last updated: 2026-07-10

## Goal

Ship one local/agent-first mutation model across canvas, text, timeline, assets,
projects, models, and production projections while preserving cloud
collaboration compatibility.

## Completed Foundation

- [x] Project cwd links through `.clash/project.toml`.
- [x] Cwd observation state stores only semantic entity versions.
- [x] Reads record observations; writes perform implicit read-presence and CAS.
- [x] Public CLI removes manual compare, lock-file, and overwrite controls.
- [x] Recursive public result sanitization hides internal receipts/versions.
- [x] Shared validators enforce read-presence then stale-version checks.
- [x] Shared node immutability uses any downstream edge.
- [x] Uniform `canvas copy` COW action, typed media/text replacements, and
  explicit Project Timeline Action copy.
- [x] Text and timeline native-file workflows create no lock sidecars.
- [x] Review gates, storyboard prompt packs, and asset metadata use path-bound
  cwd observations.
- [x] Downstream exports pin the Project Timeline revision held in Loro.
- [x] Agent skills and marketplace schemas describe implicit host CAS.
- [x] Internal host receipts remain hidden behind cwd observations.

## Release Gates

### 1. Contract tests

- Shared observation and guardrail suites pass.
- CLI daemon/canvas/text/timeline/assets/models/projects suites pass.
- Local API suites pass, including concurrent-write and local no-auth cases.
- Shared types build/tests pass.
- Skill marketplace and video-production artifact E2E pass.

### 2. Black-box behavior

The real CLI subprocess suite must prove:

1. write before read returns `READ_REQUIRED`,
2. read creates the expected cwd observation only,
3. concurrent canonical mutation causes `STALE_READ`,
4. re-read then write succeeds without a manual token,
5. public output does not expose internal receipt/version fields,
6. downstream-referenced nodes report immutable and reject in-place edits,
7. copy preserves old references and creates mutable lineage,
8. text/timeline apply works after native file edits with no sidecar,
9. review/prompt-pack/metadata paths use the same implicit contract,
10. exports pin the applied Project Timeline revision directly from Loro,
11. path/symlink escapes fail before mutation,
12. loopback local workflows work with no cloud credential.

### 3. Documentation

- `AGENTS.md` is the top-level invariant source.
- Agent skills contain only current commands.
- Architecture docs distinguish public cwd observations from internal network
  receipts.
- Recovery-only raw replica operations are clearly separated.

### 4. Diff review

- No broad JSON database state is introduced.
- No new project replica is created in cwd.
- No new mutation command bypasses shared observation/COW guardrails.
- No unrelated inherited worktree changes are reverted.
- Generated artifacts and temp reports are not accidentally committed.

## Follow-Up Work After v1

1. Product UI for explicit reference rewiring after COW.
2. Richer text revision history and Timeline history/restore UX over Loro.
3. Cloud sync admission/conflict UI over the same local replica.
4. Broader asset dependency roles and export provenance inspection.
5. Managed execution for production skills without coupling skills to private
   Clash storage or UI internals.
6. Recovery UX that remains isolated from everyday agent commands.

## Non-Goals

- Direct agent editing of `snapshot.bin`, SQLite, or revision/media blobs.
- Per-agent copies of canonical project state.
- Cloud-specific cwd or mutation commands.
- Per-node command descriptors, reasons, or mutable-field policy in read output.
- Per-keystroke revision logs outside Loro.
- A privileged force/admin mutation path.
