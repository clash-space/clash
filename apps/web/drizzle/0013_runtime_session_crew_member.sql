-- Tie runtime_session to a claimed crew_member instead of just the
-- template id stored in agent_id.
--
-- Transition strategy:
--   - Add crew_member_id as nullable. Old rows keep NULL.
--   - New session creates fill BOTH crew_member_id and agent_id (template).
--   - Daemon protocol unchanged — server still sends `crew_id` (template)
--     to the daemon since the daemon only knows templates.
--   - Reads that need template_id keep using agent_id (legacy field).
--   - Reads that need crew identity (room mentions, history grouping)
--     start using crew_member_id once UI fills it.
--
-- Down the road agent_id can be dropped after backfill, but no rush —
-- keeping it cheap and lets us roll back the row writer without DB
-- changes if Phase 2 has a regression.

ALTER TABLE `runtime_session` ADD COLUMN `crew_member_id` TEXT;
CREATE INDEX `runtime_session_crew_member_idx` ON `runtime_session` (`crew_member_id`);
