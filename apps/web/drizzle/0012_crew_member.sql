-- Claimed crew members — the user's own instances of a bundled crew template.
--
-- Templates (Director / Canvas Editor / Generator / Storyboard / Project
-- Manager) live in the bridge's dist/crew/ as read-only role definitions.
-- A user "claims" a template + runtime to create a concrete crew member —
-- e.g. "Alice's Director on alice-mac". From then on, that claimed
-- member is what gets invited into project rooms, what @-mentions
-- target, and what spawns sessions.
--
-- Why this layer instead of using template_id directly:
--   - Multi-user: alice and bob both want Director without colliding.
--   - Multi-runtime: same user can claim Director twice (laptop + desktop)
--     and have them coexist in different projects.
--   - Identity in room: room mentions encode crew_member_id, which already
--     pins down (template, user, runtime) — no ambiguity at dispatch.
--
-- runtime_session.agent_id will eventually reference crew_member.id (right
-- now it stores template_id directly). Migration to crew_member_id comes
-- in a follow-up — both can coexist during transition.
--
-- Display name defaults to the template label; user can rename to
-- distinguish multiple instances ("Director — laptop").

CREATE TABLE `crew_member` (
    `id` TEXT PRIMARY KEY NOT NULL,
    `user_id` TEXT NOT NULL,
    `template_id` TEXT NOT NULL,        -- 'director' | 'canvas-editor' | …
    `runtime_id` TEXT NOT NULL,
    `display_name` TEXT NOT NULL,
    `created_at` INTEGER NOT NULL
);
CREATE INDEX `crew_member_user_idx` ON `crew_member` (`user_id`, `created_at`);
CREATE INDEX `crew_member_runtime_idx` ON `crew_member` (`runtime_id`);
