CREATE TABLE `cli_oauth_code` (
  `code_hash` TEXT PRIMARY KEY NOT NULL,
  `user_id` TEXT NOT NULL,
  `client_id` TEXT NOT NULL,
  `redirect_uri` TEXT NOT NULL,
  `code_challenge` TEXT NOT NULL,
  `expires_at` INTEGER NOT NULL,
  `created_at` INTEGER DEFAULT (strftime('%s', 'now'))
);
CREATE INDEX `cli_oauth_code_expires_at_idx` ON `cli_oauth_code` (`expires_at`);
