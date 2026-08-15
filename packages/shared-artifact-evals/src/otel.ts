import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { NormalizedTrajectory, TrajectoryAction } from "./trajectory";
import type {
  ArtifactBenchmarkCase,
  BenchmarkAgent,
  BenchmarkCaseReport,
} from "./types";

export type BenchmarkTraceTrack = "functional" | "content-effect";

export type OtlpAnyValue =
  | { stringValue: string }
  | { boolValue: boolean }
  | { intValue: string }
  | { doubleValue: number };

export type OtlpKeyValue = {
  key: string;
  value: OtlpAnyValue;
};

export type OtlpJsonSpanEvent = {
  timeUnixNano: string;
  name: string;
  attributes: OtlpKeyValue[];
};

export type OtlpJsonSpan = {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: OtlpKeyValue[];
  events?: OtlpJsonSpanEvent[];
  status: {
    code: number;
    message?: string;
  };
};

export type OtlpJsonExportTraceServiceRequest = {
  resourceSpans: Array<{
    resource: {
      attributes: OtlpKeyValue[];
    };
    scopeSpans: Array<{
      scope: {
        name: string;
        version: string;
      };
      spans: OtlpJsonSpan[];
    }>;
  }>;
};

export type TrustedCliTraceSummary = {
  status: "sealed";
  sha256: string;
  bytes: number;
  eventCount: number;
  completedCount: number;
  succeededCount: number;
  failedCount: number;
};

export type BenchmarkOtlpTraceInput = {
  suiteId: string;
  runId: string;
  track: BenchmarkTraceTrack;
  benchmark: Pick<ArtifactBenchmarkCase, "id" | "category" | "passScore">;
  agent: BenchmarkAgent;
  attempt: number;
  startedAt: string;
  finishedAt: string;
  report: BenchmarkCaseReport;
  trajectory?: NormalizedTrajectory;
  trustedCliTrace?: TrustedCliTraceSummary;
  /**
   * The trusted Host readback object is fingerprinted as a whole. Its payload,
   * receipts, URLs, local paths, and identifiers are never copied into OTLP.
   */
  productReadback?: unknown;
  environmentTransition?: {
    captureStatus: "complete" | "failed" | "blocked";
    inputBundleDigest?: string;
    modifiedBundleDigest?: string;
    executionLockSha256: string;
  };
  serviceVersion: string;
};

export type BenchmarkOtlpTraceReceipt = {
  schemaVersion: 1;
  format: "otlp-json";
  path: "trace.otlp.json";
  bytes: number;
  sha256: string;
  traceId: string;
  rootSpanId: string;
};

type ContentFingerprint = {
  bytes: number;
  sha256: string;
};

type ActionInterval = {
  sequence: number;
  action: TrajectoryAction;
  startedAt: string;
  finishedAt: string;
};

const HEX_SHA256 = /^[a-f0-9]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u;
const SAFE_SERVICE_VERSION = /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,63}$/u;
const SAFE_MCP_OPERATION = /^[a-z0-9_-]+\/[a-z0-9_]+$/u;
const SAFE_CLI_OPERATION = /^[a-z0-9][a-z0-9-]*(?: [a-z0-9][a-z0-9-]*)*$/u;

// Protobuf enum values from opentelemetry.proto.trace.v1.
const SPAN_KIND_INTERNAL = 1;
const SPAN_KIND_CLIENT = 3;
const STATUS_UNSET = 0;
const STATUS_OK = 1;
const STATUS_ERROR = 2;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function fingerprint(value: string): ContentFingerprint {
  return {
    bytes: Buffer.byteLength(value),
    sha256: sha256(value),
  };
}

function jsonFingerprint(value: unknown): ContentFingerprint {
  let serialized: string;
  try {
    serialized = JSON.stringify(value) ?? "null";
  } catch {
    serialized = "[unserializable]";
  }
  return fingerprint(serialized);
}

function stringAttribute(key: string, value: string): OtlpKeyValue {
  return { key, value: { stringValue: value } };
}

function integerAttribute(key: string, value: number): OtlpKeyValue {
  return { key, value: { intValue: String(Math.trunc(value)) } };
}

function doubleAttribute(key: string, value: number): OtlpKeyValue {
  return { key, value: { doubleValue: value } };
}

function fingerprintAttributes(
  namespace: string,
  value: string,
): OtlpKeyValue[] {
  const content = fingerprint(value);
  return [
    integerAttribute(`${namespace}.bytes`, content.bytes),
    stringAttribute(`${namespace}.sha256`, content.sha256),
  ];
}

function jsonFingerprintAttributes(
  namespace: string,
  value: unknown,
): OtlpKeyValue[] {
  const content = jsonFingerprint(value);
  return [
    integerAttribute(`${namespace}.bytes`, content.bytes),
    stringAttribute(`${namespace}.sha256`, content.sha256),
  ];
}

function unixNano(value: string, label: string): bigint {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    throw new Error(`${label} must be a valid ISO-8601 timestamp`);
  }
  return BigInt(milliseconds) * 1_000_000n;
}

function clamp(value: bigint, minimum: bigint, maximum: bigint): bigint {
  if (value < minimum) return minimum;
  if (value > maximum) return maximum;
  return value;
}

function nonZeroHex(seed: string, length: 16 | 32): string {
  const value = sha256(seed).slice(0, length);
  return /^0+$/u.test(value) ? `${"0".repeat(length - 1)}1` : value;
}

function agentAdapter(agent: BenchmarkAgent): string {
  return agent.adapter ?? "command";
}

function safeOperation(action: TrajectoryAction): string | undefined {
  if (action.kind === "mcp" && SAFE_MCP_OPERATION.test(action.operation)) {
    return action.operation;
  }
  if (action.kind === "cli" && SAFE_CLI_OPERATION.test(action.operation)) {
    return action.operation;
  }
  return undefined;
}

function actionKey(action: TrajectoryAction): string {
  return [
    action.source,
    action.kind,
    action.operation,
    action.correlationId ?? "",
  ].join("\u0000");
}

function actionIntervals(actions: TrajectoryAction[]): ActionInterval[] {
  const pending = new Map<string, TrajectoryAction[]>();
  const intervals: ActionInterval[] = [];
  for (const action of actions) {
    const key = actionKey(action);
    if (action.status === "started") {
      const queue = pending.get(key) ?? [];
      queue.push(action);
      pending.set(key, queue);
      continue;
    }
    const queue = pending.get(key);
    const started = queue?.shift();
    if (queue?.length === 0) pending.delete(key);
    intervals.push({
      sequence: started?.sequence ?? action.sequence,
      action,
      startedAt: started?.observedAt ?? action.observedAt,
      finishedAt: action.observedAt,
    });
  }
  for (const queue of pending.values()) {
    for (const action of queue) {
      intervals.push({
        sequence: action.sequence,
        action,
        startedAt: action.observedAt,
        finishedAt: action.observedAt,
      });
    }
  }
  return intervals.sort((left, right) => left.sequence - right.sequence);
}

function statusForAgent(
  status: BenchmarkCaseReport["agent"]["status"],
): OtlpJsonSpan["status"] {
  if (status === "completed") return { code: STATUS_OK };
  if (status === "not-run") return { code: STATUS_UNSET };
  return { code: STATUS_ERROR, message: "agent run failed" };
}

function statusForAction(
  status: TrajectoryAction["status"],
): OtlpJsonSpan["status"] {
  if (status === "succeeded") return { code: STATUS_OK };
  if (status === "failed") {
    return { code: STATUS_ERROR, message: "agent action failed" };
  }
  return { code: STATUS_UNSET };
}

function event(
  time: bigint,
  name: string,
  attributes: OtlpKeyValue[],
): OtlpJsonSpanEvent {
  return {
    timeUnixNano: String(time),
    name,
    attributes,
  };
}

function assertTraceMetadata(input: BenchmarkOtlpTraceInput): void {
  const identifiers = [
    ["suiteId", input.suiteId],
    ["runId", input.runId],
    ["benchmark.id", input.benchmark.id],
  ] as const;
  for (const [label, value] of identifiers) {
    if (!SAFE_ID.test(value)) {
      throw new Error(`${label} must be a safe benchmark identifier`);
    }
  }
  if (!SAFE_SERVICE_VERSION.test(input.serviceVersion)) {
    throw new Error("serviceVersion must be a bounded package version");
  }
  if (!Number.isInteger(input.attempt) || input.attempt < 1) {
    throw new Error("attempt must be a positive integer");
  }
  if (input.trustedCliTrace) {
    const trace = input.trustedCliTrace;
    const counts = [
      trace.bytes,
      trace.eventCount,
      trace.completedCount,
      trace.succeededCount,
      trace.failedCount,
    ];
    if (
      trace.status !== "sealed" ||
      !HEX_SHA256.test(trace.sha256) ||
      counts.some((value) => !Number.isSafeInteger(value) || value < 0) ||
      trace.completedCount !== trace.succeededCount + trace.failedCount ||
      trace.eventCount < trace.completedCount
    ) {
      throw new Error("trusted CLI trace summary is invalid");
    }
  }
  if (input.environmentTransition) {
    const transition = input.environmentTransition;
    if (
      !HEX_SHA256.test(transition.executionLockSha256) ||
      (transition.inputBundleDigest !== undefined &&
        !HEX_SHA256.test(transition.inputBundleDigest)) ||
      (transition.modifiedBundleDigest !== undefined &&
        !HEX_SHA256.test(transition.modifiedBundleDigest)) ||
      (transition.captureStatus === "complete" &&
        transition.modifiedBundleDigest === undefined) ||
      (transition.captureStatus !== "complete" &&
        transition.modifiedBundleDigest !== undefined)
    ) {
      throw new Error("benchmark Environment transition is invalid");
    }
  }
}

function agentTimeRange(input: {
  rootStart: bigint;
  rootEnd: bigint;
  durationMs: number;
  trajectory?: NormalizedTrajectory;
}): { start: bigint; end: bigint } {
  const originCandidates = (input.trajectory?.actions ?? []).flatMap(
    (action) => {
      const observed = Date.parse(action.observedAt);
      return Number.isFinite(observed) && Number.isFinite(action.monotonicMs)
        ? [observed - action.monotonicMs]
        : [];
    },
  );
  const durationNs =
    BigInt(Math.max(0, Math.round(input.durationMs))) * 1_000_000n;
  const inferredStart =
    originCandidates.length > 0
      ? BigInt(Math.round(Math.min(...originCandidates))) * 1_000_000n
      : input.rootEnd - durationNs;
  const start = clamp(inferredStart, input.rootStart, input.rootEnd);
  const end = clamp(start + durationNs, start, input.rootEnd);
  return { start, end };
}

export function summarizeTrustedCliTrace(input: {
  traceText: string;
  receipt: unknown;
}): TrustedCliTraceSummary {
  if (
    !input.receipt ||
    typeof input.receipt !== "object" ||
    Array.isArray(input.receipt)
  ) {
    throw new Error("Trusted Clash CLI trace receipt is invalid");
  }
  const receipt = input.receipt as Record<string, unknown>;
  if (
    receipt.schemaVersion !== 1 ||
    receipt.source !== "runner-cli-proxy" ||
    receipt.status !== "sealed" ||
    receipt.tracePath !== "clash-cli-events.jsonl" ||
    typeof receipt.traceSha256 !== "string" ||
    !HEX_SHA256.test(receipt.traceSha256) ||
    !Number.isSafeInteger(receipt.eventCount) ||
    (receipt.eventCount as number) < 0
  ) {
    throw new Error("Trusted Clash CLI trace receipt is not sealed");
  }
  const actualSha256 = sha256(input.traceText);
  if (actualSha256 !== receipt.traceSha256) {
    throw new Error(
      "Trusted Clash CLI trace SHA-256 does not match its receipt",
    );
  }

  let eventCount = 0;
  let completedCount = 0;
  let succeededCount = 0;
  let failedCount = 0;
  for (const [index, line] of input.traceText.split(/\r?\n/u).entries()) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      throw new Error(
        `Trusted Clash CLI trace line ${index + 1} is invalid JSON`,
      );
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`Trusted Clash CLI trace line ${index + 1} is invalid`);
    }
    const record = parsed as Record<string, unknown>;
    if (
      record.type !== "clash.cli.started" &&
      record.type !== "clash.cli.completed"
    ) {
      throw new Error(
        `Trusted Clash CLI trace line ${index + 1} has an invalid event type`,
      );
    }
    eventCount += 1;
    if (record.type !== "clash.cli.completed") continue;
    completedCount += 1;
    if (record.exitCode === 0 && record.error === undefined) {
      succeededCount += 1;
    } else {
      failedCount += 1;
    }
  }
  if (eventCount !== receipt.eventCount) {
    throw new Error(
      "Trusted Clash CLI trace event count does not match receipt",
    );
  }
  return {
    status: "sealed",
    sha256: actualSha256,
    bytes: Buffer.byteLength(input.traceText),
    eventCount,
    completedCount,
    succeededCount,
    failedCount,
  };
}

export function buildBenchmarkOtlpTrace(
  input: BenchmarkOtlpTraceInput,
): OtlpJsonExportTraceServiceRequest {
  assertTraceMetadata(input);
  const rootStart = unixNano(input.startedAt, "startedAt");
  const rootEnd = unixNano(input.finishedAt, "finishedAt");
  if (rootEnd < rootStart) {
    throw new Error("finishedAt must not precede startedAt");
  }

  const traceId = nonZeroHex(
    [input.suiteId, input.runId, input.benchmark.id, input.attempt].join(
      "\u0000",
    ),
    32,
  );
  let spanSequence = 0;
  const nextSpanId = (name: string): string => {
    spanSequence += 1;
    return nonZeroHex(`${traceId}\u0000${spanSequence}\u0000${name}`, 16);
  };

  const rootSpanId = nextSpanId("benchmark.attempt");
  const root: OtlpJsonSpan = {
    traceId,
    spanId: rootSpanId,
    name: "benchmark.attempt",
    kind: SPAN_KIND_INTERNAL,
    startTimeUnixNano: String(rootStart),
    endTimeUnixNano: String(rootEnd),
    attributes: [
      stringAttribute("benchmark.category", input.benchmark.category),
      integerAttribute("benchmark.attempt", input.attempt),
      stringAttribute(
        "benchmark.execution.status",
        input.report.execution.status,
      ),
    ],
    status: statusForAgent(input.report.agent.status),
  };

  const agentRange = agentTimeRange({
    rootStart,
    rootEnd,
    durationMs: input.report.agent.durationMs,
    trajectory: input.trajectory,
  });
  const agentSpanId = nextSpanId("benchmark.agent.run");
  const agentEvents: OtlpJsonSpanEvent[] = [];
  for (const source of input.trajectory?.sourceTraces ?? []) {
    agentEvents.push(
      event(agentRange.end, "benchmark.source_trace", [
        stringAttribute("benchmark.source.kind", source.kind),
        integerAttribute("benchmark.source.bytes", source.bytes),
        integerAttribute("benchmark.source.lines", source.lines),
        ...(HEX_SHA256.test(source.sha256)
          ? [stringAttribute("benchmark.source.sha256", source.sha256)]
          : []),
      ]),
    );
  }
  for (const [index, turn] of (input.trajectory?.turns ?? []).entries()) {
    const turnAttributes: OtlpKeyValue[] = [
      integerAttribute("benchmark.turn.index", index + 1),
      stringAttribute("benchmark.turn.status", turn.status),
      integerAttribute("benchmark.turn.count", turn.turnCount ?? 1),
      integerAttribute("benchmark.usage.input_tokens", turn.usage.inputTokens),
      integerAttribute(
        "benchmark.usage.cached_input_tokens",
        turn.usage.cachedInputTokens,
      ),
      integerAttribute(
        "benchmark.usage.output_tokens",
        turn.usage.outputTokens,
      ),
      integerAttribute(
        "benchmark.usage.reasoning_output_tokens",
        turn.usage.reasoningOutputTokens,
      ),
      ...(turn.error
        ? fingerprintAttributes("benchmark.error.payload", turn.error)
        : []),
    ];
    agentEvents.push(
      event(agentRange.end, "benchmark.agent.turn", turnAttributes),
    );
  }
  for (const repair of input.trajectory?.repairs ?? []) {
    agentEvents.push(
      event(agentRange.end, "benchmark.action.recovered", [
        integerAttribute(
          "benchmark.repair.failed_sequence",
          repair.failedSequence,
        ),
        integerAttribute(
          "benchmark.repair.recovery_sequence",
          repair.recoverySequence,
        ),
        ...fingerprintAttributes(
          "benchmark.repair.operation",
          repair.operation,
        ),
      ]),
    );
  }
  if (input.trustedCliTrace) {
    agentEvents.push(
      event(agentRange.end, "benchmark.cli_trace.sealed", [
        stringAttribute("benchmark.cli_trace.status", "sealed"),
        stringAttribute(
          "benchmark.cli_trace.sha256",
          input.trustedCliTrace.sha256,
        ),
        integerAttribute(
          "benchmark.cli_trace.bytes",
          input.trustedCliTrace.bytes,
        ),
        integerAttribute(
          "benchmark.cli_trace.event_count",
          input.trustedCliTrace.eventCount,
        ),
        integerAttribute(
          "benchmark.cli_trace.completed_count",
          input.trustedCliTrace.completedCount,
        ),
        integerAttribute(
          "benchmark.cli_trace.succeeded_count",
          input.trustedCliTrace.succeededCount,
        ),
        integerAttribute(
          "benchmark.cli_trace.failed_count",
          input.trustedCliTrace.failedCount,
        ),
      ]),
    );
  }
  if (input.report.agent.error) {
    agentEvents.push(
      event(agentRange.end, "benchmark.agent.error", [
        ...fingerprintAttributes(
          "benchmark.error.payload",
          input.report.agent.error,
        ),
      ]),
    );
  }
  const usage = input.trajectory?.usage;
  const agent: OtlpJsonSpan = {
    traceId,
    spanId: agentSpanId,
    parentSpanId: rootSpanId,
    name: "benchmark.agent.run",
    kind: SPAN_KIND_INTERNAL,
    startTimeUnixNano: String(agentRange.start),
    endTimeUnixNano: String(agentRange.end),
    attributes: [
      stringAttribute("benchmark.agent.status", input.report.agent.status),
      doubleAttribute(
        "benchmark.agent.duration_ms",
        input.report.agent.durationMs,
      ),
      ...(input.report.agent.exitCode === null
        ? []
        : [
            integerAttribute(
              "benchmark.agent.exit_code",
              input.report.agent.exitCode,
            ),
          ]),
      ...(input.report.agent.signal
        ? [stringAttribute("benchmark.agent.signal", input.report.agent.signal)]
        : []),
      ...(usage
        ? [
            integerAttribute("benchmark.usage.turn_count", usage.turnCount),
            integerAttribute("benchmark.usage.input_tokens", usage.inputTokens),
            integerAttribute(
              "benchmark.usage.cached_input_tokens",
              usage.cachedInputTokens,
            ),
            integerAttribute(
              "benchmark.usage.output_tokens",
              usage.outputTokens,
            ),
            integerAttribute(
              "benchmark.usage.reasoning_output_tokens",
              usage.reasoningOutputTokens,
            ),
          ]
        : []),
    ],
    ...(agentEvents.length > 0 ? { events: agentEvents } : {}),
    status: statusForAgent(input.report.agent.status),
  };

  const actionSpans = actionIntervals(input.trajectory?.actions ?? []).map(
    (interval) => {
      const actionStart = clamp(
        unixNano(interval.startedAt, "action observedAt"),
        agentRange.start,
        agentRange.end,
      );
      const actionEnd = clamp(
        unixNano(interval.finishedAt, "action observedAt"),
        actionStart,
        agentRange.end,
      );
      const operation = safeOperation(interval.action);
      const actionEvents = interval.action.error
        ? [
            event(actionEnd, "benchmark.action.error", [
              ...fingerprintAttributes(
                "benchmark.error.payload",
                interval.action.error,
              ),
            ]),
          ]
        : undefined;
      return {
        traceId,
        spanId: nextSpanId("benchmark.agent.action"),
        parentSpanId: agentSpanId,
        name: "benchmark.agent.action",
        kind:
          interval.action.kind === "mcp" || interval.action.kind === "cli"
            ? SPAN_KIND_CLIENT
            : SPAN_KIND_INTERNAL,
        startTimeUnixNano: String(actionStart),
        endTimeUnixNano: String(actionEnd),
        attributes: [
          integerAttribute("benchmark.action.sequence", interval.sequence),
          stringAttribute("benchmark.action.source", interval.action.source),
          stringAttribute("benchmark.action.kind", interval.action.kind),
          stringAttribute("benchmark.action.status", interval.action.status),
          ...(operation
            ? [stringAttribute("benchmark.action.operation", operation)]
            : []),
          ...fingerprintAttributes(
            "benchmark.action.payload",
            interval.action.operation,
          ),
        ],
        ...(actionEvents ? { events: actionEvents } : {}),
        status: statusForAction(interval.action.status),
      } satisfies OtlpJsonSpan;
    },
  );

  const readbackSummary = input.report.execution.productReadback;
  const readbackSpans: OtlpJsonSpan[] =
    readbackSummary || input.productReadback !== undefined
      ? [
          {
            traceId,
            spanId: nextSpanId("benchmark.host.readback"),
            parentSpanId: rootSpanId,
            name: "benchmark.host.readback",
            kind: SPAN_KIND_CLIENT,
            startTimeUnixNano: String(rootEnd),
            endTimeUnixNano: String(rootEnd),
            attributes: [
              stringAttribute(
                "benchmark.readback.status",
                readbackSummary?.status ?? input.report.execution.status,
              ),
              integerAttribute(
                "benchmark.readback.matched_artifact_count",
                readbackSummary?.matchedArtifactIds.length ?? 0,
              ),
              ...(input.productReadback === undefined
                ? []
                : jsonFingerprintAttributes(
                    "benchmark.readback.payload",
                    input.productReadback,
                  )),
            ],
            status:
              (readbackSummary?.status ?? input.report.execution.status) ===
              "pass"
                ? { code: STATUS_OK }
                : { code: STATUS_ERROR, message: "host readback failed" },
          },
        ]
      : [];

  const environmentSpans: OtlpJsonSpan[] = input.environmentTransition
    ? [
        {
          traceId,
          spanId: nextSpanId("benchmark.environment.capture"),
          parentSpanId: rootSpanId,
          name: "benchmark.environment.capture",
          kind: SPAN_KIND_INTERNAL,
          startTimeUnixNano: String(rootEnd),
          endTimeUnixNano: String(rootEnd),
          attributes: [
            stringAttribute(
              "benchmark.environment.capture.status",
              input.environmentTransition.captureStatus,
            ),
            stringAttribute(
              "benchmark.environment.execution_lock.sha256",
              input.environmentTransition.executionLockSha256,
            ),
            ...(input.environmentTransition.inputBundleDigest
              ? [
                  stringAttribute(
                    "benchmark.environment.input.bundle_digest",
                    input.environmentTransition.inputBundleDigest,
                  ),
                ]
              : []),
            ...(input.environmentTransition.modifiedBundleDigest
              ? [
                  stringAttribute(
                    "benchmark.environment.modified.bundle_digest",
                    input.environmentTransition.modifiedBundleDigest,
                  ),
                ]
              : []),
          ],
          status:
            input.environmentTransition.captureStatus === "complete"
              ? { code: STATUS_OK }
              : input.environmentTransition.captureStatus === "blocked"
                ? { code: STATUS_UNSET }
                : {
                    code: STATUS_ERROR,
                    message: "modified Workspace capture failed",
                  },
        },
      ]
    : [];

  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            stringAttribute("service.name", "clash-agent-benchmark"),
            stringAttribute("service.version", input.serviceVersion),
            stringAttribute("benchmark.suite.id", input.suiteId),
            stringAttribute("benchmark.case.id", input.benchmark.id),
            stringAttribute("benchmark.run.id", input.runId),
            stringAttribute("benchmark.track", input.track),
            stringAttribute("benchmark.agent", agentAdapter(input.agent)),
          ],
        },
        scopeSpans: [
          {
            scope: {
              name: "@clash/artifact-evals",
              version: input.serviceVersion,
            },
            spans: [
              root,
              agent,
              ...actionSpans,
              ...readbackSpans,
              ...environmentSpans,
            ],
          },
        ],
      },
    ],
  };
}

export async function writeBenchmarkOtlpTrace(
  input: BenchmarkOtlpTraceInput & { caseRoot: string },
): Promise<BenchmarkOtlpTraceReceipt> {
  const document = buildBenchmarkOtlpTrace(input);
  const contents = `${JSON.stringify(document, null, 2)}\n`;
  await mkdir(input.caseRoot, { recursive: true });
  const outputPath = join(input.caseRoot, "trace.otlp.json");
  const temporaryPath = join(
    input.caseRoot,
    `.trace.otlp.json.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporaryPath, contents, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, outputPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
  const root = document.resourceSpans[0]!.scopeSpans[0]!.spans[0]!;
  return {
    schemaVersion: 1,
    format: "otlp-json",
    path: "trace.otlp.json",
    bytes: Buffer.byteLength(contents),
    sha256: sha256(contents),
    traceId: root.traceId,
    rootSpanId: root.spanId,
  };
}
