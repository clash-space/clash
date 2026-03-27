CREATE TABLE `loro_snapshots` (
	`project_id` text PRIMARY KEY NOT NULL,
	`snapshot` blob,
	`version` text,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `loro_snapshot_chunks` (
	`project_id` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`chunk_data` blob NOT NULL,
	PRIMARY KEY (`project_id`, `chunk_index`)
);
