-- Migration: Add session events table for history replay
-- Stores all streaming events for a session to enable full history replay and detachable sessions.

CREATE TABLE IF NOT EXISTS session_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}', -- JSON string
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for fast retrieval of session events in chronological order
CREATE INDEX IF NOT EXISTS idx_session_events_thread
    ON session_events(thread_id, created_at ASC);
