import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  cp,
  lstat,
  mkdir,
  readdir,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import type {
  BenchmarkFixtureFile,
  BenchmarkFixtureManifest,
  BenchmarkInputFixture,
  BenchmarkInputFixtureProvenance,
} from "./types";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const FIXTURE_PATH_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;
const RUNNER_OWNED_TOP_LEVEL_PATHS = new Set([
  ".agents",
  ".claude",
  ".clash",
  ".git",
  "outcome.json",
  "outcome.md",
  "submission.json",
]);

function compareNames(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function collectFixtureFiles(
  directory: string,
  prefix = "",
): Promise<BenchmarkFixtureFile[]> {
  const files: BenchmarkFixtureFile[] = [];
  const entries = (await readdir(directory, { withFileTypes: true })).sort(
    (left, right) => compareNames(left.name, right.name),
  );
  for (const entry of entries) {
    const absolutePath = join(directory, entry.name);
    const fixturePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) {
      throw new Error(
        `Benchmark input fixture contains a symbolic link: ${fixturePath}`,
      );
    }
    if (entry.isDirectory()) {
      files.push(...(await collectFixtureFiles(absolutePath, fixturePath)));
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(
        `Benchmark input fixture contains a non-regular entry: ${fixturePath}`,
      );
    }
    const metadata = await lstat(absolutePath);
    if (!metadata.isFile()) {
      throw new Error(
        `Benchmark input fixture changed while scanning: ${fixturePath}`,
      );
    }
    files.push({
      path: fixturePath,
      bytes: metadata.size,
      sha256: await sha256File(absolutePath),
    });
  }
  return files;
}

function manifestSha256(files: BenchmarkFixtureFile[]): string {
  return createHash("sha256")
    .update(JSON.stringify({ schemaVersion: 1, files }))
    .digest("hex");
}

export async function createBenchmarkFixtureManifest(
  directory: string,
): Promise<BenchmarkFixtureManifest> {
  const directoryMetadata = await lstat(directory);
  if (directoryMetadata.isSymbolicLink()) {
    throw new Error(
      "Benchmark input fixture directory must not be a symbolic link",
    );
  }
  if (!directoryMetadata.isDirectory()) {
    throw new Error("Benchmark input fixture path must be a directory");
  }
  const files = await collectFixtureFiles(directory);
  return {
    schemaVersion: 1,
    files,
    manifestSha256: manifestSha256(files),
    totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
  };
}

function assertSafeFixturePath(path: string): void {
  if (
    isAbsolute(path) ||
    !FIXTURE_PATH_PATTERN.test(path) ||
    path.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error(
      "Benchmark input fixture path must be a safe relative directory beneath suiteRoot",
    );
  }
}

function assertContained(root: string, candidate: string, label: string): void {
  const local = relative(root, candidate);
  if (
    !local ||
    local === ".." ||
    local.startsWith(`..${sep}`) ||
    isAbsolute(local)
  ) {
    throw new Error(`${label} must remain beneath suiteRoot`);
  }
}

async function assertPathSegmentsAreNotSymlinks(
  suiteRoot: string,
  fixturePath: string,
): Promise<void> {
  let current = suiteRoot;
  for (const segment of fixturePath.split("/")) {
    current = join(current, segment);
    const metadata = await lstat(current);
    if (metadata.isSymbolicLink()) {
      throw new Error(
        `Benchmark input fixture path contains a symbolic link: ${fixturePath}`,
      );
    }
  }
}

function assertNoRunnerOwnedPaths(manifest: BenchmarkFixtureManifest): void {
  for (const file of manifest.files) {
    const topLevel = file.path.split("/", 1)[0]?.toLowerCase();
    if (topLevel && RUNNER_OWNED_TOP_LEVEL_PATHS.has(topLevel)) {
      throw new Error(
        `Benchmark input fixture uses runner-owned path: ${file.path}`,
      );
    }
  }
}

async function assertNoRunnerOwnedTopLevelEntries(
  source: string,
): Promise<void> {
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (RUNNER_OWNED_TOP_LEVEL_PATHS.has(entry.name.toLowerCase())) {
      throw new Error(
        `Benchmark input fixture uses runner-owned path: ${entry.name}`,
      );
    }
  }
}

async function copyFixtureContents(
  source: string,
  workspace: string,
): Promise<void> {
  const entries = (await readdir(source, { withFileTypes: true })).sort(
    (left, right) => compareNames(left.name, right.name),
  );
  for (const entry of entries) {
    await cp(join(source, entry.name), join(workspace, entry.name), {
      recursive: true,
      dereference: false,
      errorOnExist: true,
      force: false,
    });
  }
}

export async function writeBenchmarkInputFixtureReceipt(
  workspace: string,
  provenance: BenchmarkInputFixtureProvenance,
): Promise<void> {
  const receiptPath = join(workspace, provenance.receiptPath);
  await mkdir(join(workspace, ".clash"), { recursive: true });
  await writeFile(
    receiptPath,
    `${JSON.stringify(provenance, null, 2)}\n`,
    "utf8",
  );
}

export async function installBenchmarkInputFixture(input: {
  suiteRoot: string;
  workspace: string;
  fixture: BenchmarkInputFixture;
}): Promise<BenchmarkInputFixtureProvenance> {
  assertSafeFixturePath(input.fixture.path);
  if (!SHA256_PATTERN.test(input.fixture.manifestSha256)) {
    throw new Error(
      "Benchmark input fixture manifestSha256 must be a lowercase SHA-256 digest",
    );
  }
  const workspaceEntries = await readdir(input.workspace);
  if (workspaceEntries.length > 0) {
    throw new Error(
      "Benchmark input fixture must be installed into a fresh empty workspace",
    );
  }
  await assertPathSegmentsAreNotSymlinks(input.suiteRoot, input.fixture.path);
  const sourceCandidate = resolve(input.suiteRoot, input.fixture.path);
  assertContained(input.suiteRoot, sourceCandidate, "Benchmark input fixture");
  const source = await realpath(sourceCandidate);
  assertContained(input.suiteRoot, source, "Benchmark input fixture");
  if (!(await stat(source)).isDirectory()) {
    throw new Error("Benchmark input fixture path must be a directory");
  }

  await assertNoRunnerOwnedTopLevelEntries(source);
  const sourceManifest = await createBenchmarkFixtureManifest(source);
  if (sourceManifest.manifestSha256 !== input.fixture.manifestSha256) {
    throw new Error(
      `Benchmark input fixture manifest sha256 mismatch: expected ${input.fixture.manifestSha256}, received ${sourceManifest.manifestSha256}`,
    );
  }
  assertNoRunnerOwnedPaths(sourceManifest);

  await copyFixtureContents(source, input.workspace);
  const copiedManifest = await createBenchmarkFixtureManifest(input.workspace);
  if (copiedManifest.manifestSha256 !== input.fixture.manifestSha256) {
    throw new Error(
      `Copied benchmark input fixture manifest sha256 mismatch: expected ${input.fixture.manifestSha256}, received ${copiedManifest.manifestSha256}`,
    );
  }

  const provenance: BenchmarkInputFixtureProvenance = {
    ...copiedManifest,
    sourcePath: input.fixture.path,
    workspacePath: ".",
    receiptPath: ".clash/benchmark-input-fixture.json",
  };
  await writeBenchmarkInputFixtureReceipt(input.workspace, provenance);
  return provenance;
}
