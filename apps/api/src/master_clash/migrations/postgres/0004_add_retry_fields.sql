-- Add retry management fields for persistent retry mechanism
-- Migration: 0004_add_retry_fields (PostgreSQL)

-- Add retry tracking fields
ALTER TABLE aigc_tasks ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0;
ALTER TABLE aigc_tasks ADD COLUMN IF NOT EXISTS last_retry_at BIGINT;
ALTER TABLE aigc_tasks ADD COLUMN IF NOT EXISTS next_retry_at BIGINT;
ALTER TABLE aigc_tasks ADD COLUMN IF NOT EXISTS retry_strategy TEXT DEFAULT 'exponential';

-- Index for retry scheduler to efficiently find tasks needing retry
CREATE INDEX IF NOT EXISTS idx_aigc_tasks_retry ON aigc_tasks(status, next_retry_at)
WHERE status = 'failed' AND retry_count < max_retries;

-- Comments for documentation
COMMENT ON COLUMN aigc_tasks.retry_count IS 'Number of times this task has been retried';
COMMENT ON COLUMN aigc_tasks.last_retry_at IS 'Timestamp (ms) of last retry attempt';
COMMENT ON COLUMN aigc_tasks.next_retry_at IS 'Timestamp (ms) when task should be retried next';
COMMENT ON COLUMN aigc_tasks.retry_strategy IS 'Retry strategy: exponential (default), linear, or fixed';
