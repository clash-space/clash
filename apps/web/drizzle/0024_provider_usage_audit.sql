CREATE TABLE `provider_usage_audit` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `provider_id` text NOT NULL,
  `provider_account_id` text,
  `model_id` text NOT NULL,
  `operation` text NOT NULL,
  `task_id` text NOT NULL,
  `project_id` text,
  `node_id` text,
  `actor_type` text,
  `actor_user_id` text,
  `actor_agent_id` text,
  `provider_request_id` text,
  `idempotency_key` text NOT NULL,
  `status` text NOT NULL,
  `estimated_cost_micro_usd` integer,
  `estimate_complete` integer DEFAULT 0 NOT NULL,
  `currency` text DEFAULT 'USD' NOT NULL,
  `pricing_source` text NOT NULL,
  `billing_basis` text DEFAULT '{}' NOT NULL,
  `error_code` text,
  `error_message` text,
  `occurred_at` integer NOT NULL
);--> statement-breakpoint
CREATE INDEX `provider_usage_audit_user_time_idx` ON `provider_usage_audit` (`user_id`, `occurred_at`);--> statement-breakpoint
CREATE INDEX `provider_usage_audit_user_task_idx` ON `provider_usage_audit` (`user_id`, `task_id`);
