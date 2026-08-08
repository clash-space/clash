import type { ArtifactBenchmarkCase, OutcomeResult } from "./types";

export function renderOutcomeMarkdown(
  benchmark: ArtifactBenchmarkCase,
  _installedSkillNames: string[] = [],
  options: { clashHost?: boolean } = {},
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
  return `# ${benchmark.title}

Task ID: \`${benchmark.id}\`

## Objective

${benchmark.outcome.objective}

## Acceptance criteria

${acceptance}

## Deliverables

${deliverables}

## Execution environment

${
  options.clashHost
    ? "This workspace is already bound to an isolated Clash project, and its private project host is ready. Discover and use the advertised MCP capabilities from their descriptions, schemas, structured results, and recovery guidance. Workspace initialization and daemon startup are benchmark infrastructure, not creative work; do not wait for or repair them. Product work must be persisted and read back through Clash; ordinary files alone are not evidence of a completed product outcome."
    : "This is a portable artifact workspace. Do not claim a live Clash product mutation unless a Clash MCP host is actually available."
}
${
  benchmark.inputFixture
    ? `\nA verified public input fixture from \`${benchmark.inputFixture.path}\` has already been copied into the workspace root. Treat those files as immutable inputs. Its public provenance receipt is \`.clash/benchmark-input-fixture.json\`.`
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
