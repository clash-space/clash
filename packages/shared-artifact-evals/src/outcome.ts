import { join } from "node:path";

import type { ArtifactBenchmarkCase, OutcomeResult } from "./types";

export function renderOutcomeMarkdown(
  benchmark: ArtifactBenchmarkCase,
  installedSkillNames: string[] = [],
  options: { clashHost?: boolean; workspaceRoot?: string } = {},
): string {
  const acceptance = benchmark.outcome.acceptanceCriteria
    .map((criterion) => `- ${criterion}`)
    .join("\n");
  const deliverables = benchmark.outcome.deliverables
    .map(
      (deliverable) =>
        `- \`${deliverable.artifactId}\` (${deliverable.kind}): ${deliverable.description}`,
    )
    .join("\n");
  const submissionTemplate = JSON.stringify(
    {
      schemaVersion: 1,
      taskId: benchmark.id,
      artifacts: benchmark.outcome.deliverables.map((deliverable) => ({
        id: deliverable.artifactId,
        kind: deliverable.kind,
        path: `<workspace-relative path for ${deliverable.artifactId}>`,
      })),
    },
    null,
    2,
  );
  const requiredSkills = [...new Set(installedSkillNames)]
    .map((name) => {
      const relativePath = `.agents/skills/${name}/SKILL.md`;
      const skillPath = options.workspaceRoot
        ? join(options.workspaceRoot, relativePath)
        : relativePath;
      return `- \`${name}\`: read \`${skillPath}\`${skillPath === relativePath ? "" : ` (workspace-relative: \`${relativePath}\`)`}`;
    })
    .join("\n");
  const requiredRemotionApis = [
    ...new Set(
      benchmark.rubric.flatMap((rubric) =>
        rubric.type === "mg-character"
          ? (rubric.requiredRemotionApis ?? [])
          : [],
      ),
    ),
  ];
  const hasRemotionComponentRubric = benchmark.rubric.some(
    (rubric) => rubric.type === "mg-character",
  );
  const authoringContractLines = [
    ...(options.clashHost && hasRemotionComponentRubric
      ? [
          "Clash-hosted Remotion component authoring: this is not a standalone Remotion project. Clash supplies the Remotion dependencies and renderer; author the self-contained TSX directly without project scaffolding or local package discovery.",
        ]
      : []),
    ...(requiredRemotionApis.length
      ? [
          `Required Remotion APIs: ${requiredRemotionApis
            .map((api) => `\`${api}\``)
            .join(", ")}.`,
        ]
      : []),
  ];
  const evaluatorAuthoringContract = authoringContractLines.length
    ? `## Evaluator-enforced authoring contract

${authoringContractLines.join("\n\n")}`
    : "";
  return `# ${benchmark.title}

Task ID: \`${benchmark.id}\`

## Objective

${benchmark.outcome.objective}

## Acceptance criteria

${acceptance}

${evaluatorAuthoringContract}

## Deliverables

${deliverables}

## Execution environment

${
  options.clashHost
    ? "This workspace is already bound to an isolated Clash project, and its private Project Host is ready. Discover and use the advertised MCP capabilities from their descriptions, schemas, structured results, and recovery guidance. Workspace initialization and Project Host readiness are benchmark infrastructure, not creative work; do not wait for or repair them. Product work must be persisted and read back through Clash; ordinary files alone are not evidence of a completed product outcome."
    : "This is a portable artifact workspace. Do not claim a live Clash product mutation unless a Clash MCP host is actually available."
}
${
  benchmark.inputFixture
    ? `\nA verified public input fixture from \`${benchmark.inputFixture.path}\` has already been copied into the workspace root. Treat those files as immutable inputs. Its public provenance receipt is \`.clash/benchmark-input-fixture.json\`.`
    : ""
}

${
  requiredSkills
    ? `## Required skills

Before starting, read and follow every installed workflow below. Treat their product and authoring contracts as part of this task.
${
  options.workspaceRoot
    ? `\nThe workspace root is \`${options.workspaceRoot}\`. Use the exact skill paths listed below. Do not scan outside this workspace to locate skills.\n`
    : ""
}

${requiredSkills}
`
    : ""
}

## Submission contract

Work autonomously until the outcome is achieved or the timeout is reached. Create every deliverable inside this workspace. Then write \`submission.json\` with this shape:

\`\`\`json
${submissionTemplate}
\`\`\`

Every \`id\` above is an exact evaluation label, not a product entity id; preserve it verbatim and change only each \`path\`. Only files declared by \`submission.json\` are evaluated. Paths must be relative, remain inside this workspace, and must not use symbolic links. Do not mark your own outcome as achieved; the benchmark runner makes that decision from the artifacts.
${benchmark.prompt ? `\n## Additional context\n\n${benchmark.prompt}\n` : ""}`;
}

export function createOutcomeResult(input: {
  benchmark: ArtifactBenchmarkCase;
  agentStatus: OutcomeResult["agentStatus"];
  evaluationStatus: OutcomeResult["evaluationStatus"];
  executionStatus: OutcomeResult["executionStatus"];
  score: number;
}): OutcomeResult {
  const achieved =
    input.agentStatus === "completed" &&
    input.executionStatus === "pass" &&
    input.evaluationStatus === "pass";
  return {
    schemaVersion: 1,
    caseId: input.benchmark.id,
    objective: input.benchmark.outcome.objective,
    status: achieved ? "achieved" : "failed",
    score: input.score,
    passScore: input.benchmark.passScore,
    agentStatus: input.agentStatus,
    evaluationStatus: input.evaluationStatus,
    executionStatus: input.executionStatus,
    completedAt: new Date().toISOString(),
  };
}
