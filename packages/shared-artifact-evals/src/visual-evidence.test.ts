import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { evaluateSubmission } from "./evaluator";
import type { ArtifactBenchmarkCase } from "./types";

const roots: string[] = [];

function ppm(width: number, height: number, foreground: Array<[number, number]>): Buffer {
  const pixels = Buffer.alloc(width * height * 3, 245);
  for (const [x, y] of foreground) {
    const offset = (y * width + x) * 3;
    pixels[offset] = 220;
    pixels[offset + 1] = 30;
    pixels[offset + 2] = 60;
  }
  return Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), pixels]);
}

async function makeWorkspace(edgeClipped: boolean): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), "visual-evidence-"));
  roots.push(workspace);
  await mkdir(join(workspace, "poses"));
  const poses: Array<Array<[number, number]>> = [
    [[4, 4], [5, 4], [4, 5], [5, 5]],
    [[3, 3], [4, 3], [3, 4], [4, 4]],
    edgeClipped
      ? [[0, 4], [1, 4], [0, 5], [1, 5]]
      : [[5, 3], [6, 3], [5, 4], [6, 4]],
  ];
  await Promise.all(poses.map((pose, index) => writeFile(
    join(workspace, "poses", `${index}.ppm`),
    ppm(10, 10, pose),
  )));
  await writeFile(join(workspace, "submission.json"), JSON.stringify({
    schemaVersion: 1,
    taskId: "visual-frames",
    artifacts: poses.map((_pose, index) => ({
      id: `frame-${index}`,
      kind: "image",
      path: `poses/${index}.ppm`,
    })),
  }));
  return workspace;
}

const benchmark = {
  id: "visual-frames",
  title: "Visual frames",
  category: "mg-character",
  outcome: {
    objective: "Provide three readable poses.",
    acceptanceCriteria: ["Frames decode, differ, and keep foreground inside the safe area."],
    deliverables: [0, 1, 2].map((index) => ({
      artifactId: `frame-${index}`,
      kind: "image",
      description: `Pose ${index}`,
    })),
  },
  passScore: 100,
  timeoutMs: 10_000,
  skills: [],
  rubric: [{
    id: "visual-frames",
    type: "visual-frames",
    artifactIds: ["frame-0", "frame-1", "frame-2"],
    width: 10,
    height: 10,
    minDistinctPairs: 2,
    minMeanAbsoluteDifference: 0.005,
    safeArea: {
      marginPercent: 0.1,
      backgroundTolerance: 16,
      maxForegroundEdgeRatio: 0.01,
    },
    weight: 1,
    required: true,
  }],
} as unknown as ArtifactBenchmarkCase;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("visual frame evidence", () => {
  it("accepts decoded, distinct frames whose foreground stays inside the safe area", async () => {
    const report = await evaluateSubmission({ benchmark, workspace: await makeWorkspace(false) });
    expect(report.status).toBe("pass");
    expect(report.checks[0]).toMatchObject({ status: "pass", type: "visual-frames" });
  }, 15_000);

  it("rejects a frame with visible foreground clipped by the edge", async () => {
    const report = await evaluateSubmission({ benchmark, workspace: await makeWorkspace(true) });
    expect(report.status).toBe("fail");
    expect(report.checks[0]?.detail).toMatch(/safe-area edge/i);
  }, 15_000);
});
