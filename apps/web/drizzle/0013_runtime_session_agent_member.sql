-- Tie runtime_session to the claimed agent member that owns the session.

ALTER TABLE `runtime_session` ADD COLUMN `agent_member_id` TEXT NOT NULL DEFAULT '';
CREATE INDEX `runtime_session_agent_member_idx` ON `runtime_session` (`agent_member_id`);
