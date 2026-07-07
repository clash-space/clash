import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { resolveAgentFilePathInsideCwd } from "./projection-cas";

export type DryRunGateStatus = "planned" | "blocked";
export type DryRunOperationAvailability = "available" | "unavailable" | "missing-credentials";
export type DryRunOperationMode = "local" | "remote";

export type DryRunOperation = {
  id: string;
  capability: string;
  provider: string;
  runtime: string;
  mode: DryRunOperationMode;
  availability: DryRunOperationAvailability;
  estimatedCostUsd: number;
  estimatedSeconds?: number;
  requiresByoKey: boolean;
};

export type DryRunFallbackOption = {
  fromOperationId: string;
  toOperationId: string;
  reason?: string;
};

export type DryRunCostGateRequest = {
  workflowId: string;
  stage: string;
  maxCostUsd: number;
  operations: DryRunOperation[];
  fallbackOptions: DryRunFallbackOption[];
};

export type DryRunRejectedFallback = {
  fromOperationId: string;
  toOperationId: string;
  reason: string;
};

export type DryRunCostGate = {
  schemaVersion: 1;
  kind: "clash.workflow.dry-run-cost-gate";
  workflowId: string;
  stage: string;
  status: DryRunGateStatus;
  executionAllowed: boolean;
  maxCostUsd: number;
  totalEstimatedCostUsd: number;
  totalEstimatedSeconds?: number;
  operations: DryRunOperation[];
  blockedReasons: string[];
  rejectedFallbacks: DryRunRejectedFallback[];
  fallbackUsed: false;
  decisionLog: string[];
  createdAt: string;
};

export type PlanDryRunCostGateOptions = {
  cwd: string;
  requestPath: string;
  outPath?: string;
};

export type PlanDryRunCostGateResult = {
  planned: true;
  status: DryRunGateStatus;
  workflowId: string;
  gatePath: string;
  executionAllowed: boolean;
  totalEstimatedCostUsd: number;
  blockedReasons: string[];
};

export async function planDryRunCostGate(
  options: PlanDryRunCostGateOptions,
): Promise<PlanDryRunCostGateResult> {
  const cwd = resolve(options.cwd);
  const requestPath = resolveProjectPath(cwd, options.requestPath, "dry-run cost gate request");
  const request = parseDryRunCostGateRequest(JSON.parse(await readFile(requestPath, "utf8")));
  const gatePath = resolveAgentFilePathInsideCwd({
    cwd,
    filePath: resolveProjectPath(
      cwd,
      options.outPath ?? join(
        "reviews",
        "gates",
        `${safeSlug(request.workflowId)}.${safeSlug(request.stage)}.dry-run-cost-gate.json`,
      ),
      "dry-run cost gate",
    ),
    writeVerb: "Dry-run cost gate",
  });
  const gate = buildDryRunCostGate(request);
  await writeJson(gatePath, gate);
  return {
    planned: true,
    status: gate.status,
    workflowId: gate.workflowId,
    gatePath,
    executionAllowed: gate.executionAllowed,
    totalEstimatedCostUsd: gate.totalEstimatedCostUsd,
    blockedReasons: gate.blockedReasons,
  };
}

function buildDryRunCostGate(request: DryRunCostGateRequest): DryRunCostGate {
  const totalEstimatedCostUsd = roundMoney(
    request.operations.reduce((sum, operation) => sum + operation.estimatedCostUsd, 0),
  );
  const totalSeconds = request.operations.reduce((sum, operation) => sum + (operation.estimatedSeconds ?? 0), 0);
  const availabilityReasons = request.operations.flatMap((operation) => {
    if (operation.availability === "available") return [];
    if (operation.availability === "missing-credentials") {
      return [`credentials missing for operation ${operation.id}`];
    }
    return [`runtime ${operation.runtime} unavailable for operation ${operation.id}`];
  });
  const budgetReasons = totalEstimatedCostUsd > request.maxCostUsd
    ? [`estimated cost ${formatMoney(totalEstimatedCostUsd)} exceeds max cost ${formatMoney(request.maxCostUsd)}`]
    : [];
  const rejectedFallbacks = request.fallbackOptions.map((fallback) => {
    const from = requireOperation(request.operations, fallback.fromOperationId);
    const to = requireOperation(request.operations, fallback.toOperationId);
    return {
      fromOperationId: fallback.fromOperationId,
      toOperationId: fallback.toOperationId,
      reason: `fallback ${from.provider}/${from.runtime} -> ${to.provider}/${to.runtime} requires explicit approval`,
    };
  });
  const blockedReasons = [...availabilityReasons, ...budgetReasons];
  const status: DryRunGateStatus = blockedReasons.length > 0 ? "blocked" : "planned";
  return {
    schemaVersion: 1,
    kind: "clash.workflow.dry-run-cost-gate",
    workflowId: request.workflowId,
    stage: request.stage,
    status,
    executionAllowed: status === "planned",
    maxCostUsd: request.maxCostUsd,
    totalEstimatedCostUsd,
    ...(totalSeconds > 0 ? { totalEstimatedSeconds: totalSeconds } : {}),
    operations: request.operations,
    blockedReasons,
    rejectedFallbacks,
    fallbackUsed: false,
    decisionLog: [
      `planned dry-run cost gate for ${request.workflowId}/${request.stage}`,
      `estimated cost ${formatMoney(totalEstimatedCostUsd)} against max ${formatMoney(request.maxCostUsd)}`,
      rejectedFallbacks.length > 0
        ? "fallback options recorded but not applied automatically"
        : "no fallback options supplied",
      "did not execute generation, download, render, or provider calls",
    ],
    createdAt: new Date().toISOString(),
  };
}

function parseDryRunCostGateRequest(input: unknown): DryRunCostGateRequest {
  if (!input || typeof input !== "object") {
    throw new Error("dry-run cost gate request must be an object");
  }
  const record = input as Record<string, unknown>;
  return {
    workflowId: requireNonEmpty(record.workflowId, "workflowId"),
    stage: requireNonEmpty(record.stage, "stage"),
    maxCostUsd: parseNonNegativeNumber(record.maxCostUsd, "maxCostUsd"),
    operations: parseOperations(record.operations),
    fallbackOptions: parseFallbackOptions(record.fallbackOptions),
  };
}

function parseOperations(input: unknown): DryRunOperation[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error("operations must be a non-empty array");
  }
  const operations = input.map((item) => {
    if (!item || typeof item !== "object") {
      throw new Error("operation must be an object");
    }
    const record = item as Record<string, unknown>;
    return {
      id: requireNonEmpty(record.id, "operation id"),
      capability: requireNonEmpty(record.capability, "operation capability"),
      provider: requireNonEmpty(record.provider, "operation provider"),
      runtime: requireNonEmpty(record.runtime, "operation runtime"),
      mode: parseMode(record.mode),
      availability: parseAvailability(record.availability),
      estimatedCostUsd: parseNonNegativeNumber(record.estimatedCostUsd, "operation estimatedCostUsd"),
      ...(record.estimatedSeconds !== undefined
        ? { estimatedSeconds: parseNonNegativeNumber(record.estimatedSeconds, "operation estimatedSeconds") }
        : {}),
      requiresByoKey: record.requiresByoKey === true,
    };
  });
  const ids = new Set<string>();
  for (const operation of operations) {
    if (ids.has(operation.id)) throw new Error(`duplicate operation id ${operation.id}`);
    ids.add(operation.id);
  }
  return operations;
}

function parseFallbackOptions(input: unknown): DryRunFallbackOption[] {
  if (input === undefined) return [];
  if (!Array.isArray(input)) {
    throw new Error("fallbackOptions must be an array");
  }
  return input.map((item) => {
    if (!item || typeof item !== "object") {
      throw new Error("fallback option must be an object");
    }
    const record = item as Record<string, unknown>;
    return {
      fromOperationId: requireNonEmpty(record.fromOperationId, "fallback fromOperationId"),
      toOperationId: requireNonEmpty(record.toOperationId, "fallback toOperationId"),
      ...(typeof record.reason === "string" && record.reason.trim() ? { reason: record.reason.trim() } : {}),
    };
  });
}

function parseMode(input: unknown): DryRunOperationMode {
  if (input === "local" || input === "remote") return input;
  throw new Error("operation mode must be local or remote");
}

function parseAvailability(input: unknown): DryRunOperationAvailability {
  if (input === "available" || input === "unavailable" || input === "missing-credentials") return input;
  throw new Error("operation availability must be available, unavailable, or missing-credentials");
}

function parseNonNegativeNumber(input: unknown, label: string): number {
  if (typeof input !== "number" || !Number.isFinite(input) || input < 0) {
    throw new Error(`${label} must be a non-negative number`);
  }
  return input;
}

function requireOperation(operations: DryRunOperation[], operationId: string): DryRunOperation {
  const operation = operations.find((candidate) => candidate.id === operationId);
  if (!operation) throw new Error(`fallback references unknown operation ${operationId}`);
  return operation;
}

function requireNonEmpty(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

function roundMoney(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function formatMoney(value: number): string {
  return String(roundMoney(value));
}

function resolveProjectPath(cwd: string, rawPath: string, label: string): string {
  if (!rawPath || typeof rawPath !== "string") {
    throw new Error(`${label} path is required`);
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(rawPath)) {
    throw new Error(`${label} path must be a local project path, not a URL`);
  }
  const resolved = isAbsolute(rawPath) ? resolve(rawPath) : resolve(cwd, rawPath);
  if (!isInsideOrEqual(cwd, resolved)) {
    throw new Error(`${label} path must stay inside the current project cwd`);
  }
  return resolved;
}

function isInsideOrEqual(parent: string, child: string): boolean {
  const relativePath = relative(parent, child);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function safeSlug(value: string): string {
  const slug = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "dry-run-cost-gate";
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
