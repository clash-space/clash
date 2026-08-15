import { describe, expect, it } from "vitest";

import { createOutcomeResult, renderOutcomeMarkdown } from "./outcome";
import type { ArtifactBenchmarkCase } from "./types";

const benchmark: ArtifactBenchmarkCase = {
  id: "skill-contract",
  title: "Skill contract",
  category: "mg-character",
  outcome: {
    objective: "Create an editable Remotion character.",
    acceptanceCriteria: ["The character is editable."],
    deliverables: [
      {
        artifactId: "component",
        kind: "remotion-component",
        description: "Editable component",
      },
    ],
  },
  passScore: 100,
  timeoutMs: 10_000,
  skills: [],
  rubric: [
    {
      id: "component",
      type: "artifact-exists",
      artifactId: "component",
      weight: 1,
      required: true,
    },
  ],
};

describe("benchmark outcome prompt", () => {
  it("does not call technically passing content achieved while quality review is pending", () => {
    const result = createOutcomeResult({
      benchmark,
      agentStatus: "completed",
      evaluationStatus: "pass",
      executionStatus: "pass",
      qualityReviewStatus: "pending",
      score: 100,
    });

    expect(result.status).toBe("pending-review");
    expect(result.qualityReviewStatus).toBe("pending");
  });

  it("makes every active skill an explicit workflow requirement", () => {
    const markdown = renderOutcomeMarkdown(
      benchmark,
      ["clash", "clash-mg-character", "remotion-best-practices"],
      { workspaceRoot: "/case/workspace" },
    );

    expect(markdown).toContain("## Required skills");
    expect(markdown).toContain("read and follow");
    expect(markdown).toContain("`clash`");
    expect(markdown).toContain("`clash-mg-character`");
    expect(markdown).toContain("`remotion-best-practices`");
    expect(markdown).toContain(
      "`.agents/skills/remotion-best-practices/SKILL.md`",
    );
    expect(markdown).toContain(
      "`/case/workspace/.agents/skills/remotion-best-practices/SKILL.md`",
    );
    expect(markdown).toContain("Do not scan outside this workspace");
  });

  it("discloses Remotion APIs that the evaluator requires", () => {
    const remotionBenchmark: ArtifactBenchmarkCase = {
      ...benchmark,
      rubric: [
        {
          id: "component-source",
          type: "mg-character",
          artifactId: "component",
          profile: "remotion-tsx",
          weight: 1,
          required: true,
          requiredRemotionApis: ["useCurrentFrame", "interpolate", "spring"],
        },
      ],
    };
    const markdown = renderOutcomeMarkdown(remotionBenchmark);

    expect(markdown).toContain("## Evaluator-enforced authoring contract");
    expect(markdown).toContain(
      "Required Remotion APIs: `useCurrentFrame`, `interpolate`, `spring`.",
    );
  });

  it("identifies Clash-hosted component authoring as distinct from standalone Remotion setup", () => {
    const markdown = renderOutcomeMarkdown(
      {
        ...benchmark,
        rubric: [
          {
            id: "component-source",
            type: "mg-character",
            artifactId: "component",
            profile: "remotion-tsx",
            weight: 1,
            required: true,
          },
        ],
      },
      [],
      { clashHost: true, workspaceRoot: "/case/workspace" },
    );

    expect(markdown).toMatch(/Clash-hosted Remotion component authoring/i);
    expect(markdown).toMatch(/not a standalone Remotion project/i);
    expect(markdown).toMatch(
      /supplies the Remotion dependencies and renderer/i,
    );
    expect(markdown).toMatch(
      /without project scaffolding or local package discovery/i,
    );
  });

  it("assigns trusted byte readback to the runner without encouraging private Host or Git checks", () => {
    const markdown = renderOutcomeMarkdown(
      {
        ...benchmark,
        execution: {
          profile: "clash-host",
          lane: "agent-product",
          requiredProductOperations: [
            "asset.import",
            "asset.list",
            "asset.get",
          ],
          forbiddenProductOperations: ["timeline.validate"],
        },
      },
      [],
      { clashHost: true, workspaceRoot: "/case/workspace" },
    );

    expect(markdown).toContain(
      "Required public product operations: `asset.import`, `asset.list`, `asset.get`.",
    );
    expect(markdown).toContain(
      "Forbidden public product operations: `timeline.validate`.",
    );
    expect(markdown).toMatch(/do not invoke.*discovery.*help/isu);
    expect(markdown).toMatch(
      /runner independently performs byte-level readback/i,
    );
    expect(markdown).toMatch(/do not call internal Host HTTP/i);
    expect(markdown).toMatch(/do not use Git as a completion check/i);
  });

  it("describes only the Clash transport surface assigned to the benchmark lane", () => {
    const renderFor = (transport: "auto" | "mcp" | "cli") =>
      renderOutcomeMarkdown(
        {
          ...benchmark,
          execution: {
            profile: "clash-host",
            lane: "agent-product",
            transport,
            requiredProductOperations: ["asset.import"],
          },
        },
        [],
        { clashHost: true, workspaceRoot: "/case/workspace" },
      );

    const mcp = renderFor("mcp");
    expect(mcp).toMatch(/only.*runner-sealed Clash MCP/is);
    expect(mcp).toMatch(/Clash CLI is not available/i);

    const cli = renderFor("cli");
    expect(cli).toMatch(/only.*runner-sealed Clash CLI/is);
    expect(cli).toMatch(/Clash MCP is not available/i);

    const auto = renderFor("auto");
    expect(auto).toMatch(/runner-sealed Clash MCP and Clash CLI.*available/is);
    expect(auto).toMatch(/choose one.*avoid switching/i);
  });
});
