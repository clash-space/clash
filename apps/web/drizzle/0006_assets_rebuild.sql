-- Demolish legacy asset table; rebuild as assets + asset_refs (M:N).
DROP TABLE IF EXISTS `asset`;--> statement-breakpoint

CREATE TABLE `assets` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `kind` text NOT NULL,
  `src_r2_key` text NOT NULL,
  `cover_r2_key` text,
  `width` integer,
  `height` integer,
  `duration_ms` integer,
  `bytes` integer,
  `source_model` text,
  `source_prompt` text,
  `source_task_id` text,
  `created_at` integer DEFAULT (strftime('%s', 'now')),
  `updated_at` integer DEFAULT (strftime('%s', 'now'))
);--> statement-breakpoint
CREATE INDEX `assets_user_idx` ON `assets` (`user_id`, `created_at`);--> statement-breakpoint
CREATE INDEX `assets_task_idx` ON `assets` (`source_task_id`);--> statement-breakpoint

CREATE TABLE `asset_refs` (
  `asset_id` text NOT NULL,
  `project_id` text NOT NULL,
  `imported_at` integer NOT NULL DEFAULT (strftime('%s', 'now')),
  PRIMARY KEY (`asset_id`, `project_id`)
);--> statement-breakpoint
CREATE INDEX `asset_refs_project_idx` ON `asset_refs` (`project_id`);--> statement-breakpoint
CREATE INDEX `asset_refs_asset_idx` ON `asset_refs` (`asset_id`);
