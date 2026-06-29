-- Per-agent budget pockets on agent_member.
--
-- Phase 0 of multi-actor billing. Today every generation falls back to
-- the project owner for accountability (see api-cf/src/generation/context.ts
-- — getProjectOwner fallback). That breaks the moment two humans collaborate
-- in one project, or the moment an agent (Test Director / Generator / …)
-- initiates a generation on its own. We need explicit attribution from the
-- node-creation site, and we need a budget pocket distinct from the user's
-- main wallet so an agent can be capped without throttling its owner.
--
-- These columns are written by the (closed-source) billing plugin and read
-- by it at enforcement time. The platform code only PLUMBS them: the user
-- sets a budget in Settings → Agent budgets, and that value lands here.
--
-- Columns
--   budget_credits  : Hard cap per period. NULL = unlimited (sane default
--                     for the v1 user who hasn't touched the setting yet).
--   budget_period   : 'monthly' | 'one-time' | 'unlimited'. 'unlimited' is
--                     a marker for the plugin so it can short-circuit; the
--                     credits column is also nulled in that case.
--   budget_used     : Plugin increments this each successful generation.
--                     Defaulted to 0 so existing rows compute correctly.
--   budget_reset_at : Unix seconds, next reset boundary. NULL until the
--                     plugin stamps one — its scheduler walks this column.

ALTER TABLE `agent_member` ADD COLUMN `budget_credits` INTEGER;
ALTER TABLE `agent_member` ADD COLUMN `budget_period` TEXT DEFAULT 'monthly';
ALTER TABLE `agent_member` ADD COLUMN `budget_used` INTEGER DEFAULT 0;
ALTER TABLE `agent_member` ADD COLUMN `budget_reset_at` INTEGER;
