# Local SQLite Migration Spec

Last updated: 2026-07-06

Status note: the earlier one-time `db.json` importer plan is deprecated for
alpha. Local-api now ignores legacy `db.json` and starts SQLite from empty
state until first write; `clash doctor storage` may report an existing
`db.json` only as a cleanup/secrets warning.

## Purpose

Move local-api product metadata out of `db.json` and into a local SQLite
database without changing the public local API surface.

This implements the v1 rule from
`agent-first-local-v1-principles.md`:

```text
Only files intentionally edited by agents/users should be JSON/YAML.
Queryable product state should be SQLite.
```

## Current State

`apps/local-api/src/app.ts` stores the following in one broad JSON file:

```text
<dataDir>/db.json
```

Current logical collections:

- `projects`
- `assets`
- `assetRefs`
- `sessions`
- `sessionMessages`
- `agentMembers`
- `providerAccounts`
- `providerOAuth`

Current implementation status:

- `projects`, `assets`, `assetRefs`, `sessions`, `agentMembers`, and
  `sessionMessages` have a SQLite-backed implementation in
  `apps/local-api/src/local-metadata-store.ts`.
- `providerAccounts` and `providerOAuth` have a SQLite-backed implementation in
  `apps/local-api/src/local-provider-store.ts`.
- New metadata/provider/workflow writes create `<dataDir>/local.sqlite` and do
  not create a fresh `db.json`.
- Metadata/provider SQLite handles open with WAL journal mode, a 5s busy
  timeout, foreign keys enabled, and `BEGIN IMMEDIATE` write/schema
  transactions.
- Legacy rows are no longer read from `db.json`; ignored-legacy regression
  tests prevent this file from becoming a local truth source again.
- Provider credential/token payloads now persist as encrypted `enc:v1:` values
  in SQLite; the local key source is explicit env key, macOS Keychain, or a
  `0600` machine-local fallback key for test/temp/fallback paths.

The old broad `db.json` approach was convenient for early development but is
wrong for v1 because:

- agents can accidentally edit app database state as plain JSON,
- every update rewrites the whole file,
- stale read-modify-write handlers can overwrite concurrent writes,
- queryable state is not indexed,
- schema evolution is ad hoc,
- cloud and local data shapes drift.

Current local-api request handlers use queued `db.update()` for project,
provider, OAuth, session, and asset metadata mutations, with regression tests
for concurrent requests. Direct future writers outside the local-api route
queue must use the same SQLite store contract instead of ad hoc file mutation or
raw SQL writes.

## Migration Goal

Create a local metadata database:

```text
~/.clash/local-api/local.sqlite
```

or, once project-scoped store layout is finalized:

```text
~/.clash/projects/<encodedProjectId>/local.sqlite
```

v1 migration should start with `~/.clash/local-api/local.sqlite` because that
matches the existing local-api `dataDir` boundary and avoids moving paths at
the same time as changing storage.

## Driver Decision

Current local Node runtime exposes `node:sqlite`, but it is experimental in
the checked runtime. Use a small local adapter boundary so the driver can be
swapped without touching app routes.

Recommended v1-alpha adapter:

```text
apps/local-api/src/db/
  local-store.ts       # product repository interface
  sqlite-store.ts      # SQLite implementation
  schema.sql           # canonical local schema
```

Driver rule:

- Prefer `node:sqlite` only if the packaged desktop runtime is pinned and the
  warning/experimental status is acceptable for the release.
- Otherwise use a stable SQLite package behind `sqlite-store.ts`.
- Do not let app routes import the driver directly.
- Do not add a `db.json` importer for alpha local state. Existing `db.json`
  is ignored and reported only as cleanup/secrets risk.

## Schema

Mirror the cloud D1 schema names where possible. Local-only columns may exist,
but table names should stay aligned so sync and tests do not need translation
layers.

### `project`

```sql
CREATE TABLE IF NOT EXISTS project (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS project_owner_idx ON project(owner_id, updated_at);
```

### `assets`

```sql
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  src_r2_key TEXT NOT NULL,
  cover_r2_key TEXT,
  metadata TEXT,
  source_model TEXT,
  source_prompt TEXT,
  source_task_id TEXT,
  sources TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS assets_user_idx ON assets(user_id, created_at);
CREATE INDEX IF NOT EXISTS assets_task_idx ON assets(source_task_id);
```

Local media blobs remain on disk under the local asset root. SQLite stores
metadata and storage keys only.

### `asset_refs`

```sql
CREATE TABLE IF NOT EXISTS asset_refs (
  asset_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  imported_at INTEGER NOT NULL,
  PRIMARY KEY (asset_id, project_id)
);
CREATE INDEX IF NOT EXISTS asset_refs_project_idx ON asset_refs(project_id);
CREATE INDEX IF NOT EXISTS asset_refs_asset_idx ON asset_refs(asset_id);
```

### `asset_node_refs`

Queryable projection of Loro/canvas asset references. This is not canonical
canvas state; the host refreshes it from project replicas so agents and UI can
inspect asset usage without reading `snapshot.bin`.

```sql
CREATE TABLE IF NOT EXISTS asset_node_refs (
  asset_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  node_type TEXT NOT NULL,
  field_path TEXT NOT NULL,
  reference_role TEXT NOT NULL DEFAULT 'asset',
  observed_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, node_id, field_path, asset_id)
);
CREATE INDEX IF NOT EXISTS asset_node_refs_asset_idx
  ON asset_node_refs(asset_id, project_id);
CREATE INDEX IF NOT EXISTS asset_node_refs_project_idx
  ON asset_node_refs(project_id, node_id);
```

`reference_role` is a first-pass semantic role inferred from stable field
names: `source`, `reference`, `required-reference`, `derived`, `primary`, or
fallback `asset`. It is an index hint for agents/UI, not canonical canvas data.
`clash doctor storage` checks this table, the `reference_role` column, and the
required lookup indexes so stale alpha databases surface as repairable warnings.

### `runtime_session`

```sql
CREATE TABLE IF NOT EXISTS runtime_session (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  runtime_id TEXT NOT NULL,
  agent_template_id TEXT,
  agent_member_id TEXT,
  agent_id TEXT,
  acp_session_id TEXT,
  cwd TEXT,
  title TEXT,
  permission_mode TEXT,
  type TEXT NOT NULL DEFAULT 'runtime',
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS runtime_session_project_idx ON runtime_session(project_id, last_active_at);
CREATE INDEX IF NOT EXISTS runtime_session_runtime_idx ON runtime_session(runtime_id);
CREATE INDEX IF NOT EXISTS runtime_session_agent_member_idx ON runtime_session(agent_member_id);
```

This table replaces local `sessions`.

### `chat_message`

```sql
CREATE TABLE IF NOT EXISTS chat_message (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  sender_kind TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  turn_id TEXT,
  events_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS chat_message_session_idx ON chat_message(session_id, created_at);
CREATE INDEX IF NOT EXISTS chat_message_user_idx ON chat_message(user_id, created_at);
```

This table replaces local `sessionMessages`.

### `room_message`

```sql
CREATE TABLE IF NOT EXISTS room_message (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  sender_kind TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  sender_user_id TEXT NOT NULL,
  mentions_json TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS room_message_project_idx ON room_message(project_id, created_at);
```

Room is the project-visible conversation. It is not raw ACP trace.

### `agent_member`

```sql
CREATE TABLE IF NOT EXISTS agent_member (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  runtime_id TEXT NOT NULL,
  agent_id TEXT,
  display_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  budget_credits INTEGER,
  budget_period TEXT DEFAULT 'monthly',
  budget_used INTEGER DEFAULT 0,
  budget_reset_at INTEGER
);
CREATE INDEX IF NOT EXISTS agent_member_user_idx ON agent_member(user_id, created_at);
CREATE INDEX IF NOT EXISTS agent_member_runtime_idx ON agent_member(runtime_id);
```

### `provider_account`

```sql
CREATE TABLE IF NOT EXISTS provider_account (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  upstream_id TEXT,
  region TEXT,
  label TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  priority INTEGER,
  weight INTEGER,
  encrypted_credentials TEXT,
  configured_credentials TEXT,
  supported_model_ids TEXT,
  model_priorities TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS provider_account_user_idx ON provider_account(user_id);
CREATE INDEX IF NOT EXISTS provider_account_provider_idx
  ON provider_account(user_id, provider_id, upstream_id);
```

### `provider_oauth`

```sql
CREATE TABLE IF NOT EXISTS provider_oauth (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  account_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  encrypted_tokens TEXT,
  verification_uri TEXT,
  user_code TEXT,
  device_code TEXT,
  interval_seconds INTEGER,
  account_label TEXT,
  expires_at INTEGER,
  error TEXT,
  has_tokens INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS provider_oauth_user_idx ON provider_oauth(user_id);
CREATE INDEX IF NOT EXISTS provider_oauth_provider_idx
  ON provider_oauth(user_id, provider_id, account_id);
```

## Secret Handling

The migration must not preserve the current plain-JSON secret risk as the
long-term state.

Rules:

- Public APIs never return raw provider credentials or OAuth tokens.
- SQLite rows store credential/token payloads only in encrypted columns.
- Do not read legacy plaintext from `db.json` as an active migration source in
  alpha. This avoids making stale JSON authoritative again.
- Do not keep adding new secrets to `db.json`.
- New provider credential/OAuth writes must go through `local-provider-store`;
  direct SQL writes are not allowed because they bypass encryption and
  encryption handling.

Current migration-period mitigation:

- New metadata/provider writes go to `local.sqlite`.
- Legacy `db.json` is ignored and reported only as cleanup/secrets risk.
- SQLite files are created with owner-only permissions where practical.
- Provider credential values and OAuth access/refresh/user/device codes are
  AES-256-GCM encrypted before SQLite write.
- Existing plaintext provider rows in legacy JSON are not imported in alpha.

Acceptable encryption sources, in priority order:

1. OS keychain backed local key.
2. User-provided local secret.
3. Temporary machine-local file key with strict permissions for test, temp, or
   non-Keychain fallback environments.

## Repository Interface

Routes should stop depending on a mutable in-memory `LocalDb` object.

Target interface shape:

```ts
export interface LocalStore {
  listProjects(): Promise<LocalProject[]>;
  createProject(input: CreateProjectInput): Promise<LocalProject>;
  getProject(id: string): Promise<LocalProject | null>;
  updateProject(id: string, patch: ProjectPatch): Promise<boolean>;
  deleteProject(id: string): Promise<boolean>;

  listProjectAssets(projectId: string): Promise<Asset[]>;
  upsertAsset(asset: Asset, refs?: AssetRefRow[]): Promise<void>;
  getAsset(id: string): Promise<Asset | null>;
  getAssets(ids: string[]): Promise<Asset[]>;
  updateAssetCover(id: string, coverR2Key: string): Promise<boolean>;
  deleteAssetRef(assetId: string, projectId?: string): Promise<void>;

  listSessions(projectId?: string): Promise<LocalSession[]>;
  upsertSession(session: LocalSession): Promise<void>;
  patchSession(id: string, patch: SessionPatch): Promise<boolean>;
  deleteSession(id: string): Promise<boolean>;
  appendSessionMessage(sessionId: string, message: LocalAcpSessionMessage): Promise<void>;
  listSessionMessages(sessionId: string): Promise<LocalAcpSessionMessage[] | null>;

  listAgentMembers(userId: string): Promise<LocalAgentMember[]>;
  seedAgentMembers(userId: string): Promise<LocalAgentMember[]>;

  listProviderAccounts(userId: string): Promise<LocalProviderAccountConfig[]>;
  upsertProviderAccounts(userId: string, accounts: LocalProviderAccountConfig[]): Promise<void>;
  deleteProviderAccount(userId: string, accountId: string): Promise<boolean>;
  listProviderOAuth(userId: string): Promise<LocalProviderOAuthRecord[]>;
  upsertProviderOAuth(userId: string, record: LocalProviderOAuthRecord): Promise<LocalProviderOAuthRecord>;
  deleteProviderOAuth(userId: string, providerId: string, accountId?: string): Promise<void>;
}
```

Implementation can split this into repositories, but the route layer should
see a store interface, not raw SQL or `db.json`.

## Legacy JSON Strategy

### First open

On local-api startup:

1. Open/create `local.sqlite`.
2. Configure WAL, busy timeout, and foreign keys.
3. Run schema migrations in a transaction.
4. If `db.json` exists:
   - do not read it into product state,
   - keep serving from SQLite,
   - let `clash doctor storage` report it as cleanup/secrets risk.
5. If SQLite is missing projection tables or indexes required by the current
   host, `clash doctor storage` should report a warning and a future explicit
   repair/migration command should apply the schema transactionally.

### Marker

Add:

```sql
CREATE TABLE IF NOT EXISTS local_migration (
  id TEXT PRIMARY KEY NOT NULL,
  completed_at INTEGER NOT NULL,
  source_path TEXT NOT NULL,
  source_sha256 TEXT NOT NULL
);
```

Use id:

```text
db-json-v1
```

### Forbidden fallback

Do not silently keep dual-writing `db.json` and SQLite. Do not add a startup
fallback that reads `db.json` when SQLite is empty. If a future explicit import
tool is needed, it should be a separate user-triggered recovery command, not
local-api default behavior.

## API Compatibility

The following surfaces should keep behavior while storage changes:

- `GET /api/v1/projects`
- `POST /api/v1/projects`
- `GET /api/projects`
- `POST /api/projects`
- `GET /api/v1/sessions`
- `POST /api/v1/sessions`
- `DELETE /api/v1/sessions`
- `GET /api/v1/local-sessions/:sessionId/messages`
- `POST /api/custom-action/upload`
- `POST /api/v1/assets`
- `GET /api/v1/assets/:id`
- `GET /api/v1/assets/:id/references`
- `POST /api/v1/assets/:id/references/refresh`
- `POST /api/v1/assets/batch`
- `DELETE /api/v1/assets/:id/ref`
- `PATCH /api/v1/assets/:id/cover`
- `GET/PATCH/DELETE /api/v1/model-providers`
- `GET/POST/DELETE /api/v1/provider-oauth`
- `GET /api/v1/agents`
- local ACP session creation/attach flows.

## JSON Files That May Remain

These are not app databases and may remain JSON for now:

- `sync.json`: local sync configuration, if manual/agent edit is intentional.
- `audio.json`: local ASR setup configuration, if manual/agent edit is
  intentional.
- `harnesses.json`: local ACP runtime enablement and custom agent server
  config, if treated as local settings rather than session history.
- `host.json`: runtime discovery record under the run directory. This is
  runtime-owned and not an agent-editable project file.
- `credentials.json` and CLI `config.json`: credential/config files with
  strict file permissions. They are JSON for portability, but auth/setup
  commands own them.
- provider test recordings: JSONL event log, because it is an artifact.
- projection lock sidecars: JSON, because agents inspect them indirectly and
  the shape is small.

They should not become dumping grounds for relational state.

Permission rule:

- credential JSON must be `0600` and live outside project projections,
- runtime discovery JSON should be treated as ephemeral runtime state,
- settings JSON may remain only while it is intentionally small and
  command/settings-owned,
- product rows, indexes, refs, messages, OAuth rows, and session history move
  to SQLite.

## Tests

### Unit

- `sqlite-store.test.ts`
  - creates schema,
  - performs CRUD for every repository group,
  - enforces indexes/unique behavior where relevant,
  - preserves public DTO compatibility.

- `app.sqlite.test.ts`
  - runs core local-api route tests with SQLite store,
  - verifies no route reads `db.json`.

### E2E

- Create a project.
- Upload/register an asset.
- Create a runtime session.
- Persist session messages.
- Restart local-api.
- Verify all rows survive and `db.json` is not created or rewritten.

### Regression Guard

Add a test that fails if new route code imports or calls the old `createDb`
JSON helper after migration.

## Migration Phases

### Phase 1: Add SQLite store behind tests

- Add schema and store modules.
- Keep app routes unchanged.
- Test repository behavior.
- First completed slice: provider account/OAuth routes now write SQLite row
  tables while preserving public DTO behavior.

### Phase 2: Route app through store interface

- Replace `createDb` with `createLocalStore`.
- Keep all public API responses identical.
- Run local-api unit tests and daemon e2e.

### Phase 3: Keep legacy `db.json` ignored

- Metadata/provider stores do not read legacy `db.json`.
- New writes go to SQLite and stop writing `db.json`.
- Mutating app routes use queued read-modify-write updates so concurrent local
  requests do not drop unrelated project/provider/session/asset changes.
- Doctor reports existing `db.json` as cleanup/secrets risk only.

### Phase 4: Remove JSON database path

- Delete `createDb`.
- Delete broad JSON database tests.
- Keep explicit JSON config stores.

## Completion Criteria

This migration is complete only when:

- local-api no longer writes broad product state to `db.json`,
- existing `db.json` installs are ignored by default,
- local API route behavior is unchanged,
- provider credentials/OAuth are not exposed in public responses,
- restart recovery is covered by tests,
- cloud schema drift is minimized and documented,
- the agent operating docs no longer imply that app DB JSON is editable.
