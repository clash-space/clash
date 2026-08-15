import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, open, readdir, realpath, unlink } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import { verifyWorkspaceBundleDirectory } from "@clash/shared-runtime";

import type { BenchmarkEnvironmentFileEvidence } from "./environment";
import type { AgentRunReport, BenchmarkEnvironmentTrack } from "./types";

export type BenchmarkAttemptFileEvidence = BenchmarkEnvironmentFileEvidence;

export type BenchmarkAttemptTreeEvidence = BenchmarkAttemptFileEvidence & {
  entries: BenchmarkAttemptFileEvidence[];
  files: number;
};

export type BenchmarkAttemptWorkspaceEvidence = BenchmarkAttemptTreeEvidence & {
  bundleDigest: string;
  format: "clash.workspace.bundle";
  projectId: string;
  scope: "attempt" | "suite";
};

export type BenchmarkAttemptWorkspaceSlot =
  | { status: "captured"; evidence: BenchmarkAttemptWorkspaceEvidence }
  | { status: "blocked" | "failed" | "not-admitted" };

export type BenchmarkAttemptManifest = {
  schemaVersion: 1;
  kind: "clash.benchmark.attempt";
  attempt: {
    suiteId: string;
    runId: string;
    caseId: string;
    attempt: number;
    track: BenchmarkEnvironmentTrack;
    status: AgentRunReport["status"];
    startedAt: string;
    finishedAt: string;
  };
  evidence: {
    task: BenchmarkAttemptFileEvidence;
    environmentLock: BenchmarkAttemptFileEvidence;
    workspaces: {
      input: BenchmarkAttemptWorkspaceSlot;
      modified: BenchmarkAttemptWorkspaceSlot;
    };
    trajectories: {
      native: {
        adapter: "codex" | "claude" | "pi" | "command";
        evidence: BenchmarkAttemptFileEvidence;
      };
      normalized: BenchmarkAttemptFileEvidence;
      atif?: BenchmarkAttemptFileEvidence;
    };
    otlp: {
      trace: BenchmarkAttemptFileEvidence;
      receipt: BenchmarkAttemptFileEvidence;
    };
    readback: BenchmarkAttemptFileEvidence[];
    logs: BenchmarkAttemptFileEvidence[];
  };
  excluded: Array<{
    path: string;
    reason:
      | "machine-local-runner-state"
      | "runner-working-copy"
      | "runner-working-state"
      | "sibling-attempt-history-not-part-of-this-attempt";
  }>;
  integrity: {
    algorithm: "sha256";
    scope: "canonical-json-without-integrity";
    attemptDigest: string;
  };
};

export type BenchmarkAttemptManifestReceipt = BenchmarkAttemptFileEvidence & {
  path: "attempt.json";
  attemptDigest: string;
};

export type WriteBenchmarkAttemptManifestInput = {
  caseRoot: string;
  suiteRoot: string;
};

/** Canonical name for the immutable, score-free rollout record. */
export type BenchmarkAttempt = BenchmarkAttemptManifest;
/** Canonical receipt for an immutable Attempt publication. */
export type BenchmarkAttemptReceipt = BenchmarkAttemptManifestReceipt;
/** Canonical input for publishing an immutable Attempt. */
export type WriteBenchmarkAttemptInput = WriteBenchmarkAttemptManifestInput;

export type BenchmarkAttemptVerification = Readonly<{
  record: BenchmarkAttempt;
  receipt: BenchmarkAttemptReceipt;
}>;

type JsonRecord = Record<string, unknown>;

const MANIFEST_PATH = "attempt.json" as const;
const SHA256 = /^[a-f0-9]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u;
const EVALUATION_ROOT_FILES = [
  "case-report.json",
  "evaluation.json",
  "execution.json",
  "outcome-result.json",
  "quality-review-request.json",
  "quality-review-result.json",
  "quality-review.json",
] as const;
const EVALUATION_OUTPUT_PATHS = [
  ...EVALUATION_ROOT_FILES,
  "quality-review-private",
  "evaluation-evidence",
  "evaluations",
  "aggregates",
  "rewards",
  "result-bundle.json",
] as const;
const READBACK_ROOT_FILE =
  /^(?:asset|director|product|remotion|timeline)-readback\.json$/u;
const ATIF_PATHS = ["logs/trajectory.atif.json", "trajectory.atif.json"];

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => compareText(left, right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

function canonicalJson(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(canonicalize(value), null, 2)}\n`);
}

function hash(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonRecord;
}

function assertExactKeys(
  value: JsonRecord,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort(compareText);
  const canonicalExpected = [...expected].sort(compareText);
  if (JSON.stringify(actual) !== JSON.stringify(canonicalExpected)) {
    throw new Error(`${label} has unsupported fields`);
  }
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  return value;
}

function safeId(value: unknown, label: string): string {
  const parsed = string(value, label);
  if (!SAFE_ID.test(parsed))
    throw new Error(`${label} must be a safe public id`);
  return parsed;
}

function safeRelativePath(value: unknown, label: string): string {
  const path = string(value, label);
  const segments = path.split("/");
  if (
    path.length === 0 ||
    path.length > 2_000 ||
    path.includes("\\") ||
    path.includes("\0") ||
    isAbsolute(path) ||
    /^[A-Za-z]:/u.test(path) ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`${label} must be a safe relative path`);
  }
  return path;
}

function isNodeError(
  error: unknown,
  code: string,
): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

async function canonicalDirectory(
  path: string,
  label: string,
): Promise<string> {
  const direct = await lstat(path);
  if (direct.isSymbolicLink() || !direct.isDirectory()) {
    throw new Error(`${label} must be a real directory`);
  }
  return realpath(path);
}

async function inspectFile(
  root: string,
  relativePath: string,
  collect = false,
): Promise<{ evidence: BenchmarkAttemptFileEvidence; contents?: Buffer }> {
  const path = safeRelativePath(relativePath, "Attempt evidence path");
  const segments = path.split("/");
  let cursor = root;
  for (const segment of segments.slice(0, -1)) {
    cursor = join(cursor, segment);
    const info = await lstat(cursor);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error(
        `Attempt evidence must not traverse symbolic links: ${path}`,
      );
    }
  }
  const absolutePath = join(root, ...segments);
  let handle;
  try {
    handle = await open(
      absolutePath,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
  } catch (error) {
    if (isNodeError(error, "ELOOP")) {
      throw new Error(`Attempt evidence must not be a symbolic link: ${path}`);
    }
    throw error;
  }
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1) {
      throw new Error(
        `Attempt evidence must be one regular unlinked file: ${path}`,
      );
    }
    const digest = createHash("sha256");
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const value of handle.createReadStream({ autoClose: false })) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      bytes += chunk.byteLength;
      digest.update(chunk);
      if (collect) chunks.push(chunk);
    }
    const [after, pathInfo] = await Promise.all([
      handle.stat(),
      lstat(absolutePath),
    ]);
    if (
      bytes !== before.size ||
      after.size !== before.size ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.nlink !== 1 ||
      pathInfo.isSymbolicLink() ||
      !pathInfo.isFile() ||
      pathInfo.nlink !== 1 ||
      pathInfo.dev !== before.dev ||
      pathInfo.ino !== before.ino
    ) {
      throw new Error(
        `Attempt evidence changed or became linked while read: ${path}`,
      );
    }
    return {
      evidence: { path, bytes, sha256: digest.digest("hex") },
      ...(collect ? { contents: Buffer.concat(chunks) } : {}),
    };
  } finally {
    await handle.close();
  }
}

async function readJsonEvidence(root: string, path: string, label: string) {
  const inspected = await inspectFile(root, path, true);
  try {
    return {
      evidence: inspected.evidence,
      value: JSON.parse(inspected.contents!.toString("utf8")) as unknown,
    };
  } catch (error) {
    throw new Error(`${label} must contain JSON`, { cause: error });
  }
}

function declaredEvidence(
  value: unknown,
  label: string,
): BenchmarkAttemptFileEvidence {
  const item = record(value, label);
  assertExactKeys(item, ["path", "bytes", "sha256"], label);
  const path = safeRelativePath(item.path, `${label} path`);
  if (!Number.isSafeInteger(item.bytes) || (item.bytes as number) < 0) {
    throw new Error(`${label} bytes must be a non-negative safe integer`);
  }
  if (typeof item.sha256 !== "string" || !SHA256.test(item.sha256)) {
    throw new Error(`${label} sha256 must be a lowercase SHA-256 digest`);
  }
  return { path, bytes: item.bytes as number, sha256: item.sha256 };
}

function declaredEvidenceArray(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  const parsed = value.map((item, index) =>
    declaredEvidence(item, `${label}[${index}]`),
  );
  const paths = new Set<string>();
  for (const item of parsed) {
    if (paths.has(item.path))
      throw new Error(`${label} contains duplicate path ${item.path}`);
    paths.add(item.path);
  }
  return parsed;
}

async function verifyDeclaredEvidence(
  root: string,
  declared: BenchmarkAttemptFileEvidence,
): Promise<BenchmarkAttemptFileEvidence> {
  const actual = (await inspectFile(root, declared.path)).evidence;
  if (actual.bytes !== declared.bytes || actual.sha256 !== declared.sha256) {
    throw new Error(
      `Declared Attempt evidence does not match ${declared.path}`,
    );
  }
  return actual;
}

async function scanDirectoryFiles(
  root: string,
  relativeRoot: string,
): Promise<BenchmarkAttemptFileEvidence[]> {
  const output: BenchmarkAttemptFileEvidence[] = [];
  const visit = async (relativeDirectory: string): Promise<void> => {
    const absoluteDirectory = relativeDirectory
      ? join(root, ...relativeDirectory.split("/"))
      : root;
    const info = await lstat(absoluteDirectory);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error(
        `Attempt evidence tree must be a real directory: ${relativeDirectory}`,
      );
    }
    const before = (await readdir(absoluteDirectory)).sort(compareText);
    for (const name of before) {
      const path = relativeDirectory ? `${relativeDirectory}/${name}` : name;
      const child = await lstat(join(absoluteDirectory, name));
      if (child.isSymbolicLink()) {
        throw new Error(
          `Attempt evidence tree must not contain symbolic links: ${path}`,
        );
      }
      if (child.isDirectory()) {
        await visit(path);
      } else if (child.isFile()) {
        output.push((await inspectFile(root, path)).evidence);
      } else {
        throw new Error(
          `Attempt evidence tree contains a non-regular entry: ${path}`,
        );
      }
    }
    const after = (await readdir(absoluteDirectory)).sort(compareText);
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      throw new Error(
        `Attempt evidence tree changed while read: ${relativeDirectory}`,
      );
    }
  };
  await visit(relativeRoot);
  return output.sort((left, right) => compareText(left.path, right.path));
}

async function workspaceEvidence(input: {
  root: string;
  path: string;
  scope: "attempt" | "suite";
  expected: JsonRecord;
}): Promise<BenchmarkAttemptWorkspaceEvidence> {
  const path = safeRelativePath(input.path, "Workspace bundle path");
  let cursor = input.root;
  for (const segment of path.split("/")) {
    cursor = join(cursor, segment);
    const info = await lstat(cursor);
    if (info.isSymbolicLink()) {
      throw new Error(
        `Workspace bundle path must not contain symbolic links: ${path}`,
      );
    }
  }
  const verified = await verifyWorkspaceBundleDirectory(cursor);
  const expectedDigest = string(
    input.expected.bundleDigest,
    "Workspace bundle digest",
  );
  const expectedProjectId = string(
    input.expected.projectId,
    "Workspace project id",
  );
  if (
    verified.manifest.integrity.bundleDigest !== expectedDigest ||
    verified.manifest.source.projectId !== expectedProjectId
  ) {
    throw new Error(
      `Workspace bundle identity does not match Environment result: ${path}`,
    );
  }
  const absoluteEntries = await scanDirectoryFiles(cursor, "");
  const entries = absoluteEntries.map((entry) => ({ ...entry }));
  const bytes = entries.reduce((total, entry) => total + entry.bytes, 0);
  return {
    path,
    scope: input.scope,
    format: "clash.workspace.bundle",
    projectId: expectedProjectId,
    bundleDigest: expectedDigest,
    entries,
    files: entries.length,
    bytes,
    sha256: hash(canonicalJson(entries)),
  };
}

function requiredPath(
  items: BenchmarkAttemptFileEvidence[],
  path: string,
): BenchmarkAttemptFileEvidence {
  const found = items.find((item) => item.path === path);
  if (!found)
    throw new Error(`Environment result is missing required ${path} evidence`);
  return found;
}

async function optionalPathExists(
  root: string,
  path: string,
): Promise<boolean> {
  try {
    await lstat(join(root, ...path.split("/")));
    return true;
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return false;
    throw error;
  }
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function publishManifest(caseRoot: string, bytes: Buffer): Promise<void> {
  const manifestPath = join(caseRoot, MANIFEST_PATH);
  const temporaryPath = join(caseRoot, `.attempt.${randomUUID()}.tmp`);
  let temporaryExists = false;
  let created = false;
  try {
    const handle = await open(
      temporaryPath,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    temporaryExists = true;
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await link(temporaryPath, manifestPath);
      created = true;
    } catch (error) {
      if (!isNodeError(error, "EEXIST")) throw error;
    }
  } finally {
    if (temporaryExists) {
      try {
        await unlink(temporaryPath);
      } catch (error) {
        if (!isNodeError(error, "ENOENT")) throw error;
      }
    }
  }
  if (created) await syncDirectory(caseRoot);
  const existing = await inspectFile(caseRoot, MANIFEST_PATH, true);
  if (!existing.contents!.equals(bytes)) {
    throw new Error("Existing attempt.json conflicts with Attempt facts");
  }
}

async function verifyWorkspaceSlot(input: {
  caseRoot: string;
  suiteRoot: string;
  value: unknown;
  label: string;
}): Promise<BenchmarkAttemptWorkspaceSlot> {
  const slot = record(input.value, input.label);
  if (slot.status !== "captured") {
    assertExactKeys(slot, ["status"], input.label);
    if (
      slot.status !== "blocked" &&
      slot.status !== "failed" &&
      slot.status !== "not-admitted"
    ) {
      throw new Error(`${input.label} status is invalid`);
    }
    return { status: slot.status };
  }
  assertExactKeys(slot, ["status", "evidence"], input.label);
  const expected = record(slot.evidence, `${input.label} evidence`);
  assertExactKeys(
    expected,
    [
      "path",
      "scope",
      "format",
      "projectId",
      "bundleDigest",
      "entries",
      "files",
      "bytes",
      "sha256",
    ],
    `${input.label} evidence`,
  );
  if (expected.scope !== "attempt" && expected.scope !== "suite") {
    throw new Error(`${input.label} scope is invalid`);
  }
  if (expected.format !== "clash.workspace.bundle") {
    throw new Error(`${input.label} format is invalid`);
  }
  const entries = declaredEvidenceArray(
    expected.entries,
    `${input.label} entries`,
  );
  if (
    !Number.isSafeInteger(expected.files) ||
    expected.files !== entries.length ||
    !Number.isSafeInteger(expected.bytes) ||
    (expected.bytes as number) < 0 ||
    typeof expected.sha256 !== "string" ||
    !SHA256.test(expected.sha256) ||
    typeof expected.bundleDigest !== "string" ||
    !SHA256.test(expected.bundleDigest)
  ) {
    throw new Error(`${input.label} tree evidence is invalid`);
  }
  safeId(expected.projectId, `${input.label} project id`);
  const path = safeRelativePath(expected.path, `${input.label} path`);
  const actual = await workspaceEvidence({
    root: expected.scope === "suite" ? input.suiteRoot : input.caseRoot,
    path,
    scope: expected.scope,
    expected,
  });
  if (!canonicalJson(actual).equals(canonicalJson(expected))) {
    throw new Error(`${input.label} evidence does not match Workspace bytes`);
  }
  return { status: "captured", evidence: actual };
}

/**
 * Verify an already-sealed Attempt and every rollout fact it references.
 * Later Evaluation/Aggregate/Reward files are deliberately outside this
 * verification closure and therefore cannot change the Attempt identity.
 */
export async function verifyBenchmarkAttempt(
  input: WriteBenchmarkAttemptInput,
): Promise<BenchmarkAttemptVerification> {
  const [caseRoot, suiteRoot] = await Promise.all([
    canonicalDirectory(input.caseRoot, "Attempt caseRoot"),
    canonicalDirectory(input.suiteRoot, "Attempt suiteRoot"),
  ]);
  const inspected = await readJsonEvidence(
    caseRoot,
    MANIFEST_PATH,
    "Benchmark Attempt",
  );
  const candidate = record(inspected.value, "Benchmark Attempt");
  assertExactKeys(
    candidate,
    ["schemaVersion", "kind", "attempt", "evidence", "excluded", "integrity"],
    "Benchmark Attempt",
  );
  if (
    candidate.schemaVersion !== 1 ||
    candidate.kind !== "clash.benchmark.attempt"
  ) {
    throw new Error("Benchmark Attempt has an unsupported contract");
  }

  const attempt = record(candidate.attempt, "Benchmark Attempt identity");
  assertExactKeys(
    attempt,
    [
      "suiteId",
      "runId",
      "caseId",
      "attempt",
      "track",
      "status",
      "startedAt",
      "finishedAt",
    ],
    "Benchmark Attempt identity",
  );
  safeId(attempt.suiteId, "Attempt suite id");
  safeId(attempt.runId, "Attempt run id");
  safeId(attempt.caseId, "Attempt case id");
  if (
    !Number.isSafeInteger(attempt.attempt) ||
    (attempt.attempt as number) < 1 ||
    (attempt.track !== "functional" && attempt.track !== "content-effect") ||
    (attempt.status !== "completed" &&
      attempt.status !== "failed" &&
      attempt.status !== "timed-out" &&
      attempt.status !== "spawn-error" &&
      attempt.status !== "not-run")
  ) {
    throw new Error("Benchmark Attempt identity is invalid");
  }
  string(attempt.startedAt, "Attempt startedAt");
  string(attempt.finishedAt, "Attempt finishedAt");

  const evidence = record(candidate.evidence, "Benchmark Attempt evidence");
  assertExactKeys(
    evidence,
    [
      "task",
      "environmentLock",
      "workspaces",
      "trajectories",
      "otlp",
      "readback",
      "logs",
    ],
    "Benchmark Attempt evidence",
  );
  const task = declaredEvidence(evidence.task, "Attempt task evidence");
  const environmentLock = declaredEvidence(
    evidence.environmentLock,
    "Attempt Environment lock evidence",
  );
  const trajectories = record(evidence.trajectories, "Attempt trajectories");
  assertExactKeys(
    trajectories,
    trajectories.atif === undefined
      ? ["native", "normalized"]
      : ["native", "normalized", "atif"],
    "Attempt trajectories",
  );
  const native = record(trajectories.native, "Attempt native trajectory");
  assertExactKeys(native, ["adapter", "evidence"], "Attempt native trajectory");
  if (
    native.adapter !== "codex" &&
    native.adapter !== "claude" &&
    native.adapter !== "pi" &&
    native.adapter !== "command"
  ) {
    throw new Error("Attempt native trajectory adapter is invalid");
  }
  const nativeEvidence = declaredEvidence(
    native.evidence,
    "Attempt native trajectory evidence",
  );
  const normalized = declaredEvidence(
    trajectories.normalized,
    "Attempt normalized trajectory evidence",
  );
  const atif =
    trajectories.atif === undefined
      ? undefined
      : declaredEvidence(trajectories.atif, "Attempt ATIF evidence");
  const otlp = record(evidence.otlp, "Attempt OTLP evidence");
  assertExactKeys(otlp, ["trace", "receipt"], "Attempt OTLP evidence");
  const trace = declaredEvidence(otlp.trace, "Attempt OTLP trace");
  const traceReceipt = declaredEvidence(otlp.receipt, "Attempt OTLP receipt");
  const readback = declaredEvidenceArray(
    evidence.readback,
    "Attempt readback evidence",
  );
  const logs = declaredEvidenceArray(evidence.logs, "Attempt log evidence");
  const fileEvidence = [
    task,
    environmentLock,
    nativeEvidence,
    normalized,
    ...(atif ? [atif] : []),
    trace,
    traceReceipt,
    ...readback,
    ...logs,
  ];
  const uniquePaths = new Set(fileEvidence.map(({ path }) => path));
  if (uniquePaths.size !== fileEvidence.length) {
    throw new Error("Benchmark Attempt evidence paths must be unique");
  }
  await Promise.all(
    fileEvidence.map((declared) => verifyDeclaredEvidence(caseRoot, declared)),
  );

  const workspaces = record(evidence.workspaces, "Attempt Workspaces");
  assertExactKeys(workspaces, ["input", "modified"], "Attempt Workspaces");
  await Promise.all([
    verifyWorkspaceSlot({
      caseRoot,
      suiteRoot,
      value: workspaces.input,
      label: "Attempt input Workspace",
    }),
    verifyWorkspaceSlot({
      caseRoot,
      suiteRoot,
      value: workspaces.modified,
      label: "Attempt modified Workspace",
    }),
  ]);

  const [taskJson, lockJson] = await Promise.all([
    readJsonEvidence(caseRoot, task.path, "Benchmark task"),
    readJsonEvidence(caseRoot, environmentLock.path, "Environment lock"),
  ]);
  const taskRecord = record(taskJson.value, "Benchmark task");
  const taskBenchmark = record(taskRecord.benchmark, "Benchmark task case");
  const lockRecord = record(lockJson.value, "Environment lock");
  const lockAgent = record(lockRecord.agent, "Environment lock Agent");
  if (
    taskRecord.kind !== "clash.benchmark.task" ||
    taskRecord.suiteId !== attempt.suiteId ||
    taskRecord.track !== attempt.track ||
    taskBenchmark.id !== attempt.caseId ||
    lockRecord.kind !== "clash.benchmark.environment-lock" ||
    lockAgent.adapter !== native.adapter
  ) {
    throw new Error("Attempt identity disagrees across sealed evidence");
  }

  if (!Array.isArray(candidate.excluded)) {
    throw new Error("Benchmark Attempt exclusions must be an array");
  }
  const exclusionPaths = candidate.excluded.map((value, index) => {
    const exclusion = record(value, `Attempt exclusion[${index}]`);
    assertExactKeys(
      exclusion,
      ["path", "reason"],
      `Attempt exclusion[${index}]`,
    );
    const path = safeRelativePath(
      exclusion.path,
      `Attempt exclusion[${index}] path`,
    );
    if (
      exclusion.reason !== "machine-local-runner-state" &&
      exclusion.reason !== "runner-working-copy" &&
      exclusion.reason !== "runner-working-state" &&
      exclusion.reason !== "sibling-attempt-history-not-part-of-this-attempt"
    ) {
      throw new Error(`Attempt exclusion[${index}] reason is invalid`);
    }
    return path;
  });
  if (
    new Set(exclusionPaths).size !== exclusionPaths.length ||
    JSON.stringify(exclusionPaths) !==
      JSON.stringify([...exclusionPaths].sort(compareText))
  ) {
    throw new Error("Benchmark Attempt exclusions must be unique and sorted");
  }

  const integrity = record(candidate.integrity, "Benchmark Attempt integrity");
  assertExactKeys(
    integrity,
    ["algorithm", "scope", "attemptDigest"],
    "Benchmark Attempt integrity",
  );
  const { integrity: _integrity, ...unsigned } = candidate;
  const attemptDigest = hash(canonicalJson(unsigned));
  if (
    integrity.algorithm !== "sha256" ||
    integrity.scope !== "canonical-json-without-integrity" ||
    integrity.attemptDigest !== attemptDigest
  ) {
    throw new Error("Benchmark Attempt digest does not match its facts");
  }
  const receipt: BenchmarkAttemptReceipt = {
    ...inspected.evidence,
    path: MANIFEST_PATH,
    attemptDigest,
  };
  return {
    record: candidate as BenchmarkAttempt,
    receipt,
  };
}

export async function writeBenchmarkAttemptManifest(
  input: WriteBenchmarkAttemptManifestInput,
): Promise<BenchmarkAttemptManifestReceipt> {
  const [caseRoot, suiteRoot] = await Promise.all([
    canonicalDirectory(input.caseRoot, "Attempt caseRoot"),
    canonicalDirectory(input.suiteRoot, "Attempt suiteRoot"),
  ]);
  const environmentRead = await readJsonEvidence(
    caseRoot,
    "attempt-capture.json",
    "Attempt capture",
  );
  const environment = record(environmentRead.value, "Attempt capture");
  if (
    environment.schemaVersion !== 1 ||
    environment.kind !== "clash.benchmark.attempt-capture"
  ) {
    throw new Error("Attempt capture has an unsupported contract");
  }

  const suiteId = safeId(environment.suiteId, "Attempt suite id");
  const runId = safeId(environment.runId, "Attempt run id");
  const caseId = safeId(environment.caseId, "Attempt case id");
  if (
    !Number.isSafeInteger(environment.attempt) ||
    (environment.attempt as number) < 1
  ) {
    throw new Error("Attempt number must be a positive safe integer");
  }
  if (
    environment.track !== "functional" &&
    environment.track !== "content-effect"
  ) {
    throw new Error("Attempt track is invalid");
  }
  const rollout = record(environment.rollout, "Environment rollout");
  const rolloutStatus = rollout.status;
  if (
    rolloutStatus !== "completed" &&
    rolloutStatus !== "failed" &&
    rolloutStatus !== "timed-out" &&
    rolloutStatus !== "spawn-error" &&
    rolloutStatus !== "not-run"
  ) {
    throw new Error("Attempt rollout status is invalid");
  }
  const startedAt = string(rollout.startedAt, "Attempt startedAt");
  const finishedAt = string(rollout.finishedAt, "Attempt finishedAt");
  const attempt = {
    suiteId,
    runId,
    caseId,
    attempt: environment.attempt as number,
    track: environment.track as BenchmarkEnvironmentTrack,
    status: rolloutStatus as AgentRunReport["status"],
    startedAt,
    finishedAt,
  };

  const reports = declaredEvidenceArray(
    environment.evidence,
    "Attempt capture evidence",
  );
  const trajectory = record(environment.trajectory, "Environment trajectory");
  const otlp = record(environment.otlp, "Environment OTLP");
  const declaredRaw = declaredEvidence(trajectory.raw, "Native trajectory");
  const declaredNormalized = declaredEvidence(
    trajectory.normalized,
    "Normalized trajectory",
  );
  const declaredTrace = declaredEvidence(otlp.trace, "OTLP trace");
  const declaredTraceReceipt = declaredEvidence(otlp.receipt, "OTLP receipt");
  const declaredLock = declaredEvidence(
    environment.executionLock,
    "Execution lock",
  );
  const atifState = record(environment.atif, "Environment ATIF");
  if (atifState.format !== "ATIF-v1.7") {
    throw new Error("Environment ATIF format must be ATIF-v1.7");
  }
  let declaredAtif: BenchmarkAttemptFileEvidence | undefined;
  let declaredAtifReceipt: BenchmarkAttemptFileEvidence | undefined;
  if (atifState.status === "complete") {
    if (atifState.fidelity !== "structured-projection") {
      throw new Error("Environment ATIF fidelity is invalid");
    }
    declaredAtif = declaredEvidence(
      atifState.trajectory,
      "Environment ATIF trajectory",
    );
    declaredAtifReceipt = declaredEvidence(
      atifState.receipt,
      "Environment ATIF receipt",
    );
    if (
      declaredAtif.path !== "logs/trajectory.atif.json" ||
      declaredAtifReceipt.path !== "logs/trajectory.atif-receipt.json"
    ) {
      throw new Error("Environment ATIF evidence uses non-canonical paths");
    }
  } else if (
    atifState.status !== "unsupported" &&
    atifState.status !== "not-run"
  ) {
    throw new Error("Environment ATIF status is invalid");
  }

  const declaredAttemptReports = reports.filter(
    ({ path }) => path === "task.json" || READBACK_ROOT_FILE.test(path),
  );
  const declaredAll = [
    ...declaredAttemptReports,
    declaredRaw,
    declaredNormalized,
    declaredTrace,
    declaredTraceReceipt,
    declaredLock,
    ...(declaredAtif ? [declaredAtif] : []),
    ...(declaredAtifReceipt ? [declaredAtifReceipt] : []),
  ];
  const seen = new Set<string>();
  for (const item of declaredAll) {
    if (seen.has(item.path)) {
      throw new Error(
        `Environment result assigns evidence path more than once: ${item.path}`,
      );
    }
    seen.add(item.path);
  }
  const verified = new Map<string, BenchmarkAttemptFileEvidence>();
  await Promise.all(
    declaredAll.map(async (item) => {
      verified.set(item.path, await verifyDeclaredEvidence(caseRoot, item));
    }),
  );

  const taskEvidence = requiredPath(reports, "task.json");
  if (declaredLock.path !== "environment-lock.json") {
    throw new Error("Execution lock evidence must be environment-lock.json");
  }

  const [taskRead, lockRead] = await Promise.all([
    readJsonEvidence(caseRoot, taskEvidence.path, "Benchmark task"),
    readJsonEvidence(caseRoot, declaredLock.path, "Execution lock"),
  ]);
  const task = record(taskRead.value, "Benchmark task");
  const taskBenchmark = record(task.benchmark, "Benchmark task case");
  const lock = record(lockRead.value, "Execution lock");
  if (
    task.kind !== "clash.benchmark.task" ||
    task.suiteId !== suiteId ||
    task.track !== attempt.track ||
    taskBenchmark.id !== caseId ||
    lock.kind !== "clash.benchmark.environment-lock"
  ) {
    throw new Error(
      "Attempt identity disagrees across task, lock, and Environment capture",
    );
  }
  const lockAgent = record(lock.agent, "Execution lock Agent");
  const lockedAdapter = lockAgent.adapter;
  if (
    lockedAdapter !== "codex" &&
    lockedAdapter !== "claude" &&
    lockedAdapter !== "pi" &&
    lockedAdapter !== "command"
  ) {
    throw new Error("Execution lock Agent adapter is invalid");
  }
  const adapter: "codex" | "claude" | "pi" | "command" = lockedAdapter;

  const gate = record(environment.gate, "Environment gate");
  const capture = record(environment.capture, "Environment capture");
  let inputWorkspace: BenchmarkAttemptWorkspaceSlot;
  if (environment.inputWorkspace === undefined) {
    if (gate.status !== "blocked") {
      throw new Error("A ready Attempt is missing its input Workspace bundle");
    }
    inputWorkspace = { status: "not-admitted" };
  } else {
    const expected = record(environment.inputWorkspace, "Input Workspace");
    const path = safeRelativePath(expected.path, "Input Workspace path");
    const absolute = resolve(suiteRoot, ...path.split("/"));
    if (absolute === suiteRoot || !absolute.startsWith(`${suiteRoot}/`)) {
      throw new Error("Input Workspace path must stay inside suiteRoot");
    }
    inputWorkspace = {
      status: "captured",
      evidence: await workspaceEvidence({
        root: suiteRoot,
        path,
        scope: "suite",
        expected,
      }),
    };
  }

  let modifiedWorkspace: BenchmarkAttemptWorkspaceSlot;
  if (capture.status === "complete") {
    const expected = record(
      environment.modifiedWorkspace,
      "Modified Workspace",
    );
    if (expected.path !== "modified-workspace") {
      throw new Error("Modified Workspace must use modified-workspace path");
    }
    modifiedWorkspace = {
      status: "captured",
      evidence: await workspaceEvidence({
        root: caseRoot,
        path: "modified-workspace",
        scope: "attempt",
        expected,
      }),
    };
  } else if (capture.status === "failed") {
    modifiedWorkspace = { status: "failed" };
  } else if (capture.status === "blocked") {
    modifiedWorkspace = { status: "blocked" };
  } else {
    throw new Error("Environment capture status is invalid");
  }

  const rootEntries = await readdir(caseRoot, { withFileTypes: true });
  const discoveredReadbacks = rootEntries
    .filter((entry) => entry.isFile() && READBACK_ROOT_FILE.test(entry.name))
    .map(({ name }) => name)
    .sort(compareText);
  const readback = declaredAttemptReports
    .filter(({ path }) => READBACK_ROOT_FILE.test(path))
    .map((item) => verified.get(item.path)!)
    .sort((left, right) => compareText(left.path, right.path));
  if (
    JSON.stringify(discoveredReadbacks) !==
    JSON.stringify(readback.map(({ path }) => path))
  ) {
    throw new Error(
      "Readback evidence exists but is not declared by Environment result",
    );
  }

  const atifPaths = (
    await Promise.all(
      ATIF_PATHS.map(async (path) =>
        (await optionalPathExists(caseRoot, path)) ? path : undefined,
      ),
    )
  ).filter((path): path is string => path !== undefined);
  if (atifPaths.length > 1)
    throw new Error("Attempt contains more than one ATIF trajectory");
  if (
    declaredAtif &&
    (atifPaths.length !== 1 || atifPaths[0] !== declaredAtif.path)
  ) {
    throw new Error(
      "Environment ATIF declaration does not match the Attempt trajectory",
    );
  }
  if (!declaredAtif && atifPaths.length !== 0) {
    throw new Error(
      "Attempt contains ATIF evidence while Environment marks it unavailable",
    );
  }
  const atif = declaredAtif ? verified.get(declaredAtif.path) : undefined;

  const allLogs = (await optionalPathExists(caseRoot, "logs"))
    ? await scanDirectoryFiles(caseRoot, "logs")
    : [];
  const trajectoryPaths = new Set([
    declaredRaw.path,
    declaredNormalized.path,
    ...(atif ? [atif.path] : []),
  ]);
  const logs = allLogs.filter(({ path }) => !trajectoryPaths.has(path));

  const admittedPaths = new Set([
    ...declaredAll.map(({ path }) => path),
    "attempt-capture.json",
    "case-report.json",
    "evaluation.json",
    "execution.json",
    "outcome-result.json",
    ...EVALUATION_OUTPUT_PATHS,
    ...(atif ? [atif.path] : []),
    ...allLogs.map(({ path }) => path),
    ...(modifiedWorkspace.status === "captured"
      ? [modifiedWorkspace.evidence.path]
      : []),
    MANIFEST_PATH,
  ]);
  const admittedRoots = new Set(
    [...admittedPaths].map((path) => path.split("/")[0]!),
  );
  const excluded: BenchmarkAttemptManifest["excluded"] = [
    {
      path: "attempts",
      reason: "sibling-attempt-history-not-part-of-this-attempt",
    },
    { path: "clash-home", reason: "machine-local-runner-state" },
    { path: "attempt-capture.json", reason: "runner-working-state" },
    { path: "workspace", reason: "runner-working-copy" },
  ];
  for (const entry of rootEntries) {
    if (
      admittedRoots.has(entry.name) ||
      entry.name === "attempts" ||
      entry.name === "clash-home" ||
      entry.name === "workspace"
    ) {
      continue;
    }
    excluded.push({ path: entry.name, reason: "runner-working-state" });
  }
  excluded.sort((left, right) => compareText(left.path, right.path));

  const unsigned = {
    schemaVersion: 1 as const,
    kind: "clash.benchmark.attempt" as const,
    attempt,
    evidence: {
      task: verified.get(taskEvidence.path)!,
      environmentLock: verified.get(declaredLock.path)!,
      workspaces: { input: inputWorkspace, modified: modifiedWorkspace },
      trajectories: {
        native: { adapter, evidence: verified.get(declaredRaw.path)! },
        normalized: verified.get(declaredNormalized.path)!,
        ...(atif ? { atif } : {}),
      },
      otlp: {
        trace: verified.get(declaredTrace.path)!,
        receipt: verified.get(declaredTraceReceipt.path)!,
      },
      readback,
      logs,
    },
    excluded,
  };
  const attemptDigest = hash(canonicalJson(unsigned));
  const manifest: BenchmarkAttemptManifest = {
    ...unsigned,
    integrity: {
      algorithm: "sha256",
      scope: "canonical-json-without-integrity",
      attemptDigest,
    },
  };
  const manifestBytes = canonicalJson(manifest);
  await publishManifest(caseRoot, manifestBytes);
  return {
    path: MANIFEST_PATH,
    bytes: manifestBytes.byteLength,
    sha256: hash(manifestBytes),
    attemptDigest,
  };
}

/**
 * Publish the immutable rollout facts for one benchmark attempt.
 *
 * @remarks `writeBenchmarkAttemptManifest` remains as a compatibility alias;
 * new callers should use this score-free name.
 */
export const writeBenchmarkAttempt = writeBenchmarkAttemptManifest;
