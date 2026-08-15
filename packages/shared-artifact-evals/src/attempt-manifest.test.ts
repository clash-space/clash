import { createHash } from "node:crypto";
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeWorkspaceBundleManifest } from "@clash/shared-runtime";
import { afterEach, describe, expect, it } from "vitest";

import {
  verifyBenchmarkAttempt,
  writeBenchmarkAttempt,
  writeBenchmarkAttemptManifest,
} from "./attempt-manifest";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function evidence(root: string, path: string) {
  const bytes = await readFile(join(root, path));
  return { path, bytes: bytes.byteLength, sha256: sha256(bytes) };
}

async function writeJson(root: string, path: string, value: unknown) {
  await mkdir(join(root, path, ".."), { recursive: true });
  await writeFile(join(root, path), `${JSON.stringify(value, null, 2)}\n`);
}

async function writeBundle(root: string, projectId: string, story: string) {
  await mkdir(join(root, "workspace"), { recursive: true });
  const snapshot = new Uint8Array([1, 2, 3, story.length]);
  await writeFile(join(root, "project.bin"), snapshot);
  await writeFile(join(root, "workspace", "story.md"), story);
  return writeWorkspaceBundleManifest(root, {
    schemaVersion: 1,
    kind: "clash.workspace.bundle",
    source: { projectId, display: { name: "Attempt fixture" } },
    content: {
      workspaceRoot: "workspace",
      project: {
        path: "project.bin",
        codec: "loro-shallow-snapshot",
        codecVersion: 1,
      },
      resources: [],
      documentBodies: [],
      textRevisions: [],
    },
    semanticRequirements: { generatorDefinitions: [], modelReferences: [] },
    files: [
      {
        path: "project.bin",
        role: "project",
        bytes: snapshot.byteLength,
        sha256: sha256(snapshot),
        mode: "0644",
      },
      {
        path: "workspace/story.md",
        role: "workspace",
        bytes: Buffer.byteLength(story),
        sha256: sha256(story),
        mode: "0644",
      },
    ],
    excluded: [],
  });
}

type Fixture = {
  root: string;
  suiteRoot: string;
  caseRoot: string;
};

async function createFixture(
  options: {
    atif?: boolean;
    evaluation?: {
      caseStatus: "pass" | "fail" | "pending-review";
      evaluationStatus: "pass" | "fail";
      evaluationScore: number;
      outcomeStatus: "achieved" | "failed" | "pending-review";
      qualityStatus: "pending" | "pass" | "fail";
    };
  } = {},
): Promise<Fixture> {
  const evaluation = options.evaluation ?? {
    caseStatus: "pass",
    evaluationStatus: "pass",
    evaluationScore: 100,
    outcomeStatus: "achieved",
    qualityStatus: "pass",
  };
  const root = await mkdtemp(join(tmpdir(), "clash-attempt-manifest-"));
  roots.push(root);
  const suiteRoot = join(root, "suite");
  const caseRoot = join(root, "attempt");
  const inputPath = "environments/base-workspace-v1";
  const modifiedPath = "modified-workspace";
  await Promise.all([
    mkdir(suiteRoot, { recursive: true }),
    mkdir(join(caseRoot, "logs"), { recursive: true }),
    mkdir(join(caseRoot, "workspace"), { recursive: true }),
    mkdir(join(caseRoot, "clash-home"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(caseRoot, "workspace", "not-in-result.txt"), "working\n"),
    writeFile(join(caseRoot, "clash-home", "not-in-result.txt"), "local\n"),
  ]);
  const [input, modified] = await Promise.all([
    writeBundle(join(suiteRoot, inputPath), "project-attempt", "input\n"),
    writeBundle(join(caseRoot, modifiedPath), "project-attempt", "modified\n"),
  ]);

  await Promise.all([
    writeJson(caseRoot, "task.json", {
      schemaVersion: 1,
      kind: "clash.benchmark.task",
      suiteId: "clash-agent-product-v1",
      track: "functional",
      benchmark: { id: "asset-import-v1" },
    }),
    writeJson(caseRoot, "environment-lock.json", {
      schemaVersion: 1,
      kind: "clash.benchmark.environment-lock",
      executionIntent: "execute",
      agent: { adapter: "codex" },
    }),
    writeJson(caseRoot, "case-report.json", {
      id: "asset-import-v1",
      attempt: 1,
      status: evaluation.caseStatus,
    }),
    writeJson(caseRoot, "evaluation.json", {
      schemaVersion: 1,
      benchmarkId: "asset-import-v1",
      status: evaluation.evaluationStatus,
      score: evaluation.evaluationScore,
    }),
    writeJson(caseRoot, "execution.json", { status: "pass" }),
    writeJson(caseRoot, "outcome-result.json", {
      schemaVersion: 1,
      caseId: "asset-import-v1",
      status: evaluation.outcomeStatus,
    }),
    writeJson(caseRoot, "product-readback.json", {
      schemaVersion: 1,
      status: "pass",
    }),
    writeJson(caseRoot, "quality-review.json", {
      required: false,
      status: evaluation.qualityStatus,
    }),
    writeJson(caseRoot, "environment-capture.json", {
      schemaVersion: 1,
      status: "complete",
      path: modifiedPath,
    }),
    writeJson(caseRoot, "logs/trajectory.json", {
      schemaVersion: 1,
      sourceTraces: [],
      actions: [],
    }),
    writeFile(join(caseRoot, "logs", "events.jsonl"), '{"type":"turn"}\n'),
    writeFile(join(caseRoot, "logs", "stderr.log"), ""),
    writeFile(join(caseRoot, "logs", "observed-events.jsonl"), "{}\n"),
    writeFile(join(caseRoot, "logs", "clash-cli-events.jsonl"), "{}\n"),
    writeJson(caseRoot, "trace.otlp.json", { resourceSpans: [] }),
    writeJson(caseRoot, "trace-receipt.json", {
      path: "trace.otlp.json",
      spans: 1,
    }),
    ...(options.atif
      ? [
          writeJson(caseRoot, "logs/trajectory.atif.json", {
            schema_version: "ATIF-v1.7",
            sessions: [],
          }),
          writeJson(caseRoot, "logs/trajectory.atif-receipt.json", {
            schemaVersion: 1,
            kind: "clash.benchmark.atif-receipt",
            format: "ATIF-v1.7",
            path: "trajectory.atif.json",
          }),
        ]
      : []),
  ]);

  const attemptEvidencePaths = ["task.json", "product-readback.json"];
  await writeJson(caseRoot, "attempt-capture.json", {
    schemaVersion: 1,
    kind: "clash.benchmark.attempt-capture",
    suiteId: "clash-agent-product-v1",
    runId: "codex-smoke-20260814",
    caseId: "asset-import-v1",
    attempt: 1,
    track: "functional",
    rollout: {
      status: "completed",
      startedAt: "2026-08-14T00:00:00.000Z",
      finishedAt: "2026-08-14T00:01:00.000Z",
    },
    gate: { status: "ready", detail: "admitted" },
    capture: { status: "complete" },
    inputWorkspace: {
      path: inputPath,
      format: "clash.workspace.bundle",
      bundleDigest: input.integrity.bundleDigest,
      projectId: "project-attempt",
    },
    modifiedWorkspace: {
      path: modifiedPath,
      format: "clash.workspace.bundle",
      bundleDigest: modified.integrity.bundleDigest,
      projectId: "project-attempt",
    },
    evidence: await Promise.all(
      attemptEvidencePaths.map((path) => evidence(caseRoot, path)),
    ),
    trajectory: {
      raw: await evidence(caseRoot, "logs/events.jsonl"),
      normalized: await evidence(caseRoot, "logs/trajectory.json"),
    },
    atif: options.atif
      ? {
          status: "complete",
          format: "ATIF-v1.7",
          fidelity: "structured-projection",
          trajectory: await evidence(caseRoot, "logs/trajectory.atif.json"),
          receipt: await evidence(
            caseRoot,
            "logs/trajectory.atif-receipt.json",
          ),
          redactionCount: 0,
          trainingEligible: true,
        }
      : {
          status: "unsupported",
          format: "ATIF-v1.7",
          detail: "This fixture does not contain an ATIF projection.",
        },
    otlp: {
      trace: await evidence(caseRoot, "trace.otlp.json"),
      receipt: await evidence(caseRoot, "trace-receipt.json"),
    },
    executionLock: await evidence(caseRoot, "environment-lock.json"),
  });
  return { root, suiteRoot, caseRoot };
}

describe("benchmark Attempt manifest", () => {
  it("keeps Attempt identity score-free and invariant across independent evaluations", async () => {
    const passed = await createFixture({
      evaluation: {
        caseStatus: "pass",
        evaluationStatus: "pass",
        evaluationScore: 100,
        outcomeStatus: "achieved",
        qualityStatus: "pass",
      },
    });
    const failed = await createFixture({
      evaluation: {
        caseStatus: "fail",
        evaluationStatus: "fail",
        evaluationScore: 7,
        outcomeStatus: "failed",
        qualityStatus: "fail",
      },
    });

    const [passedReceipt, failedReceipt] = await Promise.all([
      writeBenchmarkAttemptManifest({
        caseRoot: passed.caseRoot,
        suiteRoot: passed.suiteRoot,
      }),
      writeBenchmarkAttemptManifest({
        caseRoot: failed.caseRoot,
        suiteRoot: failed.suiteRoot,
      }),
    ]);
    const [passedAttempt, failedAttempt] = await Promise.all([
      readFile(join(passed.caseRoot, passedReceipt.path), "utf8").then(
        JSON.parse,
      ),
      readFile(join(failed.caseRoot, failedReceipt.path), "utf8").then(
        JSON.parse,
      ),
    ]);

    expect(passedReceipt.path).toBe("attempt.json");
    expect(passedAttempt.kind).toBe("clash.benchmark.attempt");
    expect(passedAttempt.attempt.status).toBe("completed");
    expect(passedAttempt.evidence).not.toHaveProperty("evaluation");
    expect(passedAttempt.evidence).not.toHaveProperty("quality");
    expect(passedAttempt.evidence).not.toHaveProperty("outcome");
    expect(JSON.stringify(passedAttempt)).not.toMatch(
      /score|passScore|verdict|qualityReview|evaluation/iu,
    );
    expect(passedAttempt.integrity.attemptDigest).toBe(
      failedAttempt.integrity.attemptDigest,
    );
  });

  it("seals every portable rollout evidence class into one canonical self-digested Attempt", async () => {
    const fixture = await createFixture({ atif: true });

    const receipt = await writeBenchmarkAttempt({
      caseRoot: fixture.caseRoot,
      suiteRoot: fixture.suiteRoot,
    });

    const manifestPath = join(fixture.caseRoot, "attempt.json");
    const bytes = await readFile(manifestPath);
    const manifest = JSON.parse(bytes.toString("utf8"));
    expect(receipt).toEqual({
      path: "attempt.json",
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
      attemptDigest: manifest.integrity.attemptDigest,
    });
    expect(manifest.kind).toBe("clash.benchmark.attempt");
    expect(manifest.attempt).toEqual({
      attempt: 1,
      caseId: "asset-import-v1",
      finishedAt: "2026-08-14T00:01:00.000Z",
      runId: "codex-smoke-20260814",
      startedAt: "2026-08-14T00:00:00.000Z",
      status: "completed",
      suiteId: "clash-agent-product-v1",
      track: "functional",
    });
    expect(manifest.evidence.task.path).toBe("task.json");
    expect(manifest.evidence.environmentLock.path).toBe(
      "environment-lock.json",
    );
    expect(manifest.evidence.workspaces.input).toMatchObject({
      status: "captured",
      evidence: {
        path: "environments/base-workspace-v1",
        projectId: "project-attempt",
        scope: "suite",
      },
    });
    expect(manifest.evidence.workspaces.modified).toMatchObject({
      status: "captured",
      evidence: { path: "modified-workspace", scope: "attempt" },
    });
    expect(manifest.evidence.workspaces.modified.evidence.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "project.bin" }),
        expect.objectContaining({ path: "workspace/story.md" }),
        expect.objectContaining({ path: "workspace.json" }),
      ]),
    );
    expect(manifest.evidence.trajectories).toMatchObject({
      native: { adapter: "codex", evidence: { path: "logs/events.jsonl" } },
      normalized: { path: "logs/trajectory.json" },
      atif: { path: "logs/trajectory.atif.json" },
    });
    expect(manifest.evidence.otlp.trace.path).toBe("trace.otlp.json");
    expect(
      manifest.evidence.readback.map(({ path }: { path: string }) => path),
    ).toEqual(["product-readback.json"]);
    expect(
      manifest.evidence.logs.map(({ path }: { path: string }) => path),
    ).toEqual([
      "logs/clash-cli-events.jsonl",
      "logs/observed-events.jsonl",
      "logs/stderr.log",
      "logs/trajectory.atif-receipt.json",
    ]);
    expect(manifest.evidence).not.toHaveProperty("evaluation");
    expect(manifest.evidence).not.toHaveProperty("quality");
    expect(manifest.evidence).not.toHaveProperty("outcome");
    expect(manifest.evidence).not.toHaveProperty("execution");
    expect(manifest.excluded).toEqual(
      expect.arrayContaining([
        {
          path: "attempts",
          reason: "sibling-attempt-history-not-part-of-this-attempt",
        },
        { path: "clash-home", reason: "machine-local-runner-state" },
        { path: "attempt-capture.json", reason: "runner-working-state" },
        { path: "environment-capture.json", reason: "runner-working-state" },
        { path: "workspace", reason: "runner-working-copy" },
      ]),
    );
    expect(bytes.toString("utf8")).toMatch(/\n$/u);
    expect(bytes.toString("utf8")).not.toContain(fixture.root);
    expect((await stat(manifestPath)).nlink).toBe(1);
  });

  it("is an atomic no-replace writer with exact idempotent replay", async () => {
    const fixture = await createFixture();
    const input = { caseRoot: fixture.caseRoot, suiteRoot: fixture.suiteRoot };

    const first = await writeBenchmarkAttemptManifest(input);
    const second = await writeBenchmarkAttemptManifest(input);

    expect(second).toEqual(first);
    expect((await stat(join(fixture.caseRoot, first.path))).nlink).toBe(1);
  });

  it("does not require an Evaluation before sealing an Attempt", async () => {
    const fixture = await createFixture();
    await unlink(join(fixture.caseRoot, "evaluation.json"));

    await expect(
      writeBenchmarkAttemptManifest({
        caseRoot: fixture.caseRoot,
        suiteRoot: fixture.suiteRoot,
      }),
    ).resolves.toMatchObject({
      path: "attempt.json",
      attemptDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
  });

  it.each(["symlink", "hardlink"])(
    "refuses a %s in admitted log evidence",
    async (kind) => {
      const fixture = await createFixture();
      const target = join(fixture.caseRoot, "logs", "stderr.log");
      await unlink(target);
      if (kind === "symlink") {
        await symlink(join(fixture.caseRoot, "logs", "events.jsonl"), target);
      } else {
        await link(join(fixture.caseRoot, "logs", "events.jsonl"), target);
      }

      await expect(
        writeBenchmarkAttemptManifest({
          caseRoot: fixture.caseRoot,
          suiteRoot: fixture.suiteRoot,
        }),
      ).rejects.toThrow(/symbolic|hard|linked|regular/iu);
    },
  );

  it("rejects an unsafe suite-relative input Workspace path", async () => {
    const fixture = await createFixture();
    const resultPath = join(fixture.caseRoot, "attempt-capture.json");
    const result = JSON.parse(await readFile(resultPath, "utf8"));
    result.inputWorkspace.path = "../outside";
    await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`);

    await expect(
      writeBenchmarkAttemptManifest({
        caseRoot: fixture.caseRoot,
        suiteRoot: fixture.suiteRoot,
      }),
    ).rejects.toThrow(/safe relative path|inside suiteRoot/iu);
  });

  it("classifies unknown non-evidence files as runner working state", async () => {
    const fixture = await createFixture();
    await writeFile(join(fixture.caseRoot, "secret-extra.txt"), "unexpected\n");

    await writeBenchmarkAttemptManifest({
      caseRoot: fixture.caseRoot,
      suiteRoot: fixture.suiteRoot,
    });

    const manifest = JSON.parse(
      await readFile(join(fixture.caseRoot, "attempt.json"), "utf8"),
    );
    expect(manifest.excluded).toContainEqual({
      path: "secret-extra.txt",
      reason: "runner-working-state",
    });
  });

  it("ignores Evaluation evidence when sealing an Attempt", async () => {
    const fixture = await createFixture();
    await writeJson(fixture.caseRoot, "quality-review-result.json", {
      schemaVersion: 1,
      kind: "clash.benchmark.quality-review-result",
    });

    await expect(
      writeBenchmarkAttemptManifest({
        caseRoot: fixture.caseRoot,
        suiteRoot: fixture.suiteRoot,
      }),
    ).resolves.toMatchObject({ path: "attempt.json" });
  });

  it("keeps the Attempt digest stable when independent Evaluation records are appended", async () => {
    const fixture = await createFixture();
    const first = await writeBenchmarkAttempt({
      caseRoot: fixture.caseRoot,
      suiteRoot: fixture.suiteRoot,
    });

    await mkdir(join(fixture.caseRoot, "evaluations", "sha256"), {
      recursive: true,
    });
    await mkdir(join(fixture.caseRoot, "aggregates", "sha256"), {
      recursive: true,
    });
    await mkdir(join(fixture.caseRoot, "rewards", "sha256"), {
      recursive: true,
    });
    await writeFile(
      join(fixture.caseRoot, "evaluations", "sha256", `${"a".repeat(64)}.json`),
      "evaluation\n",
    );
    await writeFile(
      join(fixture.caseRoot, "aggregates", "sha256", `${"b".repeat(64)}.json`),
      "aggregate\n",
    );
    await writeFile(
      join(fixture.caseRoot, "rewards", "sha256", `${"c".repeat(64)}.json`),
      "reward\n",
    );
    await writeFile(join(fixture.caseRoot, "result-bundle.json"), "result\n");

    await expect(
      writeBenchmarkAttempt({
        caseRoot: fixture.caseRoot,
        suiteRoot: fixture.suiteRoot,
      }),
    ).resolves.toEqual(first);
  });

  it("verifies sealed Attempt evidence without treating later evaluator files as rollout facts", async () => {
    const fixture = await createFixture();
    const written = await writeBenchmarkAttempt({
      caseRoot: fixture.caseRoot,
      suiteRoot: fixture.suiteRoot,
    });
    await writeFile(
      join(fixture.caseRoot, "independent-evaluation-evidence.json"),
      "evaluation-only\n",
    );

    const verified = await verifyBenchmarkAttempt({
      caseRoot: fixture.caseRoot,
      suiteRoot: fixture.suiteRoot,
    });
    expect(verified.receipt).toEqual(written);
    expect(verified.record.integrity.attemptDigest).toBe(written.attemptDigest);

    await writeFile(join(fixture.caseRoot, "task.json"), "tampered\n");
    await expect(
      verifyBenchmarkAttempt({
        caseRoot: fixture.caseRoot,
        suiteRoot: fixture.suiteRoot,
      }),
    ).rejects.toThrow(/task|evidence|match/iu);
  });

  it("rejects an ATIF file whose evidence is not exactly bound by Environment result", async () => {
    const fixture = await createFixture({ atif: true });
    const resultPath = join(fixture.caseRoot, "attempt-capture.json");
    const result = JSON.parse(await readFile(resultPath, "utf8"));
    result.atif.trajectory.sha256 = "f".repeat(64);
    await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`);

    await expect(
      writeBenchmarkAttemptManifest({
        caseRoot: fixture.caseRoot,
        suiteRoot: fixture.suiteRoot,
      }),
    ).rejects.toThrow(/ATIF|trajectory|declared.*match/iu);
  });

  it("refuses to overwrite a conflicting or linked manifest", async () => {
    const fixture = await createFixture();
    const manifestPath = join(fixture.caseRoot, "attempt.json");
    await writeFile(manifestPath, "conflict\n");

    await expect(
      writeBenchmarkAttemptManifest({
        caseRoot: fixture.caseRoot,
        suiteRoot: fixture.suiteRoot,
      }),
    ).rejects.toThrow(/conflicts/iu);
    expect(await readFile(manifestPath, "utf8")).toBe("conflict\n");

    await unlink(manifestPath);
    await link(join(fixture.caseRoot, "task.json"), manifestPath);
    await expect(
      writeBenchmarkAttemptManifest({
        caseRoot: fixture.caseRoot,
        suiteRoot: fixture.suiteRoot,
      }),
    ).rejects.toThrow(/unlinked|linked/iu);
  });
});
