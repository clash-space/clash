CREATE TABLE `asset_library_refs` (
  `asset_id` text NOT NULL,
  `user_id` text NOT NULL,
  `added_at` integer NOT NULL DEFAULT (strftime('%s', 'now')),
  PRIMARY KEY (`asset_id`, `user_id`)
);--> statement-breakpoint
CREATE INDEX `asset_library_refs_user_idx` ON `asset_library_refs` (`user_id`, `added_at`);--> statement-breakpoint
CREATE INDEX `asset_library_refs_asset_idx` ON `asset_library_refs` (`asset_id`);
