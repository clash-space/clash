import type {
  BenchmarkIdentityIntegrityReport,
  BenchmarkIdentityIntegrityViolation,
  ProductExecutionReport,
} from "./types";

type JsonRecord = Record<string, unknown>;

const IDENTITY_VARIABLES = [
  {
    name: "CLASH_AGENT_MEMBER_ID",
    clearedCode: "agent-member-id-cleared",
    unsetCode: "agent-member-id-unset",
  },
  {
    name: "CLASH_AGENT_NAME",
    clearedCode: "agent-name-cleared",
    unsetCode: "agent-name-unset",
  },
] as const;

const SHELL_BOUNDARY = String.raw`[\s;&|("'\x60]`;
const SHELL_END_BOUNDARY = String.raw`(?=$|[\s;&|)"'\x60])`;
const COMMAND_START = String.raw`(?:^|(?:\r?\n|;|&&|\|\|)\s*)`;
const LEADING_ASSIGNMENTS = String.raw`(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|[^\s;&|]*)\s+)*`;

function asRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function shellPayload(command: string): string {
  const wrapper = /^(?:\/bin\/)?(?:ba|z|)sh\s+-lc\s+(["'])([\s\S]*)\1$/u.exec(
    command.trim(),
  );
  return wrapper?.[2] ?? command;
}

function assignmentValues(command: string, variable: string): string[] {
  const pattern = new RegExp(
    String.raw`${COMMAND_START}(?:export\s+|env\s+)?${LEADING_ASSIGNMENTS}${variable}=(?:"([^"]*)"|'([^']*)'|([^\s;&|)"'\x60]*))`,
    "gu",
  );
  const values: string[] = [];
  for (const match of command.matchAll(pattern)) {
    values.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return values;
}

function explicitlyUnsets(command: string, variable: string): boolean {
  const envUnset = new RegExp(
    String.raw`${COMMAND_START}env(?:\s+[^\s;&|]+)*?\s+(?:-u\s+${variable}|--unset(?:=|\s+)${variable})${SHELL_END_BOUNDARY}`,
    "u",
  );
  const shellUnset = new RegExp(
    String.raw`${COMMAND_START}unset(?:\s+-[A-Za-z]+)*(?:\s+[A-Za-z_][A-Za-z0-9_]*)*?\s+${variable}${SHELL_END_BOUNDARY}`,
    "u",
  );
  return envUnset.test(command) || shellUnset.test(command);
}

function compactCommand(command: string): string {
  const compacted = command.replace(/\s+/gu, " ").trim();
  return compacted.length <= 500
    ? compacted
    : `${compacted.slice(0, 497)}...`;
}

function containsClashInvocation(command: string): boolean {
  return new RegExp(
    String.raw`(^|${SHELL_BOUNDARY})(?:(?:[^\s;&|)"'\x60]+/)*)?(?:clash|clash-cli(?:\.cjs)?|clash-session)${SHELL_END_BOUNDARY}`,
    "u",
  ).test(command) || /\$\{?CLASH_CLI_ENTRY_PATH\}?/u.test(command);
}

function violationsInCommand(
  command: string,
  source: BenchmarkIdentityIntegrityViolation["source"],
  sourceLine: number,
): BenchmarkIdentityIntegrityViolation[] {
  const payload = shellPayload(command);
  if (!containsClashInvocation(payload)) return [];
  const evidence = compactCommand(command);
  const violations: BenchmarkIdentityIntegrityViolation[] = [];
  const localUserValues = assignmentValues(
    payload,
    "CLASH_SESSION_AS_LOCAL_USER",
  );
  if (
    localUserValues.some((value) =>
      ["1", "true", "yes", "on"].includes(value.toLowerCase()),
    )
  ) {
    violations.push({
      code: "local-user-override",
      source,
      sourceLine,
      command: evidence,
    });
  }

  for (const variable of IDENTITY_VARIABLES) {
    if (assignmentValues(payload, variable.name).some((value) => value === "")) {
      violations.push({
        code: variable.clearedCode,
        source,
        sourceLine,
        command: evidence,
      });
    }
    if (explicitlyUnsets(payload, variable.name)) {
      violations.push({
        code: variable.unsetCode,
        source,
        sourceLine,
        command: evidence,
      });
    }
  }
  return violations;
}

function jsonLines(text: string): Array<{ line: number; value: JsonRecord }> {
  return text.split(/\r?\n/u).flatMap((raw, index) => {
    if (!raw.trim()) return [];
    try {
      const value = asRecord(JSON.parse(raw) as unknown);
      return value ? [{ line: index + 1, value }] : [];
    } catch {
      return [];
    }
  });
}

export function inspectBenchmarkIdentityIntegrity(input: {
  /** Raw JSONL from any supported first-class agent. */
  agentEventsText?: string;
  /** @deprecated Use agentEventsText. Retained for API compatibility. */
  codexEventsText?: string;
  cliTraceText?: string;
}): BenchmarkIdentityIntegrityReport {
  const violations: BenchmarkIdentityIntegrityViolation[] = [];
  const seen = new Set<string>();
  const record = (
    command: string,
    source: BenchmarkIdentityIntegrityViolation["source"],
    sourceLine: number,
  ): void => {
    for (const violation of violationsInCommand(command, source, sourceLine)) {
      const key = `${violation.source}\0${violation.code}\0${violation.command}`;
      if (seen.has(key)) continue;
      seen.add(key);
      violations.push(violation);
    }
  };

  const agentEventsText = input.agentEventsText ?? input.codexEventsText ?? "";
  for (const { line, value: envelope } of jsonLines(agentEventsText)) {
    const item = asRecord(envelope.item);
    if (item?.type === "command_execution" && typeof item.command === "string") {
      record(item.command, "codex-command", line);
    }
    const message = asRecord(envelope.message);
    const content = Array.isArray(message?.content) ? message.content : [];
    for (const candidate of content) {
      const toolUse = asRecord(candidate);
      const toolInput = asRecord(toolUse?.input);
      if (
        toolUse?.type === "tool_use" &&
        toolUse.name === "Bash" &&
        typeof toolInput?.command === "string"
      ) {
        record(toolInput.command, "claude-command", line);
      }
    }
  }

  for (const { line, value: event } of jsonLines(input.cliTraceText ?? "")) {
    if (
      event.type !== "clash.cli.started" &&
      event.type !== "clash.cli.completed"
    ) {
      continue;
    }
    const commands = new Set<string>();
    if (typeof event.command === "string") commands.add(event.command);
    if (
      Array.isArray(event.argv) &&
      event.argv.every((argument) => typeof argument === "string")
    ) {
      commands.add((event.argv as string[]).join(" "));
    }
    for (const command of commands) {
      record(command, "clash-cli-trace", line);
    }
  }

  return violations.length === 0
    ? {
        status: "pass",
        violations,
        detail:
          "No explicit Clash agent identity bypass was observed in agent commands or Clash CLI trace evidence.",
      }
    : {
        status: "fail",
        violations,
        detail: `Detected ${violations.length} explicit Clash agent identity bypass indicator(s): ${[
          ...new Set(violations.map(({ code }) => code)),
        ].join(", ")}.`,
      };
}

export function enforceBenchmarkIdentityIntegrity(
  report: ProductExecutionReport,
  identityIntegrity: BenchmarkIdentityIntegrityReport,
): ProductExecutionReport {
  return {
    ...report,
    status: identityIntegrity.status === "fail" ? "fail" : report.status,
    detail: `${report.detail} ${identityIntegrity.detail}`,
    identityIntegrity,
  };
}
