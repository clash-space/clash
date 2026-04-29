-- Add the third leg to the crew claim — which ACP CLI to spawn.
--
-- Three independent dimensions per claimed crew:
--   - template_id   : the role (Director / Canvas Editor / …)
--   - runtime_id    : the machine
--   - agent_id      : the ACP CLI (claude-code-acp / codex / gemini / …)  ← this row
--
-- agent_id was implicitly the bundled template's runtime.json default
-- before this migration. Splitting it out lets users pick e.g. "Director
-- powered by codex" or "Director powered by claude-code-acp" on the same
-- runtime, and lets each user pick whichever CLI they already have on
-- PATH on that machine.
--
-- Nullable for back-compat with rows claimed before this column existed.
-- Server treats NULL as "use the bundled template default" so old claims
-- keep working until the user opens the dialog and sets one.

ALTER TABLE `crew_member` ADD COLUMN `agent_id` TEXT;
