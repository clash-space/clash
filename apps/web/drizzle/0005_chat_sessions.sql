CREATE TABLE `chat_session` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `user_id` text NOT NULL,
  `thread_id` text NOT NULL,
  `title` text,
  `created_at` integer DEFAULT (strftime('%s', 'now')),
  `updated_at` integer DEFAULT (strftime('%s', 'now'))
);--> statement-breakpoint
CREATE INDEX `chat_session_project_idx` ON `chat_session` (`project_id`, `user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `chat_session_thread_idx` ON `chat_session` (`thread_id`);
