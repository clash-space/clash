CREATE TABLE `asset` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`project_id` text NOT NULL,
	`storage_key` text NOT NULL,
	`url` text NOT NULL,
	`type` text NOT NULL,
	`metadata` text,
	`created_at` integer DEFAULT (strftime('%s', 'now'))
);
