import { describe, expect, it } from "vitest";

import { renderOutcomeMarkdown } from "./outcome";
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
    expect(markdown).toMatch(/supplies the Remotion dependencies and renderer/i);
    expect(markdown).toMatch(/without project scaffolding or local package discovery/i);
  });
});
