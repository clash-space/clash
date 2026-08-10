import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  basename,
  delimiter,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { createConnection } from "node:net";
import { fileURLToPath } from "node:url";
import {
  DirectorStageStateSchema,
  projectDirectorStageReadToken,
  type ProjectDirectorStage,
} from "@clash/shared-types";

import { loadSubmission } from "./artifacts";
import { evaluateSubmission } from "./evaluator";
import {
  installBenchmarkInputFixture,
  writeBenchmarkInputFixtureReceipt,
} from "./fixture";
import {
  enforceBenchmarkIdentityIntegrity,
  inspectBenchmarkIdentityIntegrity,
} from "./identity-integrity";
import { createOutcomeResult, renderOutcomeMarkdown } from "./outcome";
import {
  effectiveMcpToolName,
  formatCliInvocation,
  matchRequiredProductOperations,
} from "./product-operations";
import { writeSuiteGallery } from "./report";
import { ArtifactBenchmarkSuiteSchema } from "./schemas";
import { captureObservedOutput, writeNormalizedTrajectory } from "./trajectory";
import {
  captureRemotionProductReadback,
  captureTimelineProductReadback,
  type RemotionProductReadbackReport,
  type TimelineProductReadbackReport,
} from "./product-readback";
import type {
  AgentRunReport,
  ArtifactBenchmarkCase,
  ArtifactEvaluationReport,
  BenchmarkAttemptLedgerEntry,
  BenchmarkAgent,
  BenchmarkCaseFailure,
  BenchmarkCaseReport,
  BenchmarkInputFixtureProvenance,
  BenchmarkSuiteReport,
  ClaudeAgent,
  CodexAgent,
  OutcomeResult,
  PiAgent,
  ProductExecutionReport,
  RunBenchmarkSuiteInput,
  ReevaluateBenchmarkRunInput,
} from "./types";

const SAFE_PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

class BenchmarkInfrastructureError extends Error {
  readonly phase: string;

  constructor(phase: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BenchmarkInfrastructureError";
    this.phase = phase;
  }
}

type ResolvedClashHost = {
  pluginRoot: string;
  runtimePath: string;
  workspace: string;
  profile: "dev" | "prod";
  runtimeRoot: string;
  clashHome: string;
  persistedClashHome: string;
  localDataDir: string;
  localApiPluginSocket: string;
  projectPluginSocket: string;
  agentMemberId: string;
  agentName: string;
};

type RunningClashHost = ResolvedClashHost & {
  endpoint: string;
  agentCliPath: string;
  readyAt: string;
  child: ChildProcess;
};

type ProjectDaemonReady = {
  projectId: string;
  workspaceId: string;
  initDisposition: "created" | "reused";
  markerSha256: string;
  daemonPid: number;
  mcpUrl: string;
  socketPath: string;
  apiUrl: string;
  ownership: "owned" | "reused";
  readyAt: string;
};

export type BenchmarkWorkspaceBinding = {
  projectId: string;
  workspaceId: string;
  markerPath: string;
  markerSha256: string;
  initDisposition: "created" | "reused";
};

type DirectorReadbackReport = {
  schemaVersion: 1;
  status: "pass" | "fail";
  projectId: string | null;
  matchedArtifactIds: string[];
  stages: Array<{
    id: string;
    name: string;
    revisionId: string;
    readToken: string;
    hostReceipt: string;
    stateSha256: string;
  }>;
  matches: Array<{
    artifactId: string;
    stageId: string;
    stateSha256: string;
  }>;
  captures: Array<{
    receiptPath: string;
    stageId: string;
    stageRevisionId: string;
    renderer: string;
    stateSha256: string;
    frames: Array<{
      artifactId: string;
      sha256: string;
      timeSeconds: number;
      aspectRatio: string;
      width: number;
      height: number;
    }>;
  }>;
  imageMatches: Array<{
    artifactId: string;
    stageId: string;
    captureArtifactId: string;
    sha256: string;
  }>;
  detail: string;
};

type CombinedProductReadbackReport = {
  schemaVersion: 1;
  status: "pass" | "fail";
  projectId: string | null;
  matchedArtifactIds: string[];
  reports: Array<
    | DirectorReadbackReport
    | RemotionProductReadbackReport
    | TimelineProductReadbackReport
  >;
  detail: string;
};

type TrustedProductReadback = {
  report:
    | DirectorReadbackReport
    | RemotionProductReadbackReport
    | TimelineProductReadbackReport
    | CombinedProductReadbackReport;
  receiptPath:
    | "director-readback.json"
    | "remotion-readback.json"
    | "timeline-readback.json"
    | "product-readback.json";
};

function assertSafePathSegment(value: string, label: string): void {
  if (!SAFE_PATH_SEGMENT.test(value) || value === "." || value === "..") {
    throw new Error(`${label} must be a safe path segment`);
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeJsonAtomically(
  path: string,
  value: unknown,
): Promise<void> {
  const temporaryPath = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    await writeJson(temporaryPath, value);
    await rename(temporaryPath, path);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function childHasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

async function terminateChildAndWait(child: ChildProcess): Promise<void> {
  if (childHasExited(child)) return;
  terminateChild(child, "SIGTERM");
  if (await waitForProcessClose(child, 3_000)) return;
  terminateChild(child, "SIGKILL");
  await waitForProcessClose(child, 1_000);
}

class BenchmarkProcessScope {
  private readonly children = new Set<ChildProcess>();
  private installed = false;
  private forceKillTimer: NodeJS.Timeout | undefined;
  interruptedSignal: "SIGINT" | "SIGTERM" | undefined;

  private readonly onSigint = (): void => this.interrupt("SIGINT");
  private readonly onSigterm = (): void => this.interrupt("SIGTERM");

  install(): void {
    if (this.installed) return;
    this.installed = true;
    process.on("SIGINT", this.onSigint);
    process.on("SIGTERM", this.onSigterm);
  }

  track<T extends ChildProcess>(child: T): T {
    this.children.add(child);
    child.once("close", () => {
      this.children.delete(child);
      if (this.children.size === 0 && this.forceKillTimer) {
        clearTimeout(this.forceKillTimer);
        this.forceKillTimer = undefined;
      }
    });
    if (this.interruptedSignal) terminateChild(child, "SIGTERM");
    return child;
  }

  private interrupt(signal: "SIGINT" | "SIGTERM"): void {
    if (this.interruptedSignal) {
      for (const child of this.children) terminateChild(child, "SIGKILL");
      return;
    }
    this.interruptedSignal = signal;
    if (process.exitCode === undefined || process.exitCode === 0) {
      process.exitCode = signal === "SIGINT" ? 130 : 143;
    }
    for (const child of this.children) terminateChild(child, "SIGTERM");
    this.forceKillTimer = setTimeout(() => {
      this.forceKillTimer = undefined;
      for (const child of this.children) terminateChild(child, "SIGKILL");
    }, 3_000);
    this.forceKillTimer.unref();
  }

  async dispose(): Promise<void> {
    if (this.installed) {
      process.off("SIGINT", this.onSigint);
      process.off("SIGTERM", this.onSigterm);
      this.installed = false;
    }
    if (this.forceKillTimer) {
      clearTimeout(this.forceKillTimer);
      this.forceKillTimer = undefined;
    }
    await Promise.all([...this.children].map(terminateChildAndWait));
  }
}

async function assertSnapshotTree(path: string): Promise<void> {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const entryPath = join(path, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(
        `Workspace snapshot contains a symbolic link: ${entryPath}`,
      );
    }
    if (entry.isDirectory()) {
      await assertSnapshotTree(entryPath);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(
        `Workspace snapshot contains a non-regular entry: ${entryPath}`,
      );
    }
  }
}

async function publishWorkspaceSnapshot(
  source: string,
  destination: string,
): Promise<void> {
  await assertSnapshotTree(source);
  const partial = `${destination}.partial-${process.pid}-${Date.now()}`;
  try {
    await cp(source, partial, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    await rename(partial, destination);
  } catch (error) {
    await rm(partial, { recursive: true, force: true });
    throw error;
  }
}

function terminateChild(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid) return;
  if (process.platform !== "win32") {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // The child may have left its process group; fall back to direct kill.
    }
  }
  try {
    child.kill(signal);
  } catch {
    // A concurrently exiting process is already terminated.
  }
}

function resolveAgentCommand(
  agent: BenchmarkAgent,
  workspace: string,
  prompt: string,
  clashHost?: RunningClashHost,
  cliTracePath?: string,
): { command: string; args: string[] } {
  if (agent.adapter === "codex") {
    const clashConfig = clashHost
      ? [
          "-c",
          `mcp_servers.clash.command=${JSON.stringify(process.execPath)}`,
          "-c",
          `mcp_servers.clash.args=${JSON.stringify([clashHost.runtimePath])}`,
          "-c",
          `mcp_servers.clash.cwd=${JSON.stringify(clashHost.pluginRoot)}`,
          "-c",
          "mcp_servers.clash.enabled=true",
          "-c",
          "mcp_servers.clash.required=true",
          "-c",
          "mcp_servers.clash.startup_timeout_sec=30",
          "-c",
          "mcp_servers.clash.tool_timeout_sec=600",
          "-c",
          'mcp_servers.clash.default_tools_approval_mode="approve"',
          "-c",
          "sandbox_workspace_write.network_access=true",
          "-c",
          `mcp_servers.clash.env.CLASH_PROFILE=${JSON.stringify(clashHost.profile)}`,
          "-c",
          `mcp_servers.clash.env.CLASH_HOME=${JSON.stringify(clashHost.clashHome)}`,
          "-c",
          `mcp_servers.clash.env.CLASH_LOCAL_DATA_DIR=${JSON.stringify(clashHost.localDataDir)}`,
          "-c",
          'mcp_servers.clash.env.CLASH_PLUGIN_HOST_SOCKET=""',
          "-c",
          `mcp_servers.clash.env.CLASH_WORKSPACE_ROOT=${JSON.stringify(workspace)}`,
          "-c",
          `mcp_servers.clash.env.CLASH_AGENT_MEMBER_ID=${JSON.stringify(clashHost.agentMemberId)}`,
          "-c",
          `mcp_servers.clash.env.CLASH_AGENT_NAME=${JSON.stringify(clashHost.agentName)}`,
          "-c",
          `mcp_servers.clash.env.CLASH_API_URL=${JSON.stringify(clashHost.endpoint)}`,
          "-c",
          `mcp_servers.clash.env.CLASH_CLI_ENTRY_PATH=${JSON.stringify(clashHost.agentCliPath)}`,
          ...(cliTracePath
            ? [
                "-c",
                `mcp_servers.clash.env.CLASH_CLI_TRACE_PATH=${JSON.stringify(cliTracePath)}`,
              ]
            : []),
        ]
      : [];
    const args = [
      "exec",
      "--skip-git-repo-check",
      "--ephemeral",
      "--json",
      "--ignore-user-config",
      "--strict-config",
      "--ignore-rules",
      "--color",
      "never",
      "--sandbox",
      "workspace-write",
      ...(clashHost
        ? [
            "--add-dir",
            clashHost.runtimeRoot,
            "--add-dir",
            clashHost.persistedClashHome,
          ]
        : []),
      "-c",
      'approval_policy="never"',
      "-C",
      workspace,
      ...(agent.model ? ["--model", agent.model] : []),
      ...(agent.args ?? []),
      ...clashConfig,
      prompt,
    ];
    return { command: agent.command ?? "codex", args };
  }
  if (agent.adapter === "claude") {
    const mcpConfig = clashHost
      ? JSON.stringify({
          mcpServers: {
            clash: {
              command: process.execPath,
              args: [clashHost.runtimePath],
              cwd: clashHost.pluginRoot,
              env: {
                CLASH_PROFILE: clashHost.profile,
                CLASH_HOME: clashHost.clashHome,
                CLASH_LOCAL_DATA_DIR: clashHost.localDataDir,
                CLASH_PLUGIN_HOST_SOCKET: "",
                CLASH_WORKSPACE_ROOT: workspace,
                CLASH_AGENT_MEMBER_ID: clashHost.agentMemberId,
                CLASH_AGENT_NAME: clashHost.agentName,
                CLASH_API_URL: clashHost.endpoint,
                CLASH_CLI_ENTRY_PATH: clashHost.agentCliPath,
                ...(cliTracePath ? { CLASH_CLI_TRACE_PATH: cliTracePath } : {}),
              },
            },
          },
        })
      : undefined;
    const args = [
      "--print",
      "--verbose",
      "--output-format",
      "stream-json",
      "--no-session-persistence",
      "--permission-mode",
      "dontAsk",
      "--allowedTools",
      "Read,Write,Edit,Glob,Grep,Skill,Bash,WebFetch,WebSearch,mcp__clash__*",
      "--setting-sources",
      "project,local",
      ...(clashHost
        ? [
            "--add-dir",
            clashHost.runtimeRoot,
            "--add-dir",
            clashHost.persistedClashHome,
            "--strict-mcp-config",
            "--mcp-config",
            mcpConfig!,
          ]
        : []),
      ...(agent.model ? ["--model", agent.model] : []),
      ...(agent.args ?? []),
      "--",
      prompt,
    ];
    return { command: agent.command ?? "claude", args };
  }
  if (agent.adapter === "pi") {
    const currentModulePath = fileURLToPath(import.meta.url);
    const extensionPath = join(
      dirname(currentModulePath),
      currentModulePath.endsWith(".ts")
        ? "pi-clash-extension.ts"
        : "pi-clash-extension.js",
    );
    const args = [
      "--print",
      "--mode",
      "json",
      "--no-session",
      "--no-extensions",
      ...(clashHost ? ["--extension", extensionPath] : []),
      "--no-skills",
      "--skill",
      join(workspace, ".agents", "skills"),
      "--no-prompt-templates",
      "--no-context-files",
      "--approve",
      "--thinking",
      "medium",
      ...(agent.model ? ["--model", agent.model] : []),
      ...(agent.args ?? []),
      prompt,
    ];
    return { command: agent.command ?? "pi", args };
  }
  return { command: agent.command, args: agent.args ?? [] };
}

function isolatedAgentEnvironment(
  source: NodeJS.ProcessEnv,
  workspace: string,
): NodeJS.ProcessEnv {
  const env = { ...source };
  for (const key of Object.keys(env)) {
    if (key === "INIT_CWD" || key === "OLDPWD" || /^(npm|pnpm)_/i.test(key)) {
      delete env[key];
    }
  }
  const pathKey =
    Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  if (env[pathKey]) {
    env[pathKey] = env[pathKey]
      .split(delimiter)
      .filter((entry) => !entry.includes("node_modules/.bin"))
      .join(delimiter);
  }
  env.PWD = workspace;
  return env;
}

function claudeResultError(eventsText: string): string | undefined {
  let resultError: string | undefined;
  for (const line of eventsText.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as unknown;
      if (!event || typeof event !== "object" || Array.isArray(event)) continue;
      const result = event as {
        type?: unknown;
        subtype?: unknown;
        is_error?: unknown;
        error?: unknown;
        result?: unknown;
      };
      if (
        result.type !== "result" ||
        (result.is_error !== true && result.subtype === "success")
      ) {
        continue;
      }
      resultError =
        typeof result.error === "string" && result.error.trim()
          ? result.error.trim()
          : typeof result.result === "string" && result.result.trim()
            ? result.result.trim()
            : "Claude Code reported an unsuccessful result";
    } catch {
      // Raw output stays authoritative; malformed lines are covered by the
      // normalized trajectory and do not mask a later valid result event.
    }
  }
  return resultError;
}

async function runAgent(input: {
  agent: BenchmarkAgent;
  benchmark: ArtifactBenchmarkCase;
  suiteRoot: string;
  workspace: string;
  logsRoot: string;
  promptPath: string;
  prompt: string;
  clashHost?: RunningClashHost;
  processScope: BenchmarkProcessScope;
}): Promise<AgentRunReport> {
  await mkdir(input.logsRoot, { recursive: true });
  const stdoutPath = join(
    input.logsRoot,
    input.agent.adapter === "codex" ||
      input.agent.adapter === "claude" ||
      input.agent.adapter === "pi"
      ? "events.jsonl"
      : "stdout.log",
  );
  const observedEventsPath = join(input.logsRoot, "observed-events.jsonl");
  const stderrPath = join(input.logsRoot, "stderr.log");
  const stderr = await open(stderrPath, "w");
  const startedAt = Date.now();
  const startedMonotonic = process.hrtime.bigint();
  const cliTraceSourcePath = input.clashHost
    ? join(input.workspace, ".clash", "evidence", "clash-cli-events.jsonl")
    : undefined;
  const cliTracePath = input.clashHost
    ? join(input.logsRoot, "clash-cli-events.jsonl")
    : undefined;
  if (cliTraceSourcePath)
    await mkdir(dirname(cliTraceSourcePath), { recursive: true });
  const resolvedAgent = resolveAgentCommand(
    input.agent,
    input.workspace,
    input.prompt,
    input.clashHost,
    cliTraceSourcePath,
  );
  const inheritedEnvironment =
    input.agent.inheritEnv === false ? {} : process.env;
  const env = isolatedAgentEnvironment(
    {
      ...inheritedEnvironment,
      ...input.agent.env,
    },
    input.workspace,
  );
  if (input.clashHost) {
    Object.assign(
      env,
      clashClientEnvironment(input.clashHost, input.workspace),
    );
    env.CLASH_CLI_TRACE_PATH = cliTraceSourcePath;
    env.PATH = [dirname(input.clashHost.agentCliPath), env.PATH]
      .filter((entry): entry is string => Boolean(entry))
      .join(delimiter);
  }
  Object.assign(env, {
    CLASH_BENCH_WORKSPACE: input.workspace,
    CLASH_BENCH_CASE_ID: input.benchmark.id,
    CLASH_BENCH_OUTCOME_PATH: join(input.workspace, "outcome.json"),
    CLASH_BENCH_PROMPT_PATH: input.promptPath,
    CLASH_BENCH_PROMPT: input.prompt,
  });
  if (input.agent.adapter === "claude") {
    env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = "1";
    env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS = "1";
    env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
    env.CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL = "1";
  }
  if (input.agent.adapter === "pi") env.PI_TELEMETRY = "0";
  if (input.agent.adapter === "pi" && input.clashHost) {
    env.CLASH_PI_MCP_RUNTIME_PATH = input.clashHost.runtimePath;
    env.CLASH_PI_MCP_PLUGIN_ROOT = input.clashHost.pluginRoot;
  }

  let child: ChildProcess;
  try {
    child = input.processScope.track(
      spawn(resolvedAgent.command, resolvedAgent.args, {
        cwd: input.workspace,
        env,
        shell: false,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", stderr.fd],
      }),
    );
  } catch (error) {
    await stderr.close();
    const message = error instanceof Error ? error.message : String(error);
    await Promise.all([
      writeFile(stdoutPath, "", "utf8"),
      writeFile(observedEventsPath, "", "utf8"),
      writeFile(stderrPath, `${message}\n`, { encoding: "utf8", flag: "a" }),
    ]);
    const trajectoryPath = await writeNormalizedTrajectory({
      agent: input.agent,
      logsRoot: input.logsRoot,
      rawPath: stdoutPath,
      observedPath: observedEventsPath,
    });
    return {
      status: "spawn-error",
      exitCode: null,
      signal: null,
      durationMs: Date.now() - startedAt,
      stdoutPath,
      stderrPath,
      observedEventsPath,
      trajectoryPath,
      error: message,
    };
  }
  // Install lifecycle listeners before the first await after spawn. ENOENT and
  // similar spawn failures can otherwise emit before stderr.close() settles.
  const lifecyclePromise = new Promise<
    Pick<
      AgentRunReport,
      "status" | "exitCode" | "signal" | "durationMs" | "error"
    >
  >((resolveReport) => {
    let settled = false;
    let timedOut = false;
    let forceKillTimer: NodeJS.Timeout | undefined;
    const timeout = setTimeout(() => {
      timedOut = true;
      terminateChild(child, "SIGTERM");
      forceKillTimer = setTimeout(
        () => terminateChild(child, "SIGKILL"),
        1_000,
      );
    }, input.benchmark.timeoutMs);

    const finish = (
      report: Pick<AgentRunReport, "status" | "exitCode" | "signal" | "error">,
    ): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      resolveReport({
        ...report,
        durationMs: Date.now() - startedAt,
      });
    };

    child.once("error", (error) => {
      void writeFile(stderrPath, `runner spawn error: ${error.message}\n`, {
        encoding: "utf8",
        flag: "a",
      });
      finish({
        status: "spawn-error",
        exitCode: null,
        signal: null,
        error: error.message,
      });
    });
    child.once("close", (exitCode, signal) => {
      finish({
        status: timedOut
          ? "timed-out"
          : exitCode === 0
            ? "completed"
            : "failed",
        exitCode,
        signal,
        ...(timedOut
          ? {
              error: `Agent exceeded timeout of ${input.benchmark.timeoutMs}ms`,
            }
          : {}),
      });
    });
  });
  await stderr.close();
  if (!child.stdout) throw new Error("Agent stdout pipe is unavailable");
  const capture = captureObservedOutput({
    stream: child.stdout,
    rawPath: stdoutPath,
    observedPath: observedEventsPath,
    startedMonotonic,
  });

  let lifecycle = await lifecyclePromise;
  await capture;
  if (input.agent.adapter === "claude" && lifecycle.status === "completed") {
    const resultError = claudeResultError(await readFile(stdoutPath, "utf8"));
    if (resultError) {
      lifecycle = {
        ...lifecycle,
        status: "failed",
        error: resultError,
      };
    }
  }
  if (cliTraceSourcePath && cliTracePath) {
    try {
      await cp(cliTraceSourcePath, cliTracePath, { force: true });
      await rm(cliTraceSourcePath, { force: true });
    } catch (error) {
      if (!(
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      )) {
        throw error;
      }
    }
  }
  const trajectoryPath = await writeNormalizedTrajectory({
    agent: input.agent,
    logsRoot: input.logsRoot,
    rawPath: stdoutPath,
    observedPath: observedEventsPath,
  });
  return {
    ...lifecycle,
    stdoutPath,
    stderrPath,
    observedEventsPath,
    trajectoryPath,
  };
}

async function createFreshDirectory(
  path: string,
  label: string,
): Promise<void> {
  try {
    await mkdir(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`${label} already exists: ${path}`);
    }
    throw error;
  }
}

async function installCaseSkills(
  skillPaths: string[],
  suiteRoot: string,
  workspace: string,
): Promise<string[]> {
  const destinationRoots = [
    join(workspace, ".agents", "skills"),
    join(workspace, ".claude", "skills"),
  ];
  await Promise.all(
    destinationRoots.map((destinationRoot) =>
      mkdir(destinationRoot, { recursive: true }),
    ),
  );
  if (skillPaths.length === 0) return [];
  const installedNames = new Set<string>();
  for (const configuredPath of skillPaths) {
    const candidate = isAbsolute(configuredPath)
      ? configuredPath
      : resolve(suiteRoot, configuredPath);
    let source: string;
    try {
      source = await realpath(candidate);
    } catch (error) {
      throw new Error(
        `Unable to resolve benchmark skill '${configuredPath}': ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const sourceInfo = await stat(source);
    if (!sourceInfo.isDirectory())
      throw new Error(`Benchmark skill must be a directory: ${configuredPath}`);
    const skillDefinition = join(source, "SKILL.md");
    if (!(await stat(skillDefinition)).isFile()) {
      throw new Error(`Benchmark skill is missing SKILL.md: ${configuredPath}`);
    }
    const name = basename(source);
    assertSafePathSegment(name, "Skill name");
    if (installedNames.has(name))
      throw new Error(`Duplicate benchmark skill name: ${name}`);
    await Promise.all(
      destinationRoots.map((destinationRoot) =>
        cp(source, join(destinationRoot, name), {
          recursive: true,
          errorOnExist: true,
          force: false,
        }),
      ),
    );
    installedNames.add(name);
  }
  return [...installedNames];
}

async function resolveClashHost(
  agent: BenchmarkAgent,
  caseRoot: string,
  workspace: string,
): Promise<ResolvedClashHost | undefined> {
  if (
    (agent.adapter !== "codex" &&
      agent.adapter !== "claude" &&
      agent.adapter !== "pi") ||
    !agent.clashHost
  ) {
    return undefined;
  }

  const pluginRoot = await realpath(resolve(agent.clashHost.pluginRoot));
  if (!(await stat(pluginRoot)).isDirectory()) {
    throw new Error(`Clash plugin root must be a directory: ${pluginRoot}`);
  }
  const runtimeFiles = ["index.js", "local-api.cjs", "clash-cli.cjs"];
  for (const file of runtimeFiles) {
    const path = join(pluginRoot, "runtime", file);
    let info;
    try {
      info = await stat(path);
    } catch (error) {
      throw new Error(
        `Clash plugin runtime is missing ${file}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!info.isFile())
      throw new Error(`Clash plugin runtime entry must be a file: ${path}`);
  }

  const persistedClashHome = join(caseRoot, "clash-home");
  await mkdir(persistedClashHome, { recursive: true });
  // macOS limits Unix-domain socket paths to roughly 104 bytes. Its default
  // per-user temp directory is already long enough that the project daemon's
  // hashed socket name can exceed that limit, so keep the runtime-only home
  // under the short /tmp alias there. Durable case data still lives in the
  // configured benchmark output root.
  const runtimeTempRoot = process.platform === "darwin" ? "/tmp" : tmpdir();
  const runtimeRoot = await mkdtemp(join(runtimeTempRoot, "clash-eval-"));
  try {
    const clashHome = join(runtimeRoot, "home");
    await symlink(persistedClashHome, clashHome, "dir");
    const localDataDir = join(clashHome, "local-api");
    await mkdir(localDataDir, { recursive: true });
    return {
      pluginRoot,
      runtimePath: join(pluginRoot, "runtime", "index.js"),
      workspace,
      profile: agent.clashHost.profile,
      runtimeRoot,
      clashHome,
      persistedClashHome,
      localDataDir,
      localApiPluginSocket: join(clashHome, "sockets", "plugin-host.sock"),
      projectPluginSocket: join(clashHome, "sockets", "plugin-host.sock"),
      agentMemberId: `headless-eval-${basename(caseRoot)}`,
      agentName: `Headless Eval ${basename(caseRoot)}`,
    };
  } catch (error) {
    await rm(runtimeRoot, { recursive: true, force: true });
    throw error;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "EPERM",
    );
  }
}

function socketIsActive(path: string): Promise<boolean> {
  return new Promise((resolveActive) => {
    const socket = createConnection(path);
    let settled = false;
    const finish = (active: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolveActive(active);
    };
    const timer = setTimeout(() => finish(false), 200);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function startClashHost(
  host: ResolvedClashHost,
  logsRoot: string,
  processScope: BenchmarkProcessScope,
): Promise<RunningClashHost> {
  await mkdir(logsRoot, { recursive: true });
  const stdoutPath = join(logsRoot, "clash-host.stdout.log");
  const stderrPath = join(logsRoot, "clash-host.stderr.log");
  const stdout = await open(stdoutPath, "w");
  const stderr = await open(stderrPath, "w");
  const runDir = join(host.clashHome, "run");
  await mkdir(runDir, { recursive: true });
  const ownerClientId = `headless-eval-${process.pid}-${Date.now()}`;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CLASH_PROFILE: host.profile,
    CLASH_HOME: host.clashHome,
    CLASH_LOCAL_DATA_DIR: host.localDataDir,
    CLASH_HOST_RUN_DIR: runDir,
    CLASH_PLUGIN_OWNER_CLIENT_ID: ownerClientId,
    CLASH_CLI_ENTRY_PATH: join(host.pluginRoot, "runtime", "clash-cli.cjs"),
    CLASH_LOCAL_API_WRAPPER_ENTRY: "1",
    CLASH_NODE_EXEC_PATH: process.execPath,
    CLASH_AGENT_BUNDLE_ROOT: join(host.pluginRoot, "runtime", "agents"),
    CLASH_BUILTIN_PLUGIN_ROOT: host.pluginRoot,
    CLASH_WORKSPACE_ROOT: host.workspace,
    CLASH_AGENT_MEMBER_ID: host.agentMemberId,
    CLASH_AGENT_NAME: host.agentName,
    CLASH_PLUGIN_HOST_SOCKET: "",
    CLASH_API_URL: "",
    PORT: "0",
  };
  let spawnError: Error | undefined;
  let child: ChildProcess;
  try {
    child = processScope.track(
      spawn(
        process.execPath,
        [join(host.pluginRoot, "runtime", "local-api.cjs")],
        {
          cwd: host.pluginRoot,
          env,
          shell: false,
          detached: process.platform !== "win32",
          stdio: ["ignore", stdout.fd, stderr.fd],
        },
      ),
    );
  } catch (error) {
    await Promise.all([stdout.close(), stderr.close()]);
    throw error;
  }
  child.once("error", (error) => {
    spawnError = error;
  });
  await Promise.all([stdout.close(), stderr.close()]);

  const discoveryPath = join(runDir, "host.json");
  const deadline = Date.now() + 15_000;
  try {
    while (Date.now() < deadline) {
      if (spawnError)
        throw new Error(
          `Unable to start bundled Clash host: ${spawnError.message}`,
        );
      if (childHasExited(child)) {
        const detail = await readFile(stderrPath, "utf8").catch(() => "");
        throw new Error(
          `Bundled Clash host exited during startup.${detail ? `\n${detail}` : ""}`,
        );
      }
      try {
        const record = JSON.parse(await readFile(discoveryPath, "utf8")) as {
          endpoint?: unknown;
          pid?: unknown;
          profile?: unknown;
          launchMode?: unknown;
          startedBy?: unknown;
          ownerClientId?: unknown;
          agentCliPath?: unknown;
        };
        if (
          typeof record.endpoint === "string" &&
          typeof record.pid === "number" &&
          record.pid === child.pid &&
          processExists(record.pid) &&
          record.profile === host.profile &&
          record.launchMode === "user-service" &&
          record.startedBy === "plugin" &&
          typeof record.agentCliPath === "string"
        ) {
          const response = await fetch(
            new URL("/api/v1/models/catalog", record.endpoint),
            {
              signal: AbortSignal.timeout(10_000),
            },
          );
          if (!response.ok) {
            const detail = (await response.text()).trim().slice(0, 2_000);
            throw new Error(
              `Bundled Clash host warmup failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
            );
          }
          const pluginDeadline = Date.now() + 5_000;
          while (
            Date.now() < pluginDeadline &&
            !(await socketIsActive(host.localApiPluginSocket))
          ) {
            await delay(25);
          }
          if (!(await socketIsActive(host.localApiPluginSocket))) {
            throw new Error(
              `Bundled Clash plugin runtime did not become ready: ${host.localApiPluginSocket}`,
            );
          }
          return {
            ...host,
            endpoint: record.endpoint,
            agentCliPath: record.agentCliPath,
            readyAt: new Date().toISOString(),
            child,
          };
        }
      } catch (error) {
        if (!(
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "ENOENT"
        )) {
          throw error;
        }
      }
      await delay(50);
    }
    throw new Error(
      `Timed out waiting for bundled Clash host discovery: ${discoveryPath}`,
    );
  } catch (error) {
    await terminateChildAndWait(child);
    throw error;
  }
}

async function stopClashHost(host: RunningClashHost): Promise<void> {
  await terminateChildAndWait(host.child);
}

type ProjectDaemonController = {
  ready: Promise<ProjectDaemonReady>;
  stop(): Promise<void>;
};

function clashClientEnvironment(
  host: RunningClashHost,
  workspace: string,
): NodeJS.ProcessEnv {
  return {
    CLASH_PROFILE: host.profile,
    CLASH_HOME: host.clashHome,
    CLASH_LOCAL_DATA_DIR: host.localDataDir,
    CLASH_API_URL: host.endpoint,
    CLASH_CLI_ENTRY_PATH: host.agentCliPath,
    CLASH_NODE_EXEC_PATH: process.execPath,
    CLASH_WORKSPACE_ROOT: workspace,
    CLASH_AGENT_MEMBER_ID: host.agentMemberId,
    CLASH_AGENT_NAME: host.agentName,
    CLASH_PLUGIN_HOST_SOCKET: "",
  };
}

function clashProjectEnvironment(
  host: RunningClashHost,
  workspace: string,
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...clashClientEnvironment(host, workspace),
  };
}

async function waitForProcessClose(
  child: ChildProcess,
  timeoutMs: number,
): Promise<boolean> {
  if (childHasExited(child)) return true;
  return await new Promise<boolean>((resolveExit) => {
    const timer = setTimeout(() => {
      child.off("close", onClose);
      resolveExit(false);
    }, timeoutMs);
    const onClose = () => {
      clearTimeout(timer);
      resolveExit(true);
    };
    child.once("close", onClose);
  });
}

async function pathIsFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function runWorkspaceInitCli(input: {
  cliPath: string;
  args: string[];
  workspace: string;
  environment: NodeJS.ProcessEnv;
  stdoutPath: string;
  stderrPath: string;
  processScope: BenchmarkProcessScope;
}): Promise<string> {
  let stdout = "";
  let stderr = "";
  let child: ChildProcess;
  try {
    child = input.processScope.track(
      spawn(input.cliPath, input.args, {
        cwd: input.workspace,
        env: input.environment,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
  } catch (error) {
    throw new Error(
      `Unable to start packaged Clash workspace init: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const result = await new Promise<{
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    error?: Error;
  }>((resolveResult) => {
    let settled = false;
    let timedOut = false;
    const finish = (value: {
      exitCode: number | null;
      signal: NodeJS.Signals | null;
      error?: Error;
    }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolveResult(value);
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      void terminateChildAndWait(child).then(() => {
        finish({
          exitCode: null,
          signal: "SIGTERM",
          error: new Error("Packaged Clash workspace init timed out"),
        });
      });
    }, 15_000);
    child.once("error", (error) =>
      finish({ exitCode: null, signal: null, error }),
    );
    child.once("close", (exitCode, signal) => {
      if (!timedOut) finish({ exitCode, signal });
    });
  });
  await Promise.all([
    writeFile(input.stdoutPath, stdout, "utf8"),
    writeFile(input.stderrPath, stderr, "utf8"),
  ]);
  if (result.error) throw result.error;
  if (result.exitCode !== 0) {
    const detail = stderr.trim() || stdout.trim();
    throw new Error(
      `Packaged Clash workspace init failed with exit code ${result.exitCode}${result.signal ? ` (${result.signal})` : ""}${detail ? `: ${detail.slice(0, 2_000)}` : ""}`,
    );
  }
  return stdout;
}

export async function prepareBenchmarkWorkspaceBinding(input: {
  cliPath: string;
  workspace: string;
  caseRoot: string;
  logsRoot: string;
  generatedProjectId: string;
  environment: NodeJS.ProcessEnv;
  processScope?: BenchmarkProcessScope;
}): Promise<BenchmarkWorkspaceBinding> {
  const markerPath = join(input.workspace, ".clash", "project.toml");
  const hadMarker = await pathIsFile(markerPath);
  const originalMarker = hadMarker
    ? await readFile(markerPath, "utf8")
    : undefined;
  const args = hadMarker
    ? ["init", "--json"]
    : ["init", "--project", input.generatedProjectId, "--json"];
  const stdout = await runWorkspaceInitCli({
    cliPath: input.cliPath,
    args,
    workspace: input.workspace,
    environment: input.environment,
    stdoutPath: join(input.logsRoot, "clash-workspace-init.stdout.log"),
    stderrPath: join(input.logsRoot, "clash-workspace-init.stderr.log"),
    processScope: input.processScope ?? new BenchmarkProcessScope(),
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch (error) {
    throw new Error(
      `Packaged Clash workspace init returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const result = parsed as Record<string, unknown>;
  if (
    typeof result.projectId !== "string" ||
    !result.projectId.trim() ||
    typeof result.workspaceId !== "string" ||
    !result.workspaceId.trim() ||
    typeof result.reused !== "boolean"
  ) {
    throw new Error(
      "Packaged Clash workspace init did not return projectId, workspaceId, and reused",
    );
  }
  if (hadMarker && result.reused !== true) {
    throw new Error(
      "Packaged Clash workspace init replaced an existing project marker instead of reusing it",
    );
  }
  const marker = await readFile(markerPath, "utf8");
  const markerProjectId = /^project_id\s*=\s*"([^"]+)"/mu.exec(marker)?.[1];
  const markerWorkspaceId = /^workspace_id\s*=\s*"([^"]+)"/mu.exec(marker)?.[1];
  if (
    markerProjectId !== result.projectId ||
    markerWorkspaceId !== result.workspaceId
  ) {
    throw new Error(
      "Packaged Clash workspace init result does not match the persisted project marker",
    );
  }
  if (hadMarker && marker !== originalMarker) {
    throw new Error(
      "Packaged Clash workspace init modified an existing project marker",
    );
  }
  if (
    !hadMarker &&
    (result.reused !== false || result.projectId !== input.generatedProjectId)
  ) {
    throw new Error(
      "Packaged Clash workspace init did not create the requested isolated project",
    );
  }
  const binding: BenchmarkWorkspaceBinding = {
    projectId: result.projectId,
    workspaceId: result.workspaceId,
    markerPath,
    markerSha256: sha256Bytes(marker),
    initDisposition: result.reused ? "reused" : "created",
  };
  await writeJson(join(input.caseRoot, "clash-workspace-init.json"), {
    schemaVersion: 1,
    status: "initialized",
    projectId: binding.projectId,
    workspaceId: binding.workspaceId,
    initDisposition: binding.initDisposition,
    markerPath: ".clash/project.toml",
    markerSha256: binding.markerSha256,
  });
  return binding;
}

async function pingProjectDaemon(socketPath: string): Promise<boolean> {
  return await new Promise<boolean>((resolvePing) => {
    const socket = createConnection(socketPath);
    let settled = false;
    let response = "";
    const finish = (ready: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.destroy();
      resolvePing(ready);
    };
    const timeout = setTimeout(() => finish(false), 500);
    socket.once("connect", () => {
      socket.write(`${JSON.stringify({ action: "ping" })}\n`);
    });
    socket.on("data", (chunk) => {
      response += chunk.toString();
      const newline = response.indexOf("\n");
      if (newline < 0) return;
      try {
        const parsed = JSON.parse(response.slice(0, newline)) as {
          pong?: unknown;
        };
        finish(parsed.pong === true);
      } catch {
        finish(false);
      }
    });
    socket.once("end", () => {
      try {
        const parsed = JSON.parse(response) as { pong?: unknown };
        finish(parsed.pong === true);
      } catch {
        finish(false);
      }
    });
    socket.once("error", () => finish(false));
  });
}

type ProjectDaemonProbe = {
  daemonPid: number;
  mcpUrl: string;
  socketPath: string;
};

function isLoopbackHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      (url.hostname === "127.0.0.1" ||
        url.hostname === "localhost" ||
        url.hostname === "[::1]" ||
        url.hostname === "::1")
    );
  } catch {
    return false;
  }
}

async function probeProjectDaemon(input: {
  pidPath: string;
  mcpPath: string;
  socketPath: string;
}): Promise<ProjectDaemonProbe | undefined> {
  let daemonPid: number;
  let mcpUrl: string;
  try {
    daemonPid = Number.parseInt(
      (await readFile(input.pidPath, "utf8")).trim(),
      10,
    );
    const mcp = JSON.parse(await readFile(input.mcpPath, "utf8")) as {
      url?: unknown;
    };
    if (
      !Number.isInteger(daemonPid) ||
      daemonPid <= 0 ||
      !processExists(daemonPid)
    ) {
      return undefined;
    }
    if (typeof mcp.url !== "string" || !isLoopbackHttpUrl(mcp.url)) {
      throw new Error("Clash project daemon advertised a non-loopback MCP URL");
    }
    mcpUrl = mcp.url;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
  if (!(await pingProjectDaemon(input.socketPath))) return undefined;
  try {
    const response = await fetch(new URL("/health", mcpUrl), {
      signal: AbortSignal.timeout(1_000),
    });
    if (!response.ok) return undefined;
    const health = (await response.json()) as Record<string, unknown>;
    if (
      health.status !== "ok" ||
      health.transport !== "streamable-http" ||
      health.endpoint !== "/mcp"
    ) {
      return undefined;
    }
  } catch {
    return undefined;
  }
  return {
    daemonPid,
    mcpUrl,
    socketPath: input.socketPath,
  };
}

function startProjectDaemonController(input: {
  host: RunningClashHost;
  binding: BenchmarkWorkspaceBinding;
  workspace: string;
  caseRoot: string;
  logsRoot: string;
  agentReadyPath: string;
  processScope: BenchmarkProcessScope;
}): ProjectDaemonController {
  let cancelled = false;
  let connectChild: ChildProcess | undefined;
  let ownership: ProjectDaemonReady["ownership"] = "owned";
  const environment = clashProjectEnvironment(input.host, input.workspace);
  const reportPath = join(input.caseRoot, "clash-project-host.json");

  const task = (async (): Promise<ProjectDaemonReady> => {
    const markerPath = join(input.workspace, ".clash", "project.toml");
    const marker = await readFile(markerPath, "utf8");
    const projectId = /^project_id\s*=\s*"([^"]+)"/mu.exec(marker)?.[1];
    if (
      projectId !== input.binding.projectId ||
      sha256Bytes(marker) !== input.binding.markerSha256
    ) {
      throw new Error(
        "Workspace project marker changed between initialization and daemon startup",
      );
    }

    const key = createHash("sha256")
      .update(projectId)
      .digest("hex")
      .slice(0, 32);
    const pidPath = join(input.host.clashHome, "sockets", `${key}.pid`);
    const mcpPath = join(input.host.clashHome, "sockets", `${key}.mcp.json`);
    const socketPath = join(input.host.clashHome, "sockets", `${key}.sock`);
    const publishReady = async (
      probe: ProjectDaemonProbe,
      daemonOwnership: ProjectDaemonReady["ownership"],
    ): Promise<ProjectDaemonReady> => {
      const readyAt = new Date().toISOString();
      const publicReport = {
        schemaVersion: 1,
        status: "ready",
        projectId,
        workspaceId: input.binding.workspaceId,
        initDisposition: input.binding.initDisposition,
        markerSha256: input.binding.markerSha256,
        agentMemberId: input.host.agentMemberId,
        localApiReadyAt: input.host.readyAt,
        readyAt,
      };
      await Promise.all([
        writeJson(reportPath, {
          ...publicReport,
          daemonPid: probe.daemonPid,
          socketPath: probe.socketPath,
          mcpUrl: probe.mcpUrl,
          apiUrl: input.host.endpoint,
          ownership: daemonOwnership,
        }),
        writeJson(input.agentReadyPath, publicReport),
      ]);
      return {
        projectId,
        workspaceId: input.binding.workspaceId,
        initDisposition: input.binding.initDisposition,
        markerSha256: input.binding.markerSha256,
        daemonPid: probe.daemonPid,
        mcpUrl: probe.mcpUrl,
        socketPath: probe.socketPath,
        apiUrl: input.host.endpoint,
        ownership: daemonOwnership,
        readyAt,
      };
    };

    const existing = await probeProjectDaemon({ pidPath, mcpPath, socketPath });
    if (existing) {
      ownership = "reused";
      return await publishReady(existing, ownership);
    }

    const stdout = await open(
      join(input.logsRoot, "clash-project-host.stdout.log"),
      "w",
    );
    const stderr = await open(
      join(input.logsRoot, "clash-project-host.stderr.log"),
      "w",
    );
    let connectSpawnError: Error | undefined;
    try {
      connectChild = input.processScope.track(
        spawn(input.host.agentCliPath, ["canvas", "connect"], {
          cwd: input.workspace,
          env: environment,
          shell: false,
          detached: process.platform !== "win32",
          stdio: ["ignore", stdout.fd, stderr.fd],
        }),
      );
      connectChild.once("error", (error) => {
        connectSpawnError = error;
      });
    } catch (error) {
      await Promise.all([stdout.close(), stderr.close()]);
      throw error;
    }
    await Promise.all([stdout.close(), stderr.close()]);

    const deadline = Date.now() + 15_000;
    while (!cancelled && Date.now() < deadline) {
      if (connectSpawnError) {
        throw new Error(
          `Unable to start Clash project host: ${connectSpawnError.message}`,
        );
      }
      if (childHasExited(connectChild) && connectChild.exitCode !== 0) {
        throw new Error(
          `Clash project host exited before readiness with code ${connectChild.exitCode}`,
        );
      }
      if (childHasExited(connectChild) && connectChild.exitCode === 0) {
        ownership = "reused";
      }
      const probe = await probeProjectDaemon({ pidPath, mcpPath, socketPath });
      if (probe && connectChild.pid === probe.daemonPid) {
        ownership = "owned";
        return await publishReady(probe, ownership);
      }
      if (
        probe &&
        childHasExited(connectChild) &&
        connectChild.exitCode === 0
      ) {
        ownership = "reused";
        return await publishReady(probe, ownership);
      }
      await delay(25);
    }
    if (!cancelled)
      throw new Error(`Timed out starting Clash project host for ${projectId}`);
    throw new Error(
      `Clash project host startup was cancelled for ${projectId}`,
    );
  })();
  const settledTask = task.catch(async (error): Promise<never> => {
    const report = {
      schemaVersion: 1,
      status: "failed",
      projectId: input.binding.projectId,
      workspaceId: input.binding.workspaceId,
      initDisposition: input.binding.initDisposition,
      error: error instanceof Error ? error.message : String(error),
    };
    await Promise.all([
      writeJson(reportPath, report),
      writeJson(input.agentReadyPath, report),
    ]);
    throw error;
  });

  return {
    ready: settledTask,
    stop: async () => {
      cancelled = true;
      await settledTask.catch(() => undefined);
      if (ownership === "reused") return;
      if (!connectChild || childHasExited(connectChild)) return;

      let disconnect: ChildProcess | undefined;
      try {
        disconnect = input.processScope.track(
          spawn(input.host.agentCliPath, ["canvas", "disconnect"], {
            cwd: input.workspace,
            env: environment,
            shell: false,
            stdio: "ignore",
          }),
        );
        disconnect.once("error", () => {
          // The persistent connect process is still terminated below.
        });
        if (!(await waitForProcessClose(disconnect, 5_000))) {
          await terminateChildAndWait(disconnect);
        }
      } finally {
        if (!(await waitForProcessClose(connectChild, 3_000))) {
          await terminateChildAndWait(connectChild);
        }
      }
    },
  };
}

function stableJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean")
    return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((item) => stableJson(item ?? null)).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return "null";
}

function sha256Json(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function sha256Bytes(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function findFilesNamed(
  root: string,
  targetName: string,
): Promise<string[]> {
  const matches: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile() && entry.name === targetName) {
        matches.push(path);
      }
    }
  };
  await visit(root);
  return matches.sort();
}

function parseProjectDirectorStage(value: unknown): ProjectDirectorStage {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Director readback stage must be an object");
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || !raw.id.trim())
    throw new Error("Director readback stage id is required");
  if (typeof raw.name !== "string" || !raw.name.trim())
    throw new Error(`Director Stage ${raw.id} name is required`);
  if (typeof raw.revisionId !== "string" || !raw.revisionId.trim()) {
    throw new Error(`Director Stage ${raw.id} revisionId is required`);
  }
  if (!raw.owner || typeof raw.owner !== "object" || Array.isArray(raw.owner)) {
    throw new Error(`Director Stage ${raw.id} owner is invalid`);
  }
  const owner = raw.owner as Record<string, unknown>;
  const parsedOwner: ProjectDirectorStage["owner"] =
    owner.kind === "project"
      ? { kind: "project" }
      : owner.kind === "canvas-action" &&
          typeof owner.canvasId === "string" &&
          typeof owner.actionNodeId === "string"
        ? {
            kind: "canvas-action",
            canvasId: owner.canvasId,
            actionNodeId: owner.actionNodeId,
          }
        : (() => {
            throw new Error(`Director Stage ${raw.id} owner is invalid`);
          })();
  const state = DirectorStageStateSchema.safeParse(raw.state);
  if (!state.success)
    throw new Error(`Director Stage ${raw.id} state is invalid`);
  return {
    id: raw.id,
    name: raw.name,
    revisionId: raw.revisionId,
    owner: parsedOwner,
    state: state.data,
  };
}

async function verifyDirectorCaptureWithProductRenderer(input: {
  ready: ProjectDaemonReady;
  stage: ProjectDirectorStage;
  stateSha256: string;
  frames: DirectorReadbackReport["captures"][number]["frames"];
}): Promise<boolean> {
  const longEdges = new Set(
    input.frames.map((frame) => Math.max(frame.width, frame.height)),
  );
  if (longEdges.size !== 1) return false;
  const response = await fetch(
    new URL("/api/v1/local/director-stage/capture", input.ready.apiUrl),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        state: input.stage.state,
        longEdge: [...longEdges][0],
        frames: input.frames.map((frame) => ({
          label: frame.artifactId,
          timeSeconds: frame.timeSeconds,
          aspectRatio: frame.aspectRatio,
        })),
      }),
      signal: AbortSignal.timeout(120_000),
    },
  );
  if (!response.ok) return false;
  const rendered = (await response.json()) as {
    renderer?: { id?: unknown; contractVersion?: unknown };
    stateSha256?: unknown;
    frames?: unknown;
  };
  if (
    rendered.renderer?.id !== "clash-director-viewport-webgl" ||
    rendered.renderer.contractVersion !== 1 ||
    rendered.stateSha256 !== input.stateSha256 ||
    !Array.isArray(rendered.frames) ||
    rendered.frames.length !== input.frames.length
  )
    return false;
  const renderedFrames = rendered.frames;
  return input.frames.every((expected, index) => {
    const actual = renderedFrames[index];
    if (!actual || typeof actual !== "object" || Array.isArray(actual))
      return false;
    const value = actual as {
      label?: unknown;
      timeSeconds?: unknown;
      aspectRatio?: unknown;
      width?: unknown;
      height?: unknown;
      sha256?: unknown;
    };
    return (
      value.label === expected.artifactId &&
      value.timeSeconds === expected.timeSeconds &&
      value.aspectRatio === expected.aspectRatio &&
      value.width === expected.width &&
      value.height === expected.height &&
      value.sha256 === expected.sha256
    );
  });
}

function sendDaemonCommand(
  socketPath: string,
  command: object,
): Promise<unknown> {
  return new Promise((resolveCommand, rejectCommand) => {
    const socket = createConnection(socketPath);
    let settled = false;
    let data = "";
    const finish = (error?: Error, value?: unknown): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) rejectCommand(error);
      else resolveCommand(value);
    };
    const timer = setTimeout(
      () => finish(new Error("Director host readback timed out")),
      15_000,
    );
    socket.once("connect", () => {
      socket.write(`${JSON.stringify(command)}\n`);
    });
    socket.on("data", (chunk) => {
      data += chunk.toString();
      const newline = data.indexOf("\n");
      if (newline < 0) return;
      try {
        finish(undefined, JSON.parse(data.slice(0, newline)) as unknown);
      } catch (error) {
        finish(
          new Error(
            `Invalid Director host readback: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
    });
    socket.once("error", (error) => finish(error));
    socket.once("end", () => {
      if (!settled)
        finish(
          new Error("Director host readback ended without a JSON response"),
        );
    });
  });
}

async function captureDirectorReadback(input: {
  benchmark: ArtifactBenchmarkCase;
  workspace: string;
  caseRoot: string;
  ready?: ProjectDaemonReady;
}): Promise<DirectorReadbackReport> {
  const reportPath = join(input.caseRoot, "director-readback.json");
  const matchedArtifactIds: string[] = [];
  const stages: DirectorReadbackReport["stages"] = [];
  const matches: DirectorReadbackReport["matches"] = [];
  const captures: DirectorReadbackReport["captures"] = [];
  const imageMatches: DirectorReadbackReport["imageMatches"] = [];
  try {
    if (!input.ready)
      throw new Error("Clash project daemon did not become ready");
    if (!processExists(input.ready.daemonPid))
      throw new Error("Clash project daemon exited before trusted readback");
    const marker = await readFile(
      join(input.workspace, ".clash", "project.toml"),
      "utf8",
    );
    const markerProjectId = /^project_id\s*=\s*"([^"]+)"/mu.exec(marker)?.[1];
    if (markerProjectId !== input.ready.projectId) {
      throw new Error(
        "Workspace project marker does not match the live project daemon",
      );
    }
    const response = await sendDaemonCommand(input.ready.socketPath, {
      action: "list_director_stages",
    });
    if (!response || typeof response !== "object" || Array.isArray(response)) {
      throw new Error("Director host readback response must be an object");
    }
    const raw = response as {
      error?: unknown;
      stages?: unknown;
      versions?: unknown;
    };
    if (typeof raw.error === "string" && raw.error) throw new Error(raw.error);
    if (
      !Array.isArray(raw.stages) ||
      !raw.versions ||
      typeof raw.versions !== "object" ||
      Array.isArray(raw.versions)
    ) {
      throw new Error(
        "Director host readback response is missing stages or receipts",
      );
    }
    const versions = raw.versions as Record<string, unknown>;
    const parsedStages = raw.stages.map(parseProjectDirectorStage);
    for (const stage of parsedStages) {
      const readToken = projectDirectorStageReadToken(stage);
      const hostReceipt = versions[stage.id];
      const prefix = `${readToken}:receipt:`;
      if (
        typeof hostReceipt !== "string" ||
        !hostReceipt.startsWith(prefix) ||
        !/^[A-Za-z0-9._~-]{1,256}$/u.test(hostReceipt.slice(prefix.length))
      ) {
        throw new Error(
          `Director Stage ${stage.id} is missing a live daemon read receipt`,
        );
      }
      stages.push({
        id: stage.id,
        name: stage.name,
        revisionId: stage.revisionId,
        readToken,
        hostReceipt,
        stateSha256: sha256Json(stage.state),
      });
    }

    const expectedArtifactIds =
      input.benchmark.execution?.productReadback?.artifactIds ??
      input.benchmark.rubric
        .filter((rubric) => rubric.type === "director-stage")
        .map((rubric) => rubric.artifactId);
    const submission = await loadSubmission(input.workspace);
    if (submission.error) throw new Error(submission.error);
    const artifactById = new Map(
      submission.artifacts.map((artifact) => [
        artifact.descriptor.id,
        artifact,
      ]),
    );
    const directorArtifactIds = expectedArtifactIds.filter(
      (artifactId) =>
        artifactById.get(artifactId)?.descriptor.kind === "director-stage",
    );
    const imageArtifactIds = expectedArtifactIds.filter(
      (artifactId) => artifactById.get(artifactId)?.descriptor.kind === "image",
    );
    for (const artifactId of directorArtifactIds) {
      const artifact = artifactById.get(artifactId);
      if (!artifact?.content || artifact.error) {
        throw new Error(
          `Director artifact '${artifactId}' is unavailable for product readback matching`,
        );
      }
      let value: unknown;
      try {
        value = JSON.parse(artifact.content.toString("utf8")) as unknown;
      } catch (error) {
        throw new Error(
          `Director artifact '${artifactId}' is not JSON: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      const state = DirectorStageStateSchema.safeParse(value);
      if (!state.success)
        throw new Error(
          `Director artifact '${artifactId}' is not a valid Stage state`,
        );
      const stateSha256 = sha256Json(state.data);
      const matchedStage = stages.find(
        (stage) => stage.stateSha256 === stateSha256,
      );
      if (!matchedStage) {
        throw new Error(
          `Director artifact '${artifactId}' does not match any live product Stage`,
        );
      }
      matchedArtifactIds.push(artifactId);
      matches.push({ artifactId, stageId: matchedStage.id, stateSha256 });
    }

    const matchedStageIds = new Set(matches.map((match) => match.stageId));
    for (const receiptPath of await findFilesNamed(
      input.workspace,
      "capture.json",
    )) {
      let receipt: unknown;
      try {
        receipt = JSON.parse(await readFile(receiptPath, "utf8")) as unknown;
      } catch {
        continue;
      }
      if (!receipt || typeof receipt !== "object" || Array.isArray(receipt))
        continue;
      const value = receipt as {
        captured?: unknown;
        stageId?: unknown;
        sourceStageRevisionId?: unknown;
        verifiedStageRevisionId?: unknown;
        renderer?: unknown;
        stateSha256?: unknown;
        frames?: unknown;
      };
      if (
        value.captured !== true ||
        typeof value.stageId !== "string" ||
        !matchedStageIds.has(value.stageId) ||
        typeof value.sourceStageRevisionId !== "string" ||
        value.sourceStageRevisionId !== value.verifiedStageRevisionId ||
        !value.renderer ||
        typeof value.renderer !== "object" ||
        Array.isArray(value.renderer) ||
        (value.renderer as { id?: unknown }).id !==
          "clash-director-viewport-webgl" ||
        (value.renderer as { contractVersion?: unknown }).contractVersion !==
          1 ||
        typeof value.stateSha256 !== "string" ||
        !Array.isArray(value.frames)
      )
        continue;
      const liveStage = parsedStages.find(
        (stage) =>
          stage.id === value.stageId &&
          stage.revisionId === value.sourceStageRevisionId,
      );
      if (
        !liveStage ||
        sha256Bytes(JSON.stringify(liveStage.state)) !== value.stateSha256
      )
        continue;
      const frames = value.frames.flatMap((frame) => {
        if (!frame || typeof frame !== "object" || Array.isArray(frame))
          return [];
        const candidate = frame as {
          artifactId?: unknown;
          sha256?: unknown;
          timeSeconds?: unknown;
          aspectRatio?: unknown;
          width?: unknown;
          height?: unknown;
        };
        return typeof candidate.artifactId === "string" &&
          typeof candidate.sha256 === "string" &&
          /^[a-f0-9]{64}$/u.test(candidate.sha256) &&
          typeof candidate.timeSeconds === "number" &&
          typeof candidate.aspectRatio === "string" &&
          typeof candidate.width === "number" &&
          Number.isInteger(candidate.width) &&
          candidate.width > 0 &&
          typeof candidate.height === "number" &&
          Number.isInteger(candidate.height) &&
          candidate.height > 0
          ? [
              {
                artifactId: candidate.artifactId,
                sha256: candidate.sha256,
                timeSeconds: candidate.timeSeconds,
                aspectRatio: candidate.aspectRatio,
                width: candidate.width,
                height: candidate.height,
              },
            ]
          : [];
      });
      if (frames.length !== value.frames.length) continue;
      if (
        !(await verifyDirectorCaptureWithProductRenderer({
          ready: input.ready,
          stage: liveStage,
          stateSha256: value.stateSha256,
          frames,
        }))
      )
        continue;
      captures.push({
        receiptPath: relative(input.workspace, receiptPath),
        stageId: value.stageId,
        stageRevisionId: value.sourceStageRevisionId,
        renderer: "clash-director-viewport-webgl@1",
        stateSha256: value.stateSha256,
        frames,
      });
    }

    for (const artifactId of imageArtifactIds) {
      const artifact = artifactById.get(artifactId);
      if (!artifact?.evidence || artifact.error) {
        throw new Error(
          `Director capture artifact '${artifactId}' is unavailable for product readback matching`,
        );
      }
      const match = captures
        .flatMap((capture) =>
          capture.frames.map((frame) => ({ capture, frame })),
        )
        .find(({ frame }) => frame.sha256 === artifact.evidence!.sha256);
      if (!match) {
        throw new Error(
          `Director capture artifact '${artifactId}' does not match a trusted product capture receipt`,
        );
      }
      matchedArtifactIds.push(artifactId);
      imageMatches.push({
        artifactId,
        stageId: match.capture.stageId,
        captureArtifactId: match.frame.artifactId,
        sha256: match.frame.sha256,
      });
    }
    const report: DirectorReadbackReport = {
      schemaVersion: 1,
      status: "pass",
      projectId: input.ready.projectId,
      matchedArtifactIds,
      stages,
      matches,
      captures,
      imageMatches,
      detail: `Matched ${matches.length} Director Stage artifact(s) and ${imageMatches.length} product-rendered capture frame(s) with daemon receipts.`,
    };
    await writeJson(reportPath, report);
    return report;
  } catch (error) {
    const report: DirectorReadbackReport = {
      schemaVersion: 1,
      status: "fail",
      projectId: input.ready?.projectId ?? null,
      matchedArtifactIds,
      stages,
      matches,
      captures,
      imageMatches,
      detail: error instanceof Error ? error.message : String(error),
    };
    await writeJson(reportPath, report);
    return report;
  }
}

async function combineProductReadbacks(
  caseRoot: string,
  reports: Array<
    | DirectorReadbackReport
    | RemotionProductReadbackReport
    | TimelineProductReadbackReport
  >,
): Promise<CombinedProductReadbackReport> {
  const matchedArtifactIds = [
    ...new Set(reports.flatMap((report) => report.matchedArtifactIds)),
  ];
  const projectIds = [
    ...new Set(
      reports
        .map((report) => report.projectId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const report: CombinedProductReadbackReport = {
    schemaVersion: 1,
    status:
      reports.length > 0 &&
      reports.every((candidate) => candidate.status === "pass") &&
      projectIds.length === 1
        ? "pass"
        : "fail",
    projectId: projectIds.length === 1 ? projectIds[0]! : null,
    matchedArtifactIds,
    reports,
    detail:
      reports.length === 0
        ? "No supported trusted product readback was executed."
        : reports.map((candidate) => candidate.detail).join(" "),
  };
  await writeJson(join(caseRoot, "product-readback.json"), report);
  return report;
}

async function captureRequiredProductReadback(input: {
  benchmark: ArtifactBenchmarkCase;
  workspace: string;
  caseRoot: string;
  ready?: ProjectDaemonReady;
}): Promise<TrustedProductReadback | undefined> {
  const readbackMechanism =
    input.benchmark.execution?.productReadback?.mechanism;
  const requiresDirectorReadback = input.benchmark.rubric.some(
    (rubric) => rubric.type === "director-stage",
  );
  const requiresRemotionReadback =
    readbackMechanism === "remotion-component-and-render-receipt" ||
    readbackMechanism === "mixed-remotion-lineage-and-render-receipt";
  const requiresTimelineReadback =
    readbackMechanism === "timeline-state-and-render-receipt";
  if (
    !requiresDirectorReadback &&
    !requiresRemotionReadback &&
    !requiresTimelineReadback
  ) {
    return undefined;
  }

  const readbacks: Array<
    | DirectorReadbackReport
    | RemotionProductReadbackReport
    | TimelineProductReadbackReport
  > = [];
  if (requiresDirectorReadback) {
    readbacks.push(
      await captureDirectorReadback({
        benchmark: input.benchmark,
        workspace: input.workspace,
        caseRoot: input.caseRoot,
        ready: input.ready,
      }),
    );
  }
  if (requiresRemotionReadback) {
    readbacks.push(
      await captureRemotionProductReadback({
        benchmark: input.benchmark,
        workspace: input.workspace,
        caseRoot: input.caseRoot,
        ready: input.ready,
      }),
    );
  } else if (requiresTimelineReadback) {
    readbacks.push(
      await captureTimelineProductReadback({
        benchmark: input.benchmark,
        workspace: input.workspace,
        caseRoot: input.caseRoot,
        ready: input.ready,
      }),
    );
  }
  if (readbacks.length === 1) {
    return {
      report: readbacks[0]!,
      receiptPath: requiresDirectorReadback
        ? "director-readback.json"
        : requiresRemotionReadback
          ? "remotion-readback.json"
          : "timeline-readback.json",
    };
  }
  return {
    receiptPath: "product-readback.json",
    report: await combineProductReadbacks(input.caseRoot, readbacks),
  };
}

async function evaluateProductExecution(
  benchmark: ArtifactBenchmarkCase,
  agent: AgentRunReport,
  productReadback?: TrustedProductReadback,
): Promise<ProductExecutionReport> {
  const requiredProductOperations =
    benchmark.execution?.requiredProductOperations ?? [];
  const requiredMcpTools = benchmark.execution?.requiredMcpTools ?? [];
  const requiredCliCommands = benchmark.execution?.requiredCliCommands ?? [];
  if (!benchmark.execution) {
    return {
      profile: "portable",
      status: "pass",
      requiredProductOperations,
      observedProductOperations: [],
      missingProductOperations: [],
      requiredMcpTools,
      observedMcpTools: [],
      missingMcpTools: [],
      requiredCliCommands,
      observedCliCommands: [],
      missingCliCommands: [],
      detail: "No live Clash host calls are required for this portable case.",
    };
  }

  const observedMcpTools: string[] = [];
  const observedCliCommands: string[] = [];
  const successfulCliArgv: string[][] = [];
  const observed = new Set<string>();
  let cliTraceText = "";
  let text = "";
  try {
    text = await readFile(agent.stdoutPath, "utf8");
  } catch (error) {
    return {
      profile: "clash-host",
      status: "fail",
      requiredProductOperations,
      observedProductOperations: [],
      missingProductOperations: [...requiredProductOperations],
      requiredMcpTools,
      observedMcpTools,
      missingMcpTools: [...requiredMcpTools],
      requiredCliCommands,
      observedCliCommands,
      missingCliCommands: [...requiredCliCommands],
      detail: `Unable to read agent JSONL events: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const claudeMcpToolUses = new Map<
    string,
    { tool: string; arguments: unknown }
  >();
  const piMcpToolUses = new Map<string, { tool: string; arguments: unknown }>();
  for (const line of text.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    let event: unknown;
    try {
      event = JSON.parse(line) as unknown;
    } catch {
      continue;
    }
    if (!event || typeof event !== "object") continue;
    const envelope = event as {
      type?: unknown;
      item?: unknown;
      message?: unknown;
      toolCallId?: unknown;
      toolName?: unknown;
      args?: unknown;
      isError?: unknown;
    };
    if (
      envelope.type === "tool_execution_start" &&
      typeof envelope.toolCallId === "string" &&
      typeof envelope.toolName === "string"
    ) {
      const mcpName =
        /^mcp__clash__(.+)$/u.exec(envelope.toolName)?.[1] ??
        (envelope.toolName.startsWith("clash") ? envelope.toolName : undefined);
      if (mcpName) {
        piMcpToolUses.set(envelope.toolCallId, {
          tool: mcpName,
          arguments: envelope.args,
        });
      }
      continue;
    }
    if (
      envelope.type === "tool_execution_end" &&
      typeof envelope.toolCallId === "string"
    ) {
      const toolUse = piMcpToolUses.get(envelope.toolCallId);
      if (toolUse) {
        if (envelope.isError !== true) {
          const effectiveTool = effectiveMcpToolName(toolUse);
          if (effectiveTool && !observed.has(effectiveTool)) {
            observed.add(effectiveTool);
            observedMcpTools.push(effectiveTool);
          }
        }
        piMcpToolUses.delete(envelope.toolCallId);
      }
      continue;
    }
    if (
      (envelope.type === "assistant" || envelope.type === "user") &&
      envelope.message &&
      typeof envelope.message === "object"
    ) {
      const content = (envelope.message as { content?: unknown }).content;
      if (Array.isArray(content) && envelope.type === "assistant") {
        for (const candidate of content) {
          if (!candidate || typeof candidate !== "object") continue;
          const toolUse = candidate as {
            type?: unknown;
            id?: unknown;
            name?: unknown;
            input?: unknown;
          };
          const mcpName =
            typeof toolUse.name === "string"
              ? /^mcp__clash__(.+)$/u.exec(toolUse.name)
              : null;
          if (
            toolUse.type === "tool_use" &&
            typeof toolUse.id === "string" &&
            mcpName
          ) {
            claudeMcpToolUses.set(toolUse.id, {
              tool: mcpName[1]!,
              arguments: toolUse.input,
            });
          }
        }
      }
      if (Array.isArray(content) && envelope.type === "user") {
        for (const candidate of content) {
          if (!candidate || typeof candidate !== "object") continue;
          const toolResult = candidate as {
            type?: unknown;
            tool_use_id?: unknown;
            is_error?: unknown;
          };
          if (
            toolResult.type !== "tool_result" ||
            typeof toolResult.tool_use_id !== "string" ||
            toolResult.is_error === true
          ) {
            continue;
          }
          const toolUse = claudeMcpToolUses.get(toolResult.tool_use_id);
          if (!toolUse) continue;
          const effectiveTool = effectiveMcpToolName(toolUse);
          if (effectiveTool && !observed.has(effectiveTool)) {
            observed.add(effectiveTool);
            observedMcpTools.push(effectiveTool);
          }
          claudeMcpToolUses.delete(toolResult.tool_use_id);
        }
      }
      continue;
    }
    if (
      envelope.type !== "item.completed" ||
      !envelope.item ||
      typeof envelope.item !== "object"
    ) {
      continue;
    }
    const item = envelope.item as {
      type?: unknown;
      server?: unknown;
      tool?: unknown;
      arguments?: unknown;
      status?: unknown;
      error?: unknown;
    };
    const effectiveTool = effectiveMcpToolName(item);
    if (
      item.type !== "mcp_tool_call" ||
      item.server !== "clash" ||
      item.status !== "completed" ||
      item.error ||
      !effectiveTool ||
      observed.has(effectiveTool)
    ) {
      continue;
    }
    observed.add(effectiveTool);
    observedMcpTools.push(effectiveTool);
  }
  const missingMcpTools = requiredMcpTools.filter(
    (tool) => !observed.has(tool),
  );
  try {
    cliTraceText = await readFile(
      join(dirname(agent.stdoutPath), "clash-cli-events.jsonl"),
      "utf8",
    );
    const seenCliCommands = new Set<string>();
    for (const line of cliTraceText.split(/\r?\n/u)) {
      if (!line.trim()) continue;
      let event: unknown;
      try {
        event = JSON.parse(line) as unknown;
      } catch {
        continue;
      }
      if (!event || typeof event !== "object" || Array.isArray(event)) continue;
      const value = event as {
        type?: unknown;
        argv?: unknown;
        exitCode?: unknown;
        origin?: unknown;
      };
      if (
        value.type !== "clash.cli.completed" ||
        value.exitCode !== 0 ||
        value.origin === "mcp-transport" ||
        !Array.isArray(value.argv) ||
        !value.argv.every((arg) => typeof arg === "string")
      )
        continue;
      const command = formatCliInvocation(value.argv);
      successfulCliArgv.push(value.argv);
      if (!seenCliCommands.has(command)) {
        seenCliCommands.add(command);
        observedCliCommands.push(command);
      }
    }
  } catch (error) {
    if (!(
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ))
      throw error;
  }
  const missingCliCommands = requiredCliCommands.filter(
    (required) =>
      !successfulCliArgv.some((argv) =>
        matchesRequiredCliCommand(required, argv),
      ),
  );
  const { observedProductOperations, missingProductOperations } =
    matchRequiredProductOperations({
      requiredProductOperations,
      successfulMcpTools: observedMcpTools,
      successfulCliArgv,
    });
  const tracePassed =
    missingProductOperations.length === 0 &&
    missingMcpTools.length === 0 &&
    missingCliCommands.length === 0;
  const expectedReadbackArtifactIds =
    benchmark.execution.productReadback?.artifactIds ?? [];
  const missingReadbackArtifactIds = expectedReadbackArtifactIds.filter(
    (artifactId) =>
      !productReadback?.report.matchedArtifactIds.includes(artifactId),
  );
  const readbackPassed =
    expectedReadbackArtifactIds.length === 0
      ? !productReadback || productReadback.report.status === "pass"
      : productReadback?.report.status === "pass" &&
        missingReadbackArtifactIds.length === 0;
  const executionReport: ProductExecutionReport = {
    profile: "clash-host",
    status: tracePassed && readbackPassed ? "pass" : "fail",
    requiredProductOperations,
    observedProductOperations,
    missingProductOperations,
    requiredMcpTools,
    observedMcpTools,
    missingMcpTools,
    requiredCliCommands,
    observedCliCommands,
    missingCliCommands,
    detail: [
      ...(requiredProductOperations.length > 0
        ? [
            missingProductOperations.length === 0
              ? `Observed all ${requiredProductOperations.length} required product operations through successful Clash CLI or MCP calls.`
              : `Missing successful Clash product operations: ${missingProductOperations.join(", ")}.`,
          ]
        : []),
      ...(requiredMcpTools.length > 0
        ? [
            missingMcpTools.length === 0
              ? `Observed all ${requiredMcpTools.length} required successful Clash MCP calls in agent JSONL.`
              : `Missing successful Clash MCP calls: ${missingMcpTools.join(", ")}.`,
          ]
        : []),
      ...(requiredCliCommands.length > 0
        ? [
            missingCliCommands.length === 0
              ? `Observed all ${requiredCliCommands.length} required successful Clash CLI calls in the runner trace.`
              : `Missing successful Clash CLI calls: ${missingCliCommands.join(", ")}.`,
          ]
        : []),
      ...(productReadback ? [productReadback.report.detail] : []),
      ...(missingReadbackArtifactIds.length > 0
        ? [
            `Missing trusted product readback for artifacts: ${missingReadbackArtifactIds.join(", ")}.`,
          ]
        : []),
    ].join(" "),
    ...(productReadback
      ? {
          productReadback: {
            status: productReadback.report.status,
            receiptPath: productReadback.receiptPath,
            matchedArtifactIds: productReadback.report.matchedArtifactIds,
            detail: productReadback.report.detail,
          },
        }
      : {}),
  };
  const identityIntegrity = inspectBenchmarkIdentityIntegrity({
    agentEventsText: text,
    cliTraceText,
  });
  return enforceBenchmarkIdentityIntegrity(executionReport, identityIntegrity);
}

export function matchesRequiredCliCommand(
  required: string,
  argv: string[],
): boolean {
  if (
    argv.some(
      (argument) =>
        argument === "--help" ||
        argument === "-h" ||
        argument === "--version" ||
        argument === "-V",
    )
  ) {
    return false;
  }
  const requiredArgv = required.trim().split(/\s+/u).filter(Boolean);
  return (
    requiredArgv.length > 0 &&
    requiredArgv.every((argument, index) => argv[index] === argument)
  );
}

async function runCase(input: {
  benchmark: ArtifactBenchmarkCase;
  agent: BenchmarkAgent;
  suiteRoot: string;
  caseRoot: string;
  processScope: BenchmarkProcessScope;
}): Promise<BenchmarkCaseReport> {
  assertSafePathSegment(input.benchmark.id, "Benchmark case id");
  const caseRoot = input.caseRoot;
  await createFreshDirectory(caseRoot, "Case directory");
  const finalWorkspace = join(caseRoot, "workspace");
  const executionWorkspaceRoot = await mkdtemp(
    join(tmpdir(), "clash-benchmark-workspace-"),
  );
  const workspaceCandidate = join(executionWorkspaceRoot, "workspace");
  await mkdir(workspaceCandidate);
  const workspace = await realpath(workspaceCandidate);
  let snapshotPublished = false;
  let clashHostConfig: ResolvedClashHost | undefined;
  let inputFixture: BenchmarkInputFixtureProvenance | undefined;
  try {
    if (input.benchmark.inputFixture) {
      inputFixture = await installBenchmarkInputFixture({
        suiteRoot: input.suiteRoot,
        workspace,
        fixture: input.benchmark.inputFixture,
      });
    }
    // Persist the public outcome before any optional setup so even a setup crash
    // leaves a useful, recoverable attempt workspace.
    await writeJson(join(workspace, "outcome.json"), input.benchmark.outcome);
    clashHostConfig = await resolveClashHost(input.agent, caseRoot, workspace);
    const installedSkillNames = await installCaseSkills(
      [
        ...input.benchmark.skills,
        ...(input.agent.adapter === "pi" ? (input.agent.skills ?? []) : []),
      ],
      input.suiteRoot,
      workspace,
    );
    const agentReadyPath = join(
      workspace,
      ".clash",
      "headless-host-ready.json",
    );
    const prompt = renderOutcomeMarkdown(input.benchmark, installedSkillNames, {
      clashHost: Boolean(clashHostConfig),
      workspaceRoot: workspace,
    });
    const promptPath = join(workspace, "OUTCOME.md");
    const setupWrites: Promise<void>[] = [
      writeFile(promptPath, prompt, "utf8"),
    ];
    if (clashHostConfig) {
      setupWrites.push(
        writeJson(join(caseRoot, "clash-host.json"), {
          profile: clashHostConfig.profile,
          pluginRoot: clashHostConfig.pluginRoot,
          runtimePath: clashHostConfig.runtimePath,
          runtimeClashHome: clashHostConfig.clashHome,
          persistedClashHome: clashHostConfig.persistedClashHome,
          localDataDir: clashHostConfig.localDataDir,
          localApiPluginSocket: clashHostConfig.localApiPluginSocket,
          projectPluginSocket: clashHostConfig.projectPluginSocket,
          executionWorkspace: workspace,
          finalWorkspace,
          workspaceBinding: "runner-managed",
          projectDaemonGate: "required-before-agent",
        }),
      );
    }
    await Promise.all(setupWrites);

    const logsRoot = join(caseRoot, "logs");
    let clashHost: RunningClashHost | undefined;
    let projectDaemon: ProjectDaemonController | undefined;
    let projectReady: ProjectDaemonReady | undefined;
    let agent: AgentRunReport;
    let productReadback: TrustedProductReadback | undefined;
    try {
      clashHost = clashHostConfig
        ? await startClashHost(clashHostConfig, logsRoot, input.processScope)
        : undefined;
      if (clashHost) {
        const generatedProjectId = `headless_eval_${createHash("sha256")
          .update(caseRoot)
          .digest("hex")
          .slice(0, 24)}`;
        let binding: BenchmarkWorkspaceBinding;
        try {
          binding = await prepareBenchmarkWorkspaceBinding({
            cliPath: clashHost.agentCliPath,
            workspace,
            caseRoot,
            logsRoot,
            generatedProjectId,
            environment: clashProjectEnvironment(clashHost, workspace),
            processScope: input.processScope,
          });
        } catch (error) {
          throw new BenchmarkInfrastructureError(
            "workspace-init",
            `Clash workspace initialization failed: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
          );
        }
        projectDaemon = startProjectDaemonController({
          host: clashHost,
          binding,
          workspace,
          caseRoot,
          logsRoot,
          agentReadyPath,
          processScope: input.processScope,
        });
        try {
          projectReady = await projectDaemon.ready;
        } catch (error) {
          throw new BenchmarkInfrastructureError(
            "project-daemon-setup",
            `Clash project daemon setup failed: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
          );
        }
        await writeJson(join(caseRoot, "clash-host.json"), {
          profile: clashHost.profile,
          pluginRoot: clashHost.pluginRoot,
          runtimePath: clashHost.runtimePath,
          runtimeClashHome: clashHost.clashHome,
          persistedClashHome: clashHost.persistedClashHome,
          localDataDir: clashHost.localDataDir,
          localApiPluginSocket: clashHost.localApiPluginSocket,
          projectPluginSocket: clashHost.projectPluginSocket,
          endpoint: clashHost.endpoint,
          agentCliPath: clashHost.agentCliPath,
          agentMemberId: clashHost.agentMemberId,
          agentName: clashHost.agentName,
          hostPid: clashHost.child.pid,
          localApiReadyAt: clashHost.readyAt,
          executionWorkspace: workspace,
          finalWorkspace,
          projectId: projectReady.projectId,
          workspaceId: projectReady.workspaceId,
          initDisposition: projectReady.initDisposition,
          markerSha256: projectReady.markerSha256,
          projectDaemonReadyAt: projectReady.readyAt,
          projectDaemonOwnership: projectReady.ownership,
          workspaceBinding: "ready",
          projectDaemonGate: "satisfied-before-agent",
          lifecycleOwner: "benchmark-runner",
        });
      }
      agent = await runAgent({
        agent: input.agent,
        benchmark: input.benchmark,
        suiteRoot: input.suiteRoot,
        workspace,
        logsRoot,
        promptPath,
        prompt,
        clashHost,
        processScope: input.processScope,
      });
      if (inputFixture) {
        await writeBenchmarkInputFixtureReceipt(workspace, inputFixture);
      }
      await publishWorkspaceSnapshot(workspace, finalWorkspace);
      snapshotPublished = true;
      productReadback = await captureRequiredProductReadback({
        benchmark: input.benchmark,
        workspace: finalWorkspace,
        caseRoot,
        ready: projectReady,
      });
    } finally {
      try {
        if (projectDaemon) await projectDaemon.stop();
      } finally {
        if (clashHost) await stopClashHost(clashHost);
      }
    }

    const execution = await evaluateProductExecution(
      input.benchmark,
      agent,
      productReadback,
    );
    const evaluation = await evaluateSubmission({
      benchmark: input.benchmark,
      workspace: finalWorkspace,
    });
    const outcome = createOutcomeResult({
      benchmark: input.benchmark,
      agentStatus: agent.status,
      evaluationStatus: evaluation.status,
      executionStatus: execution.status,
      score: evaluation.score,
    });
    const status = outcome.status === "achieved" ? "pass" : "fail";
    const report: BenchmarkCaseReport = {
      id: input.benchmark.id,
      workspace: finalWorkspace,
      ...(inputFixture ? { inputFixture } : {}),
      status,
      agent,
      execution,
      evaluation,
      outcome,
    };
    await Promise.all([
      writeJson(join(caseRoot, "evaluation.json"), evaluation),
      writeJson(join(caseRoot, "execution.json"), execution),
      writeJson(join(caseRoot, "outcome-result.json"), outcome),
      writeJson(join(caseRoot, "case-report.json"), report),
    ]);
    return report;
  } finally {
    if (!snapshotPublished) {
      try {
        await publishWorkspaceSnapshot(workspace, finalWorkspace);
        snapshotPublished = true;
      } catch (error) {
        await writeFile(
          join(caseRoot, "workspace-snapshot-error.log"),
          `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
          "utf8",
        ).catch(() => undefined);
      }
    }
    if (clashHostConfig) {
      await rm(clashHostConfig.runtimeRoot, { recursive: true, force: true });
    }
    await rm(executionWorkspaceRoot, { recursive: true, force: true });
  }
}

type RunManifest = {
  schemaVersion: 1;
  suiteId: string;
  runId: string;
  suiteSha256: string;
  startedAt: string;
};

type RunProgressCase = {
  id: string;
  status: BenchmarkCaseReport["status"];
  attempt?: number;
  failure?: BenchmarkCaseFailure;
};

type LegacyRunProgress = {
  schemaVersion: 1;
  suiteId: string;
  runId: string;
  status: "in-progress";
  startedAt: string;
  updatedAt: string;
  resumed: boolean;
  completedCases: RunProgressCase[];
};

type RunProgress = {
  schemaVersion: 2;
  suiteId: string;
  runId: string;
  status: "in-progress";
  startedAt: string;
  updatedAt: string;
  resumed: boolean;
  completedCases: RunProgressCase[];
  attempts: BenchmarkAttemptLedgerEntry[];
};

type StoredRunProgress = LegacyRunProgress | RunProgress;

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    )
      return false;
    throw error;
  }
}

async function ensureFile(path: string, contents = ""): Promise<void> {
  if (!(await pathExists(path))) await writeFile(path, contents, "utf8");
}

function nonRunEvaluation(
  benchmark: ArtifactBenchmarkCase,
  status: "fail" | "not-run",
  detail: string,
): ArtifactEvaluationReport {
  return {
    schemaVersion: 1,
    benchmarkId: benchmark.id,
    taskId: null,
    status,
    score: 0,
    checks: [],
    artifacts: [],
    outcomeGate: {
      status: "fail",
      detail,
      missingArtifactIds: benchmark.outcome.deliverables.map(
        ({ artifactId }) => artifactId,
      ),
      invalidArtifactIds: [],
    },
    error: detail,
  };
}

function nonRunExecution(
  benchmark: ArtifactBenchmarkCase,
  status: "fail" | "blocked",
  detail: string,
): ProductExecutionReport {
  return {
    profile: benchmark.execution ? "clash-host" : "portable",
    status,
    requiredProductOperations:
      benchmark.execution?.requiredProductOperations ?? [],
    observedProductOperations: [],
    missingProductOperations:
      benchmark.execution?.requiredProductOperations ?? [],
    requiredMcpTools: benchmark.execution?.requiredMcpTools ?? [],
    observedMcpTools: [],
    missingMcpTools: benchmark.execution?.requiredMcpTools ?? [],
    requiredCliCommands: benchmark.execution?.requiredCliCommands ?? [],
    observedCliCommands: [],
    missingCliCommands: benchmark.execution?.requiredCliCommands ?? [],
    detail,
  };
}

async function createNonRunAgentReport(input: {
  agent: BenchmarkAgent;
  logsRoot: string;
  error?: string;
}): Promise<AgentRunReport> {
  await mkdir(input.logsRoot, { recursive: true });
  const stdoutPath = join(
    input.logsRoot,
    input.agent.adapter === "codex" ||
      input.agent.adapter === "claude" ||
      input.agent.adapter === "pi"
      ? "events.jsonl"
      : "stdout.log",
  );
  const stderrPath = join(input.logsRoot, "stderr.log");
  const observedEventsPath = join(input.logsRoot, "observed-events.jsonl");
  await Promise.all([
    ensureFile(stdoutPath),
    ensureFile(stderrPath),
    ensureFile(observedEventsPath),
  ]);
  const trajectoryPath = await writeNormalizedTrajectory({
    agent: input.agent,
    logsRoot: input.logsRoot,
    rawPath: stdoutPath,
    observedPath: observedEventsPath,
  }).catch(() => undefined);
  return {
    status: "not-run",
    exitCode: null,
    signal: null,
    durationMs: 0,
    stdoutPath,
    stderrPath,
    observedEventsPath,
    ...(trajectoryPath ? { trajectoryPath } : {}),
    ...(input.error ? { error: input.error } : {}),
  };
}

async function writeCaseReportFiles(
  caseRoot: string,
  report: BenchmarkCaseReport,
): Promise<void> {
  await Promise.all([
    writeJson(join(caseRoot, "evaluation.json"), report.evaluation),
    writeJson(join(caseRoot, "execution.json"), report.execution),
    writeJson(join(caseRoot, "outcome-result.json"), report.outcome),
    writeJson(join(caseRoot, "case-report.json"), report),
  ]);
}

async function createInfrastructureFailureReport(input: {
  benchmark: ArtifactBenchmarkCase;
  agent: BenchmarkAgent;
  caseRoot: string;
  attempt: number;
  error: unknown;
}): Promise<BenchmarkCaseReport> {
  const detail =
    input.error instanceof Error ? input.error.message : String(input.error);
  const phase =
    input.error instanceof BenchmarkInfrastructureError
      ? input.error.phase
      : "runner";
  const stack =
    input.error instanceof Error ? (input.error.stack ?? detail) : detail;
  const workspace = join(input.caseRoot, "workspace");
  const logsRoot = join(input.caseRoot, "logs");
  await Promise.all([
    mkdir(workspace, { recursive: true }),
    mkdir(logsRoot, { recursive: true }),
  ]);
  await Promise.all([
    ensureFile(
      join(workspace, "outcome.json"),
      `${JSON.stringify(input.benchmark.outcome, null, 2)}\n`,
    ),
    writeJson(join(input.caseRoot, "runner-error.json"), {
      schemaVersion: 1,
      classification: "infrastructure",
      retryable: true,
      phase,
      detail,
      stack,
    }),
  ]);
  const failure: BenchmarkCaseFailure = {
    classification: "infrastructure",
    retryable: true,
    phase,
    detail,
  };
  const agent = await createNonRunAgentReport({
    agent: input.agent,
    logsRoot,
    error: detail,
  });
  const evaluation = nonRunEvaluation(
    input.benchmark,
    "fail",
    `Benchmark evaluation did not run because the runner infrastructure failed: ${detail}`,
  );
  const execution = nonRunExecution(
    input.benchmark,
    "fail",
    `Product execution could not be verified because the runner infrastructure failed: ${detail}`,
  );
  const outcome: OutcomeResult = {
    schemaVersion: 1,
    caseId: input.benchmark.id,
    objective: input.benchmark.outcome.objective,
    status: "failed",
    score: 0,
    passScore: input.benchmark.passScore,
    agentStatus: agent.status,
    evaluationStatus: evaluation.status,
    executionStatus: execution.status,
    completedAt: new Date().toISOString(),
  };
  const report: BenchmarkCaseReport = {
    id: input.benchmark.id,
    workspace,
    status: "fail",
    attempt: input.attempt,
    failure,
    agent,
    execution,
    evaluation,
    outcome,
  };
  await writeCaseReportFiles(input.caseRoot, report);
  return report;
}

async function createBlockedCaseReport(input: {
  benchmark: ArtifactBenchmarkCase;
  agent: BenchmarkAgent;
  caseRoot: string;
  attempt: number;
}): Promise<BenchmarkCaseReport> {
  await createFreshDirectory(input.caseRoot, "Case directory");
  const workspace = join(input.caseRoot, "workspace");
  const logsRoot = join(input.caseRoot, "logs");
  await Promise.all([mkdir(workspace), mkdir(logsRoot)]);
  const preflight = input.benchmark.execution?.preflight;
  const missing =
    preflight?.checks.filter(({ status }) => status === "missing") ?? [];
  const detail =
    missing.length > 0
      ? `Preflight blocked: ${missing.map(({ capability, detail: reason }) => `${capability}: ${reason}`).join("; ")}`
      : "Preflight blocked by the benchmark capability contract.";
  await Promise.all([
    writeJson(join(workspace, "outcome.json"), input.benchmark.outcome),
    writeFile(
      join(workspace, "OUTCOME.md"),
      renderOutcomeMarkdown(input.benchmark),
      "utf8",
    ),
    writeJson(join(input.caseRoot, "preflight.json"), {
      schemaVersion: 1,
      status: "blocked",
      checks: preflight?.checks ?? [],
      detail,
    }),
  ]);
  const failure: BenchmarkCaseFailure = {
    classification: "preflight",
    retryable: false,
    phase: "preflight",
    detail,
  };
  const agent = await createNonRunAgentReport({ agent: input.agent, logsRoot });
  const evaluation = nonRunEvaluation(input.benchmark, "not-run", detail);
  const execution = nonRunExecution(input.benchmark, "blocked", detail);
  const outcome: OutcomeResult = {
    schemaVersion: 1,
    caseId: input.benchmark.id,
    objective: input.benchmark.outcome.objective,
    status: "blocked",
    score: 0,
    passScore: input.benchmark.passScore,
    agentStatus: agent.status,
    evaluationStatus: evaluation.status,
    executionStatus: execution.status,
    completedAt: new Date().toISOString(),
  };
  const report: BenchmarkCaseReport = {
    id: input.benchmark.id,
    workspace,
    status: "blocked",
    attempt: input.attempt,
    failure,
    agent,
    execution,
    evaluation,
    outcome,
  };
  await writeCaseReportFiles(input.caseRoot, report);
  return report;
}

function classifyCaseFailure(
  report: BenchmarkCaseReport,
): BenchmarkCaseFailure | undefined {
  if (report.status === "pass") return undefined;
  if (report.failure) return report.failure;
  if (report.status === "blocked" || report.execution.status === "blocked") {
    return (
      report.failure ?? {
        classification: "preflight",
        retryable: false,
        phase: "preflight",
        detail: report.execution.detail,
      }
    );
  }
  if (report.agent.status === "spawn-error") {
    return {
      classification: "infrastructure",
      retryable: true,
      phase: "agent-spawn",
      detail:
        report.agent.error ??
        "The benchmark agent process could not be spawned.",
    };
  }
  if (report.agent.status !== "completed") {
    return {
      classification: "agent",
      retryable: false,
      phase: "agent",
      detail:
        report.agent.error ??
        `Agent finished with status ${report.agent.status}.`,
    };
  }
  if (report.execution.status !== "pass") {
    return {
      classification: "product",
      retryable: false,
      phase: "product-execution",
      detail: report.execution.detail,
    };
  }
  return {
    classification: "evaluation",
    retryable: false,
    phase: "artifact-evaluation",
    detail:
      report.evaluation.error ??
      (report.evaluation.checks
        .filter(({ status }) => status === "fail")
        .map(({ detail }) => detail)
        .join("; ") ||
        "Artifact evaluation did not satisfy the benchmark rubric."),
  };
}

function relativeRunPath(runRoot: string, path: string): string {
  const local = relative(runRoot, path);
  if (!local || local === ".." || local.startsWith(`..${sep}`)) {
    throw new Error(
      `Attempt path must remain inside the run directory: ${path}`,
    );
  }
  return local;
}

async function recordAttemptEntry(
  progressPath: string,
  progress: RunProgress,
  entry: BenchmarkAttemptLedgerEntry,
): Promise<void> {
  const attempts = [...progress.attempts, entry];
  const updatedAt = new Date().toISOString();
  await writeJsonAtomically(progressPath, { ...progress, updatedAt, attempts });
  progress.updatedAt = updatedAt;
  progress.attempts.push(entry);
}

async function loadAttemptLedger(
  path: string,
): Promise<BenchmarkAttemptLedgerEntry[]> {
  if (!(await pathExists(path))) return [];
  const contents = await readFile(path, "utf8");
  const lines = contents.split("\n");
  const entries: BenchmarkAttemptLedgerEntry[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim();
    if (!line) continue;
    try {
      entries.push(JSON.parse(line) as BenchmarkAttemptLedgerEntry);
    } catch (error) {
      // A killed process can leave only the final append incomplete. Preserve the
      // source ledger and recover from every complete entry before it.
      if (
        index === lines.length - 1 ||
        lines.slice(index + 1).every((item) => !item.trim())
      )
        break;
      throw new Error(
        `Attempt ledger is corrupt at line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return entries;
}

async function loadRunProgress(input: {
  progressPath: string;
  manifest: RunManifest;
  resumed: boolean;
}): Promise<RunProgress> {
  let stored: StoredRunProgress | undefined;
  if (await pathExists(input.progressPath)) {
    try {
      stored = JSON.parse(
        await readFile(input.progressPath, "utf8"),
      ) as StoredRunProgress;
    } catch (error) {
      throw new Error(
        `Cannot resume without readable run progress: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (
      (stored.schemaVersion !== 1 && stored.schemaVersion !== 2) ||
      stored.suiteId !== input.manifest.suiteId ||
      stored.runId !== input.manifest.runId ||
      stored.startedAt !== input.manifest.startedAt
    ) {
      throw new Error(
        "Cannot resume: run progress does not match the existing run manifest",
      );
    }
    if (stored.schemaVersion === 2) return stored;
  }
  const legacyLedgerPath = join(dirname(input.progressPath), "attempts.jsonl");
  const progress: RunProgress = {
    schemaVersion: 2,
    suiteId: input.manifest.suiteId,
    runId: input.manifest.runId,
    status: "in-progress",
    startedAt: input.manifest.startedAt,
    updatedAt: new Date().toISOString(),
    resumed: input.resumed,
    completedCases: stored?.completedCases ?? [],
    attempts: await loadAttemptLedger(legacyLedgerPath),
  };
  await writeJsonAtomically(input.progressPath, progress);
  await rm(legacyLedgerPath, { force: true });
  return progress;
}

function attemptRoot(runRoot: string, caseId: string, attempt: number): string {
  return attempt === 1
    ? join(runRoot, caseId)
    : join(runRoot, caseId, "attempts", String(attempt).padStart(3, "0"));
}

function suiteStatus(
  cases: BenchmarkCaseReport[],
): BenchmarkSuiteReport["status"] {
  if (cases.some(({ status }) => status === "fail")) return "fail";
  if (cases.some(({ status }) => status === "blocked")) return "blocked";
  return "pass";
}

async function writeSuiteProgress(input: {
  progressPath: string;
  progress: RunProgress;
  resumed: boolean;
  cases: BenchmarkCaseReport[];
}): Promise<void> {
  const completedCases = input.cases.map(
    ({ id, status, attempt, failure }): RunProgressCase => ({
      id,
      status,
      attempt,
      ...(failure ? { failure } : {}),
    }),
  );
  const updatedAt = new Date().toISOString();
  await writeJsonAtomically(input.progressPath, {
    ...input.progress,
    updatedAt,
    resumed: input.resumed,
    completedCases,
  });
  input.progress.updatedAt = updatedAt;
  input.progress.resumed = input.resumed;
  input.progress.completedCases = completedCases;
}

export type CodexAgentAdapterOptions = Omit<CodexAgent, "adapter">;

export function createCodexAgentAdapter(
  options: CodexAgentAdapterOptions = {},
): CodexAgent {
  return { adapter: "codex", ...options };
}

export type ClaudeAgentAdapterOptions = Omit<ClaudeAgent, "adapter">;

export function createClaudeAgentAdapter(
  options: ClaudeAgentAdapterOptions = {},
): ClaudeAgent {
  return { adapter: "claude", ...options };
}

export type PiAgentAdapterOptions = Omit<PiAgent, "adapter">;

export function createPiAgentAdapter(
  options: PiAgentAdapterOptions = {},
): PiAgent {
  return { adapter: "pi", ...options };
}

async function runBenchmarkSuiteInProcessScope(
  input: RunBenchmarkSuiteInput,
  processScope: BenchmarkProcessScope,
): Promise<BenchmarkSuiteReport> {
  if (input.force && !input.resume) {
    throw new Error("--force requires --resume");
  }
  const parsedSuite = ArtifactBenchmarkSuiteSchema.safeParse(input.suite);
  if (!parsedSuite.success) {
    const detail = parsedSuite.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid benchmark suite: ${detail}`);
  }
  assertSafePathSegment(input.runId, "Run id");
  for (const benchmark of parsedSuite.data.cases)
    assertSafePathSegment(benchmark.id, "Benchmark case id");

  const suiteRoot = await realpath(input.suiteRoot);
  if (!(await stat(suiteRoot)).isDirectory())
    throw new Error("suiteRoot must be a directory");
  await mkdir(resolve(input.outputRoot), { recursive: true });
  const outputRoot = await realpath(resolve(input.outputRoot));
  if (!(await stat(outputRoot)).isDirectory())
    throw new Error("outputRoot must be a directory");
  const configuredRunRoot = join(outputRoot, input.runId);
  const suiteSha256 = sha256Json(parsedSuite.data);
  let runRoot: string;
  let manifest: RunManifest;
  if (input.resume) {
    if (!(await pathExists(configuredRunRoot))) {
      throw new Error(
        `Cannot resume because the run directory does not exist: ${configuredRunRoot}`,
      );
    }
    runRoot = await realpath(configuredRunRoot);
    const localRunRoot = relative(outputRoot, runRoot);
    if (
      !localRunRoot ||
      localRunRoot === ".." ||
      localRunRoot.startsWith(`..${sep}`)
    ) {
      throw new Error(
        `Run directory must remain inside outputRoot: ${runRoot}`,
      );
    }
    const manifestPath = join(runRoot, "run-manifest.json");
    let parsedManifest: RunManifest;
    try {
      parsedManifest = JSON.parse(
        await readFile(manifestPath, "utf8"),
      ) as RunManifest;
    } catch (error) {
      throw new Error(
        `Cannot resume without a readable run manifest: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (
      parsedManifest.schemaVersion !== 1 ||
      parsedManifest.suiteId !== parsedSuite.data.id ||
      parsedManifest.runId !== input.runId ||
      parsedManifest.suiteSha256 !== suiteSha256
    ) {
      throw new Error(
        "Cannot resume: the benchmark suite does not match the existing run manifest",
      );
    }
    manifest = parsedManifest;
  } else {
    await createFreshDirectory(configuredRunRoot, "Run directory");
    runRoot = await realpath(configuredRunRoot);
    manifest = {
      schemaVersion: 1,
      suiteId: parsedSuite.data.id,
      runId: input.runId,
      suiteSha256,
      startedAt: new Date().toISOString(),
    };
    await writeJsonAtomically(join(runRoot, "run-manifest.json"), manifest);
  }

  const maxInfrastructureAttempts = input.maxInfrastructureAttempts ?? 2;
  if (
    !Number.isInteger(maxInfrastructureAttempts) ||
    maxInfrastructureAttempts < 1
  ) {
    throw new Error("maxInfrastructureAttempts must be a positive integer");
  }
  const progressPath = join(runRoot, "suite-progress.json");
  const progress = await loadRunProgress({
    progressPath,
    manifest,
    resumed: Boolean(input.resume),
  });
  const ledger = progress.attempts;
  const startedAt = manifest.startedAt;
  const cases: BenchmarkCaseReport[] = [];
  for (const benchmark of parsedSuite.data.cases) {
    if (processScope.interruptedSignal) break;
    const existingEntries = ledger.filter(
      ({ caseId }) => caseId === benchmark.id,
    );
    const terminalAttempts = new Set(
      existingEntries
        .filter(({ event }) => event === "completed" || event === "abandoned")
        .map(({ attempt }) => attempt),
    );
    for (const entry of existingEntries.filter(
      ({ event, attempt }) =>
        event === "started" && !terminalAttempts.has(attempt),
    )) {
      const failure: BenchmarkCaseFailure = {
        classification: "infrastructure",
        retryable: true,
        phase: "runner-interrupted",
        detail:
          "The previous runner stopped before recording a completed attempt.",
      };
      const abandoned: BenchmarkAttemptLedgerEntry = {
        schemaVersion: 1,
        suiteId: parsedSuite.data.id,
        runId: input.runId,
        caseId: benchmark.id,
        attempt: entry.attempt,
        event: "abandoned",
        at: new Date().toISOString(),
        caseRoot: entry.caseRoot,
        failure,
      };
      await recordAttemptEntry(progressPath, progress, abandoned);
      existingEntries.push(abandoned);
    }

    const completedEntries = existingEntries.filter(
      (entry): entry is BenchmarkAttemptLedgerEntry & { reportPath: string } =>
        entry.event === "completed" && typeof entry.reportPath === "string",
    );
    const latestCompleted = completedEntries.at(-1);
    let latestReport: BenchmarkCaseReport | undefined;
    if (latestCompleted) {
      const reportPath = resolve(runRoot, latestCompleted.reportPath);
      relativeRunPath(runRoot, reportPath);
      try {
        latestReport = JSON.parse(
          await readFile(reportPath, "utf8"),
        ) as BenchmarkCaseReport;
      } catch (error) {
        throw new Error(
          `Cannot resume case '${benchmark.id}' because its completed report is unreadable: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      latestReport.attempt ??= latestCompleted.attempt;
      latestReport.failure ??= classifyCaseFailure(latestReport);
    }

    const completedInfrastructureFailures = completedEntries.filter(
      ({ failure }) =>
        failure?.classification === "infrastructure" && failure.retryable,
    ).length;
    const completedForcedEntries = completedEntries.filter(
      ({ forced }) => forced === true,
    );
    const latestForcedCompleted = completedForcedEntries.at(-1);
    const latestAttemptWasForced = latestCompleted?.forced === true;
    let forcedRetryRequested = false;
    if (
      input.force &&
      latestReport?.status === "fail" &&
      (latestAttemptWasForced ||
        latestReport.failure?.classification !== "infrastructure")
    ) {
      if (latestAttemptWasForced && latestForcedCompleted) {
        const hasForcePending = existingEntries.some(
          ({ event, attempt, forced }) =>
            event === "force-pending" &&
            attempt === latestForcedCompleted.attempt &&
            forced === true,
        );
        const pendingWasConsumed = existingEntries.some(
          ({ event, attempt, forced }) =>
            event === "started" &&
            forced === true &&
            attempt > latestForcedCompleted.attempt,
        );
        if (!hasForcePending || pendingWasConsumed) {
          throw new Error(
            `A force-pending record is required before another forced retry of case '${benchmark.id}'`,
          );
        }
      }
      forcedRetryRequested = true;
    }
    if (
      latestReport &&
      !forcedRetryRequested &&
      (latestAttemptWasForced ||
        latestReport.status === "pass" ||
        latestReport.status === "blocked" ||
        latestReport.failure?.classification !== "infrastructure" ||
        !latestReport.failure.retryable ||
        completedInfrastructureFailures >= maxInfrastructureAttempts)
    ) {
      cases.push(latestReport);
      await writeSuiteProgress({
        progressPath,
        progress,
        resumed: Boolean(input.resume),
        cases,
      });
      continue;
    }

    let infrastructureFailures = completedInfrastructureFailures;
    let nextAttempt =
      Math.max(0, ...existingEntries.map(({ attempt }) => attempt)) + 1;
    while (true) {
      const caseRoot = attemptRoot(runRoot, benchmark.id, nextAttempt);
      await mkdir(dirname(caseRoot), { recursive: true });
      const startedEntry: BenchmarkAttemptLedgerEntry = {
        schemaVersion: 1,
        suiteId: parsedSuite.data.id,
        runId: input.runId,
        caseId: benchmark.id,
        attempt: nextAttempt,
        event: "started",
        at: new Date().toISOString(),
        caseRoot: relativeRunPath(runRoot, caseRoot),
        ...(forcedRetryRequested ? { forced: true } : {}),
      };
      await recordAttemptEntry(progressPath, progress, startedEntry);

      let report: BenchmarkCaseReport;
      try {
        report =
          benchmark.execution?.preflight?.status === "blocked"
            ? await createBlockedCaseReport({
                benchmark,
                agent: input.agent,
                caseRoot,
                attempt: nextAttempt,
              })
            : await runCase({
                benchmark,
                agent: input.agent,
                suiteRoot,
                caseRoot,
                processScope,
              });
      } catch (error) {
        report = await createInfrastructureFailureReport({
          benchmark,
          agent: input.agent,
          caseRoot,
          attempt: nextAttempt,
          error,
        });
      }
      report.attempt = nextAttempt;
      report.failure = classifyCaseFailure(report);
      if (forcedRetryRequested && report.status !== "pass") {
        report.forcePending = true;
      }
      await writeJson(join(caseRoot, "case-report.json"), report);

      const completedEntry: BenchmarkAttemptLedgerEntry = {
        schemaVersion: 1,
        suiteId: parsedSuite.data.id,
        runId: input.runId,
        caseId: benchmark.id,
        attempt: nextAttempt,
        event: "completed",
        at: new Date().toISOString(),
        caseRoot: relativeRunPath(runRoot, caseRoot),
        status: report.status,
        ...(forcedRetryRequested ? { forced: true } : {}),
        ...(report.failure ? { failure: report.failure } : {}),
        reportPath: relativeRunPath(
          runRoot,
          join(caseRoot, "case-report.json"),
        ),
      };
      await recordAttemptEntry(progressPath, progress, completedEntry);

      if (forcedRetryRequested && report.status !== "pass") {
        const forcePendingEntry: BenchmarkAttemptLedgerEntry = {
          schemaVersion: 1,
          suiteId: parsedSuite.data.id,
          runId: input.runId,
          caseId: benchmark.id,
          attempt: nextAttempt,
          event: "force-pending",
          at: new Date().toISOString(),
          caseRoot: relativeRunPath(runRoot, caseRoot),
          forced: true,
          status: report.status,
          ...(report.failure ? { failure: report.failure } : {}),
          reportPath: relativeRunPath(
            runRoot,
            join(caseRoot, "case-report.json"),
          ),
        };
        await recordAttemptEntry(progressPath, progress, forcePendingEntry);
      }

      if (processScope.interruptedSignal) {
        cases.push(report);
        await writeSuiteProgress({
          progressPath,
          progress,
          resumed: Boolean(input.resume),
          cases,
        });
        break;
      }

      if (
        !forcedRetryRequested &&
        report.failure?.classification === "infrastructure" &&
        report.failure.retryable
      ) {
        infrastructureFailures += 1;
        if (infrastructureFailures < maxInfrastructureAttempts) {
          nextAttempt += 1;
          continue;
        }
      }
      cases.push(report);
      await writeSuiteProgress({
        progressPath,
        progress,
        resumed: Boolean(input.resume),
        cases,
      });
      break;
    }
    if (processScope.interruptedSignal) break;
  }
  const report: BenchmarkSuiteReport = {
    schemaVersion: 1,
    suiteId: parsedSuite.data.id,
    runId: input.runId,
    status: processScope.interruptedSignal ? "fail" : suiteStatus(cases),
    startedAt,
    finishedAt: new Date().toISOString(),
    resumed: Boolean(input.resume),
    cases,
  };
  await Promise.all([
    writeJson(join(runRoot, "suite-report.json"), report),
    writeSuiteGallery({ report, runRoot }),
  ]);
  return report;
}

export async function runBenchmarkSuite(
  input: RunBenchmarkSuiteInput,
): Promise<BenchmarkSuiteReport> {
  const processScope = new BenchmarkProcessScope();
  processScope.install();
  try {
    return await runBenchmarkSuiteInProcessScope(input, processScope);
  } finally {
    await processScope.dispose();
  }
}

function sameArtifactEvidence(
  left: ArtifactEvaluationReport["artifacts"],
  right: ArtifactEvaluationReport["artifacts"],
): boolean {
  const byId = (artifacts: ArtifactEvaluationReport["artifacts"]) =>
    [...artifacts].sort((a, b) => a.id.localeCompare(b.id));
  return stableJson(byId(left)) === stableJson(byId(right));
}

async function assertPersistedAgentEvidence(
  caseRoot: string,
  agent: AgentRunReport,
): Promise<void> {
  if (agent.status !== "completed" || agent.exitCode !== 0) {
    throw new Error(
      "Cannot reevaluate a case whose original agent did not complete successfully",
    );
  }
  const paths = [
    agent.stdoutPath,
    agent.stderrPath,
    agent.observedEventsPath,
    agent.trajectoryPath,
  ].filter((path): path is string => typeof path === "string");
  for (const path of paths) {
    const canonical = await realpath(path).catch((error) => {
      throw new Error(
        `Cannot reevaluate without persisted agent evidence '${path}': ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    relativeRunPath(caseRoot, canonical);
    if (!(await stat(canonical)).isFile()) {
      throw new Error(`Persisted agent evidence is not a file: ${path}`);
    }
  }
}

async function loadPersistedWorkspaceBinding(
  caseRoot: string,
  workspace: string,
): Promise<BenchmarkWorkspaceBinding> {
  const receipt = JSON.parse(
    await readFile(join(caseRoot, "clash-workspace-init.json"), "utf8"),
  ) as Record<string, unknown>;
  const markerPath = join(workspace, ".clash", "project.toml");
  const marker = await readFile(markerPath, "utf8");
  const projectId = /^project_id\s*=\s*"([^"]+)"/mu.exec(marker)?.[1];
  const workspaceId = /^workspace_id\s*=\s*"([^"]+)"/mu.exec(marker)?.[1];
  const markerSha256 = sha256Bytes(marker);
  if (
    receipt.status !== "initialized" ||
    typeof receipt.projectId !== "string" ||
    typeof receipt.workspaceId !== "string" ||
    (receipt.initDisposition !== "created" &&
      receipt.initDisposition !== "reused") ||
    receipt.markerSha256 !== markerSha256 ||
    receipt.projectId !== projectId ||
    receipt.workspaceId !== workspaceId
  ) {
    throw new Error(
      "Cannot reevaluate because the persisted Clash workspace binding is invalid",
    );
  }
  return {
    projectId: receipt.projectId,
    workspaceId: receipt.workspaceId,
    markerPath,
    markerSha256,
    initDisposition: receipt.initDisposition,
  };
}

async function recapturePersistedProductReadback(input: {
  benchmark: ArtifactBenchmarkCase;
  caseRoot: string;
  workspace: string;
}): Promise<TrustedProductReadback | undefined> {
  const storedHost = JSON.parse(
    await readFile(join(input.caseRoot, "clash-host.json"), "utf8"),
  ) as Record<string, unknown>;
  if (
    typeof storedHost.pluginRoot !== "string" ||
    (storedHost.profile !== "dev" && storedHost.profile !== "prod")
  ) {
    throw new Error(
      "Cannot reevaluate because the persisted Clash host receipt is invalid",
    );
  }
  const resolvedHost = await resolveClashHost(
    {
      adapter: "codex",
      clashHost: {
        pluginRoot: storedHost.pluginRoot,
        profile: storedHost.profile,
      },
    },
    input.caseRoot,
    input.workspace,
  );
  if (!resolvedHost) {
    throw new Error("Cannot reevaluate without a persisted Clash host");
  }

  const processScope = new BenchmarkProcessScope();
  const logsRoot = join(resolvedHost.runtimeRoot, "reevaluate-logs");
  const agentReadyPath = join(
    resolvedHost.runtimeRoot,
    "headless-host-ready.json",
  );
  let runningHost: RunningClashHost | undefined;
  let projectDaemon: ProjectDaemonController | undefined;
  try {
    runningHost = await startClashHost(resolvedHost, logsRoot, processScope);
    const binding = await loadPersistedWorkspaceBinding(
      input.caseRoot,
      input.workspace,
    );
    projectDaemon = startProjectDaemonController({
      host: runningHost,
      binding,
      workspace: input.workspace,
      caseRoot: input.caseRoot,
      logsRoot,
      agentReadyPath,
      processScope,
    });
    const ready = await projectDaemon.ready;
    return await captureRequiredProductReadback({
      benchmark: input.benchmark,
      workspace: input.workspace,
      caseRoot: input.caseRoot,
      ready,
    });
  } finally {
    try {
      if (projectDaemon) await projectDaemon.stop();
    } finally {
      if (runningHost) await stopClashHost(runningHost);
      await processScope.dispose();
      await rm(resolvedHost.runtimeRoot, { recursive: true, force: true });
    }
  }
}

export async function reevaluateBenchmarkRun(
  input: ReevaluateBenchmarkRunInput,
): Promise<BenchmarkCaseReport> {
  const parsedSuite = ArtifactBenchmarkSuiteSchema.safeParse(input.suite);
  if (!parsedSuite.success) {
    const detail = parsedSuite.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid benchmark suite: ${detail}`);
  }
  assertSafePathSegment(input.runId, "Run id");
  assertSafePathSegment(input.caseId, "Benchmark case id");
  const matchingCases = parsedSuite.data.cases.filter(
    ({ id }) => id === input.caseId,
  );
  if (matchingCases.length !== 1) {
    throw new Error(`Benchmark case not found: ${input.caseId}`);
  }
  const benchmark = matchingCases[0]!;
  const suiteRoot = await realpath(input.suiteRoot);
  if (!(await stat(suiteRoot)).isDirectory()) {
    throw new Error("suiteRoot must be a directory");
  }
  const outputRoot = await realpath(resolve(input.outputRoot));
  if (!(await stat(outputRoot)).isDirectory()) {
    throw new Error("outputRoot must be a directory");
  }
  const configuredRunRoot = join(outputRoot, input.runId);
  if (!(await pathExists(configuredRunRoot))) {
    throw new Error(
      `Cannot reevaluate because the run directory does not exist: ${configuredRunRoot}`,
    );
  }
  const runRoot = await realpath(configuredRunRoot);
  relativeRunPath(outputRoot, runRoot);
  const manifestPath = join(runRoot, "run-manifest.json");
  let manifest: RunManifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8")) as RunManifest;
  } catch (error) {
    throw new Error(
      `Cannot reevaluate without a readable run manifest: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const singleCaseSuite = { ...parsedSuite.data, cases: [benchmark] };
  const acceptedSuiteHashes = new Set([
    sha256Json(parsedSuite.data),
    sha256Json(singleCaseSuite),
  ]);
  if (
    manifest.schemaVersion !== 1 ||
    manifest.suiteId !== parsedSuite.data.id ||
    manifest.runId !== input.runId ||
    !acceptedSuiteHashes.has(manifest.suiteSha256)
  ) {
    throw new Error(
      "Cannot reevaluate: the benchmark suite does not match the existing run manifest",
    );
  }
  const progress = await loadRunProgress({
    progressPath: join(runRoot, "suite-progress.json"),
    manifest,
    resumed: true,
  });
  const ledger = progress.attempts;
  const completed = ledger.filter(
    (entry): entry is BenchmarkAttemptLedgerEntry & { reportPath: string } =>
      entry.caseId === benchmark.id &&
      entry.event === "completed" &&
      typeof entry.reportPath === "string",
  );
  const latest = completed.at(-1);
  if (!latest) {
    throw new Error(
      `Cannot reevaluate case '${benchmark.id}' without a completed attempt`,
    );
  }
  const caseRoot = resolve(runRoot, latest.caseRoot);
  relativeRunPath(runRoot, caseRoot);
  if ((await realpath(caseRoot)) !== caseRoot) {
    throw new Error("Cannot reevaluate a case root reached through a symlink");
  }
  const reportPath = resolve(runRoot, latest.reportPath);
  relativeRunPath(runRoot, reportPath);
  if (dirname(reportPath) !== caseRoot) {
    throw new Error(
      "Completed attempt report does not belong to its case root",
    );
  }
  let previous: BenchmarkCaseReport;
  try {
    previous = JSON.parse(
      await readFile(reportPath, "utf8"),
    ) as BenchmarkCaseReport;
  } catch (error) {
    throw new Error(
      `Cannot reevaluate case '${benchmark.id}' because its completed report is unreadable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (previous.id !== benchmark.id) {
    throw new Error(
      "Completed attempt report does not match the benchmark case",
    );
  }
  const workspace = await realpath(join(caseRoot, "workspace"));
  if (previous.workspace !== workspace) {
    throw new Error(
      "Completed attempt report does not match its persisted workspace",
    );
  }
  await assertPersistedAgentEvidence(caseRoot, previous.agent);
  const submission = await loadSubmission(workspace);
  if (
    submission.error ||
    !submission.submission ||
    submission.submission.taskId !== benchmark.id ||
    submission.artifacts.some(({ error }) => Boolean(error))
  ) {
    throw new Error(
      `Cannot reevaluate without a valid persisted submission for '${benchmark.id}': ${submission.error ?? "artifact evidence is missing or invalid"}`,
    );
  }
  const currentEvidence = submission.artifacts.flatMap(({ evidence }) =>
    evidence ? [evidence] : [],
  );
  if (!sameArtifactEvidence(previous.evaluation.artifacts, currentEvidence)) {
    throw new Error(
      "Cannot reevaluate because the persisted workspace artifacts changed after the original evaluation",
    );
  }
  const productReadback = benchmark.execution
    ? await recapturePersistedProductReadback({
        benchmark,
        caseRoot,
        workspace,
      })
    : undefined;
  const execution = await evaluateProductExecution(
    benchmark,
    previous.agent,
    productReadback,
  );
  const evaluation = await evaluateSubmission({ benchmark, workspace });
  const outcome = createOutcomeResult({
    benchmark,
    agentStatus: previous.agent.status,
    evaluationStatus: evaluation.status,
    executionStatus: execution.status,
    score: evaluation.score,
  });
  const report: BenchmarkCaseReport = {
    id: benchmark.id,
    workspace,
    ...(previous.inputFixture ? { inputFixture: previous.inputFixture } : {}),
    status: outcome.status === "achieved" ? "pass" : "fail",
    attempt: previous.attempt ?? latest.attempt,
    agent: previous.agent,
    execution,
    evaluation,
    outcome,
  };
  report.failure = classifyCaseFailure(report);

  const suiteReportPath = join(runRoot, "suite-report.json");
  let suiteReport: BenchmarkSuiteReport;
  try {
    suiteReport = JSON.parse(
      await readFile(suiteReportPath, "utf8"),
    ) as BenchmarkSuiteReport;
  } catch (error) {
    throw new Error(
      `Cannot reevaluate without a readable suite report: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (
    suiteReport.schemaVersion !== 1 ||
    suiteReport.suiteId !== manifest.suiteId ||
    suiteReport.runId !== manifest.runId ||
    !suiteReport.cases.some(({ id }) => id === benchmark.id)
  ) {
    throw new Error(
      "Cannot reevaluate: suite report does not match the run manifest",
    );
  }
  const cases = suiteReport.cases.map((candidate) =>
    candidate.id === benchmark.id ? report : candidate,
  );
  const updatedSuiteReport: BenchmarkSuiteReport = {
    ...suiteReport,
    status: suiteStatus(cases),
    finishedAt: new Date().toISOString(),
    cases,
  };
  await writeJsonAtomically(join(caseRoot, "evaluation.json"), evaluation);
  await writeJsonAtomically(join(caseRoot, "execution.json"), execution);
  await writeJsonAtomically(join(caseRoot, "outcome-result.json"), outcome);
  await writeJsonAtomically(reportPath, report);
  await writeJsonAtomically(suiteReportPath, updatedSuiteReport);
  await writeSuiteGallery({ report: updatedSuiteReport, runRoot });
  return report;
}
