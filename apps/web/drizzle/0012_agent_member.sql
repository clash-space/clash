-- Claimed agent members — the user's own instances of a bundled agent template.
--
-- Templates (Director / Canvas Editor / Generator / Storyboard / Project
-- Manager) live in the bridge's dist/agent/ as read-only role definitions.
-- A user "claims" a template + runtime to create a concrete agent member —
-- e.g. "Alice's Director on alice-mac". From then on, that claimed
-- member is what gets invited into project rooms, what @-mentions
-- target, and what spawns sessions.
--
-- Why this layer instead of using template_id directly:
--   - Multi-user: alice and bob both want Director without colliding.
--   - Multi-runtime: same user can claim Director twice (laptop + desktop)
--     and have them coexist in different projects.
--   - Identity in room: room mentions encode agent_member_id, which already
--     pins down (template, user, runtime) — no ambiguity at dispatch.
--
-- Display name defaults to the template label; user can rename to
-- distinguish multiple instances ("Director — laptop").

CREATE TABLE `agent_member` (
    `id` TEXT PRIMARY KEY NOT NULL,
    `user_id` TEXT NOT NULL,
    `template_id` TEXT NOT NULL,        -- 'director' | 'canvas-editor' | …
    `runtime_id` TEXT NOT NULL,
    `display_name` TEXT NOT NULL,
    `created_at` INTEGER NOT NULL
);
CREATE INDEX `agent_member_user_idx` ON `agent_member` (`user_id`, `created_at`);
CREATE INDEX `agent_member_runtime_idx` ON `agent_member` (`runtime_id`);
