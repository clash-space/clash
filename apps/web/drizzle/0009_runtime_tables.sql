-- Local Runtime tables — daemon registration, machine credentials, agent
-- session catalog. See packages/clash-bridge for the daemon side.
--
-- Design notes:
--   * No foreign keys — D1 doesn't enforce them; matches existing convention.
--   * `runtime` is keyed by (owner_user_id, machine_id). machine_id is a
--     daemon-computed stable fingerprint so reinstalling the daemon on the
--     same box reuses the row instead of accumulating zombies.
--   * `runtime_token` stores sha256(token), never the secret. Token format
--     `sk_machine_<60-hex>` issued during `clash setup`. v1 = 1 token per
--     runtime; created_by_user_id captures provenance now so v2 (org admin
--     issues tokens for shared runtimes) doesn't need a migration.
--   * `connect_daemon_code` is the OAuth-style intermediary: browser POSTs
--     /connect-daemon (auth'd), gets a code, redirects to localhost callback
--     where the CLI exchanges code → token. 5-min TTL, single-use.
--   * `runtime_session` is a metadata index for resume/history. The actual
--     transcript stays on the user's disk (e.g. ~/.claude/projects/<hash>/
--     <acpSessionId>.jsonl). We store enough to tell the daemon "load
--     session X next time" — `acp_session_id` is what the agent expects.

CREATE TABLE `runtime` (
    `id` TEXT PRIMARY KEY NOT NULL,
    `owner_user_id` TEXT NOT NULL,
    `machine_id` TEXT NOT NULL,
    `hostname` TEXT NOT NULL,
    `os` TEXT NOT NULL,
    `agents_json` TEXT NOT NULL DEFAULT '[]',
    `version` TEXT NOT NULL,
    `status` TEXT NOT NULL DEFAULT 'offline',
    `last_heartbeat` INTEGER,
    `created_at` INTEGER DEFAULT (strftime('%s', 'now'))
);
CREATE INDEX `runtime_owner_idx` ON `runtime` (`owner_user_id`);
CREATE UNIQUE INDEX `runtime_unique_idx` ON `runtime` (`owner_user_id`, `machine_id`);

CREATE TABLE `runtime_token` (
    `id` TEXT PRIMARY KEY NOT NULL,
    `runtime_id` TEXT NOT NULL,
    `token_hash` TEXT NOT NULL,
    `created_by_user_id` TEXT NOT NULL,
    `created_at` INTEGER DEFAULT (strftime('%s', 'now')),
    `last_used_at` INTEGER,
    `revoked_at` INTEGER
);
CREATE INDEX `runtime_token_runtime_idx` ON `runtime_token` (`runtime_id`);
CREATE UNIQUE INDEX `runtime_token_hash_idx` ON `runtime_token` (`token_hash`);

CREATE TABLE `connect_daemon_code` (
    `code` TEXT PRIMARY KEY NOT NULL,
    `user_id` TEXT NOT NULL,
    `state` TEXT NOT NULL,
    `expires_at` INTEGER NOT NULL,
    `used_at` INTEGER
);
CREATE INDEX `connect_daemon_code_expires_idx` ON `connect_daemon_code` (`expires_at`);

CREATE TABLE `runtime_session` (
    `id` TEXT PRIMARY KEY NOT NULL,
    `user_id` TEXT NOT NULL,
    `runtime_id` TEXT NOT NULL,
    `agent_id` TEXT NOT NULL,
    `acp_session_id` TEXT,
    `cwd` TEXT NOT NULL,
    `title` TEXT,
    `status` TEXT NOT NULL DEFAULT 'active',
    `created_at` INTEGER DEFAULT (strftime('%s', 'now')),
    `last_active_at` INTEGER DEFAULT (strftime('%s', 'now'))
);
CREATE INDEX `runtime_session_user_idx` ON `runtime_session` (`user_id`, `last_active_at`);
CREATE INDEX `runtime_session_runtime_idx` ON `runtime_session` (`runtime_id`);
