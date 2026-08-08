import { createHash } from "node:crypto";
import {
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createBenchmarkFixtureManifest } from "./fixture";
import { runBenchmarkSuite } from "./runner";
import { ArtifactBenchmarkCaseSchema } from "./schemas";
import type {
  ArtifactBenchmarkCase,
  ArtifactBenchmarkSuite,
  BenchmarkAgent,
} from "./types";

function fixtureCase(
  inputFixture?: ArtifactBenchmarkCase["inputFixture"],
): ArtifactBenchmarkCase {
  return {
    id: "spoken-edit",
    title: "Spoken edit",
    category: "timeline",
    outcome: {
      objective: "Read the public input and create a report.",
      acceptanceCriteria: ["The report contains the supplied transcript."],
      deliverables: [
        {
          artifactId: "result",
          kind: "report",
          description: "Fixture-backed report",
        },
      ],
    },
    passScore: 100,
    timeoutMs: 10_000,
    skills: [],
    ...(inputFixture ? { inputFixture } : {}),
    rubric: [
      {
        id: "result-exists",
        type: "artifact-exists",
        artifactId: "result",
        kind: "report",
        weight: 1,
        required: true,
      },
    ],
  };
}

function fixtureSuite(
  benchmark: ArtifactBenchmarkCase,
): ArtifactBenchmarkSuite {
  return {
    schemaVersion: 1,
    id: "fixture-suite",
    title: "Fixture suite",
    cases: [benchmark],
  };
}

function fixtureReadingAgent(startedMarker?: string): BenchmarkAgent {
  const source = [
    'const fs = require("node:fs")',
    'const path = require("node:path")',
    "const workspace = process.env.CLASH_BENCH_WORKSPACE",
    ...(startedMarker
      ? [`fs.writeFileSync(${JSON.stringify(startedMarker)}, "started")`]
      : []),
    'const transcript = fs.readFileSync(path.join(workspace, "inputs", "transcript.txt"), "utf8")',
    'if (!fs.existsSync(path.join(workspace, "media", "speaker.raw"))) process.exit(7)',
    'if (!fs.existsSync(path.join(workspace, ".clash", "benchmark-input-fixture.json"))) process.exit(8)',
    'fs.writeFileSync(path.join(workspace, "result.txt"), transcript)',
    'fs.writeFileSync(path.join(workspace, "submission.json"), JSON.stringify({schemaVersion:1,taskId:"spoken-edit",artifacts:[{id:"result",kind:"report",path:"result.txt"}]}))',
  ].join(";");
  return { command: process.execPath, args: ["-e", source] };
}

describe("benchmark input fixtures", () => {
  it("builds a canonical sorted file manifest with path, size, and sha256", async () => {
    const fixtureRoot = await mkdtemp(
      join(tmpdir(), "clash-fixture-manifest-"),
    );
    await mkdir(join(fixtureRoot, "z"));
    await writeFile(join(fixtureRoot, "z", "speaker.raw"), "voice", "utf8");
    await writeFile(join(fixtureRoot, "brief.txt"), "hello", "utf8");

    const manifest = await createBenchmarkFixtureManifest(fixtureRoot);
    const files = [
      {
        path: "brief.txt",
        bytes: 5,
        sha256: createHash("sha256").update("hello").digest("hex"),
      },
      {
        path: "z/speaker.raw",
        bytes: 5,
        sha256: createHash("sha256").update("voice").digest("hex"),
      },
    ];
    const expectedSha256 = createHash("sha256")
      .update(JSON.stringify({ schemaVersion: 1, files }))
      .digest("hex");

    expect(manifest).toEqual({
      schemaVersion: 1,
      files,
      manifestSha256: expectedSha256,
      totalBytes: 10,
    });
  });

  it("copies verified public inputs before the agent starts and records provenance", async () => {
    const root = await mkdtemp(join(tmpdir(), "clash-fixture-run-"));
    const suiteRoot = join(root, "suite");
    const fixtureRoot = join(suiteRoot, "fixtures", "spoken-edit");
    const outputRoot = join(root, "runs");
    await mkdir(join(fixtureRoot, "inputs"), { recursive: true });
    await mkdir(join(fixtureRoot, "media"));
    await writeFile(
      join(fixtureRoot, "inputs", "transcript.txt"),
      "hello host",
      "utf8",
    );
    await writeFile(join(fixtureRoot, "media", "speaker.raw"), "voice", "utf8");
    const expected = await createBenchmarkFixtureManifest(fixtureRoot);
    const benchmark = fixtureCase({
      path: "fixtures/spoken-edit",
      manifestSha256: expected.manifestSha256,
    });

    const report = await runBenchmarkSuite({
      suite: fixtureSuite(benchmark),
      suiteRoot,
      outputRoot,
      runId: "fixture-run",
      agent: fixtureReadingAgent(),
    });

    expect(report.status).toBe("pass");
    expect(report.cases[0]?.inputFixture).toMatchObject({
      sourcePath: "fixtures/spoken-edit",
      workspacePath: ".",
      manifestSha256: expected.manifestSha256,
      totalBytes: expected.totalBytes,
      receiptPath: ".clash/benchmark-input-fixture.json",
    });
    expect(report.cases[0]?.inputFixture?.files).toEqual(expected.files);
    const workspace = report.cases[0]!.workspace;
    await expect(readFile(join(workspace, "result.txt"), "utf8")).resolves.toBe(
      "hello host",
    );
    const receipt = JSON.parse(
      await readFile(
        join(workspace, ".clash", "benchmark-input-fixture.json"),
        "utf8",
      ),
    ) as Record<string, unknown>;
    expect(receipt).toMatchObject({
      schemaVersion: 1,
      sourcePath: "fixtures/spoken-edit",
      manifestSha256: expected.manifestSha256,
    });
    const outcome = await readFile(join(workspace, "OUTCOME.md"), "utf8");
    expect(outcome).toContain("public input fixture");
    expect(outcome).toContain("fixtures/spoken-edit");
    expect(outcome).not.toContain("result-exists");
  });

  it("rejects a mismatched manifest before starting the agent", async () => {
    const root = await mkdtemp(join(tmpdir(), "clash-fixture-mismatch-"));
    const suiteRoot = join(root, "suite");
    const fixtureRoot = join(suiteRoot, "fixtures", "spoken-edit");
    const outputRoot = join(root, "runs");
    const startedMarker = join(root, "agent-started");
    await mkdir(join(fixtureRoot, "inputs"), { recursive: true });
    await mkdir(join(fixtureRoot, "media"));
    await writeFile(
      join(fixtureRoot, "inputs", "transcript.txt"),
      "tampered",
      "utf8",
    );
    await writeFile(join(fixtureRoot, "media", "speaker.raw"), "voice", "utf8");

    const report = await runBenchmarkSuite({
      suite: fixtureSuite(
        fixtureCase({
          path: "fixtures/spoken-edit",
          manifestSha256: "0".repeat(64),
        }),
      ),
      suiteRoot,
      outputRoot,
      runId: "fixture-mismatch",
      agent: fixtureReadingAgent(startedMarker),
      maxInfrastructureAttempts: 1,
    });

    expect(report.cases[0]).toMatchObject({
      status: "fail",
      agent: { status: "not-run" },
      failure: {
        classification: "infrastructure",
        phase: "runner",
      },
    });
    expect(report.cases[0]?.failure?.detail).toMatch(
      /manifest sha256 mismatch/i,
    );
    await expect(lstat(startedMarker)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects path escapes, symbolic links, and runner-owned fixture paths", async () => {
    expect(
      ArtifactBenchmarkCaseSchema.safeParse({
        ...fixtureCase(),
        inputFixture: {
          path: "../private-gold",
          manifestSha256: "0".repeat(64),
        },
      }).success,
    ).toBe(false);

    const root = await mkdtemp(join(tmpdir(), "clash-fixture-unsafe-"));
    const suiteRoot = join(root, "suite");
    const symlinkFixture = join(suiteRoot, "fixtures", "symlinked");
    const reservedFixture = join(suiteRoot, "fixtures", "reserved");
    const outputRoot = join(root, "runs");
    await mkdir(symlinkFixture, { recursive: true });
    await writeFile(join(root, "private-gold.txt"), "gold", "utf8");
    await symlink(
      join(root, "private-gold.txt"),
      join(symlinkFixture, "gold.txt"),
    );
    await expect(
      createBenchmarkFixtureManifest(symlinkFixture),
    ).rejects.toThrow(/symbolic link/i);

    await mkdir(reservedFixture, { recursive: true });
    await writeFile(join(reservedFixture, "OUTCOME.md"), "replace me", "utf8");
    const reservedManifest =
      await createBenchmarkFixtureManifest(reservedFixture);
    const report = await runBenchmarkSuite({
      suite: fixtureSuite(
        fixtureCase({
          path: "fixtures/reserved",
          manifestSha256: reservedManifest.manifestSha256,
        }),
      ),
      suiteRoot,
      outputRoot,
      runId: "reserved-fixture",
      agent: fixtureReadingAgent(),
      maxInfrastructureAttempts: 1,
    });
    expect(report.cases[0]?.failure?.detail).toMatch(
      /runner-owned path.*OUTCOME\.md/i,
    );
  });

  it("rejects an empty runner-owned directory that is absent from the file manifest", async () => {
    const root = await mkdtemp(join(tmpdir(), "clash-fixture-reserved-dir-"));
    const suiteRoot = join(root, "suite");
    const fixtureRoot = join(suiteRoot, "fixtures", "reserved-dir");
    const outputRoot = join(root, "runs");
    await mkdir(join(fixtureRoot, ".agents"), { recursive: true });
    const manifest = await createBenchmarkFixtureManifest(fixtureRoot);

    const report = await runBenchmarkSuite({
      suite: fixtureSuite(
        fixtureCase({
          path: "fixtures/reserved-dir",
          manifestSha256: manifest.manifestSha256,
        }),
      ),
      suiteRoot,
      outputRoot,
      runId: "reserved-directory-fixture",
      agent: fixtureReadingAgent(),
      maxInfrastructureAttempts: 1,
    });

    expect(report.cases[0]?.failure?.detail).toMatch(
      /runner-owned path.*\.agents/i,
    );
  });
});
