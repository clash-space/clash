-- api_token
CREATE TABLE `api_token` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL ,
  `name` text NOT NULL,
  `token_hash` text NOT NULL,
  `token_prefix` text NOT NULL,
  `last_used_at` integer,
  `created_at` integer DEFAULT (strftime('%s', 'now'))
);--> statement-breakpoint
CREATE INDEX `api_token_userId_idx` ON `api_token` (`user_id`);--> statement-breakpoint
CREATE INDEX `api_token_hash_idx` ON `api_token` (`token_hash`);--> statement-breakpoint

-- user_variable
CREATE TABLE `user_variable` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL ,
  `key` text NOT NULL,
  `encrypted_value` text NOT NULL,
  `created_at` integer DEFAULT (strftime('%s', 'now')),
  `updated_at` integer DEFAULT (strftime('%s', 'now'))
);--> statement-breakpoint
CREATE INDEX `user_variable_userId_idx` ON `user_variable` (`user_id`);--> statement-breakpoint
CREATE INDEX `user_variable_unique_idx` ON `user_variable` (`user_id`, `key`);--> statement-breakpoint

-- installed_action
CREATE TABLE `installed_action` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL ,
  `action_id` text NOT NULL,
  `name` text NOT NULL,
  `description` text,
  `manifest` text NOT NULL,
  `runtime` text NOT NULL DEFAULT 'worker',
  `version` text,
  `author` text,
  `repository` text,
  `worker_url` text,
  `icon` text,
  `color` text,
  `tags` text,
  `created_at` integer DEFAULT (strftime('%s', 'now'))
);--> statement-breakpoint
CREATE INDEX `installed_action_userId_idx` ON `installed_action` (`user_id`);--> statement-breakpoint
CREATE INDEX `installed_action_unique_idx` ON `installed_action` (`user_id`, `action_id`);--> statement-breakpoint

-- installed_skill
CREATE TABLE `installed_skill` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL ,
  `skill_id` text NOT NULL,
  `name` text NOT NULL,
  `description` text,
  `repository` text,
  `version` text,
  `author` text,
  `icon` text,
  `tags` text,
  `linked_action_id` text,
  `created_at` integer DEFAULT (strftime('%s', 'now'))
);--> statement-breakpoint
CREATE INDEX `installed_skill_userId_idx` ON `installed_skill` (`user_id`);--> statement-breakpoint
CREATE INDEX `installed_skill_unique_idx` ON `installed_skill` (`user_id`, `skill_id`);
