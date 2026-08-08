#!/usr/bin/env node
import { dirname, resolve } from "node:path";

import {
  createClaudeAgentAdapter,
  createCodexAgentAdapter,
} from "./runner";
import { runBenchmarkSuite } from "./runner";
import { loadBenchmarkSuite } from "./suite";
import type { BenchmarkAgent } from "./types";

type CliOptions = {
  suite?: string;
  output?: string;
  runId?: string;
  caseId?: string;
  agent?: "codex" | "claude" | "command";
  agentCommand?: string;
  agentArgs: string[];
  model?: string;
  clashPluginRoot?: string;
  clashProfile?: "dev" | "prod";
  resume?: boolean;
  maxInfrastructureAttempts?: number;
};

function usage(): string {
  return `Usage: clash-artifact-bench --suite <suite.json> --out <directory> [options]

Options:
  --agent codex|claude|command  Agent adapter (default: codex)
  --agent-command <path>      Command adapter executable; implies --agent command
  --agent-arg <value>         Append one native agent argument (repeatable)
  --case <case-id>            Run one benchmark case
  --model <model>             Agent model override
  --clash-plugin-root <path>  Clash plugin root for clash-host cases (default: plugins/clash)
  --clash-profile dev|prod    Isolated Clash runtime profile (default: dev)
  --run-id <id>               Stable run id (default: run-<timestamp>)
  --resume                    Continue a compatible existing run id
  --max-infra-attempts <n>    Retry infrastructure failures only (default: 2 total attempts)
  --out, --output <directory> Run output root
  -h, --help                  Show this help`;
}

function requiredValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = { agentArgs: [] };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]!;
    if (flag === "--") continue;
    if (flag === "-h" || flag === "--help") {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    }
    if (flag === "--suite") options.suite = requiredValue(args, index++, flag);
    else if (flag === "--out" || flag === "--output") options.output = requiredValue(args, index++, flag);
    else if (flag === "--run-id") options.runId = requiredValue(args, index++, flag);
    else if (flag === "--resume") options.resume = true;
    else if (flag === "--max-infra-attempts") {
      const value = Number.parseInt(requiredValue(args, index++, flag), 10);
      if (!Number.isInteger(value) || value < 1) throw new Error("--max-infra-attempts must be a positive integer");
      options.maxInfrastructureAttempts = value;
    }
    else if (flag === "--case") options.caseId = requiredValue(args, index++, flag);
    else if (flag === "--model") options.model = requiredValue(args, index++, flag);
    else if (flag === "--clash-plugin-root") options.clashPluginRoot = requiredValue(args, index++, flag);
    else if (flag === "--clash-profile") {
      const value = requiredValue(args, index++, flag);
      if (value !== "dev" && value !== "prod") throw new Error("--clash-profile must be dev or prod");
      options.clashProfile = value;
    }
    else if (flag === "--agent-arg") options.agentArgs.push(requiredValue(args, index++, flag));
    else if (flag === "--agent-command") {
      options.agentCommand = requiredValue(args, index++, flag);
      options.agent = "command";
    } else if (flag === "--agent") {
      const value = requiredValue(args, index++, flag);
      if (value !== "codex" && value !== "claude" && value !== "command") {
        throw new Error("--agent must be codex, claude, or command");
      }
      options.agent = value;
    } else {
      throw new Error(`Unknown argument: ${flag}`);
    }
  }
  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!options.suite) throw new Error("--suite is required");
  if (!options.output) throw new Error("--out is required");
  if (options.resume && !options.runId) throw new Error("--resume requires --run-id");
  const invocationRoot = process.env.INIT_CWD ?? process.cwd();
  const suitePath = resolve(invocationRoot, options.suite);
  const loadedSuite = await loadBenchmarkSuite(suitePath);
  const suite = options.caseId
    ? { ...loadedSuite, cases: loadedSuite.cases.filter((benchmarkCase) => benchmarkCase.id === options.caseId) }
    : loadedSuite;
  if (suite.cases.length === 0) throw new Error(`Benchmark case not found: ${options.caseId}`);

  const adapter = options.agent ?? (options.agentCommand ? "command" : "codex");
  const requiresClashHost = suite.cases.some(
    (benchmarkCase) => benchmarkCase.execution?.profile === "clash-host"
      && benchmarkCase.execution.preflight?.status !== "blocked",
  );
  let agent: BenchmarkAgent;
  if (adapter === "command") {
    if (requiresClashHost) throw new Error("clash-host cases require the Codex or Claude adapter");
    if (!options.agentCommand) throw new Error("--agent-command is required for the command adapter");
    agent = { command: options.agentCommand, args: options.agentArgs };
  } else if (adapter === "codex") {
    agent = createCodexAgentAdapter({
      args: options.agentArgs,
      ...(options.model ? { model: options.model } : {}),
      ...(requiresClashHost ? {
        clashHost: {
          pluginRoot: resolve(invocationRoot, options.clashPluginRoot ?? "plugins/clash"),
          profile: options.clashProfile ?? "dev",
        },
      } : {}),
    });
  } else {
    agent = createClaudeAgentAdapter({
      args: options.agentArgs,
      ...(options.model ? { model: options.model } : {}),
      ...(requiresClashHost ? {
        clashHost: {
          pluginRoot: resolve(invocationRoot, options.clashPluginRoot ?? "plugins/clash"),
          profile: options.clashProfile ?? "dev",
        },
      } : {}),
    });
  }
  const report = await runBenchmarkSuite({
    suite,
    suiteRoot: dirname(suitePath),
    outputRoot: resolve(invocationRoot, options.output),
    runId: options.runId ?? `run-${Date.now()}`,
    agent,
    ...(options.resume ? { resume: true } : {}),
    ...(options.maxInfrastructureAttempts
      ? { maxInfrastructureAttempts: options.maxInfrastructureAttempts }
      : {}),
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (
    report.status !== "pass" &&
    (process.exitCode === undefined || process.exitCode === 0)
  ) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
