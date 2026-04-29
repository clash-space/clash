-- Project room — group-chat IM layer for multi-crew + multi-user collaboration.
--
-- ONE row per "speech act" — either a human typing in the room input, or a
-- crew member explicitly broadcasting via the say_to_room tool. Crew internal
-- activity (tool calls, streamed text chunks) does NOT land here — that lives
-- in chat_message scoped to the crew's own runtime_session.
--
-- Multi-user: sender_user_id is on every row, even when sender_kind='crew'
-- (it's the user whose daemon spawned that crew). UI renders "director (alice)"
-- so people know who fired the agent. Per-user crew model — each user runs
-- their own daemon with their own crew sessions, but the room is shared
-- across the project's members.
--
-- mentions_json — array of {user_id, crew_id?}. Used by ProjectRoom DO to
-- look up the matching runtime_session (where user_id=? AND agent_id=?) and
-- push room.mention into that crew's react loop.
--
-- v1 scope: project has single owner (no project_member table yet), so
-- "multi-user" data shape is in place but only the owner appears. When
-- membership lands later, this table needs no migration.

CREATE TABLE `room_message` (
    `id` TEXT PRIMARY KEY NOT NULL,
    `project_id` TEXT NOT NULL,
    `sender_kind` TEXT NOT NULL,        -- 'user' | 'crew'
    `sender_id` TEXT NOT NULL,          -- user_id (when 'user') or crew_id (when 'crew')
    `sender_user_id` TEXT NOT NULL,     -- always the human; for crews it's the daemon owner
    `mentions_json` TEXT NOT NULL,      -- '[]' or '[{"user_id":"alice","crew_id":"director"}]'
    `text` TEXT NOT NULL,
    `created_at` INTEGER NOT NULL
);
CREATE INDEX `room_message_project_idx` ON `room_message` (`project_id`, `created_at` DESC);
