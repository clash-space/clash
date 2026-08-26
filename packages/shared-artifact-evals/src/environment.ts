import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { verifyWorkspaceBundleDirectory } from "@clash/shared-runtime";
import type { WorkspaceBundleManifest } from "@clash/shared-types";

import {
  summarizeTrustedCliTrace,
  writeBenchmarkOtlpTrace,
  type BenchmarkOtlpTraceReceipt,
  type TrustedCliTraceSummary,
} from "./otel";
import type { NormalizedTrajectory } from "./trajectory";
import type {
  ArtifactBenchmarkCase,
  BenchmarkAgent,
  BenchmarkCaseReport,
  BenchmarkEnvironmentTrack,
} from "./types";

export type BenchmarkEnvironmentFileEvidence = {
  path: string;
  bytes: number;
  sha256: string;
};

export type BenchmarkAttemptCapture = {
  schemaVersion: 1;
  kind: "clash.benchmark.attempt-capture";
  suiteId: string;
  runId: string;
  caseId: string;
  attempt: number;
  track: BenchmarkEnvironmentTrack;
  rollout: {
    status: BenchmarkCaseReport["agent"]["status"];
    startedAt: string;
    finishedAt: string;
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    durationMs: number;
  };
  gate: {
    status: "ready" | "blocked";
    detail: string;
  };
  capture:
    | { status: "complete" }
    | { status: "blocked" }
    | {
        status: "failed";
        error: Omit<BenchmarkEnvironmentFileEvidence, "path">;
      };
  inputWorkspace?: {
    path: string;
    format: "clash.workspace.bundle";
    bundleDigest: string;
    projectId: string;
  };
  modifiedWorkspace?: {
    path: "modified-workspace";
    format: "clash.workspace.bundle";
    bundleDigest: string;
    projectId: string;
  };
  evidence: BenchmarkEnvironmentFileEvidence[];
  trajectory: {
    raw: BenchmarkEnvironmentFileEvidence;
    normalized: BenchmarkEnvironmentFileEvidence;
  };
  atif:
    | {
        status: "complete";
        format: "ATIF-v1.7";
        fidelity: "structured-projection";
        trajectory: BenchmarkEnvironmentFileEvidence;
        receipt: BenchmarkEnvironmentFileEvidence;
        redactionCount: number;
        trainingEligible: boolean;
      }
    | {
        status: "not-run" | "unsupported";
        format: "ATIF-v1.7";
        detail: string;
      };
  otlp: {
    trace: BenchmarkEnvironmentFileEvidence;
    receipt: BenchmarkEnvironmentFileEvidence;
  };
  executionLock: BenchmarkEnvironmentFileEvidence;
};

/** @deprecated Use BenchmarkAttemptCapture. */
export type BenchmarkEnvironmentResult = BenchmarkAttemptCapture;

export type BenchmarkModifiedWorkspaceCapture =
  | { status: "complete"; path: string }
  | { status: "failed"; error: string }
  | { status: "blocked" };

export type BenchmarkWorkspaceScaffoldReceipt = {
  schemaVersion: 1;
  files: BenchmarkEnvironmentFileEvidence[];
  skillNames: string[];
};

export type WriteBenchmarkEnvironmentResultInput = {
  caseRoot: string;
  suiteId: string;
  runId: string;
  benchmark: ArtifactBenchmarkCase;
  agent: BenchmarkAgent;
  report: BenchmarkCaseReport;
  attempt: number;
  startedAt: string;
  finishedAt: string;
  inputWorkspaceBundle?: string;
  modifiedWorkspaceCapture: BenchmarkModifiedWorkspaceCapture;
  serviceVersion: string;
};

/** Canonical input for collecting the score-free facts of one Agent rollout. */
export type WriteBenchmarkAttemptCaptureInput =
  WriteBenchmarkEnvironmentResultInput;

function isInside(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return (
    fromRoot === "" ||
    (fromRoot !== ".." &&
      !fromRoot.startsWith(`..${sep}`) &&
      !isAbsolute(fromRoot))
  );
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolveHash, rejectHash) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", rejectHash);
    stream.once("end", resolveHash);
  });
  return hash.digest("hex");
}

async function collectScaffoldFiles(input: {
  workspace: string;
  skillNames: string[];
}): Promise<BenchmarkEnvironmentFileEvidence[]> {
  const roots = [
    "outcome.json",
    "OUTCOME.md",
    ".clash/headless-host-ready.json",
    ".clash/benchmark-input-fixture.json",
    ...input.skillNames.flatMap((name) => [
      `.agents/skills/${name}`,
      `.claude/skills/${name}`,
    ]),
  ];
  const files: BenchmarkEnvironmentFileEvidence[] = [];
  const visit = async (relativePath: string): Promise<void> => {
    const absolutePath = resolve(input.workspace, relativePath);
    const info = await lstat(absolutePath);
    if (info.isSymbolicLink()) {
      throw new Error(
        `Runner scaffold must not contain symlinks: ${relativePath}`,
      );
    }
    if (info.isDirectory()) {
      const entries = (await readdir(absolutePath)).sort();
      for (const entry of entries) {
        await visit(`${relativePath}/${entry}`);
      }
      return;
    }
    if (!info.isFile() || info.nlink !== 1) {
      throw new Error(
        `Runner scaffold must contain only regular non-linked files: ${relativePath}`,
      );
    }
    files.push({
      path: relativePath,
      bytes: info.size,
      sha256: await hashFile(absolutePath),
    });
  };
  for (const root of roots) {
    await visit(root).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function assertSkillNames(skillNames: string[]): string[] {
  const normalized = [...new Set(skillNames)].sort();
  for (const name of normalized) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u.test(name)) {
      throw new Error("Runner scaffold skill name must be a safe path segment");
    }
  }
  return normalized;
}

export async function captureBenchmarkWorkspaceScaffold(input: {
  workspace: string;
  skillNames: string[];
}): Promise<BenchmarkWorkspaceScaffoldReceipt> {
  const skillNames = assertSkillNames(input.skillNames);
  return {
    schemaVersion: 1,
    files: await collectScaffoldFiles({
      workspace: input.workspace,
      skillNames,
    }),
    skillNames,
  };
}

export async function removeVerifiedBenchmarkWorkspaceScaffold(input: {
  workspace: string;
  receipt: BenchmarkWorkspaceScaffoldReceipt;
}): Promise<void> {
  const skillNames = assertSkillNames(input.receipt.skillNames);
  const current = await collectScaffoldFiles({
    workspace: input.workspace,
    skillNames,
  });
  if (JSON.stringify(current) !== JSON.stringify(input.receipt.files)) {
    throw new Error(
      "Agent changed runner-owned Workspace scaffold; refusing to hide it during export",
    );
  }
  await Promise.all(
    input.receipt.files.map((file) => rm(join(input.workspace, file.path))),
  );
  await Promise.all(
    skillNames.flatMap((name) => [
      rm(join(input.workspace, ".agents", "skills", name), {
        recursive: true,
        force: true,
      }),
      rm(join(input.workspace, ".claude", "skills", name), {
        recursive: true,
        force: true,
      }),
    ]),
  );
  for (const relativePath of [
    ".agents/skills",
    ".agents",
    ".claude/skills",
    ".claude",
    ".clash",
  ]) {
    await rmdir(join(input.workspace, relativePath)).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT" && error.code !== "ENOTEMPTY") throw error;
      },
    );
  }
}

async function evidenceForFile(
  caseRoot: string,
  path: string,
): Promise<BenchmarkEnvironmentFileEvidence> {
  const canonicalRoot = await realpath(caseRoot);
  const canonicalPath = await realpath(path);
  if (!isInside(canonicalRoot, canonicalPath)) {
    throw new Error("Benchmark Environment evidence must stay inside caseRoot");
  }
  const relativePath = relative(canonicalRoot, canonicalPath)
    .split(sep)
    .join("/");
  const pathInfo = await lstat(path);
  const canonicalInfo = await stat(canonicalPath);
  if (
    pathInfo.isSymbolicLink() ||
    !pathInfo.isFile() ||
    !canonicalInfo.isFile() ||
    pathInfo.nlink !== 1
  ) {
    throw new Error(
      `Benchmark Environment evidence must be one regular non-linked file: ${relativePath}`,
    );
  }
  return {
    path: relativePath,
    bytes: canonicalInfo.size,
    sha256: await hashFile(canonicalPath),
  };
}

async function atifEvidence(input: {
  caseRoot: string;
  gateStatus: "ready" | "blocked";
  agent: BenchmarkAgent;
  report: BenchmarkCaseReport;
}): Promise<BenchmarkEnvironmentResult["atif"]> {
  if (
    input.gateStatus === "blocked" ||
    input.report.agent.status === "not-run"
  ) {
    return {
      status: "not-run",
      format: "ATIF-v1.7",
      detail: "The Agent process did not run, so no rollout was projected.",
    };
  }
  if (input.agent.adapter !== "codex" && input.agent.adapter !== "pi") {
    return {
      status: "unsupported",
      format: "ATIF-v1.7",
      detail: `ATIF structured projection is not implemented for the ${input.agent.adapter} adapter.`,
    };
  }
  if (
    input.report.failure?.classification === "infrastructure" &&
    input.report.failure.phase === "atif-projection"
  ) {
    return {
      status: "unsupported",
      format: "ATIF-v1.7",
      detail: input.report.failure.detail,
    };
  }
  const trajectoryPath = join(input.caseRoot, "logs", "trajectory.atif.json");
  const receiptPath = join(
    input.caseRoot,
    "logs",
    "trajectory.atif-receipt.json",
  );
  const [trajectory, receipt, receiptText] = await Promise.all([
    evidenceForFile(input.caseRoot, trajectoryPath),
    evidenceForFile(input.caseRoot, receiptPath),
    readFile(receiptPath, "utf8"),
  ]);
  const parsed = JSON.parse(receiptText) as Record<string, unknown>;
  if (
    parsed.schemaVersion !== 1 ||
    parsed.kind !== "clash.benchmark.atif-receipt" ||
    parsed.format !== "ATIF-v1.7" ||
    parsed.path !== "trajectory.atif.json" ||
    parsed.fidelity !== "structured-projection" ||
    !Number.isSafeInteger(parsed.redactionCount) ||
    (parsed.redactionCount as number) < 0 ||
    typeof parsed.trainingEligible !== "boolean" ||
    parsed.bytes !== trajectory.bytes ||
    parsed.sha256 !== trajectory.sha256
  ) {
    throw new Error("ATIF receipt does not match its trajectory");
  }
  return {
    status: "complete",
    format: "ATIF-v1.7",
    fidelity: "structured-projection",
    trajectory,
    receipt,
    redactionCount: parsed.redactionCount as number,
    trainingEligible: parsed.trainingEligible,
  };
}

function errorEvidence(
  error: string,
): Omit<BenchmarkEnvironmentFileEvidence, "path"> {
  return {
    bytes: Buffer.byteLength(error),
    sha256: createHash("sha256").update(error).digest("hex"),
  };
}

async function assertCapturedExecutionLock(path: string): Promise<void> {
  const value = JSON.parse(await readFile(path, "utf8")) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Benchmark Environment execution lock is invalid");
  }
  const lock = value as Record<string, unknown>;
  if (
    lock.schemaVersion !== 1 ||
    lock.kind !== "clash.benchmark.environment-lock" ||
    (lock.executionIntent !== "execute" &&
      lock.executionIntent !== "blocked-no-run") ||
    !lock.agent ||
    typeof lock.agent !== "object" ||
    Array.isArray(lock.agent)
  ) {
    throw new Error("Benchmark Environment execution lock is invalid");
  }
}

async function readNormalizedTrajectory(
  path: string,
): Promise<NormalizedTrajectory> {
  const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    (raw as { schemaVersion?: unknown }).schemaVersion !== 1 ||
    !Array.isArray((raw as { actions?: unknown }).actions)
  ) {
    throw new Error("Normalized benchmark trajectory is invalid");
  }
  return raw as NormalizedTrajectory;
}

async function writeJsonAtomically(
  path: string,
  value: unknown,
): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, path);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

function requiredEnvironment(
  benchmark: ArtifactBenchmarkCase,
): NonNullable<NonNullable<ArtifactBenchmarkCase["execution"]>["environment"]> {
  const environment = benchmark.execution?.environment;
  if (!environment) {
    throw new Error(
      `Benchmark case '${benchmark.id}' does not declare a standardized Environment`,
    );
  }
  return environment;
}

function declaredInputWorkspace(
  environment: ReturnType<typeof requiredEnvironment>,
): { path: string; bundleDigest: string } | undefined {
  if (environment.profile === "clash-agent-environment-v1") {
    return environment.initialState?.workspace;
  }
  return environment.inputWorkspace;
}

async function attemptEvidence(
  caseRoot: string,
  report: BenchmarkCaseReport,
): Promise<BenchmarkEnvironmentFileEvidence[]> {
  const readbackPaths = (await readdir(caseRoot, { withFileTypes: true }))
    .filter(
      (entry) =>
        entry.isFile() &&
        /^(?:asset|director|product|remotion|timeline)-readback\.json$/u.test(
          entry.name,
        ),
    )
    .map(({ name }) => name);
  const paths = [
    "task.json",
    ...readbackPaths,
    ...(report.execution.productReadback
      ? [report.execution.productReadback.receiptPath]
      : []),
  ];
  return await Promise.all(
    [...new Set(paths)]
      .sort()
      .map((path) => evidenceForFile(caseRoot, resolve(caseRoot, path))),
  );
}

async function readTrustedOtlpEvidence(input: {
  caseRoot: string;
  gateStatus: "ready" | "blocked";
  report: BenchmarkCaseReport;
}): Promise<{
  trustedCliTrace?: TrustedCliTraceSummary;
  productReadback?: unknown;
}> {
  const cliTracePath = join(input.caseRoot, "logs", "clash-cli-events.jsonl");
  const cliReceiptPath = join(
    input.caseRoot,
    "logs",
    "clash-cli-trace-receipt.json",
  );
  let trustedCliTrace: TrustedCliTraceSummary | undefined;
  try {
    const [traceText, receiptText] = await Promise.all([
      readFile(cliTracePath, "utf8"),
      readFile(cliReceiptPath, "utf8"),
    ]);
    await Promise.all([
      evidenceForFile(input.caseRoot, cliTracePath),
      evidenceForFile(input.caseRoot, cliReceiptPath),
    ]);
    trustedCliTrace = summarizeTrustedCliTrace({
      traceText,
      receipt: JSON.parse(receiptText) as unknown,
    });
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? (error as NodeJS.ErrnoException).code
        : undefined;
    if (
      code !== "ENOENT" ||
      (input.gateStatus === "ready" && input.report.agent.status !== "not-run")
    ) {
      throw error;
    }
  }

  let productReadback: unknown;
  const receiptPath = input.report.execution.productReadback?.receiptPath;
  if (receiptPath) {
    const path = resolve(input.caseRoot, receiptPath);
    await evidenceForFile(input.caseRoot, path);
    productReadback = JSON.parse(await readFile(path, "utf8")) as unknown;
  }
  return {
    ...(trustedCliTrace ? { trustedCliTrace } : {}),
    ...(productReadback === undefined ? {} : { productReadback }),
  };
}

export async function writeBenchmarkEnvironmentResult(
  input: WriteBenchmarkEnvironmentResultInput,
): Promise<BenchmarkEnvironmentResult> {
  const environment = requiredEnvironment(input.benchmark);
  const declaredWorkspace = declaredInputWorkspace(environment);
  const gateStatus =
    input.benchmark.execution?.preflight?.status === "blocked"
      ? "blocked"
      : "ready";
  if (gateStatus === "blocked" && input.report.agent.status !== "not-run") {
    throw new Error(
      "A blocked Environment gate requires a non-running Agent rollout",
    );
  }
  if (
    gateStatus === "blocked" &&
    input.modifiedWorkspaceCapture.status !== "blocked"
  ) {
    throw new Error(
      "A blocked Environment must not capture a modified Workspace",
    );
  }
  if (gateStatus === "ready" && !declaredWorkspace) {
    throw new Error(
      "A ready Environment requires an input Workspace declaration",
    );
  }
  if (gateStatus === "ready" && !input.inputWorkspaceBundle) {
    throw new Error("A ready Environment requires an input Workspace bundle");
  }

  let inputWorkspace: BenchmarkEnvironmentResult["inputWorkspace"];
  let inputManifest: WorkspaceBundleManifest | undefined;
  if (declaredWorkspace && input.inputWorkspaceBundle) {
    const verified = await verifyWorkspaceBundleDirectory(
      input.inputWorkspaceBundle,
    );
    if (
      verified.manifest.integrity.bundleDigest !==
      declaredWorkspace.bundleDigest
    ) {
      throw new Error(
        "Input Workspace bundle digest does not match the benchmark Environment declaration",
      );
    }
    inputWorkspace = {
      path: declaredWorkspace.path,
      format: "clash.workspace.bundle",
      bundleDigest: verified.manifest.integrity.bundleDigest,
      projectId: verified.manifest.source.projectId,
    };
    inputManifest = verified.manifest;
  }

  let modifiedWorkspace: BenchmarkEnvironmentResult["modifiedWorkspace"];
  let capture: BenchmarkEnvironmentResult["capture"];
  if (input.modifiedWorkspaceCapture.status === "complete") {
    const canonicalCaseRoot = await realpath(input.caseRoot);
    const canonicalBundle = await realpath(input.modifiedWorkspaceCapture.path);
    if (!isInside(canonicalCaseRoot, canonicalBundle)) {
      throw new Error("Modified Workspace bundle must stay inside caseRoot");
    }
    const expectedPath = join(canonicalCaseRoot, "modified-workspace");
    if (canonicalBundle !== expectedPath) {
      throw new Error(
        "Modified Workspace bundle must use the runner-owned modified-workspace path",
      );
    }
    const verified = await verifyWorkspaceBundleDirectory(canonicalBundle);
    if (
      inputWorkspace &&
      verified.manifest.source.projectId !== inputWorkspace.projectId
    ) {
      throw new Error(
        "Modified Workspace must preserve the input Project identity",
      );
    }
    modifiedWorkspace = {
      path: "modified-workspace",
      format: "clash.workspace.bundle",
      bundleDigest: verified.manifest.integrity.bundleDigest,
      projectId: verified.manifest.source.projectId,
    };
    capture = { status: "complete" };
  } else if (input.modifiedWorkspaceCapture.status === "failed") {
    capture = {
      status: "failed",
      error: errorEvidence(input.modifiedWorkspaceCapture.error),
    };
  } else {
    capture = { status: "blocked" };
  }

  const trajectoryPath = input.report.agent.trajectoryPath;
  if (!trajectoryPath) {
    throw new Error("Benchmark Environment requires a normalized trajectory");
  }
  const [rawTrajectory, normalizedTrajectory, trajectory, evidence] =
    await Promise.all([
      evidenceForFile(input.caseRoot, input.report.agent.stdoutPath),
      evidenceForFile(input.caseRoot, trajectoryPath),
      readNormalizedTrajectory(trajectoryPath),
      attemptEvidence(input.caseRoot, input.report),
    ]);
  const trustedOtlpEvidence = await readTrustedOtlpEvidence({
    caseRoot: input.caseRoot,
    gateStatus,
    report: input.report,
  });
  const atif = await atifEvidence({
    caseRoot: input.caseRoot,
    gateStatus,
    agent: input.agent,
    report: input.report,
  });

  const executionLockPath = join(input.caseRoot, "environment-lock.json");
  await assertCapturedExecutionLock(executionLockPath);
  const executionLockEvidence = await evidenceForFile(
    input.caseRoot,
    executionLockPath,
  );

  const otlpReceipt: BenchmarkOtlpTraceReceipt = await writeBenchmarkOtlpTrace({
    caseRoot: input.caseRoot,
    suiteId: input.suiteId,
    runId: input.runId,
    track: environment.track,
    benchmark: input.benchmark,
    agent: input.agent,
    attempt: input.attempt,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    report: input.report,
    trajectory,
    ...trustedOtlpEvidence,
    environmentTransition: {
      captureStatus: capture.status,
      ...(inputWorkspace
        ? { inputBundleDigest: inputWorkspace.bundleDigest }
        : {}),
      ...(modifiedWorkspace
        ? { modifiedBundleDigest: modifiedWorkspace.bundleDigest }
        : {}),
      executionLockSha256: executionLockEvidence.sha256,
    },
    serviceVersion: input.serviceVersion,
  });
  const traceReceiptPath = join(input.caseRoot, "trace-receipt.json");
  await writeJsonAtomically(traceReceiptPath, otlpReceipt);
  const [traceEvidence, traceReceiptEvidence] = await Promise.all([
    evidenceForFile(input.caseRoot, join(input.caseRoot, otlpReceipt.path)),
    evidenceForFile(input.caseRoot, traceReceiptPath),
  ]);

  const result: BenchmarkEnvironmentResult = {
    schemaVersion: 1,
    kind: "clash.benchmark.attempt-capture",
    suiteId: input.suiteId,
    runId: input.runId,
    caseId: input.benchmark.id,
    attempt: input.attempt,
    track: environment.track,
    rollout: {
      status: input.report.agent.status,
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
      exitCode: input.report.agent.exitCode,
      signal: input.report.agent.signal,
      durationMs: input.report.agent.durationMs,
    },
    gate: {
      status: gateStatus,
      detail:
        gateStatus === "ready"
          ? "The exact input Workspace bundle was admitted for execution."
          : "Benchmark preflight blocked execution before Workspace import.",
    },
    capture,
    ...(inputWorkspace ? { inputWorkspace } : {}),
    ...(modifiedWorkspace ? { modifiedWorkspace } : {}),
    evidence,
    trajectory: {
      raw: rawTrajectory,
      normalized: normalizedTrajectory,
    },
    atif,
    otlp: {
      trace: traceEvidence,
      receipt: traceReceiptEvidence,
    },
    executionLock: executionLockEvidence,
  };
  await writeJsonAtomically(
    join(input.caseRoot, "attempt-capture.json"),
    result,
  );
  return result;
}

/**
 * Capture the rollout facts that are sealed into `attempt.json`.
 *
 * @remarks The legacy function name remains for source compatibility; this
 * capture never contains evaluator scores or verdicts.
 */
export const writeBenchmarkAttemptCapture = writeBenchmarkEnvironmentResult;
