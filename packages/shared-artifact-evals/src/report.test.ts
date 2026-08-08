import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { writeSuiteGallery } from "./report";
import type { BenchmarkSuiteReport } from "./types";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("artifact gallery", () => {
  it("writes a directly browsable run report with media, frames, sources, and traces", async () => {
    const runRoot = await mkdtemp(join(tmpdir(), "artifact-gallery-"));
    roots.push(runRoot);
    const caseRoot = join(runRoot, "mg-wave");
    await mkdir(join(caseRoot, "workspace", "poses"), { recursive: true });
    await mkdir(join(caseRoot, "workspace", "assets"), { recursive: true });
    await mkdir(join(caseRoot, "logs"), { recursive: true });
    await Promise.all([
      writeFile(join(caseRoot, "workspace", "assets", "wave.mp4"), "video"),
      writeFile(join(caseRoot, "workspace", "poses", "start.png"), "png"),
      writeFile(join(caseRoot, "workspace", "character.json"), "{}"),
      writeFile(join(caseRoot, "logs", "events.jsonl"), "{}\n"),
      writeFile(join(caseRoot, "logs", "trajectory.json"), "{}\n"),
    ]);
    const report = {
      schemaVersion: 1,
      suiteId: "creative-v2",
      runId: "run-1",
      status: "pass",
      startedAt: "2026-08-07T00:00:00.000Z",
      finishedAt: "2026-08-07T00:01:00.000Z",
      cases: [
        {
          id: "mg-wave",
          workspace: join(caseRoot, "workspace"),
          status: "pass",
          agent: {
            status: "completed",
            exitCode: 0,
            signal: null,
            durationMs: 60_000,
            stdoutPath: join(caseRoot, "logs", "events.jsonl"),
            stderrPath: join(caseRoot, "logs", "stderr.log"),
            trajectoryPath: join(caseRoot, "logs", "trajectory.json"),
          },
          execution: {
            profile: "clash-host",
            status: "pass",
            requiredProductOperations: [],
            observedProductOperations: [],
            missingProductOperations: [],
            requiredMcpTools: [],
            observedMcpTools: [],
            missingMcpTools: [],
            requiredCliCommands: [],
            observedCliCommands: [],
            missingCliCommands: [],
            detail: "identity integrity failed",
            identityIntegrity: {
              status: "fail",
              detail: "Detected an explicit identity bypass.",
              violations: [
                {
                  code: "agent-member-id-cleared",
                  source: "codex-command",
                  sourceLine: 17,
                  command:
                    "CLASH_AGENT_MEMBER_ID= clash timeline apply --timeline main",
                },
              ],
            },
          },
          evaluation: {
            schemaVersion: 1,
            benchmarkId: "mg-wave",
            taskId: "mg-wave",
            status: "pass",
            score: 100,
            checks: [],
            artifacts: [
              {
                id: "video",
                kind: "video",
                path: "assets/wave.mp4",
                bytes: 5,
                sha256: "a",
              },
              {
                id: "start",
                kind: "image",
                path: "poses/start.png",
                bytes: 3,
                sha256: "b",
              },
              {
                id: "source",
                kind: "remotion-component",
                path: "character.tsx",
                bytes: 2,
                sha256: "c",
              },
            ],
            outcomeGate: {
              status: "pass",
              detail: "ok",
              missingArtifactIds: [],
              invalidArtifactIds: [],
            },
          },
          outcome: {
            schemaVersion: 1,
            caseId: "mg-wave",
            objective: "wave",
            status: "achieved",
            score: 100,
            passScore: 80,
            agentStatus: "completed",
            evaluationStatus: "pass",
            executionStatus: "pass",
            completedAt: "2026-08-07T00:01:00.000Z",
          },
        },
      ],
    } satisfies BenchmarkSuiteReport;

    const output = await writeSuiteGallery({ report, runRoot });
    const html = await readFile(output, "utf8");

    expect(output).toBe(join(runRoot, "report.html"));
    expect(html).toContain("<video controls");
    expect(html).toContain("mg-wave/workspace/assets/wave.mp4");
    expect(html).toContain("mg-wave/workspace/poses/start.png");
    expect(html).toContain("mg-wave/workspace/character.tsx");
    expect(html).toContain("mg-wave/logs/events.jsonl");
    expect(html).toContain("mg-wave/logs/trajectory.json");
    expect(html).toContain("agent-member-id-cleared");
    expect(html).toContain("codex-command line 17");
    expect(html).toContain(
      "CLASH_AGENT_MEMBER_ID= clash timeline apply --timeline main",
    );
  });
});
