import { Command } from "commander";
import { apiJson } from "../lib/api";
import { isJsonMode, printJson, printTable } from "../lib/output";

export type MutationAuditRecord = {
  id: string;
  createdAt: number;
  operation: string;
  entity: { kind: string; id: string };
  actorClientType?: string | null;
  forced: boolean;
  accepted: boolean;
  reason?: string | null;
  resultEntityId?: string | null;
  error?: string | null;
  mutation?: Record<string, unknown>;
};

export async function fetchMutationAudit(options: {
  operation?: string;
  entity?: string;
  limit?: number;
} = {}): Promise<MutationAuditRecord[]> {
  const params = new URLSearchParams();
  if (options.operation?.trim()) params.set("operation", options.operation.trim());
  if (options.entity?.trim()) params.set("entityId", options.entity.trim());
  if (Number.isFinite(options.limit)) params.set("limit", String(Math.floor(options.limit ?? 0)));
  const query = params.size > 0 ? `?${params.toString()}` : "";
  const data = await apiJson<{ records: MutationAuditRecord[] }>(`/api/v1/mutation-audit${query}`);
  return data.records;
}

export const auditCommand = new Command("audit")
  .description("Inspect local mutation audit evidence");

auditCommand
  .command("mutations")
  .description("List sanitized local host mutation audit records")
  .option("--operation <name>", "Filter by mutation operation")
  .option("--entity <id>", "Filter by entity id")
  .option("--limit <n>", "Maximum records to return", (value) => Number(value), 50)
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const records = await fetchMutationAudit({
      operation: options.operation,
      entity: options.entity,
      limit: options.limit,
    });

    if (isJsonMode(options)) {
      printJson({ records });
      return;
    }

    printTable(records.map((record) => ({
      createdAt: new Date(record.createdAt).toISOString(),
      operation: record.operation,
      entity: `${record.entity.kind}:${record.entity.id}`,
      actor: record.actorClientType ?? "",
      forced: record.forced ? "yes" : "no",
      accepted: record.accepted ? "yes" : "no",
      reason: record.reason ?? record.error ?? "",
    })), [
      { key: "createdAt", label: "Created", width: 24 },
      { key: "operation", label: "Operation", width: 22 },
      { key: "entity", label: "Entity", width: 36 },
      { key: "actor", label: "Actor", width: 10 },
      { key: "forced", label: "Forced", width: 8 },
      { key: "accepted", label: "Accepted", width: 10 },
      { key: "reason", label: "Reason", width: 28 },
    ]);
  });
