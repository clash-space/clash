-- Account-scoped OAuth state for plugin providers.
--
-- Token payloads are stored encrypted and never returned by public settings
-- APIs. account_id ties the authorization to a provider_account row so two
-- configs for the same provider do not share authorization accidentally.

CREATE TABLE `provider_oauth` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `user_id` TEXT NOT NULL,
  `provider_id` TEXT NOT NULL,
  `account_id` TEXT,
  `status` TEXT NOT NULL DEFAULT 'pending',
  `encrypted_tokens` TEXT,
  `verification_uri` TEXT,
  `user_code` TEXT,
  `device_code` TEXT,
  `interval_seconds` INTEGER,
  `account_label` TEXT,
  `expires_at` INTEGER,
  `error` TEXT,
  `has_tokens` INTEGER NOT NULL DEFAULT 0,
  `created_at` INTEGER DEFAULT (strftime('%s', 'now')),
  `updated_at` INTEGER DEFAULT (strftime('%s', 'now'))
);
CREATE INDEX `provider_oauth_user_idx` ON `provider_oauth` (`user_id`);
CREATE INDEX `provider_oauth_provider_idx` ON `provider_oauth` (`user_id`, `provider_id`, `account_id`);
