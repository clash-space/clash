-- Add the third leg to the agent claim — which ACP CLI to spawn.
--
-- Three independent dimensions per claimed agent:
--   - template_id   : the role (Director / Canvas Editor / …)
--   - runtime_id    : the machine
--   - agent_id      : the ACP CLI (claude-agent-acp / codex / gemini / …)  ← this row
--
-- This lets users pick e.g. "Director powered by codex" or
-- "Director powered by claude-agent-acp" on the same runtime, and lets each
-- user pick whichever CLI they already have on PATH on that machine.

ALTER TABLE `agent_member` ADD COLUMN `agent_id` TEXT NOT NULL DEFAULT '';
