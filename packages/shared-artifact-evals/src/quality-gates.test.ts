import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { evaluateSubmission } from "./evaluator";
import { ArtifactBenchmarkSuiteSchema, ArtifactRubricSchema } from "./schemas";
import type { ArtifactBenchmarkCase } from "./types";

const roots: string[] = [];

function ppm(
  width: number,
  height: number,
  foreground: Array<[number, number]>,
): Buffer {
  const pixels = Buffer.alloc(width * height * 3, 245);
  for (const [x, y] of foreground) {
    const offset = (y * width + x) * 3;
    pixels[offset] = 220;
    pixels[offset + 1] = 30;
    pixels[offset + 2] = 60;
  }
  return Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), pixels]);
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("creative quality gate contracts", () => {
  it("requires every Remotion character case to reject sparse visual evidence without duplicating product scale validation", async () => {
    const suiteUrl = new URL(
      "../../../benchmarks/creative-artifacts/v2/suite.json",
      import.meta.url,
    );
    const suite = ArtifactBenchmarkSuiteSchema.parse(
      JSON.parse(await readFile(suiteUrl, "utf8")),
    );
    const cases = suite.cases.filter((benchmark) =>
      benchmark.id.startsWith("remotion-character-"),
    );

    expect(cases).toHaveLength(5);
    for (const benchmark of cases) {
      expect(
        benchmark.rubric.find((rubric) => rubric.id === "mg-timeline"),
      ).toMatchObject({ type: "timeline" });
      expect(
        benchmark.rubric.find((rubric) => rubric.id === "mg-timeline"),
      ).not.toHaveProperty("maxItemScale");
      expect(
        benchmark.rubric.find((rubric) => rubric.id === "mg-visual-poses"),
      ).toMatchObject({
        type: "visual-frames",
        foregroundCoverage: { backgroundTolerance: 24, minRatio: 0.05 },
      });
    }
  });

  it("accepts an explicit minimum foreground-coverage requirement", () => {
    const parsed = ArtifactRubricSchema.safeParse({
      id: "pose-coverage",
      type: "visual-frames",
      artifactIds: ["start", "action", "settle"],
      width: 720,
      height: 1280,
      minDistinctPairs: 2,
      minMeanAbsoluteDifference: 0.005,
      foregroundCoverage: {
        backgroundTolerance: 24,
        minRatio: 0.05,
      },
      weight: 20,
      required: true,
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects benchmark-only Timeline scale thresholds because the product contract owns them", () => {
    const parsed = ArtifactRubricSchema.safeParse({
      id: "timeline-scale",
      type: "timeline",
      artifactId: "timeline",
      maxItemScale: 4,
      weight: 10,
      required: true,
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects pose evidence whose subject occupies too little of every frame", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "quality-coverage-"));
    roots.push(workspace);
    await mkdir(join(workspace, "poses"));
    const poses: Array<Array<[number, number]>> = [
      [
        [3, 3],
        [4, 3],
        [3, 4],
        [4, 4],
      ],
      [
        [5, 3],
        [6, 3],
        [5, 4],
        [6, 4],
      ],
      [
        [4, 5],
        [5, 5],
        [4, 6],
        [5, 6],
      ],
    ];
    await Promise.all(
      poses.map((pose, index) =>
        writeFile(join(workspace, "poses", `${index}.ppm`), ppm(10, 10, pose)),
      ),
    );
    await writeFile(
      join(workspace, "submission.json"),
      JSON.stringify({
        schemaVersion: 1,
        taskId: "coverage-gate",
        artifacts: poses.map((_pose, index) => ({
          id: `frame-${index}`,
          kind: "image",
          path: `poses/${index}.ppm`,
        })),
      }),
    );
    const benchmark = {
      id: "coverage-gate",
      title: "Coverage gate",
      category: "mg-character",
      outcome: {
        objective: "Keep the character readable at delivery size.",
        acceptanceCriteria: ["The subject has meaningful frame coverage."],
        deliverables: poses.map((_pose, index) => ({
          artifactId: `frame-${index}`,
          kind: "image",
          description: `Pose ${index}`,
        })),
      },
      passScore: 100,
      timeoutMs: 10_000,
      skills: [],
      rubric: [
        {
          id: "pose-coverage",
          type: "visual-frames",
          artifactIds: ["frame-0", "frame-1", "frame-2"],
          width: 10,
          height: 10,
          minDistinctPairs: 2,
          minMeanAbsoluteDifference: 0.005,
          foregroundCoverage: { backgroundTolerance: 24, minRatio: 0.05 },
          weight: 1,
          required: true,
        },
      ],
    } as ArtifactBenchmarkCase;

    const report = await evaluateSubmission({ benchmark, workspace });

    expect(report.status).toBe("fail");
    expect(report.checks[0]?.detail).toMatch(/foreground coverage/i);
  }, 15_000);
});
