# Agent-First Local v1 Black-Box E2E Specification

Status: Required

Last updated: 2026-07-11

## Purpose

Unit tests are insufficient for the local-first contract. Release evidence must
exercise the packaged CLI/local host and the real Desktop ACP path from a fresh
cwd, then verify persisted artifacts and recovery behavior.

## Required Environments

1. Deterministic CLI/local-api harness with isolated `CLASH_HOME`.
2. Codex subscription QA run through `codex exec` with a JSON Schema report.
3. Electron Desktop with the bundled Codex ACP adapter and a real managed cwd.

Cloud credentials must be removed from the deterministic local environment.

## Workspace Path Scenario

From an empty temporary cwd:

1. Run `clash init --project <id>`.
2. Verify `.clash/project.toml` contains the exact Project ID.
3. Run `project status` and verify:
   - `storage.workspace.root` is the marker cwd;
   - canonical SQLite, Loro snapshot, and global asset blob roots are below the
     isolated `CLASH_HOME`;
   - the cwd does not own canonical snapshot or metadata.
4. Create and edit files under `timelines/`, `projections/`, and `assets/links/`.
5. Verify no broad JSON database, Timeline lock, or Timeline revision sidecar is created.

## Project, Canvas, and Timeline Scenario

The CLI smoke must:

- run without `CLASH_API_KEY`;
- create and rename a second Canvas;
- reject an unknown Canvas instead of creating it;
- keep Canvas node scopes isolated;
- create a standalone Project Timeline;
- pull YAML, edit with normal file writes, and apply through implicit CAS;
- attach, detach, and copy Timeline ownership correctly;
- create a distinct Timeline and Action identity for a cross-Canvas copy;
- reject write-before-read, stale observations, and forged receipts;
- hide internal receipts and versions from public JSON;
- persist `.clash/observed.json` with mode `0600`;
- restart the daemon from one Project snapshot and recover all Canvases,
  Timelines, ownership, and node placements.

## Timeline Provenance Scenario

Start a real local daemon containing a Project Timeline whose state matches a
YAML file. Export captions, NLE handoff, and caption-burn artifacts with
`--timeline-id`.

Every manifest, package, ffmpeg plan, and derived Asset metadata row must pin:

- the Project Timeline ID;
- the current Project Timeline revision ID;
- the shared semantic Timeline hash;
- `sourceTimelineRevisionStatus: applied`.

Change either the file or Project Timeline state and verify export fails until
the projection is pulled/applied again. The test must not fabricate a revision
manifest or lock file.

## Text and Asset Scenario

- Pull and edit a text node through Markdown.
- Reject apply after a concurrent change.
- Create a copy-on-write text node when downstream references exist.
- Persist immutable text revision content and verify read-only permissions.
- Import identical media twice and verify one global content-addressed blob.
- Create read-only project links in the marker cwd.
- Reject broken or escaping symlinks.
- Keep existing downstream references pinned after asset replacement.

## SQLite and Storage Scenario

- Start from an empty local store and from deliberately partial schemas.
- Verify local-api/doctor create or repair SQLite tables and indexes.
- Verify old `mutation_audit.forced` and Timeline revision table columns are
  removed from upgraded stores.
- Verify no JSON metadata database is created.
- Verify canonical snapshot, SQLite, secrets, media blobs, and text revision
  blobs are outside the marker cwd and not agent-writable.
- Verify deleting the marker cwd cannot delete canonical Project state.

## Cloud Boundary Scenario

- Local loopback requests and CLI operations succeed without cloud auth.
- Root help and setup documentation present OAuth as optional cloud sync.
- A marker cannot enable sync, sharing, Web access, or membership.
- Hosted OAuth and ProjectRoom tests continue to pass independently.
- Local room persistence/endpoints remain absent.

## Real Desktop ACP Scenario

Launch Electron with the real local-api and bundled Codex ACP adapter. In a
managed Project cwd, send:

```text
Run `pwd` with your shell tool, then answer with only the path.
```

Evidence must show:

- ACP process and tool call are real, not mocked;
- the shell tool row is visible;
- returned `pwd` equals the managed marker cwd;
- the task reaches idle with the final answer visible;
- task/session state persists after leaving and reopening;
- screenshots capture the active run and restored session;
- no cloud credential was needed for Project/Canvas access.

## Codex QA Report

`apps/desktop/e2e/qa-agent-codex.mjs` must run Codex through the user's
subscription and require a schema-valid report. The report cites deterministic
artifacts rather than relying on prose claims. Any failed required check fails
the gate.

## Release Gate

The v1 gate passes only when all deterministic suites, path/storage smokes,
video-production E2E, Codex schema QA, and real Electron ACP checks pass. Mock
UI tests do not substitute for the Electron run.
