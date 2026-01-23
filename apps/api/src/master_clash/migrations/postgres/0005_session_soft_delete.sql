-- Migration 0005: Add missing columns to session_interrupts
-- Adds title, is_deleted, deleted_at for feature parity with D1/SQLite schema

-- Add title column for session display names
ALTER TABLE session_interrupts ADD COLUMN IF NOT EXISTS title TEXT;

-- Add soft deletion columns
ALTER TABLE session_interrupts ADD COLUMN IF NOT EXISTS is_deleted INTEGER DEFAULT 0;
ALTER TABLE session_interrupts ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

-- Create index for filtering deleted sessions
CREATE INDEX IF NOT EXISTS idx_session_deleted ON session_interrupts(is_deleted, project_id);
