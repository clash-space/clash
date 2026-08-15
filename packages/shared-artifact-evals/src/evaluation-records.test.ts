import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createAggregateRecord,
  createEvaluationRecord,
  createRewardRecord,
  parseAggregateRecord,
  parseEvaluationRecord,
  parseRewardRecord,
  writeAggregateRecord,
  writeEvaluationRecord,
  writeRewardRecord,
} from "./evaluation-records";

const ATTEMPT_A = "a".repeat(64);
const ATTEMPT_B = "b".repeat(64);
const EVALUATOR_A = {
  id: "clash.functional-evaluator",
  version: "1.0.0",
  digest: "c".repeat(64),
};
const EVALUATOR_B = {
  id: "clash.content-judge",
  version: "2026-08-14",
  digest: "d".repeat(64),
};
const FUNCTIONAL_SPEC = {
  id: "asset-import-correctness",
  version: "1.0.0",
  digest: "e".repeat(64),
};
const CONTENT_SPEC = {
  id: "premium-gadget-visual-quality",
  version: "2.0.0",
  digest: "f".repeat(64),
};
const AGGREGATE_POLICY = {
  id: "all-required-dimensions",
  version: "1.0.0",
  digest: "1".repeat(64),
};
const REWARD_POLICY = {
  id: "weighted-benchmark-reward",
  version: "1.0.0",
  digest: "2".repeat(64),
};

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function functionalEvaluation(attemptDigest = ATTEMPT_A) {
  return createEvaluationRecord({
    attemptDigest,
    evaluator: EVALUATOR_A,
    spec: FUNCTIONAL_SPEC,
    dimensions: [
      {
        id: "exact-asset-identity",
        score: 100,
        verdict: "pass",
        rationale: "The Host returned the imported Asset ID.",
      },
    ],
    evidence: [
      {
        path: "readback/asset.json",
        bytes: 128,
        sha256: "3".repeat(64),
      },
    ],
  });
}

function contentEvaluation(attemptDigest = ATTEMPT_A) {
  return createEvaluationRecord({
    attemptDigest,
    evaluator: EVALUATOR_B,
    spec: CONTENT_SPEC,
    dimensions: [
      {
        id: "visual-hierarchy",
        score: 82.5,
        verdict: "pass",
        rationale: "The product remains dominant across all rendered frames.",
      },
      {
        id: "material-fidelity",
        score: 76,
        verdict: "pass",
      },
    ],
    evidence: [
      {
        path: "quality/frame-hero.png",
        bytes: 2048,
        sha256: "4".repeat(64),
      },
    ],
  });
}

describe("Evaluation records", () => {
  it("binds an immutable Evaluation to one Attempt while allowing independent dimensions", () => {
    const input = {
      attemptDigest: ATTEMPT_A,
      evaluator: EVALUATOR_A,
      spec: FUNCTIONAL_SPEC,
      dimensions: [
        {
          id: "exact-asset-identity",
          score: 100,
          verdict: "pass" as const,
        },
      ],
      evidence: [
        {
          path: "readback/asset.json",
          bytes: 128,
          sha256: "3".repeat(64),
        },
      ],
    };

    const record = createEvaluationRecord(input);
    input.dimensions[0]!.score = 0;

    expect(record).toMatchObject({
      schemaVersion: 1,
      kind: "clash.benchmark.evaluation",
      attemptDigest: ATTEMPT_A,
      evaluator: EVALUATOR_A,
      spec: FUNCTIONAL_SPEC,
      dimensions: [{ id: "exact-asset-identity", score: 100 }],
      evidence: [{ path: "readback/asset.json", bytes: 128 }],
    });
    expect(record.digest).toMatch(/^[a-f0-9]{64}$/u);
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.dimensions)).toBe(true);
    expect(Object.isFrozen(record.dimensions[0])).toBe(true);
  });

  it("gives multiple Evaluations of the same Attempt independent identities", () => {
    const functional = functionalEvaluation();
    const content = contentEvaluation();

    expect(functional.attemptDigest).toBe(ATTEMPT_A);
    expect(content.attemptDigest).toBe(ATTEMPT_A);
    expect(content.digest).not.toBe(functional.digest);
    expect(parseEvaluationRecord(functional)).toEqual(functional);
    expect(parseEvaluationRecord(content)).toEqual(content);
  });

  it("rejects an Evaluation whose scored content was changed after digesting", () => {
    const record = functionalEvaluation();

    expect(() =>
      parseEvaluationRecord({
        ...record,
        dimensions: [{ ...record.dimensions[0], score: 0 }],
      }),
    ).toThrow(/digest/i);
  });

  it("publishes canonical Evaluation JSON idempotently and rejects a conflicting object", async () => {
    const storeRoot = await mkdtemp(join(tmpdir(), "evaluation-records-"));
    roots.push(storeRoot);
    const record = functionalEvaluation();

    const created = await writeEvaluationRecord({ storeRoot, record });
    const replay = await writeEvaluationRecord({ storeRoot, record });
    const absolutePath = join(storeRoot, created.path);

    expect(created.path).toBe(`evaluations/sha256/${record.digest}.json`);
    expect(created.publication).toBe("created");
    expect(replay).toMatchObject({
      path: created.path,
      bytes: created.bytes,
      sha256: created.sha256,
      publication: "existing",
    });
    expect(parseEvaluationRecord(await readFile(absolutePath))).toEqual(record);
    expect((await stat(absolutePath)).mode & 0o222).toBe(0);

    await chmod(absolutePath, 0o600);
    await writeFile(absolutePath, "{}\n");

    await expect(writeEvaluationRecord({ storeRoot, record })).rejects.toThrow(
      /conflict/i,
    );
  });
});

describe("Evaluation Aggregate records", () => {
  it("aggregates only Evaluation digests belonging to the bound Attempt", () => {
    const functional = functionalEvaluation();
    const content = contentEvaluation();

    const aggregate = createAggregateRecord({
      attemptDigest: ATTEMPT_A,
      evaluations: [content, functional],
      policy: AGGREGATE_POLICY,
      verdict: "pass",
      score: 86.25,
    });

    expect(aggregate).toMatchObject({
      schemaVersion: 1,
      kind: "clash.benchmark.evaluation-aggregate",
      attemptDigest: ATTEMPT_A,
      policy: AGGREGATE_POLICY,
      verdict: "pass",
      score: 86.25,
    });
    expect(aggregate.evaluationDigests).toEqual(
      [functional.digest, content.digest].sort(),
    );
    expect(parseAggregateRecord(aggregate, [functional, content])).toEqual(
      aggregate,
    );
  });

  it("rejects aggregation across different Attempts", () => {
    expect(() =>
      createAggregateRecord({
        attemptDigest: ATTEMPT_A,
        evaluations: [functionalEvaluation(), contentEvaluation(ATTEMPT_B)],
        policy: AGGREGATE_POLICY,
        verdict: "fail",
        score: 49,
      }),
    ).toThrow(/same Attempt/i);
  });

  it("requires every referenced Evaluation when parsing an Aggregate", () => {
    const functional = functionalEvaluation();
    const content = contentEvaluation();
    const aggregate = createAggregateRecord({
      attemptDigest: ATTEMPT_A,
      evaluations: [functional, content],
      policy: AGGREGATE_POLICY,
      verdict: "pass",
      score: 86.25,
    });

    expect(() => parseAggregateRecord(aggregate, [functional])).toThrow(
      /referenced Evaluation/i,
    );
  });

  it("publishes Aggregate JSON under its immutable content identity", async () => {
    const storeRoot = await mkdtemp(join(tmpdir(), "aggregate-records-"));
    roots.push(storeRoot);
    const evaluations = [functionalEvaluation(), contentEvaluation()];
    const record = createAggregateRecord({
      attemptDigest: ATTEMPT_A,
      evaluations,
      policy: AGGREGATE_POLICY,
      verdict: "pass",
      score: 86.25,
    });

    const receipt = await writeAggregateRecord({
      storeRoot,
      record,
      evaluations,
    });

    expect(receipt.path).toBe(`aggregates/sha256/${record.digest}.json`);
    expect(
      parseAggregateRecord(
        await readFile(join(storeRoot, receipt.path)),
        evaluations,
      ),
    ).toEqual(record);
  });
});

describe("Reward records", () => {
  it("binds Reward policy and components to one Attempt and Aggregate", () => {
    const evaluations = [functionalEvaluation(), contentEvaluation()];
    const aggregate = createAggregateRecord({
      attemptDigest: ATTEMPT_A,
      evaluations,
      policy: AGGREGATE_POLICY,
      verdict: "pass",
      score: 86.25,
    });

    const reward = createRewardRecord({
      attemptDigest: ATTEMPT_A,
      aggregate,
      policy: REWARD_POLICY,
      components: [
        {
          id: "functional",
          value: 1,
          sourceEvaluationDigest: evaluations[0]!.digest,
        },
        {
          id: "content-quality",
          value: 0.725,
          sourceEvaluationDigest: evaluations[1]!.digest,
        },
      ],
      value: 0.8625,
    });

    expect(reward).toMatchObject({
      schemaVersion: 1,
      kind: "clash.benchmark.reward",
      attemptDigest: ATTEMPT_A,
      aggregateDigest: aggregate.digest,
      policy: REWARD_POLICY,
      value: 0.8625,
    });
    expect(parseRewardRecord(reward, aggregate)).toEqual(reward);
  });

  it("rejects a Reward that mixes an Aggregate from another Attempt", () => {
    const aggregate = createAggregateRecord({
      attemptDigest: ATTEMPT_B,
      evaluations: [functionalEvaluation(ATTEMPT_B)],
      policy: AGGREGATE_POLICY,
      verdict: "pass",
      score: 100,
    });

    expect(() =>
      createRewardRecord({
        attemptDigest: ATTEMPT_A,
        aggregate,
        policy: REWARD_POLICY,
        components: [{ id: "functional", value: 1 }],
        value: 1,
      }),
    ).toThrow(/same Attempt/i);
  });

  it("rejects a Reward component sourced from outside its Aggregate", () => {
    const functional = functionalEvaluation();
    const aggregate = createAggregateRecord({
      attemptDigest: ATTEMPT_A,
      evaluations: [functional],
      policy: AGGREGATE_POLICY,
      verdict: "pass",
      score: 100,
    });

    expect(() =>
      createRewardRecord({
        attemptDigest: ATTEMPT_A,
        aggregate,
        policy: REWARD_POLICY,
        components: [
          {
            id: "unbound",
            value: 1,
            sourceEvaluationDigest: contentEvaluation().digest,
          },
        ],
        value: 1,
      }),
    ).toThrow(/Aggregate/i);
  });

  it("publishes Reward JSON and verifies the exact Aggregate during parsing", async () => {
    const storeRoot = await mkdtemp(join(tmpdir(), "reward-records-"));
    roots.push(storeRoot);
    const evaluations = [functionalEvaluation()];
    const aggregate = createAggregateRecord({
      attemptDigest: ATTEMPT_A,
      evaluations,
      policy: AGGREGATE_POLICY,
      verdict: "pass",
      score: 100,
    });
    const otherAggregate = createAggregateRecord({
      attemptDigest: ATTEMPT_A,
      evaluations: [contentEvaluation()],
      policy: AGGREGATE_POLICY,
      verdict: "pass",
      score: 80,
    });
    const record = createRewardRecord({
      attemptDigest: ATTEMPT_A,
      aggregate,
      policy: REWARD_POLICY,
      components: [{ id: "functional", value: 1 }],
      value: 1,
    });

    const receipt = await writeRewardRecord({
      storeRoot,
      record,
      aggregate,
    });

    expect(receipt.path).toBe(`rewards/sha256/${record.digest}.json`);
    const bytes = await readFile(join(storeRoot, receipt.path));
    expect(parseRewardRecord(bytes, aggregate)).toEqual(record);
    expect(() => parseRewardRecord(bytes, otherAggregate)).toThrow(
      /Aggregate/i,
    );
  });
});
