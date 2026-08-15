import { createHash } from "node:crypto";
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type {
  BenchmarkAttemptManifest,
  BenchmarkAttemptManifestReceipt,
} from "./attempt-manifest";
import {
  createAggregateRecord,
  createEvaluationRecord,
  createRewardRecord,
  writeAggregateRecord,
  writeEvaluationRecord,
  writeRewardRecord,
  type BenchmarkEvaluationRecord,
  type EvaluationRecordReceipt,
} from "./evaluation-records";
import {
  parseBenchmarkResultBundle,
  writeBenchmarkResultBundle,
} from "./result-bundle";

const ATTEMPT_A = "a".repeat(64);
const ATTEMPT_B = "b".repeat(64);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

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

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "clash-result-bundle-"));
  roots.push(root);
  return root;
}

async function attemptEvidence(
  root: string,
  digestSeed = ATTEMPT_A,
): Promise<{
  record: BenchmarkAttemptManifest;
  receipt: BenchmarkAttemptManifestReceipt;
}> {
  const file = (path: string) => ({
    path,
    bytes: 1,
    sha256: "1".repeat(64),
  });
  const unsigned = {
    schemaVersion: 1 as const,
    kind: "clash.benchmark.attempt" as const,
    attempt: {
      suiteId: "suite-v1",
      runId: "run-v1",
      caseId: "case-v1",
      attempt: 1,
      track: "functional" as const,
      status: "completed" as const,
      startedAt: "2026-08-14T00:00:00.000Z",
      finishedAt: "2026-08-14T00:00:01.000Z",
    },
    evidence: {
      task: file("task.json"),
      environmentLock: file("environment-lock.json"),
      workspaces: {
        input: { status: "not-admitted" as const },
        modified: { status: "blocked" as const },
      },
      trajectories: {
        native: {
          adapter: "codex" as const,
          evidence: file("logs/events.jsonl"),
        },
        normalized: file("logs/trajectory.json"),
      },
      otlp: {
        trace: file("trace.otlp.json"),
        receipt: file("trace-receipt.json"),
      },
      readback: [],
      logs: [],
    },
    excluded: [],
  };
  const attemptDigest =
    digestSeed === ATTEMPT_A ? sha256(canonicalJson(unsigned)) : digestSeed;
  const record: BenchmarkAttemptManifest = {
    ...unsigned,
    integrity: {
      algorithm: "sha256",
      scope: "canonical-json-without-integrity",
      attemptDigest,
    },
  };
  const bytes = canonicalJson(record);
  await writeFile(join(root, "attempt.json"), bytes);
  return {
    record,
    receipt: {
      path: "attempt.json",
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
      attemptDigest,
    },
  };
}

async function evaluationEvidence(
  root: string,
  attemptDigest: string,
  id: string,
  score: number,
): Promise<EvaluationRecordReceipt<BenchmarkEvaluationRecord>> {
  const record = createEvaluationRecord({
    attemptDigest,
    evaluator: {
      id: `evaluator-${id}`,
      version: "1.0.0",
      digest: "2".repeat(64),
    },
    spec: {
      id: `spec-${id}`,
      version: "1.0.0",
      digest: "3".repeat(64),
    },
    dimensions: [{ id, score, verdict: score >= 50 ? "pass" : "fail" }],
    evidence: [
      { path: `readback/${id}.json`, bytes: 1, sha256: "4".repeat(64) },
    ],
  });
  return writeEvaluationRecord({ storeRoot: root, record });
}

describe("benchmark Result Bundle", () => {
  it("publishes a score-free current index for an Attempt with no Evaluations", async () => {
    const root = await fixtureRoot();
    const attempt = await attemptEvidence(root);

    const receipt = await writeBenchmarkResultBundle({
      root,
      attempt,
      evaluations: [],
    });
    const bytes = await readFile(join(root, "result-bundle.json"));
    const bundle = parseBenchmarkResultBundle(bytes);

    expect(receipt).toEqual({
      record: bundle,
      path: "result-bundle.json",
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
      resultBundleDigest: bundle.integrity.resultBundleDigest,
    });
    expect(bundle).toMatchObject({
      schemaVersion: 1,
      kind: "clash.benchmark.result-bundle",
      attempt: {
        path: "attempt.json",
        sha256: attempt.receipt.sha256,
        digest: attempt.receipt.attemptDigest,
      },
      evaluations: [],
      integrity: {
        algorithm: "sha256",
        scope: "canonical-json-without-integrity",
      },
    });
    expect(Object.keys(bundle.attempt).sort()).toEqual([
      "digest",
      "path",
      "sha256",
    ]);
    expect(JSON.stringify(bundle)).not.toMatch(/score|verdict|status/iu);
  });

  it("atomically replaces the current index when another Evaluation is added without changing the Attempt", async () => {
    const root = await fixtureRoot();
    const attempt = await attemptEvidence(root);
    const attemptBefore = await readFile(join(root, attempt.receipt.path));
    const functional = await evaluationEvidence(
      root,
      attempt.receipt.attemptDigest,
      "functional",
      100,
    );
    const first = await writeBenchmarkResultBundle({
      root,
      attempt,
      evaluations: [functional],
    });
    const content = await evaluationEvidence(
      root,
      attempt.receipt.attemptDigest,
      "content",
      82,
    );

    const second = await writeBenchmarkResultBundle({
      root,
      attempt,
      evaluations: [content, functional],
    });
    const attemptAfter = await readFile(join(root, attempt.receipt.path));

    expect(second.path).toBe(first.path);
    expect(second.resultBundleDigest).not.toBe(first.resultBundleDigest);
    expect(second.record.evaluations).toEqual(
      [functional, content]
        .map(({ path, sha256, record }) => ({
          path,
          sha256,
          digest: record.digest,
        }))
        .sort((left, right) => compareText(left.digest, right.digest)),
    );
    expect(attemptAfter).toEqual(attemptBefore);
    expect(second.record.attempt.digest).toBe(first.record.attempt.digest);
  });

  it("optionally indexes one Aggregate and Reward without copying their scores", async () => {
    const root = await fixtureRoot();
    const attempt = await attemptEvidence(root);
    const evaluation = await evaluationEvidence(
      root,
      attempt.receipt.attemptDigest,
      "functional",
      100,
    );
    const aggregateRecord = createAggregateRecord({
      attemptDigest: attempt.receipt.attemptDigest,
      evaluations: [evaluation.record],
      policy: {
        id: "all-required",
        version: "1.0.0",
        digest: "5".repeat(64),
      },
      verdict: "pass",
      score: 100,
    });
    const aggregate = await writeAggregateRecord({
      storeRoot: root,
      record: aggregateRecord,
      evaluations: [evaluation.record],
    });
    const rewardRecord = createRewardRecord({
      attemptDigest: attempt.receipt.attemptDigest,
      aggregate: aggregate.record,
      policy: {
        id: "rl-reward",
        version: "1.0.0",
        digest: "6".repeat(64),
      },
      components: [
        {
          id: "functional",
          value: 1,
          sourceEvaluationDigest: evaluation.record.digest,
        },
      ],
      value: 1,
    });
    const reward = await writeRewardRecord({
      storeRoot: root,
      record: rewardRecord,
      aggregate: aggregate.record,
    });

    const receipt = await writeBenchmarkResultBundle({
      root,
      attempt,
      evaluations: [evaluation],
      aggregate,
      reward,
    });

    expect(receipt.record.aggregate).toEqual({
      path: aggregate.path,
      sha256: aggregate.sha256,
      digest: aggregate.record.digest,
    });
    expect(receipt.record.reward).toEqual({
      path: reward.path,
      sha256: reward.sha256,
      digest: reward.record.digest,
    });
    expect(Object.keys(receipt.record.aggregate!).sort()).toEqual([
      "digest",
      "path",
      "sha256",
    ]);
    expect(JSON.stringify(receipt.record)).not.toMatch(/score|verdict/iu);
  });

  it("rejects an Evaluation belonging to another Attempt", async () => {
    const root = await fixtureRoot();
    const attempt = await attemptEvidence(root);
    const evaluation = await evaluationEvidence(
      root,
      ATTEMPT_B,
      "foreign",
      100,
    );

    await expect(
      writeBenchmarkResultBundle({
        root,
        attempt,
        evaluations: [evaluation],
      }),
    ).rejects.toThrow(/same Attempt/i);
  });

  it("rejects an Aggregate unless every referenced Evaluation is present", async () => {
    const root = await fixtureRoot();
    const attempt = await attemptEvidence(root);
    const included = await evaluationEvidence(
      root,
      attempt.receipt.attemptDigest,
      "included",
      100,
    );
    const omitted = await evaluationEvidence(
      root,
      attempt.receipt.attemptDigest,
      "omitted",
      80,
    );
    const record = createAggregateRecord({
      attemptDigest: attempt.receipt.attemptDigest,
      evaluations: [omitted.record],
      policy: {
        id: "single",
        version: "1.0.0",
        digest: "5".repeat(64),
      },
      verdict: "pass",
      score: 80,
    });
    const aggregate = await writeAggregateRecord({
      storeRoot: root,
      record,
      evaluations: [omitted.record],
    });

    await expect(
      writeBenchmarkResultBundle({
        root,
        attempt,
        evaluations: [included],
        aggregate,
      }),
    ).rejects.toThrow(/referenced Evaluation/i);
  });

  it("rejects a Reward when no Aggregate is present", async () => {
    const root = await fixtureRoot();
    const attempt = await attemptEvidence(root);
    const evaluation = await evaluationEvidence(
      root,
      attempt.receipt.attemptDigest,
      "functional",
      100,
    );
    const aggregateRecord = createAggregateRecord({
      attemptDigest: attempt.receipt.attemptDigest,
      evaluations: [evaluation.record],
      policy: {
        id: "all-required",
        version: "1.0.0",
        digest: "5".repeat(64),
      },
      verdict: "pass",
      score: 100,
    });
    const rewardRecord = createRewardRecord({
      attemptDigest: attempt.receipt.attemptDigest,
      aggregate: aggregateRecord,
      policy: {
        id: "rl-reward",
        version: "1.0.0",
        digest: "6".repeat(64),
      },
      components: [{ id: "functional", value: 1 }],
      value: 1,
    });
    const aggregate = await writeAggregateRecord({
      storeRoot: root,
      record: aggregateRecord,
      evaluations: [evaluation.record],
    });
    const reward = await writeRewardRecord({
      storeRoot: root,
      record: rewardRecord,
      aggregate: aggregate.record,
    });

    await expect(
      writeBenchmarkResultBundle({
        root,
        attempt,
        evaluations: [evaluation],
        reward,
      }),
    ).rejects.toThrow(/Aggregate/i);
  });

  it("rejects a scored record whose content no longer matches its digest", async () => {
    const root = await fixtureRoot();
    const attempt = await attemptEvidence(root);
    const evaluation = await evaluationEvidence(
      root,
      attempt.receipt.attemptDigest,
      "functional",
      100,
    );
    const tampered = {
      ...evaluation,
      record: {
        ...evaluation.record,
        dimensions: [{ ...evaluation.record.dimensions[0]!, score: 0 }],
      },
    } as EvaluationRecordReceipt<BenchmarkEvaluationRecord>;

    await expect(
      writeBenchmarkResultBundle({
        root,
        attempt,
        evaluations: [tampered],
      }),
    ).rejects.toThrow(/digest/i);
  });

  it("rejects referenced bytes changed after their immutable receipt", async () => {
    const root = await fixtureRoot();
    const attempt = await attemptEvidence(root);
    const evaluation = await evaluationEvidence(
      root,
      attempt.receipt.attemptDigest,
      "functional",
      100,
    );
    await unlink(join(root, evaluation.path));
    await writeFile(join(root, evaluation.path), "{}\n");

    await expect(
      writeBenchmarkResultBundle({
        root,
        attempt,
        evaluations: [evaluation],
      }),
    ).rejects.toThrow(/bytes|sha256|receipt|changed/i);
  });

  it("rejects an unsafe record path before it can escape the bundle root", async () => {
    const root = await fixtureRoot();
    const attempt = await attemptEvidence(root);
    const evaluation = await evaluationEvidence(
      root,
      attempt.receipt.attemptDigest,
      "functional",
      100,
    );

    await expect(
      writeBenchmarkResultBundle({
        root,
        attempt,
        evaluations: [{ ...evaluation, path: "../foreign.json" }],
      }),
    ).rejects.toThrow(/safe relative path/i);
  });

  it.each(["symbolic", "hard"] as const)(
    "rejects a %s-linked immutable record even when its bytes match",
    async (linkKind) => {
      const root = await fixtureRoot();
      const attempt = await attemptEvidence(root);
      const evaluation = await evaluationEvidence(
        root,
        attempt.receipt.attemptDigest,
        "functional",
        100,
      );
      const originalPath = join(root, evaluation.path);
      const linkSource = join(root, `${linkKind}-source.json`);
      await writeFile(linkSource, await readFile(originalPath));
      await unlink(originalPath);
      if (linkKind === "symbolic") {
        await symlink(linkSource, originalPath);
      } else {
        await link(linkSource, originalPath);
      }

      await expect(
        writeBenchmarkResultBundle({
          root,
          attempt,
          evaluations: [evaluation],
        }),
      ).rejects.toThrow(/link/i);
    },
  );

  it.each(["symbolic", "hard"] as const)(
    "refuses to replace a %s-linked current index",
    async (linkKind) => {
      const root = await fixtureRoot();
      const attempt = await attemptEvidence(root);
      const protectedPath = join(root, `${linkKind}-protected.json`);
      const protectedBytes = Buffer.from("protected\n");
      await writeFile(protectedPath, protectedBytes);
      const indexPath = join(root, "result-bundle.json");
      if (linkKind === "symbolic") {
        await symlink(protectedPath, indexPath);
      } else {
        await link(protectedPath, indexPath);
      }

      await expect(
        writeBenchmarkResultBundle({ root, attempt, evaluations: [] }),
      ).rejects.toThrow(/current index.*link/i);
      expect(await readFile(protectedPath)).toEqual(protectedBytes);
    },
  );

  it("rejects a current index whose resultBundleDigest was tampered", async () => {
    const root = await fixtureRoot();
    const attempt = await attemptEvidence(root);
    const receipt = await writeBenchmarkResultBundle({
      root,
      attempt,
      evaluations: [],
    });

    expect(() =>
      parseBenchmarkResultBundle({
        ...receipt.record,
        integrity: {
          ...receipt.record.integrity,
          resultBundleDigest: "0".repeat(64),
        },
      }),
    ).toThrow(/result bundle digest/i);
  });
});
