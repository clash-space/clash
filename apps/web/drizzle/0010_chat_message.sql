-- Chat history for local-runtime sessions (BYO bridge / daemon).
--
-- One row per message — both user prompts and assembled crew responses.
-- Crew responses are accumulated server-side from session.event chunks
-- and written on session.complete (one row per turn). Streaming chunks
-- aren't individually persisted; they're broadcast live and re-derived
-- from the final row on history reads.
--
-- Why D1 not Loro: chat is append-only, no concurrent-edit case. SQL
-- supports cross-session queries (history page, future search) that a
-- per-DO Loro doc would need fan-out for. RuntimeRoom DO continues to
-- handle live broadcast — D1 is the durable record.

CREATE TABLE `chat_message` (
    `id` TEXT PRIMARY KEY NOT NULL,
    `session_id` TEXT NOT NULL,         -- runtime_session.id
    `user_id` TEXT NOT NULL,            -- denormalized from runtime_session for query speed
    `sender_kind` TEXT NOT NULL,        -- 'user' | 'crew'
    `sender_id` TEXT NOT NULL,          -- crew_id when 'crew', user_id when 'user'
    `turn_id` TEXT,                     -- ACP turn id; null for user rows
    `events_json` TEXT NOT NULL,        -- JSON array of raw ACP events (for crew) or [{type:'text',text:'...'}] (user)
    `created_at` INTEGER NOT NULL
);
CREATE INDEX `chat_message_session_idx` ON `chat_message` (`session_id`, `created_at`);
CREATE INDEX `chat_message_user_idx` ON `chat_message` (`user_id`, `created_at`);
