import type { UserModelCardConfig } from "@clash/shared-types";

type ModelCardConfigRow = {
  user_id: string;
  model_id: string;
  custom: number;
  kind: string;
  name: string | null;
  description: string | null;
  prompt_guidance: string | null;
  created_at: number | null;
  updated_at: number | null;
};

type ModelCardProviderBindingRow = {
  user_id: string;
  model_id: string;
  provider_account_id: string;
  upstream_model: string;
  position: number;
};

function isoTimestamp(value: number | null): string | undefined {
  return typeof value === "number"
    ? new Date(value * 1000).toISOString()
    : undefined;
}

export async function listModelCardConfigs(
  db: D1Database,
  userId: string,
): Promise<UserModelCardConfig[]> {
  const [configs, bindings] = await Promise.all([
    db
      .prepare(
        `SELECT user_id, model_id, custom, kind, name, description, prompt_guidance, created_at, updated_at
         FROM model_card_config
         WHERE user_id = ?
         ORDER BY model_id`,
      )
      .bind(userId)
      .all<ModelCardConfigRow>(),
    db
      .prepare(
        `SELECT user_id, model_id, provider_account_id, upstream_model, position
         FROM model_card_provider_binding
         WHERE user_id = ?
         ORDER BY model_id, position, provider_account_id`,
      )
      .bind(userId)
      .all<ModelCardProviderBindingRow>(),
  ]);
  const bindingsByModel = new Map<string, UserModelCardConfig["providerBindings"]>();
  for (const row of bindings.results ?? []) {
    const current = bindingsByModel.get(row.model_id) ?? [];
    current.push({
      providerAccountId: row.provider_account_id,
      upstreamModel: row.upstream_model,
    });
    bindingsByModel.set(row.model_id, current);
  }
  return (configs.results ?? []).map((row) => ({
    modelId: row.model_id,
    custom: row.custom === 1,
    kind: "text",
    ...(row.name ? { name: row.name } : {}),
    ...(row.description ? { description: row.description } : {}),
    ...(row.prompt_guidance ? { promptGuidance: row.prompt_guidance } : {}),
    providerBindings: bindingsByModel.get(row.model_id) ?? [],
    ...(isoTimestamp(row.created_at) ? { createdAt: isoTimestamp(row.created_at) } : {}),
    ...(isoTimestamp(row.updated_at) ? { updatedAt: isoTimestamp(row.updated_at) } : {}),
  }));
}

export async function upsertModelCardConfig(
  db: D1Database,
  userId: string,
  config: UserModelCardConfig,
): Promise<UserModelCardConfig> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO model_card_config
       (user_id, model_id, custom, kind, name, description, prompt_guidance, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, model_id) DO UPDATE SET
         custom = excluded.custom,
         kind = excluded.kind,
         name = excluded.name,
         description = excluded.description,
         prompt_guidance = excluded.prompt_guidance,
         updated_at = excluded.updated_at`,
    )
    .bind(
      userId,
      config.modelId,
      config.custom ? 1 : 0,
      "text",
      config.name ?? null,
      config.description ?? null,
      config.promptGuidance ?? null,
      now,
      now,
    )
    .run();
  await db
    .prepare(
      `DELETE FROM model_card_provider_binding
       WHERE user_id = ? AND model_id = ?`,
    )
    .bind(userId, config.modelId)
    .run();
  for (const [position, binding] of config.providerBindings.entries()) {
    await db
      .prepare(
        `INSERT INTO model_card_provider_binding
         (user_id, model_id, provider_account_id, upstream_model, position)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(
        userId,
        config.modelId,
        binding.providerAccountId,
        binding.upstreamModel,
        position,
      )
      .run();
  }
  const saved = (await listModelCardConfigs(db, userId))
    .find((candidate) => candidate.modelId === config.modelId);
  if (!saved) throw new Error("Model card config insert failed.");
  return saved;
}

export async function deleteModelCardConfig(
  db: D1Database,
  userId: string,
  modelId: string,
): Promise<boolean> {
  const existing = (await listModelCardConfigs(db, userId))
    .some((config) => config.modelId === modelId);
  if (!existing) return false;
  await db
    .prepare(
      `DELETE FROM model_card_provider_binding
       WHERE user_id = ? AND model_id = ?`,
    )
    .bind(userId, modelId)
    .run();
  await db
    .prepare(
      `DELETE FROM model_card_config
       WHERE user_id = ? AND model_id = ?`,
    )
    .bind(userId, modelId)
    .run();
  return true;
}
