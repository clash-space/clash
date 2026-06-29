-- Provider accounts for model routing.
--
-- Multiple rows per user/provider are allowed so users can keep several keys
-- and order them with priority. Credential values are encrypted; only the
-- configured credential key names are stored separately for UI/model catalog
-- availability checks.

CREATE TABLE `provider_account` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `user_id` TEXT NOT NULL,
  `provider_id` TEXT NOT NULL,
  `upstream_id` TEXT,
  `region` TEXT,
  `label` TEXT,
  `enabled` INTEGER NOT NULL DEFAULT 1,
  `priority` INTEGER,
  `weight` INTEGER,
  `encrypted_credentials` TEXT,
  `configured_credentials` TEXT,
  `created_at` INTEGER DEFAULT (strftime('%s', 'now')),
  `updated_at` INTEGER DEFAULT (strftime('%s', 'now'))
);
CREATE INDEX `provider_account_user_idx` ON `provider_account` (`user_id`);
CREATE INDEX `provider_account_provider_idx` ON `provider_account` (`user_id`, `provider_id`, `upstream_id`);
