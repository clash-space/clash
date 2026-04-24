-- Collapse per-column asset metadata into a single JSON blob.
--
-- Rationale: width / height / duration_ms / bytes are never used as query
-- predicates (no WHERE / ORDER BY on them). Keeping one column lets us add
-- more fields later (waveform peaks, content hash, dominant color, codec,
-- has_audio, ...) without a migration each time.
--
-- json_extract(metadata, '$.width') still works if we ever need ad-hoc query.

ALTER TABLE `assets` ADD COLUMN `metadata` TEXT;--> statement-breakpoint
UPDATE `assets`
SET `metadata` = json_object(
  'width', width,
  'height', height,
  'durationMs', duration_ms,
  'bytes', bytes
)
WHERE width IS NOT NULL
   OR height IS NOT NULL
   OR duration_ms IS NOT NULL
   OR bytes IS NOT NULL;--> statement-breakpoint
ALTER TABLE `assets` DROP COLUMN `width`;--> statement-breakpoint
ALTER TABLE `assets` DROP COLUMN `height`;--> statement-breakpoint
ALTER TABLE `assets` DROP COLUMN `duration_ms`;--> statement-breakpoint
ALTER TABLE `assets` DROP COLUMN `bytes`;
