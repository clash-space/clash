-- Per-provider-account model allowlists.
--
-- JSON array of public model card ids. NULL means the account inherits every
-- model declared by its provider definition.

ALTER TABLE `provider_account` ADD `supported_model_ids` TEXT;
