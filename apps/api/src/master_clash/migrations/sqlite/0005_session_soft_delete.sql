-- Migration 0005: Add missing columns to session_interrupts
-- Adds title, is_deleted, deleted_at for feature parity

-- SQLite doesn't support IF NOT EXISTS for ALTER TABLE
-- These columns may already exist from D1 migrations
-- The migration runner should handle errors gracefully

ALTER TABLE session_interrupts ADD COLUMN title TEXT;
ALTER TABLE session_interrupts ADD COLUMN is_deleted INTEGER DEFAULT 0;
ALTER TABLE session_interrupts ADD COLUMN deleted_at TIMESTAMP;

-- Create index for filtering deleted sessions
CREATE INDEX IF NOT EXISTS idx_session_deleted ON session_interrupts(is_deleted, project_id);
