-- Add retry management fields for persistent retry mechanism
-- Migration: 0004_add_retry_fields

-- Add retry tracking fields
ALTER TABLE aigc_tasks ADD COLUMN retry_count INTEGER DEFAULT 0;
ALTER TABLE aigc_tasks ADD COLUMN last_retry_at INTEGER;
ALTER TABLE aigc_tasks ADD COLUMN next_retry_at INTEGER;
ALTER TABLE aigc_tasks ADD COLUMN retry_strategy TEXT DEFAULT 'exponential'; -- exponential, linear, fixed

-- Index for retry scheduler to efficiently find tasks needing retry
CREATE INDEX IF NOT EXISTS idx_aigc_tasks_retry ON aigc_tasks(status, next_retry_at)
WHERE status = 'failed' AND retry_count < max_retries;

-- Comments for documentation
-- retry_count: Number of times this task has been retried
-- last_retry_at: Timestamp (ms) of last retry attempt
-- next_retry_at: Timestamp (ms) when task should be retried next
-- retry_strategy: 'exponential' (default), 'linear', or 'fixed' delay
