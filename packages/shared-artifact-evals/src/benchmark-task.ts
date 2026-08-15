import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, open, realpath, unlink } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import { ArtifactBenchmarkCaseSchema } from "./schemas";
import type { ArtifactBenchmarkCase, BenchmarkEnvironmentTrack } from "./types";

export type BenchmarkTaskManifest = {
  schemaVersion: 1;
  kind: "clash.benchmark.task";
  suiteId: string;
  track: BenchmarkEnvironmentTrack;
  benchmark: ArtifactBenchmarkCase;
};

export type BenchmarkTaskFileEvidence = {
  path: "task.json";
  bytes: number;
  sha256: string;
};

export type WriteBenchmarkTaskManifestInput = {
  caseRoot: string;
  suiteId: string;
  track: BenchmarkEnvironmentTrack;
  benchmark: ArtifactBenchmarkCase;
};

const SAFE_SUITE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const CREDENTIAL_VALUE =
  /(?:sk-(?:proj-)?[A-Za-z0-9_-]{16,}|clsh_[a-f0-9]{32,}|github_pat_[A-Za-z0-9_]{16,}|gh[pousr]_[A-Za-z0-9]{16,}|xox[aboprs]-[A-Za-z0-9-]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/u;

function assertCanonicalJsonValue(value: unknown, path: string): void {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new Error(`${path} must contain canonical JSON values`);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) {
        throw new Error(`${path} must contain canonical JSON values`);
      }
      assertCanonicalJsonValue(value[index], `${path}[${index}]`);
    }
    return;
  }
  if (typeof value !== "object") {
    throw new Error(`${path} must contain canonical JSON values`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${path} must contain canonical JSON values`);
  }
  for (const [key, child] of Object.entries(value)) {
    if (child === undefined) {
      throw new Error(`${path}.${key} must contain canonical JSON values`);
    }
    assertCanonicalJsonValue(child, `${path}.${key}`);
  }
}

function assertPublicBenchmark(benchmark: ArtifactBenchmarkCase): void {
  if (
    benchmark.skills.some(
      (skill) =>
        isAbsolute(skill) ||
        /^[A-Za-z]:[\\/]/u.test(skill) ||
        skill.startsWith("~") ||
        /^file:/iu.test(skill),
    )
  ) {
    throw new Error(
      "Benchmark task skill references must not contain absolute runtime paths",
    );
  }
  const visit = (value: unknown): void => {
    if (typeof value === "string") {
      if (CREDENTIAL_VALUE.test(value)) {
        throw new Error("Benchmark task must not contain credentials");
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }
    if (value && typeof value === "object") {
      for (const child of Object.values(value)) visit(child);
    }
  };
  visit(benchmark);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((child) => canonicalize(child));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

function canonicalJson(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(canonicalize(value), null, 2)}\n`);
}

function canonicalizeTransportDefault(
  benchmark: ArtifactBenchmarkCase,
): ArtifactBenchmarkCase {
  if (!benchmark.execution || benchmark.execution.transport !== undefined) {
    return benchmark;
  }
  return {
    ...benchmark,
    execution: { ...benchmark.execution, transport: "auto" },
  };
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

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function verifyExistingTask(
  taskPath: string,
  expected: Buffer,
): Promise<void> {
  let handle;
  try {
    handle = await open(taskPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (isNodeError(error, "ELOOP")) {
      throw new Error("Existing task.json must be a regular unlinked file");
    }
    throw error;
  }
  try {
    const openedInfo = await handle.stat();
    if (!openedInfo.isFile() || openedInfo.nlink !== 1) {
      throw new Error("Existing task.json must be a regular unlinked file");
    }
    const bytes = await handle.readFile();
    const pathInfo = await lstat(taskPath);
    if (
      !pathInfo.isFile() ||
      pathInfo.isSymbolicLink() ||
      pathInfo.nlink !== 1 ||
      pathInfo.dev !== openedInfo.dev ||
      pathInfo.ino !== openedInfo.ino
    ) {
      throw new Error("Existing task.json must be a regular unlinked file");
    }
    if (!bytes.equals(expected)) {
      throw new Error("Existing task.json conflicts with benchmark task");
    }
  } finally {
    await handle.close();
  }
}

function taskEvidence(bytes: Buffer): BenchmarkTaskFileEvidence {
  return {
    path: "task.json",
    bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export async function writeBenchmarkTaskManifest(
  input: WriteBenchmarkTaskManifestInput,
): Promise<BenchmarkTaskFileEvidence> {
  if (input.suiteId.length > 200 || !SAFE_SUITE_ID.test(input.suiteId)) {
    throw new Error("Benchmark suite id must be a safe public id");
  }
  assertCanonicalJsonValue(input.benchmark, "Benchmark case");
  const parsed = ArtifactBenchmarkCaseSchema.safeParse(input.benchmark);
  if (!parsed.success) {
    throw new Error(
      `Invalid benchmark case: ${parsed.error.issues[0]?.message ?? "schema validation failed"}`,
    );
  }
  const caseBytes = canonicalJson(
    canonicalizeTransportDefault(input.benchmark),
  );
  if (!caseBytes.equals(canonicalJson(parsed.data))) {
    throw new Error("Benchmark case must be preserved as exact canonical JSON");
  }
  const environmentTrack = parsed.data.execution?.environment?.track;
  if (environmentTrack !== input.track) {
    throw new Error(
      "Benchmark task track must match the benchmark Environment track",
    );
  }
  assertPublicBenchmark(parsed.data);
  const manifest: BenchmarkTaskManifest = {
    schemaVersion: 1,
    kind: "clash.benchmark.task",
    suiteId: input.suiteId,
    track: input.track,
    benchmark: parsed.data,
  };
  const bytes = canonicalJson(manifest);
  const caseRoot = await realpath(input.caseRoot);
  const rootInfo = await lstat(caseRoot);
  if (!rootInfo.isDirectory()) {
    throw new Error("Benchmark case root must be a directory");
  }
  const taskPath = join(caseRoot, "task.json");
  const temporaryPath = join(caseRoot, `.task.json.${randomUUID()}.tmp`);
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
      await link(temporaryPath, taskPath);
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
  await verifyExistingTask(taskPath, bytes);
  return taskEvidence(bytes);
}
