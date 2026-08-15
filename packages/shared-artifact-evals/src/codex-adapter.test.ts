import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createCodexAgentAdapter, runBenchmarkSuite } from "./runner";

const usageLimitMessage =
  "You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Aug 20th, 2026 1:13 PM.";

async function runFakeCodexFailure(input: {
  caseId: string;
  events: unknown[];
}) {
  const root = await mkdtemp(join(tmpdir(), "clash-codex-failure-"));
  const suiteRoot = join(root, "suite");
  const fakeCodex = join(root, "fake-codex");
  await mkdir(suiteRoot);
  await writeFile(
    fakeCodex,
    [
      `#!${process.execPath}`,
      `const events = ${JSON.stringify(input.events)}`,
      'for (const event of events) process.stdout.write(JSON.stringify(event) + "\\n")',
      "process.exit(1)",
    ].join("\n"),
    "utf8",
  );
  await chmod(fakeCodex, 0o755);

  const report = await runBenchmarkSuite({
    suite: {
      schemaVersion: 1,
      id: `${input.caseId}-suite`,
      title: "Codex lifecycle failure suite",
      cases: [
        {
          id: input.caseId,
          title: "Codex lifecycle failure",
          category: "timeline",
          outcome: {
            objective: "Create a report.",
            acceptanceCriteria: ["The report exists."],
            deliverables: [
              { artifactId: "result", kind: "report", description: "Result" },
            ],
          },
          passScore: 100,
          timeoutMs: 10_000,
          skills: [],
          rubric: [
            {
              id: "result",
              type: "artifact-exists",
              artifactId: "result",
              weight: 1,
              required: true,
            },
          ],
        },
      ],
    },
    suiteRoot,
    outputRoot: join(root, "runs"),
    runId: `${input.caseId}-run`,
    agent: createCodexAgentAdapter({ command: fakeCodex }),
  });

  return report.cases[0]!;
}

describe("Codex headless adapter failures", () => {
  it("classifies a quota reset failure as non-retryable infrastructure", async () => {
    const quotaResetMessage =
      "Codex quota exceeded. Your usage quota resets at Aug 20th, 2026 1:13 PM.";
    const benchmarkCase = await runFakeCodexFailure({
      caseId: "codex-quota-reset",
      events: [
        { type: "thread.started", thread_id: "thread-quota-reset" },
        { type: "turn.started" },
        { type: "turn.failed", error: { message: quotaResetMessage } },
      ],
    });

    expect(benchmarkCase.agent.error).toBe(quotaResetMessage);
    expect(benchmarkCase.failure).toEqual({
      classification: "infrastructure",
      retryable: false,
      phase: "agent",
      detail: quotaResetMessage,
    });
  });

  it("retains a public error event when Codex emits no turn failure", async () => {
    const benchmarkCase = await runFakeCodexFailure({
      caseId: "codex-error-event",
      events: [
        { type: "thread.started", thread_id: "thread-error-event" },
        { type: "turn.started" },
        { type: "error", message: usageLimitMessage },
      ],
    });

    expect(benchmarkCase.agent.error).toBe(usageLimitMessage);
    expect(benchmarkCase.failure).toMatchObject({
      classification: "infrastructure",
      retryable: false,
    });
  });

  it("classifies a public usage-limit failure as non-retryable infrastructure", async () => {
    const benchmarkCase = await runFakeCodexFailure({
      caseId: "codex-usage-limit",
      events: [
        { type: "thread.started", thread_id: "thread-usage-limit" },
        { type: "turn.started" },
        { type: "error", message: usageLimitMessage },
        { type: "turn.failed", error: { message: usageLimitMessage } },
      ],
    });

    expect(benchmarkCase.agent).toMatchObject({
      status: "failed",
      exitCode: 1,
      error: usageLimitMessage,
    });
    expect(benchmarkCase.failure).toEqual({
      classification: "infrastructure",
      retryable: false,
      phase: "agent",
      detail: usageLimitMessage,
    });
  });

  it("keeps an ordinary public turn failure classified as agent", async () => {
    const benchmarkCase = await runFakeCodexFailure({
      caseId: "codex-turn-failed",
      events: [
        { type: "thread.started", thread_id: "thread-turn-failed" },
        { type: "turn.started" },
        {
          type: "turn.failed",
          error: {
            message: "The agent could not complete the requested task.",
          },
        },
      ],
    });

    expect(benchmarkCase.agent).toMatchObject({
      status: "failed",
      exitCode: 1,
      error: "The agent could not complete the requested task.",
    });
    expect(benchmarkCase.failure).toEqual({
      classification: "agent",
      retryable: false,
      phase: "agent",
      detail: "The agent could not complete the requested task.",
    });
  });
});
