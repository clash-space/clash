import { lstat, mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runBenchmarkSuite } from "./runner";
import type { ArtifactBenchmarkSuite, BenchmarkAgent } from "./types";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function suite(): ArtifactBenchmarkSuite {
  return {
    schemaVersion: 1,
    id: "workspace-snapshot-suite",
    title: "Workspace snapshot suite",
    cases: [
      {
        id: "workspace-snapshot",
        title: "Workspace snapshot",
        category: "mixed",
        outcome: {
          objective: "Create one report artifact.",
          acceptanceCriteria: ["The submitted report exists."],
          deliverables: [
            {
              artifactId: "result",
              kind: "report",
              description: "A deterministic report.",
            },
          ],
        },
        passScore: 100,
        timeoutMs: 10_000,
        skills: [],
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
      },
    ],
  };
}

function snapshotAgent(extraSource: string): BenchmarkAgent {
  return {
    command: process.execPath,
    args: [
      "-e",
      [
        'const fs = require("node:fs")',
        'const path = require("node:path")',
        "const workspace = process.env.CLASH_BENCH_WORKSPACE",
        "const caseId = process.env.CLASH_BENCH_CASE_ID",
        extraSource,
        'fs.writeFileSync(path.join(workspace, "result.txt"), "artifact")',
        'fs.writeFileSync(path.join(workspace, "submission.json"), JSON.stringify({schemaVersion:1,taskId:caseId,artifacts:[{id:"result",kind:"report",path:"result.txt"}]}))',
      ].join(";"),
    ],
  };
}

async function runSnapshotCase(runId: string, agent: BenchmarkAgent) {
  const root = await mkdtemp(join(tmpdir(), "clash-workspace-snapshot-"));
  roots.push(root);
  const suiteRoot = join(root, "suite");
  const outputRoot = join(root, "runs");
  await mkdir(suiteRoot);
  const report = await runBenchmarkSuite({
    suite: suite(),
    suiteRoot,
    outputRoot,
    runId,
    maxInfrastructureAttempts: 1,
    agent,
  });
  return {
    caseRoot: join(outputRoot, runId, "workspace-snapshot"),
    report,
  };
}

describe("runner Workspace snapshot boundary", () => {
  it("omits managed Asset links without omitting their stored Asset bytes", async () => {
    const run = await runSnapshotCase(
      "managed-asset-link",
      snapshotAgent(
        [
          'fs.mkdirSync(path.join(workspace, "assets", "objects"), {recursive:true})',
          'fs.mkdirSync(path.join(workspace, "assets", "links"), {recursive:true})',
          'fs.writeFileSync(path.join(workspace, "assets", "objects", "asset.svg"), "<svg/>")',
          'fs.symlinkSync(path.join("..", "objects", "asset.svg"), path.join(workspace, "assets", "links", "asset-id.svg"))',
        ].join(";"),
      ),
    );

    expect(run.report).toMatchObject({
      status: "pass",
      cases: [{ status: "pass", agent: { status: "completed" } }],
    });
    const finalWorkspace = run.report.cases[0]!.workspace;
    await expect(
      readFile(join(finalWorkspace, "assets", "objects", "asset.svg"), "utf8"),
    ).resolves.toBe("<svg/>");
    await expect(
      lstat(join(finalWorkspace, "assets", "links")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("fails closed for a symbolic link outside the managed Asset links subtree", async () => {
    const run = await runSnapshotCase(
      "unmanaged-link",
      snapshotAgent(
        [
          'fs.writeFileSync(path.join(workspace, "target.txt"), "target")',
          'fs.symlinkSync("target.txt", path.join(workspace, "agent-link.txt"))',
        ].join(";"),
      ),
    );

    expect(run.report).toMatchObject({
      status: "fail",
      cases: [
        {
          status: "fail",
          failure: {
            classification: "infrastructure",
            detail: expect.stringMatching(
              /Workspace snapshot contains a symbolic link: .*agent-link\.txt/u,
            ),
          },
        },
      ],
    });
    await expect(
      readFile(join(run.caseRoot, "runner-error.json"), "utf8"),
    ).resolves.toContain("agent-link.txt");
  });
});
