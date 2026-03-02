-- Migration: Add session events table for history replay
-- Stores all streaming events for a session to enable full history replay and detachable sessions.

CREATE TABLE IF NOT EXISTS session_events (
    id SERIAL PRIMARY KEY,
    thread_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for fast retrieval of session events in chronological order
CREATE INDEX IF NOT EXISTS idx_session_events_thread
    ON session_events(thread_id, created_at ASC);

-- Index for filtering by event type
CREATE INDEX IF NOT EXISTS idx_session_events_type
    ON session_events(event_type);
