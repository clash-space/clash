-- Project room — group-chat IM layer for multi-agent + multi-user collaboration.
--
-- ONE row per "speech act" — either a human typing in the room input, or a
-- agent member explicitly broadcasting via the say_to_room tool. Agent internal
-- activity (tool calls, streamed text chunks) does NOT land here — that lives
-- in chat_message scoped to the agent's own runtime_session.
--
-- Multi-user: sender_user_id is on every row, even when sender_kind='agent'
-- (it's the user whose daemon spawned that agent). UI renders "director (alice)"
-- so people know who fired the agent. Per-user agent model — each user runs
-- their own daemon with their own agent sessions, but the room is shared
-- across the project's members.
--
-- mentions_json — array of {user_id, agent_member_id?}. Used by ProjectRoom DO to
-- look up the matching runtime_session (where agent_member_id=?) and
-- push room.mention into that agent's react loop.
--
-- v1 scope: project has single owner (no project_member table yet), so
-- "multi-user" data shape is in place but only the owner appears. When
-- membership lands later, this table needs no migration.

CREATE TABLE `room_message` (
    `id` TEXT PRIMARY KEY NOT NULL,
    `project_id` TEXT NOT NULL,
    `sender_kind` TEXT NOT NULL,        -- 'user' | 'agent'
    `sender_id` TEXT NOT NULL,          -- user_id (when 'user') or agent_member_id (when 'agent')
    `sender_user_id` TEXT NOT NULL,     -- always the human; for agents it's the daemon owner
    `mentions_json` TEXT NOT NULL,      -- '[]' or '[{"user_id":"alice","agent_member_id":"local-director"}]'
    `text` TEXT NOT NULL,
    `created_at` INTEGER NOT NULL
);
CREATE INDEX `room_message_project_idx` ON `room_message` (`project_id`, `created_at` DESC);
