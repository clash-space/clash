import {
  ProviderUsageAuditEventSchema,
  type ProviderUsageAuditEvent,
} from "@clash/shared-types";

type ProviderUsageAuditRow = {
  id: string;
  user_id: string;
  provider_id: string;
  provider_account_id: string | null;
  model_id: string;
  operation: string;
  task_id: string;
  project_id: string | null;
  node_id: string | null;
  actor_type: string | null;
  actor_user_id: string | null;
  actor_agent_id: string | null;
  provider_request_id: string | null;
  idempotency_key: string;
  status: string;
  estimated_cost_micro_usd: number | null;
  estimate_complete: number;
  currency: string;
  pricing_source: string;
  billing_basis: string;
  error_code: string | null;
  error_message: string | null;
  occurred_at: number | string;
};

export async function appendProviderUsageEvent(
  db: D1Database,
  input: ProviderUsageAuditEvent,
): Promise<void> {
  const event = ProviderUsageAuditEventSchema.parse(input);
  await db.prepare(
    `INSERT OR IGNORE INTO provider_usage_audit
     (id, user_id, provider_id, provider_account_id, model_id, operation,
      task_id, project_id, node_id, actor_type, actor_user_id, actor_agent_id,
      provider_request_id, idempotency_key, status, estimated_cost_micro_usd,
      estimate_complete, currency, pricing_source, billing_basis, error_code,
      error_message, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    event.id,
    event.userId,
    event.providerId,
    event.providerAccountId ?? null,
    event.modelId,
    event.operation,
    event.taskId,
    event.projectId ?? null,
    event.nodeId ?? null,
    event.actorType ?? null,
    event.actorUserId ?? null,
    event.actorAgentId ?? null,
    event.providerRequestId ?? null,
    event.idempotencyKey,
    event.status,
    event.estimatedCostMicroUsd ?? null,
    event.estimateComplete ? 1 : 0,
    event.currency,
    event.pricingSource,
    JSON.stringify(event.billingBasis),
    event.errorCode ?? null,
    event.errorMessage ?? null,
    Date.parse(event.occurredAt),
  ).run();
}

export async function listProviderUsageEvents(
  db: D1Database,
  userId: string,
  limit = 100,
): Promise<ProviderUsageAuditEvent[]> {
  const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
  const result = await db.prepare(
    `SELECT id, user_id, provider_id, provider_account_id, model_id, operation,
            task_id, project_id, node_id, actor_type, actor_user_id, actor_agent_id,
            provider_request_id, idempotency_key, status, estimated_cost_micro_usd,
            estimate_complete, currency, pricing_source, billing_basis, error_code,
            error_message, occurred_at
     FROM provider_usage_audit
     WHERE user_id = ?
     ORDER BY occurred_at DESC, id DESC
     LIMIT ?`,
  ).bind(userId, safeLimit).all<ProviderUsageAuditRow>();

  return (result.results ?? []).map((row) => ProviderUsageAuditEventSchema.parse({
    id: row.id,
    userId: row.user_id,
    providerId: row.provider_id,
    providerAccountId: row.provider_account_id ?? undefined,
    modelId: row.model_id,
    operation: row.operation,
    taskId: row.task_id,
    projectId: row.project_id ?? undefined,
    nodeId: row.node_id ?? undefined,
    actorType: row.actor_type ?? undefined,
    actorUserId: row.actor_user_id ?? undefined,
    actorAgentId: row.actor_agent_id ?? undefined,
    providerRequestId: row.provider_request_id ?? undefined,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    estimatedCostMicroUsd: row.estimated_cost_micro_usd ?? undefined,
    estimateComplete: row.estimate_complete === 1,
    currency: row.currency,
    pricingSource: row.pricing_source,
    billingBasis: JSON.parse(row.billing_basis) as Record<string, unknown>,
    errorCode: row.error_code ?? undefined,
    errorMessage: row.error_message ?? undefined,
    occurredAt: typeof row.occurred_at === "number"
      ? new Date(row.occurred_at).toISOString()
      : row.occurred_at,
  }));
}
