import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

type CliTraceStarted = {
  type: "clash.cli.started";
  startedAt: string;
  pid: number;
  parentPid: number;
  cwd: string;
  argv: string[];
  caseId?: string;
  origin?: "mcp-transport";
};

function appendTrace(path: string, event: object): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(event)}\n`, "utf8");
  } catch {
    // Evidence collection must never change the product command's behavior.
  }
}

export function installCliTrace(input: {
  env?: NodeJS.ProcessEnv;
  argv?: string[];
  cwd?: string;
  pid?: number;
  parentPid?: number;
  onExit?: (handler: (code: number) => void) => void;
  now?: () => Date;
  monotonicNow?: () => bigint;
} = {}): void {
  const env = input.env ?? process.env;
  const configuredPath = env.CLASH_CLI_TRACE_PATH?.trim();
  if (!configuredPath) return;
  const origin =
    env.CLASH_CLI_TRACE_ORIGIN?.trim() === "mcp-transport"
      ? "mcp-transport"
      : undefined;
  const path = resolve(configuredPath);
  const now = input.now ?? (() => new Date());
  const monotonicNow = input.monotonicNow ?? (() => process.hrtime.bigint());
  const startedMonotonic = monotonicNow();
  const started: CliTraceStarted = {
    type: "clash.cli.started",
    startedAt: now().toISOString(),
    pid: input.pid ?? process.pid,
    parentPid: input.parentPid ?? process.ppid,
    cwd: input.cwd ?? process.cwd(),
    argv: input.argv ?? process.argv.slice(2),
    ...(env.CLASH_BENCH_CASE_ID ? { caseId: env.CLASH_BENCH_CASE_ID } : {}),
    ...(origin ? { origin } : {}),
  };
  appendTrace(path, started);

  let completed = false;
  const finish = (exitCode: number): void => {
    if (completed) return;
    completed = true;
    appendTrace(path, {
      type: "clash.cli.completed",
      startedAt: started.startedAt,
      finishedAt: now().toISOString(),
      durationMs: Number(monotonicNow() - startedMonotonic) / 1_000_000,
      pid: started.pid,
      parentPid: started.parentPid,
      cwd: started.cwd,
      argv: started.argv,
      exitCode,
      signal: null,
      ...(started.caseId ? { caseId: started.caseId } : {}),
      ...(started.origin ? { origin: started.origin } : {}),
    });
  };
  const onExit = input.onExit ?? ((handler) => process.once("exit", handler));
  onExit(finish);
}
