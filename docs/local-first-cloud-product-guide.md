# Clash Local-First + Cloud Collaboration Product Guide

Last updated: 2026-06-05

## Product Thesis

Clash should be a local-first creative agent workspace.

Desktop is the primary runtime. Cloud is an optional sync, web access, and multiplayer layer. Web is a cloud-attached client, not the default source of truth for every project.

The product reference is:

- Anytype for local-first data ownership, optional network modes, encrypted backup/sync, and shared spaces.
- Figma for real-time multiplayer, presence, permissions, and a reliable cloud sequencer with journal/checkpoint persistence.

This does not mean copying either product surface. Clash's distinctive surface is creative canvas + media assets + AIGC processors + local agent daemon.

v1 local/agent-first follow-up docs:

- `agent-first-local-v1-principles.md`
- `agent-first-local-v1-traceability-matrix.md`
- `agent-first-local-v1-implementation-plan.md`
- `agent-first-local-v1-remote-compatibility-boundary.md`
- `local-sqlite-migration-spec.md`
- `agent-file-projection-cas-spec.md`

Those docs refine this guide with concrete storage, SQLite, projection/CAS,
and agent-editability constraints.

## Principles

1. Default to local.

   A new desktop project should work without cloud login, OSS, remote workflow, or remote media processing. Local project creation, canvas editing, AIGC mock/provider calls, agent chat, room messages, and assets should all function through local API + local storage.

2. Cloud is an upgrade, not a dependency.

   Cloud enables web access, backup, multi-device sync, and multiplayer sharing. It should not be required for the single-user desktop path.

3. Make network state visible.

   Users should always know whether a project is Local-only, Synced, or Shared. This is product state, not hidden infra.

4. Separate human team membership from agent agent identity.

   Human collaborators are project members. Agent members are user-owned agent actors bound to a runtime and an agent CLI. A shared project can contain multiple humans, each bringing their own local agent.

5. Sync shared context before private traces.

   Canvas state, project metadata, room messages, and asset metadata are sync-worthy. Detailed agent session traces, local file paths, tool logs, and raw agent scratch context are sensitive and should be local by default or opt-in for sync.

6. Shared projects need a cloud sequencer.

   For multiplayer, cloud ProjectRoom should order updates, validate permissions, broadcast presence, and persist a journal. Do not try to make the first shared version fully P2P.

## User-Facing Modes

### Local-only Project

The default desktop mode.

User promise:

- Works offline.
- Data stays on this machine.
- Local agent and local AIGC processors work.
- Web cannot open this project.
- Other users cannot join.

Backend authority:

- Local API owns project metadata, room messages, agent members, assets, and Loro state.
- Local Loro room is the canvas source of truth.
- Local assets live on disk.
- Local agent sessions run through desktop-local runtime.

Primary UI signals:

- Badge: `Local`
- Settings action: `Enable Sync`
- Status copy: `Stored on this Mac`

### Synced Project

The user enables cloud sync for web access, backup, or multi-device work.

User promise:

- Desktop remains fully usable offline.
- Changes sync to cloud when online.
- Web can open the project from the cloud copy.
- Remote media loads on demand.
- Agent work still prefers the user's local runtime.

Backend authority:

- Local remains the best interactive source when desktop is active.
- Cloud stores a remote Loro mirror, room message log, project metadata, asset metadata, and optionally media blobs.
- Conflicts are merged through Loro for canvas state.
- Append-only logs are merged by stable message ids and project sequence.

Primary UI signals:

- Badge: `Synced`
- Sync health: `Local saved`, `Syncing`, `Synced`, `Offline changes`, `Cloud unavailable`
- Web action: `Open in Web`

### Shared Project

The user invites collaborators.

User promise:

- Multiple people can edit and chat in real time.
- Permissions are explicit.
- Everyone sees presence, cursors, and room messages.
- Each user can attach their own local agent if their machine is online.
- If a user's daemon is offline, mentions/tasks queue or show unavailable.

Backend authority:

- Cloud ProjectRoom becomes the real-time sequencer for Loro updates.
- Cloud room message log is authoritative for project-wide chat.
- Cloud project membership controls access.
- Local runtimes attach as user-owned execution endpoints, not as global project workers.

Primary UI signals:

- Badge: `Shared`
- Members panel: Owner, Editor, Viewer
- Runtime/agent status per user: `Online`, `Offline`, `Local only`, `Queued`

## Data Model Guide

### Canvas State

Use Loro for canvas state: nodes, edges, project-level visual metadata, custom action definitions that belong in the shared canvas context.

Local-only:

- Stored in local Loro snapshot/update log.

Synced:

- Local app mirrors Loro updates to cloud remote persistence.
- Cloud can serve web clients from snapshot + update log.

Shared:

- Cloud ProjectRoom sequences live updates.
- Local desktop imports cloud updates and keeps a local cache.

### Project Room Chat

Room chat should be append-only and syncable.

Store:

- message id
- project id
- sender kind: user or agent
- sender user id
- sender agent member id when applicable
- mentions
- text/content parts
- created sequence/time
- sync status

Room chat should sync in Synced and Shared projects. It is the user-visible project conversation and should be available in Web.

### Agent Session Log

Agent session logs are not the same as room chat.

Default local-only fields:

- raw ACP events
- tool calls
- local paths
- command output
- scratch reasoning or internal trace
- file reads/writes

Sync-safe fields:

- session id
- agent member id
- title
- high-level status
- user-visible assistant messages
- selected artifacts
- optional summary

Product rule:

- Sync room chat by default once project sync is enabled.
- Sync detailed agent logs only with explicit setting or team policy.
- Project status exposes this split as `collaboration.tracePolicy`: room
  messages and public session metadata are sync-worthy collaboration context,
  while raw agent traces are `local-only` by default and excluded from room.

### Assets

Media needs lazy sync.

Anytype avoids downloading all media during sync and streams media from backup nodes or peers when requested. Clash should use the same product idea.

Local-only:

- Assets live on disk.
- UI uses local URLs.

Synced:

- Asset metadata syncs first.
- Media uploads lazily or by policy.
- Web shows unavailable placeholders for media that has not been uploaded.

Shared:

- Shared assets required by the room should upload or stream through cloud storage.
- Large media should be cached locally after first open/play.

### Agent Members

Agent member is a local/user-owned actor:

```text
agent_member = user_id + template_id + runtime_id + agent_id + display_name
```

In local desktop:

- `user_id` can be `local-user`.
- `runtime_id` is `desktop-local`.
- claims are stored in local DB.
- default claims can be seeded from bundled templates and detected ACP agents.

In cloud/shared:

- agent members still belong to a specific user.
- project mentions target a `agent_member_id`.
- cloud routes mentions to that user's active runtime session when available.

## Network and Privacy Guide

Borrow Anytype's network framing, but keep Clash wording simpler.

### Network Modes

1. Local-only

   No cloud account required. Local desktop is the only data owner. Local network peer sync can be explored later, but is not required for the first release.

2. Clash Cloud

   Enables sync, web access, backup, and shared projects.

3. Self-hosted

   OSS/team users can point desktop and web at their own sync server. This should use the same protocol as Clash Cloud.

### Encryption Roadmap

Phase 1 can be honest non-E2EE cloud sync if needed, but the product copy must not imply Anytype-level privacy until implemented.

Long-term E2EE model:

- Per-project encryption key.
- Loro updates encrypted before leaving desktop.
- Asset chunks encrypted before upload.
- Shared project keys encrypted to members.
- Cloud can route, store, and sequence metadata needed for sync but cannot read private content.

This matters because Anytype's value proposition is not just local-first; it is local-first with controlled keys and encrypted sync.

## Multiplayer Guide

Figma's model applies when a project becomes Shared.

Cloud ProjectRoom should:

- own live WebSocket sessions
- order updates
- validate access and reject invalid mutations
- broadcast to clients
- maintain presence and awareness
- persist update journal
- compact into checkpoints/snapshots

Use journal + checkpoint, not checkpoint-only persistence. Figma moved to a transaction log because checkpoint-only systems can lose recent edits after crashes and create write spikes during deploys.

For Clash, the current Loro update log + snapshot compaction is the right shape. The missing product work is making this cloud room a mode that users explicitly enter when they sync/share, not the hidden default for desktop.

## Web Experience

Web should only show projects that have cloud state.

Rules:

- Local-only projects do not appear on Web, or appear as disabled records with `Enable sync from desktop`.
- Synced projects open on Web using cloud Loro + cloud room log.
- Shared projects open with multiplayer presence and membership.
- If the user's desktop daemon is offline, local-only actions show unavailable or queue.
- Cloud-native actions can be offered later, but should be visually distinct from local agent actions.

## UX Copy Guide

Use concrete storage and access language.

Good:

- `Stored on this Mac`
- `Synced to Clash Cloud`
- `Shared with 3 members`
- `This action runs on your Mac`
- `Your Mac is offline. The task will run when it reconnects.`
- `Media is local only. Upload it to make it visible on Web.`

Avoid:

- `Decentralized` unless we actually support peer/self-host semantics.
- `Private cloud` unless E2EE is implemented.
- `Synced` when only canvas syncs but room chat/assets do not.
- `Team` when the feature only invites local agent agents.

## Product Boundaries

### In Scope for First Hybrid Release

- Local-only desktop projects.
- Local agent claims.
- Local room message persistence.
- Cloud sync opt-in.
- Web access for synced projects.
- Cloud room chat sync.
- Cloud ProjectRoom for shared projects.
- Owner/editor/viewer roles.
- Basic asset upload/lazy loading.

### Out of Scope for First Hybrid Release

- Full P2P device sync.
- Anytype-level self-hosted network UX.
- E2EE shared spaces.
- Cloud agent workers as the default runtime.
- Syncing every raw agent trace by default.

## Implementation Phases

### Phase 0: Make Desktop Complete

Goal: desktop works without cloud.

Requirements:

- Local DB stores projects, assets, room messages, agent members, project agent invites.
- `/api/v1/agents` returns local agent claims.
- `/api/v1/runtimes/:runtimeId/sessions` resolves `agent_member_id`.
- Local room messages persist and dispatch mentions to local agent sessions.
- Local Loro room remains the canvas source of truth.

### Phase 1: Add Remote Persistence

Goal: local projects can become Synced projects.

Requirements:

- Cloud exposes remote Loro snapshot/update APIs.
- Local API mirrors Loro updates to cloud.
- Room messages sync to cloud append-only log.
- Asset metadata syncs.
- UI shows sync health.

### Phase 2: Enable Web Access

Goal: synced projects are usable in Web.

Requirements:

- Web opens cloud Loro state.
- Web loads cloud room messages.
- Web resolves asset metadata and media availability.
- Web clearly shows local daemon status.

### Phase 3: Shared Projects

Goal: multiplayer collaboration.

Requirements:

- `project_member` table with owner/editor/viewer roles.
- Cloud ProjectRoom authorizes members, not just owner.
- Presence and awareness work across users.
- Room message mentions route to each user's active agent sessions.
- Cloud ProjectRoom sequences shared Loro updates.

### Phase 4: Privacy and Self-Host Hardening

Goal: approach Anytype's trust model where appropriate.

Requirements:

- Project-level encryption keys.
- Encrypted Loro updates and asset chunks.
- Member key rotation/removal behavior.
- Self-hosted sync server mode.
- Clear export/import and recovery flows.

## Decision Rules

Use these rules when deciding product behavior:

- If only one desktop user is involved, prefer local authority.
- If web access is requested, require cloud sync.
- If another human is invited, switch to Shared and use cloud ProjectRoom.
- If an agent action requires local files or local tools, run it on that user's local runtime.
- If a media asset must be visible to collaborators, upload or stream it through the shared media layer.
- If data is sensitive trace/log material, keep it local unless explicitly shared.

## Source Notes

- Anytype describes itself as encrypted and local-first, with offline-created spaces and local P2P sync: https://doc.anytype.io/
- Anytype storage docs describe local-first storage, backup node/device sync, local P2P, and lazy media download: https://doc.anytype.io/anytype-docs/advanced/data-and-security/data-storage-and-deletion
- Anytype network docs expose Anytype Network, Self-hosted, and Local-only network choices: https://doc.anytype.io/anytype-docs/advanced/data-and-security/self-hosting
- Anytype privacy docs describe controlled keys, local indexes, encrypted object changes, and backup nodes not reading actual data: https://doc.anytype.io/anytype-docs/advanced/data-and-security/how-we-keep-your-data-safe
- Anytype collaboration docs use owner/editor/viewer roles for shared spaces: https://doc.anytype.io/anytype-docs/getting-started/collaboration
- Any-Sync overview describes local-first CRDT-based collaboration and E2EE sync providers: https://tech.anytype.io/any-sync/overview
- Figma multiplayer docs describe server-authoritative WebSocket multiplayer and journal/checkpoint persistence: https://www.figma.com/blog/making-multiplayer-more-reliable/
