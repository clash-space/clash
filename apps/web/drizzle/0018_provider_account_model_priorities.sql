ALTER TABLE provider_account ADD COLUMN model_priorities TEXT;

-- JSON object mapping public model card ids to provider/account priority.
-- NULL means the account has no per-model provider priority override.
