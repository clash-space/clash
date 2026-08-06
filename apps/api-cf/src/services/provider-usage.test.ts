import { describe, expect, it } from "vitest";
import type { ProviderUsageAuditEvent } from "@clash/shared-types";
import {
  appendProviderUsageEvent,
  listProviderUsageEvents,
} from "./provider-usage";

type Row = Record<string, unknown>;

class MemoryD1 {
  rows: Row[] = [];

  prepare(sql: string) {
    const db = this;
    return {
      bind(...args: unknown[]) {
        return {
          async run() {
            if (!sql.includes("INSERT OR IGNORE INTO provider_usage_audit")) return {};
            const [
              id, userId, providerId, providerAccountId, modelId, operation,
              taskId, projectId, nodeId, actorType, actorUserId, actorAgentId,
              providerRequestId, idempotencyKey, status, estimatedCostMicroUsd,
              estimateComplete, currency, pricingSource, billingBasis, errorCode,
              errorMessage, occurredAt,
            ] = args;
            if (db.rows.some((row) => row.id === id)) return {};
            db.rows.push({
              id,
              user_id: userId,
              provider_id: providerId,
              provider_account_id: providerAccountId,
              model_id: modelId,
              operation,
              task_id: taskId,
              project_id: projectId,
              node_id: nodeId,
              actor_type: actorType,
              actor_user_id: actorUserId,
              actor_agent_id: actorAgentId,
              provider_request_id: providerRequestId,
              idempotency_key: idempotencyKey,
              status,
              estimated_cost_micro_usd: estimatedCostMicroUsd,
              estimate_complete: estimateComplete,
              currency,
              pricing_source: pricingSource,
              billing_basis: billingBasis,
              error_code: errorCode,
              error_message: errorMessage,
              occurred_at: occurredAt,
            });
            return {};
          },
          async all<T>() {
            const [userId, limit] = args;
            return {
              results: db.rows
                .filter((row) => row.user_id === userId)
                .sort((a, b) => Number(b.occurred_at) - Number(a.occurred_at))
                .slice(0, Number(limit)),
            } as T;
          },
        };
      },
    };
  }
}

const event: ProviderUsageAuditEvent = {
  id: "task-1:pika:req-1:submitted",
  userId: "user-1",
  providerId: "pika",
  providerAccountId: "pika-primary",
  modelId: "pika-2.5",
  operation: "pika/v2.5/text-to-video",
  taskId: "task-1",
  projectId: "project-1",
  nodeId: "node-1",
  providerRequestId: "req-1",
  idempotencyKey: "idem-1",
  status: "submitted",
  estimatedCostMicroUsd: 200_000,
  estimateComplete: true,
  currency: "USD",
  pricingSource: "pika-catalog",
  billingBasis: { duration: 5, resolution: "720p" },
  occurredAt: "2026-08-05T10:00:00.000Z",
};

describe("provider usage audit", () => {
  it("appends immutable events and ignores a replayed event id", async () => {
    const db = new MemoryD1();
    await appendProviderUsageEvent(db as unknown as D1Database, event);
    await appendProviderUsageEvent(db as unknown as D1Database, {
      ...event,
      status: "failed",
      estimatedCostMicroUsd: 999_000,
    });

    await expect(listProviderUsageEvents(db as unknown as D1Database, "user-1", 100))
      .resolves.toEqual([event]);
  });
});
