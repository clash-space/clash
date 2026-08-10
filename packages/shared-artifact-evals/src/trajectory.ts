import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";

import type { BenchmarkAgent } from "./types";
import { effectiveMcpToolName } from "./product-operations";

type ObservationRecord = {
  line: number;
  observedAt: string;
  monotonicMs: number;
  rawLineSha256: string;
  parsed: boolean;
  type?: string;
};

export type TrajectoryAction = {
  sequence: number;
  source: "codex" | "claude" | "pi" | "clash-cli";
  sourceLine: number;
  kind: "mcp" | "cli" | "shell";
  operation: string;
  status: "started" | "succeeded" | "failed";
  observedAt: string;
  monotonicMs: number;
  correlationId?: string;
  error?: string;
};

/**
 * Non-gating usability diagnostics. These describe how hard Clash was to drive,
 * never whether the produced artifact is good, so no gate may read them.
 */
export type TrajectoryUsability = {
  successfulClashActionCount: number;
  failedClashActionCount: number;
  errorCodes: string[];
  recoveryCount: number;
  parameterErrorCount: number;
  helpActionCount: number;
  contractDiscoveryActionCount: number;
  contractResponseBytes: number;
  largestContractResponseBytes: number;
  timeToFirstSuccessfulMutationMs?: number;
  transportsUsed: Array<"mcp" | "cli">;
  transportSwitchCount: number;
};

export type NormalizedTrajectory = {
  schemaVersion: 1;
  sourceTraces: Array<{
    kind: "codex-events" | "claude-events" | "pi-events" | "command-stdout" | "runner-observations" | "clash-cli-events";
    path: string;
    sha256: string;
    bytes: number;
    lines: number;
  }>;
  actions: TrajectoryAction[];
  repairs: Array<{
    operation: string;
    failedSequence: number;
    recoverySequence: number;
  }>;
  turns: Array<{
    status: "completed" | "failed";
    turnCount?: number;
    usage: {
      inputTokens: number;
      cachedInputTokens: number;
      outputTokens: number;
      reasoningOutputTokens: number;
    };
    error?: string;
  }>;
  usage: {
    turnCount: number;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    reasoningOutputTokens: number;
  };
  errors: Array<{
    source: "codex" | "claude" | "pi" | "clash-cli";
    sourceLine: number;
    message: string;
  }>;
  summary: {
    actionCount: number;
    failedActionCount: number;
    repairCount: number;
    turnCount: number;
  };
  usability: TrajectoryUsability;
};

function roundMonotonicMs(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function parseLineType(rawLine: string): { parsed: boolean; type?: string } {
  try {
    const value = JSON.parse(rawLine) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return { parsed: true };
    const type = (value as { type?: unknown }).type;
    return typeof type === "string" ? { parsed: true, type } : { parsed: true };
  } catch {
    return { parsed: false };
  }
}

const DROPPED_STREAM_EVENT_TYPES = new Set([
  "message_update",
  "tool_execution_update",
]);

const PROJECTED_MESSAGE_EVENT_TYPES = new Set([
  "message_start",
  "message_end",
  "turn_end",
]);

function summarizeMessageContent(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const content = asRecord(item);
    if (!content) return { type: typeof item };
    const type = typeof content.type === "string" ? content.type : "unknown";
    const text = typeof content.text === "string"
      ? content.text
      : typeof content.thinking === "string"
        ? content.thinking
        : undefined;
    let argumentsBytes: number | undefined;
    if (content.arguments !== undefined) {
      try {
        argumentsBytes = Buffer.byteLength(JSON.stringify(content.arguments));
      } catch {
        argumentsBytes = undefined;
      }
    }
    return {
      type,
      ...(typeof content.id === "string" ? { id: content.id } : {}),
      ...(typeof content.name === "string" ? { name: content.name } : {}),
      ...(text === undefined ? {} : { characterCount: text.length }),
      ...(argumentsBytes === undefined ? {} : { argumentsBytes }),
    };
  });
}

function projectMessage(value: unknown): Record<string, unknown> {
  const message = asRecord(value) ?? {};
  return Object.fromEntries(
    [
      "role",
      "api",
      "provider",
      "model",
      "usage",
      "stopReason",
      "timestamp",
      "responseId",
    ]
      .filter((key) => message[key] !== undefined)
      .map((key) => [key, message[key]]),
  ) as Record<string, unknown> & {
    contentSummary?: Array<Record<string, unknown>>;
  };
}

function compactCapturedEvent(rawLine: string): {
  type?: string;
  line?: string;
  dropped: boolean;
  projected: boolean;
} {
  let event: Record<string, unknown> | undefined;
  try {
    event = asRecord(JSON.parse(rawLine) as unknown);
  } catch {
    return { dropped: false, projected: false };
  }
  const type = typeof event?.type === "string" ? event.type : undefined;
  if (!event || !type) return { dropped: false, projected: false };
  if (DROPPED_STREAM_EVENT_TYPES.has(type)) {
    return { type, dropped: true, projected: false };
  }
  if (PROJECTED_MESSAGE_EVENT_TYPES.has(type)) {
    const message = projectMessage(event.message);
    const contentSummary = summarizeMessageContent(asRecord(event.message)?.content);
    return {
      type,
      line: JSON.stringify({
        type,
        message: {
          ...message,
          ...(contentSummary.length > 0 ? { contentSummary } : {}),
        },
        ...(type === "turn_end" && Array.isArray(event.toolResults)
          ? { toolResultCount: event.toolResults.length }
          : {}),
      }),
      dropped: false,
      projected: true,
    };
  }
  if (type === "agent_end") {
    return {
      type,
      line: JSON.stringify({
        type,
        messageCount: Array.isArray(event.messages) ? event.messages.length : 0,
      }),
      dropped: false,
      projected: true,
    };
  }
  return { type, dropped: false, projected: false };
}

export async function captureObservedOutput(input: {
  stream: Readable;
  rawPath: string;
  observedPath: string;
  startedMonotonic: bigint;
}): Promise<void> {
  const rawFile = await open(input.rawPath, "w");
  const observedFile = await open(input.observedPath, "w");
  const decoder = new TextDecoder();
  let pending = "";
  let lineNumber = 0;
  let retainedLineCount = 0;
  let rawEndsWithNewline = true;
  let droppedBytes = 0;
  let projectedBytesSaved = 0;
  const droppedEventTypes = new Map<string, number>();
  const projectedEventTypes = new Map<string, number>();

  const observeLine = async (
    rawLineWithPossibleCarriageReturn: string,
  ): Promise<void> => {
    const rawLine = rawLineWithPossibleCarriageReturn.endsWith("\r")
      ? rawLineWithPossibleCarriageReturn.slice(0, -1)
      : rawLineWithPossibleCarriageReturn;
    lineNumber += 1;
    const parsed = parseLineType(rawLine);
    const observation: ObservationRecord = {
      line: lineNumber,
      observedAt: new Date().toISOString(),
      monotonicMs: roundMonotonicMs(
        Number(process.hrtime.bigint() - input.startedMonotonic) / 1_000_000,
      ),
      rawLineSha256: createHash("sha256").update(rawLine).digest("hex"),
      ...parsed,
    };
    await observedFile.write(`${JSON.stringify(observation)}\n`, undefined, "utf8");
  };

  const captureLine = async (
    rawLineWithPossibleCarriageReturn: string,
    hasNewline: boolean,
  ): Promise<void> => {
    const rawLine = rawLineWithPossibleCarriageReturn.endsWith("\r")
      ? rawLineWithPossibleCarriageReturn.slice(0, -1)
      : rawLineWithPossibleCarriageReturn;
    const compacted = compactCapturedEvent(rawLine);
    if (compacted.dropped && compacted.type) {
      droppedEventTypes.set(
        compacted.type,
        (droppedEventTypes.get(compacted.type) ?? 0) + 1,
      );
      droppedBytes += Buffer.byteLength(
        `${rawLineWithPossibleCarriageReturn}${hasNewline ? "\n" : ""}`,
      );
      return;
    }
    const capturedLine = compacted.line ?? rawLineWithPossibleCarriageReturn;
    if (compacted.projected && compacted.type && compacted.line) {
      projectedEventTypes.set(
        compacted.type,
        (projectedEventTypes.get(compacted.type) ?? 0) + 1,
      );
      projectedBytesSaved += Math.max(
        0,
        Buffer.byteLength(
          `${rawLineWithPossibleCarriageReturn}${hasNewline ? "\n" : ""}`,
        ) - Buffer.byteLength(`${compacted.line}${hasNewline ? "\n" : ""}`),
      );
    }
    await rawFile.write(
      `${capturedLine}${hasNewline ? "\n" : ""}`,
      undefined,
      "utf8",
    );
    retainedLineCount += 1;
    rawEndsWithNewline = hasNewline;
    await observeLine(capturedLine);
  };

  try {
    for await (const value of input.stream) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array);
      pending += decoder.decode(chunk, { stream: true });
      let newline = pending.indexOf("\n");
      while (newline >= 0) {
        await captureLine(pending.slice(0, newline), true);
        pending = pending.slice(newline + 1);
        newline = pending.indexOf("\n");
      }
    }
    pending += decoder.decode();
    if (pending.length > 0) await captureLine(pending, false);
    if (droppedEventTypes.size > 0 || projectedEventTypes.size > 0) {
      const compactionEvent = JSON.stringify({
        schemaVersion: 1,
        type: "benchmark.capture.compacted",
        droppedEventTypes: Object.fromEntries(droppedEventTypes),
        projectedEventTypes: Object.fromEntries(projectedEventTypes),
        droppedBytes,
        projectedBytesSaved,
      });
      if (retainedLineCount > 0 && !rawEndsWithNewline) {
        await rawFile.write("\n", undefined, "utf8");
      }
      await rawFile.write(`${compactionEvent}\n`, undefined, "utf8");
      await observeLine(compactionEvent);
    }
  } finally {
    await Promise.all([rawFile.close(), observedFile.close()]);
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function hashFile(path: string): Promise<{ sha256: string; bytes: number }> {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const value of createReadStream(path)) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array);
    bytes += chunk.byteLength;
    hash.update(chunk);
  }
  return { sha256: hash.digest("hex"), bytes };
}

async function readJsonLines(path: string): Promise<Array<{ line: number; value: unknown }>> {
  const lines: Array<{ line: number; value: unknown }> = [];
  const reader = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  let lineNumber = 0;
  for await (const line of reader) {
    lineNumber += 1;
    if (!line.trim()) continue;
    try {
      lines.push({ line: lineNumber, value: JSON.parse(line) as unknown });
    } catch {
      // The raw source remains authoritative even when a producer emits a non-JSON line.
    }
  }
  return lines;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function errorMessage(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  const record = asRecord(value);
  if (!record) return undefined;
  if (typeof record.message === "string" && record.message.trim()) return record.message.trim();
  try {
    return JSON.stringify(record);
  } catch {
    return String(value);
  }
}

function contentMessage(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!Array.isArray(value)) return errorMessage(value);
  const text = value.flatMap((item) => {
    const record = asRecord(item);
    return record && typeof record.text === "string" ? [record.text] : [];
  }).join("\n").trim();
  return text || undefined;
}

function responseByteLength(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? undefined : Buffer.byteLength(serialized);
  } catch {
    return undefined;
  }
}

function usageNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizeUsage(value: unknown): NormalizedTrajectory["turns"][number]["usage"] {
  const usage = asRecord(value) ?? {};
  return {
    inputTokens: usageNumber(usage.input_tokens),
    cachedInputTokens: usageNumber(usage.cached_input_tokens),
    outputTokens: usageNumber(usage.output_tokens),
    reasoningOutputTokens: usageNumber(usage.reasoning_output_tokens),
  };
}

function normalizeClaudeUsage(value: unknown): NormalizedTrajectory["turns"][number]["usage"] {
  const usage = asRecord(value) ?? {};
  return {
    inputTokens: usageNumber(usage.input_tokens),
    cachedInputTokens: usageNumber(usage.cache_read_input_tokens),
    outputTokens: usageNumber(usage.output_tokens),
    reasoningOutputTokens: 0,
  };
}

function normalizePiUsage(value: unknown): NormalizedTrajectory["turns"][number]["usage"] {
  const usage = asRecord(value) ?? {};
  return {
    inputTokens: usageNumber(usage.input),
    cachedInputTokens: usageNumber(usage.cacheRead),
    outputTokens: usageNumber(usage.output),
    reasoningOutputTokens: usageNumber(usage.reasoning),
  };
}

function cliOperation(argv: string[]): string {
  const operation: string[] = [];
  for (const argument of argv) {
    if (argument.startsWith("-")) break;
    operation.push(argument);
    if (operation.length === 2) break;
  }
  return operation.join(" ") || argv[0] || "clash";
}

type PendingAction = Omit<TrajectoryAction, "sequence"> & {
  epochMs: number;
  stableOrder: number;
};

function actionStatus(envelopeType: string, item: Record<string, unknown>): TrajectoryAction["status"] {
  if (envelopeType === "item.started" || item.status === "in_progress") return "started";
  const failed = Boolean(errorMessage(item.error))
    || item.status === "failed"
    || (typeof item.exit_code === "number" && item.exit_code !== 0);
  return failed ? "failed" : "succeeded";
}

function inferRunOrigin(observations: ObservationRecord[]): number {
  const first = observations.find((observation) => Number.isFinite(Date.parse(observation.observedAt)));
  return first ? Date.parse(first.observedAt) - first.monotonicMs : Date.now();
}

const HELP_FLAGS = new Set(["--help", "-h", "help"]);

const CONTRACT_DISCOVERY_VERBS = new Set([
  "capabilities",
  "contract",
  "describe",
  "docs",
  "manifest",
  "schema",
  "schemas",
  "spec",
]);

/** A dispatcher tool that never resolved to a leaf was a menu or discovery call. */
const MCP_ROOT_TOOLS = new Set([
  "clash",
  "clash_canvas",
  "clash_composition",
  "clash_director",
  "clash_timeline",
  "clash_workspace",
]);

const MUTATION_VERBS = new Set([
  "add",
  "append",
  "apply",
  "capture",
  "create",
  "delete",
  "duplicate",
  "generate",
  "import",
  "insert",
  "move",
  "patch",
  "remove",
  "rename",
  "render",
  "save",
  "set",
  "update",
  "upload",
  "write",
]);

/** Codes meaning the caller could not express the call, not that Clash refused it. */
const PARAMETER_ERROR_CODE_PREFIXES = ["INVALID_", "MISSING_", "UNKNOWN_", "UNRECOGNIZED_"];
const PARAMETER_ERROR_MESSAGE = /unknown (?:option|argument|command|tool|flag)|unrecognized (?:option|argument)|invalid (?:option|argument|value|input|parameter)|missing required (?:option|argument|flag|parameter)/iu;

function clashTransport(action: TrajectoryAction): "mcp" | "cli" | undefined {
  return action.kind === "mcp" || action.kind === "cli" ? action.kind : undefined;
}

function mcpToolName(operation: string): string {
  const separator = operation.indexOf("/");
  return separator >= 0 ? operation.slice(separator + 1) : operation;
}

function operationVerb(action: TrajectoryAction): string {
  if (action.kind === "mcp") {
    return mcpToolName(action.operation).split("_").filter(Boolean).at(-1) ?? "";
  }
  return action.operation
    .split(/\s+/u)
    .filter((token) => token && !token.startsWith("-"))
    .at(-1) ?? "";
}

function isContractDiscoveryOperation(operation: string): boolean {
  const tool = mcpToolName(operation);
  return MCP_ROOT_TOOLS.has(tool)
    || CONTRACT_DISCOVERY_VERBS.has(tool.split("_").filter(Boolean).at(-1) ?? "");
}

function isHelpAction(action: TrajectoryAction): boolean {
  if (action.kind === "mcp") return false;
  const isClashCommandLine = /(?:^|[\s/])clash(?:-cli)?(?:\.[cm]?js)?(?:\s|$)/u.test(action.operation);
  if (action.kind === "shell" && !isClashCommandLine) return false;
  return action.operation.split(/\s+/u).some((token) => HELP_FLAGS.has(token));
}

function failureCode(message: string | undefined): string | undefined {
  return message ? /^([A-Z][A-Z0-9_]{2,}):/u.exec(message.trim())?.[1] : undefined;
}

function isParameterFailure(code: string | undefined, message: string | undefined): boolean {
  if (code && (PARAMETER_ERROR_CODE_PREFIXES.some((prefix) => code.startsWith(prefix))
    || /VALIDATION|SCHEMA/u.test(code))) {
    return true;
  }
  return message !== undefined && PARAMETER_ERROR_MESSAGE.test(message);
}

export function summarizeTrajectoryUsability(input: {
  actions: TrajectoryAction[];
  repairs: NormalizedTrajectory["repairs"];
  contractResponses?: Array<{ operation: string; bytes: number }>;
}): TrajectoryUsability {
  // Started actions are paired with their own terminal action, so counting both would double.
  const settled = input.actions.filter((action) => action.status !== "started");
  const clashActions = settled.filter((action) => clashTransport(action) !== undefined);

  const errorCodes: string[] = [];
  let parameterErrorCount = 0;
  for (const action of clashActions) {
    if (action.status !== "failed") continue;
    const code = failureCode(action.error);
    if (code && !errorCodes.includes(code)) errorCodes.push(code);
    if (isParameterFailure(code, action.error)) parameterErrorCount += 1;
  }

  const transportsUsed: Array<"mcp" | "cli"> = [];
  let transportSwitchCount = 0;
  let previousTransport: "mcp" | "cli" | undefined;
  for (const action of clashActions) {
    const transport = clashTransport(action);
    if (!transport) continue;
    if (!transportsUsed.includes(transport)) transportsUsed.push(transport);
    if (previousTransport && previousTransport !== transport) transportSwitchCount += 1;
    previousTransport = transport;
  }

  const contractBytes = (input.contractResponses ?? [])
    .filter((response) => isContractDiscoveryOperation(response.operation))
    .map((response) => response.bytes);
  const firstMutation = clashActions.find(
    (action) => action.status === "succeeded" && MUTATION_VERBS.has(operationVerb(action)),
  );

  return {
    successfulClashActionCount: clashActions.filter((action) => action.status === "succeeded").length,
    failedClashActionCount: clashActions.filter((action) => action.status === "failed").length,
    errorCodes,
    recoveryCount: input.repairs.length,
    parameterErrorCount,
    helpActionCount: settled.filter((action) => isHelpAction(action)).length,
    contractDiscoveryActionCount: settled.filter(
      (action) => action.kind === "mcp" && isContractDiscoveryOperation(action.operation),
    ).length,
    contractResponseBytes: contractBytes.reduce((total, bytes) => total + bytes, 0),
    largestContractResponseBytes: contractBytes.reduce((largest, bytes) => Math.max(largest, bytes), 0),
    ...(firstMutation
      ? { timeToFirstSuccessfulMutationMs: roundMonotonicMs(firstMutation.monotonicMs) }
      : {}),
    transportsUsed,
    transportSwitchCount,
  };
}

export async function writeNormalizedTrajectory(input: {
  agent: BenchmarkAgent;
  logsRoot: string;
  rawPath: string;
  observedPath: string;
}): Promise<string> {
  const trajectoryPath = join(input.logsRoot, "trajectory.json");
  const rawKind = input.agent.adapter === "codex"
    ? "codex-events"
    : input.agent.adapter === "claude"
      ? "claude-events"
      : input.agent.adapter === "pi"
        ? "pi-events"
      : "command-stdout";
  const rawLines = await readJsonLines(input.rawPath);
  const observationLines = await readJsonLines(input.observedPath);
  const observations = observationLines.flatMap(({ value }) => {
    const record = asRecord(value);
    return record
      && typeof record.line === "number"
      && typeof record.observedAt === "string"
      && typeof record.monotonicMs === "number"
      && typeof record.rawLineSha256 === "string"
      ? [{
          line: record.line,
          observedAt: record.observedAt,
          monotonicMs: record.monotonicMs,
          rawLineSha256: record.rawLineSha256,
          parsed: record.parsed === true,
          ...(typeof record.type === "string" ? { type: record.type } : {}),
        } satisfies ObservationRecord]
      : [];
  });
  const observationByLine = new Map(observations.map((observation) => [observation.line, observation]));
  const runOriginEpochMs = inferRunOrigin(observations);
  const pendingActions: PendingAction[] = [];
  const turns: NormalizedTrajectory["turns"] = [];
  const errors: NormalizedTrajectory["errors"] = [];
  const claudeTools = new Map<
    string,
    { kind: "mcp" | "shell"; operation: string }
  >();
  const seenClaudeToolUses = new Set<string>();
  const piTools = new Map<string, { kind: "mcp" | "shell"; operation: string }>();
  const contractResponses: Array<{ operation: string; bytes: number }> = [];
  let stableOrder = 0;

  for (const { line, value } of rawLines) {
    const envelope = asRecord(value);
    if (!envelope || typeof envelope.type !== "string") continue;
    const observation = observationByLine.get(line);
    const observedAt = observation?.observedAt ?? new Date(runOriginEpochMs).toISOString();
    const monotonicMs = observation?.monotonicMs ?? 0;
    if (input.agent.adapter === "pi") {
      if (envelope.type === "turn_end") {
        const message = asRecord(envelope.message);
        turns.push({
          status: "completed",
          usage: normalizePiUsage(message?.usage),
        });
        continue;
      }
      if (
        envelope.type !== "tool_execution_start" &&
        envelope.type !== "tool_execution_end"
      ) {
        continue;
      }
      const toolCallId = typeof envelope.toolCallId === "string"
        ? envelope.toolCallId
        : undefined;
      const toolName = typeof envelope.toolName === "string"
        ? envelope.toolName
        : undefined;
      if (!toolCallId || !toolName) continue;
      if (envelope.type === "tool_execution_start") {
        const args = asRecord(envelope.args) ?? {};
        const rawMcpName = /^mcp__clash__(.+)$/u.exec(toolName)?.[1]
          ?? (toolName.startsWith("clash") ? toolName : undefined);
        const kind = rawMcpName ? "mcp" : toolName === "bash" ? "shell" : undefined;
        const operation = rawMcpName
          ? `clash/${effectiveMcpToolName({ tool: rawMcpName, arguments: args }) ?? rawMcpName}`
          : toolName === "bash" && typeof args.command === "string"
            ? args.command
            : undefined;
        if (!kind || !operation) continue;
        piTools.set(toolCallId, { kind, operation });
        stableOrder += 1;
        pendingActions.push({
          source: "pi",
          sourceLine: line,
          kind,
          operation,
          status: "started",
          observedAt,
          monotonicMs,
          correlationId: toolCallId,
          epochMs: Date.parse(observedAt),
          stableOrder,
        });
        continue;
      }
      const pending = piTools.get(toolCallId);
      if (!pending) continue;
      const failed = envelope.isError === true;
      const failure = failed
        ? contentMessage(asRecord(envelope.result)?.content) ?? "Pi tool call failed"
        : undefined;
      const responseBytes = responseByteLength(asRecord(envelope.result)?.content);
      if (pending.kind === "mcp" && responseBytes !== undefined) {
        contractResponses.push({ operation: pending.operation, bytes: responseBytes });
      }
      stableOrder += 1;
      pendingActions.push({
        source: "pi",
        sourceLine: line,
        kind: pending.kind,
        operation: pending.operation,
        status: failed ? "failed" : "succeeded",
        observedAt,
        monotonicMs,
        correlationId: toolCallId,
        ...(failure ? { error: failure } : {}),
        epochMs: Date.parse(observedAt),
        stableOrder,
      });
      piTools.delete(toolCallId);
      continue;
    }
    if (input.agent.adapter === "claude" && envelope.type === "result") {
      const failed = envelope.is_error === true || envelope.subtype !== "success";
      const message = failed
        ? errorMessage(envelope.error) ?? errorMessage(envelope.result)
        : undefined;
      turns.push({
        status: failed ? "failed" : "completed",
        turnCount:
          typeof envelope.num_turns === "number" && envelope.num_turns > 0
            ? envelope.num_turns
            : 1,
        usage: normalizeClaudeUsage(envelope.usage),
        ...(message ? { error: message } : {}),
      });
      if (message) errors.push({ source: "claude", sourceLine: line, message });
      continue;
    }
    if (input.agent.adapter === "claude") {
      const message = asRecord(envelope.message);
      const content = Array.isArray(message?.content) ? message.content : [];
      if (envelope.type === "assistant") {
        for (const candidate of content) {
          const toolUse = asRecord(candidate);
          if (
            toolUse?.type !== "tool_use" ||
            typeof toolUse.id !== "string" ||
            typeof toolUse.name !== "string" ||
            seenClaudeToolUses.has(toolUse.id)
          ) {
            continue;
          }
          const toolInput = asRecord(toolUse.input) ?? {};
          let kind: "mcp" | "shell" | undefined;
          let operation: string | undefined;
          const mcpName = /^mcp__([^]+?)__(.+)$/u.exec(toolUse.name);
          if (mcpName) {
            kind = "mcp";
            operation = `${mcpName[1]}/${
              effectiveMcpToolName({
                tool: mcpName[2],
                arguments: toolInput,
              }) ?? mcpName[2]
            }`;
          } else if (toolUse.name === "Bash") {
            kind = "shell";
            operation = typeof toolInput.command === "string"
              ? toolInput.command
              : "shell";
          }
          if (!kind || !operation) continue;
          seenClaudeToolUses.add(toolUse.id);
          claudeTools.set(toolUse.id, { kind, operation });
          stableOrder += 1;
          pendingActions.push({
            source: "claude",
            sourceLine: line,
            kind,
            operation,
            status: "started",
            observedAt,
            monotonicMs,
            correlationId: toolUse.id,
            epochMs: Date.parse(observedAt),
            stableOrder,
          });
        }
      } else if (envelope.type === "user") {
        for (const candidate of content) {
          const toolResult = asRecord(candidate);
          if (
            toolResult?.type !== "tool_result" ||
            typeof toolResult.tool_use_id !== "string"
          ) {
            continue;
          }
          const pending = claudeTools.get(toolResult.tool_use_id);
          if (!pending) continue;
          const failed = toolResult.is_error === true;
          const failure = failed
            ? contentMessage(toolResult.content) ?? "Claude tool call failed"
            : undefined;
          const responseBytes = responseByteLength(toolResult.content);
          if (pending.kind === "mcp" && responseBytes !== undefined) {
            contractResponses.push({ operation: pending.operation, bytes: responseBytes });
          }
          stableOrder += 1;
          pendingActions.push({
            source: "claude",
            sourceLine: line,
            kind: pending.kind,
            operation: pending.operation,
            status: failed ? "failed" : "succeeded",
            observedAt,
            monotonicMs,
            correlationId: toolResult.tool_use_id,
            ...(failure ? { error: failure } : {}),
            epochMs: Date.parse(observedAt),
            stableOrder,
          });
          claudeTools.delete(toolResult.tool_use_id);
        }
      }
      continue;
    }
    if (envelope.type === "turn.completed" || envelope.type === "turn.failed") {
      const turnError = errorMessage(envelope.error);
      turns.push({
        status: envelope.type === "turn.failed" ? "failed" : "completed",
        usage: normalizeUsage(envelope.usage),
        ...(turnError ? { error: turnError } : {}),
      });
      if (turnError) errors.push({ source: "codex", sourceLine: line, message: turnError });
      continue;
    }
    const item = asRecord(envelope.item);
    if (!item) continue;
    if (item.type === "error") {
      const message = errorMessage(item.message) ?? "Unknown Codex error";
      errors.push({ source: "codex", sourceLine: line, message });
      continue;
    }
    if (item.type !== "mcp_tool_call" && item.type !== "command_execution") continue;
    const kind = item.type === "mcp_tool_call" ? "mcp" : "shell";
    const operation = kind === "mcp"
      ? `${typeof item.server === "string" ? item.server : "unknown"}/${effectiveMcpToolName(item) ?? "unknown"}`
      : typeof item.command === "string" ? item.command : "shell";
    const status = actionStatus(envelope.type, item);
    const failure = status === "failed"
      ? errorMessage(item.error)
        ?? (typeof item.exit_code === "number" ? `Command exited with code ${item.exit_code}` : "Action failed")
      : undefined;
    const responseBytes = responseByteLength(item.result);
    if (kind === "mcp" && status !== "started" && responseBytes !== undefined) {
      contractResponses.push({ operation, bytes: responseBytes });
    }
    stableOrder += 1;
    pendingActions.push({
      source: "codex",
      sourceLine: line,
      kind,
      operation,
      status,
      observedAt,
      monotonicMs,
      ...(typeof item.id === "string" ? { correlationId: item.id } : {}),
      ...(failure ? { error: failure } : {}),
      epochMs: Date.parse(observedAt),
      stableOrder,
    });
  }

  const cliPath = join(input.logsRoot, "clash-cli-events.jsonl");
  const hasCliTrace = await pathExists(cliPath);
  const cliLines = hasCliTrace ? await readJsonLines(cliPath) : [];
  for (const { line, value } of cliLines) {
    const event = asRecord(value);
    if (!event || (event.type !== "clash.cli.started" && event.type !== "clash.cli.completed")) continue;
    if (event.origin === "mcp-transport") continue;
    const argv = Array.isArray(event.argv) && event.argv.every((argument) => typeof argument === "string")
      ? event.argv as string[]
      : [];
    const completed = event.type === "clash.cli.completed";
    const failed = completed && (errorMessage(event.error) !== undefined || event.exitCode !== 0);
    const observedAt = completed && typeof event.finishedAt === "string"
      ? event.finishedAt
      : typeof event.startedAt === "string" ? event.startedAt : new Date(runOriginEpochMs).toISOString();
    const epochMs = Date.parse(observedAt);
    const failure = failed
      ? errorMessage(event.error)
        ?? (typeof event.exitCode === "number" ? `Clash CLI exited with code ${event.exitCode}` : "Clash CLI failed")
      : undefined;
    stableOrder += 1;
    pendingActions.push({
      source: "clash-cli",
      sourceLine: line,
      kind: "cli",
      operation: cliOperation(argv),
      status: completed ? failed ? "failed" : "succeeded" : "started",
      observedAt,
      monotonicMs: roundMonotonicMs(Math.max(0, epochMs - runOriginEpochMs)),
      ...(typeof event.pid === "number" ? { correlationId: String(event.pid) } : {}),
      ...(failure ? { error: failure } : {}),
      epochMs,
      stableOrder,
    });
  }

  pendingActions.sort((left, right) => (
    left.epochMs - right.epochMs || left.stableOrder - right.stableOrder
  ));
  const actions: TrajectoryAction[] = pendingActions.map(({ epochMs: _epochMs, stableOrder: _stableOrder, ...action }, index) => ({
    sequence: index + 1,
    ...action,
  }));
  const failedByOperation = new Map<string, TrajectoryAction>();
  const repairs: NormalizedTrajectory["repairs"] = [];
  for (const action of actions) {
    const key = `${action.kind}:${action.operation}`;
    if (action.status === "failed") {
      failedByOperation.set(key, action);
    } else if (action.status === "succeeded") {
      const failure = failedByOperation.get(key);
      if (failure) {
        repairs.push({
          operation: action.operation,
          failedSequence: failure.sequence,
          recoverySequence: action.sequence,
        });
        failedByOperation.delete(key);
      }
    }
  }
  for (const action of actions) {
    if (action.status === "failed" && action.error) {
      errors.push({ source: action.source, sourceLine: action.sourceLine, message: action.error });
    }
  }

  const sourceInputs: Array<{
    kind: NormalizedTrajectory["sourceTraces"][number]["kind"];
    path: string;
    lines: number;
  }> = [
    { kind: rawKind, path: input.rawPath, lines: rawLines.length },
    { kind: "runner-observations", path: input.observedPath, lines: observationLines.length },
    ...(hasCliTrace ? [{ kind: "clash-cli-events" as const, path: cliPath, lines: cliLines.length }] : []),
  ];
  const sourceTraces = await Promise.all(sourceInputs.map(async (source) => ({
    kind: source.kind,
    path: basename(source.path),
    ...(await hashFile(source.path)),
    lines: source.lines,
  })));
  const usage = turns.reduce<NormalizedTrajectory["usage"]>((total, turn) => ({
    turnCount: total.turnCount + (turn.turnCount ?? 1),
    inputTokens: total.inputTokens + turn.usage.inputTokens,
    cachedInputTokens: total.cachedInputTokens + turn.usage.cachedInputTokens,
    outputTokens: total.outputTokens + turn.usage.outputTokens,
    reasoningOutputTokens: total.reasoningOutputTokens + turn.usage.reasoningOutputTokens,
  }), {
    turnCount: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
  });
  const trajectory: NormalizedTrajectory = {
    schemaVersion: 1,
    sourceTraces,
    actions,
    repairs,
    turns,
    usage,
    errors,
    summary: {
      actionCount: actions.length,
      failedActionCount: actions.filter((action) => action.status === "failed").length,
      repairCount: repairs.length,
      turnCount: usage.turnCount,
    },
    usability: summarizeTrajectoryUsability({ actions, repairs, contractResponses }),
  };
  await writeFile(trajectoryPath, `${JSON.stringify(trajectory, null, 2)}\n`, "utf8");
  return trajectoryPath;
}
