ALTER TABLE `provider_account` ADD `api_shape` TEXT;

CREATE TABLE `model_card_config` (
  `user_id` TEXT NOT NULL,
  `model_id` TEXT NOT NULL,
  `custom` INTEGER NOT NULL DEFAULT 0,
  `kind` TEXT NOT NULL DEFAULT 'text',
  `name` TEXT,
  `description` TEXT,
  `prompt_guidance` TEXT,
  `created_at` INTEGER DEFAULT (strftime('%s', 'now')),
  `updated_at` INTEGER DEFAULT (strftime('%s', 'now')),
  PRIMARY KEY (`user_id`, `model_id`)
);
CREATE INDEX `model_card_config_user_idx` ON `model_card_config` (`user_id`);

CREATE TABLE `model_card_provider_binding` (
  `user_id` TEXT NOT NULL,
  `model_id` TEXT NOT NULL,
  `provider_account_id` TEXT NOT NULL,
  `upstream_model` TEXT NOT NULL,
  `position` INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (`user_id`, `model_id`, `provider_account_id`)
);
CREATE INDEX `model_card_provider_binding_user_idx` ON `model_card_provider_binding` (`user_id`);
