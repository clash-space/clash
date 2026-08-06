CREATE TABLE `plugin_broker_audit` (
  `id` text PRIMARY KEY NOT NULL,
  `capability_id` text NOT NULL,
  `plugin_id` text NOT NULL,
  `plugin_version` text NOT NULL,
  `project_id` text NOT NULL,
  `invocation_id` text NOT NULL,
  `request_id` text NOT NULL,
  `operation` text NOT NULL,
  `target` text NOT NULL,
  `status` text NOT NULL,
  `error` text,
  `occurred_at` integer NOT NULL
);--> statement-breakpoint
CREATE INDEX `plugin_broker_audit_plugin_idx` ON `plugin_broker_audit` (`plugin_id`, `occurred_at`);--> statement-breakpoint
CREATE INDEX `plugin_broker_audit_invocation_idx` ON `plugin_broker_audit` (`invocation_id`, `occurred_at`);
