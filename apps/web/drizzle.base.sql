-- Master Clash Frontend Database Schema for Cloudflare D1
-- This is the combined schema for all frontend tables

-- Projects table
CREATE TABLE IF NOT EXISTS project (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    nodes TEXT DEFAULT '[]',
    edges TEXT DEFAULT '[]',
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- Messages table (chat history)
CREATE TABLE IF NOT EXISTS message (
    id TEXT PRIMARY KEY NOT NULL,
    content TEXT NOT NULL,
    role TEXT NOT NULL,
    project_id TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    -- FK removed: api-cf creates assets independently
);

-- Assets table (generated images/videos)
CREATE TABLE IF NOT EXISTS asset (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    project_id TEXT NOT NULL,
    storage_key TEXT NOT NULL,
    url TEXT NOT NULL,
    type TEXT NOT NULL,
    metadata TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    -- FK removed: api-cf creates assets independently
);

-- User authentication table
CREATE TABLE IF NOT EXISTS user (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT,
    email TEXT,
    emailVerified INTEGER,
    image TEXT
);

-- OAuth accounts table
CREATE TABLE IF NOT EXISTS account (
    userId TEXT NOT NULL,
    type TEXT NOT NULL,
    provider TEXT NOT NULL,
    providerAccountId TEXT NOT NULL,
    refresh_token TEXT,
    access_token TEXT,
    expires_at INTEGER,
    token_type TEXT,
    scope TEXT,
    id_token TEXT,
    session_state TEXT,
    PRIMARY KEY (provider, providerAccountId),
    FOREIGN KEY (userId) REFERENCES user(id) ON DELETE CASCADE
);

-- User sessions table
CREATE TABLE IF NOT EXISTS session (
    sessionToken TEXT PRIMARY KEY NOT NULL,
    userId TEXT NOT NULL,
    expires INTEGER NOT NULL,
    FOREIGN KEY (userId) REFERENCES user(id) ON DELETE CASCADE
);

-- Email verification tokens table
CREATE TABLE IF NOT EXISTS verificationToken (
    identifier TEXT NOT NULL,
    token TEXT NOT NULL,
    expires INTEGER NOT NULL,
    PRIMARY KEY (identifier, token)
);

-- API Tokens table (for CLI/agent access)
CREATE TABLE IF NOT EXISTS api_token (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    token_prefix TEXT NOT NULL,
    last_used_at INTEGER,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);

-- User variables table (encrypted API keys for actions)
CREATE TABLE IF NOT EXISTS user_variable (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    key TEXT NOT NULL,
    encrypted_value TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE,
    UNIQUE(user_id, key)
);

-- Installed actions table (global, per-user)
CREATE TABLE IF NOT EXISTS installed_action (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    action_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    manifest TEXT NOT NULL,
    runtime TEXT NOT NULL DEFAULT 'worker',
    version TEXT,
    author TEXT,
    repository TEXT,
    worker_url TEXT,
    icon TEXT,
    color TEXT,
    tags TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE,
    UNIQUE(user_id, action_id)
);

-- Installed skills table (global, per-user)
CREATE TABLE IF NOT EXISTS installed_skill (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    skill_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    repository TEXT,
    version TEXT,
    author TEXT,
    icon TEXT,
    tags TEXT,
    linked_action_id TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE,
    UNIQUE(user_id, skill_id)
);

-- Create indexes for better performance
CREATE UNIQUE INDEX IF NOT EXISTS user_email_unique ON user(email);
CREATE INDEX IF NOT EXISTS idx_message_project ON message(project_id);
CREATE INDEX IF NOT EXISTS idx_asset_project ON asset(project_id);
CREATE INDEX IF NOT EXISTS idx_session_user ON session(userId);
CREATE INDEX IF NOT EXISTS idx_account_user ON account(userId);
CREATE INDEX IF NOT EXISTS idx_api_token_user ON api_token(user_id);
CREATE INDEX IF NOT EXISTS idx_api_token_hash ON api_token(token_hash);
CREATE INDEX IF NOT EXISTS idx_user_variable_user ON user_variable(user_id);
CREATE INDEX IF NOT EXISTS idx_installed_action_user ON installed_action(user_id);
CREATE INDEX IF NOT EXISTS idx_installed_skill_user ON installed_skill(user_id);
