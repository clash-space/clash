import type { DemoArtifactChapter } from "../../src/demo-recording/artifacts.js";
import type {
  DemoCase,
  DemoSuite,
} from "../../src/demo-recording/contracts.js";
import type { DemoEvent } from "../../src/demo-recording/events.js";

export interface ChapterCoverageResult {
  chapters: DemoArtifactChapter[];
  failures: string[];
}

export interface TrajectoryHealthResult {
  failures: string[];
}

export function evaluateTrajectoryHealth(
  events: readonly DemoEvent[],
): TrajectoryHealthResult {
  return {
    failures: events
      .filter((event) => event.type === "agent.tool.failed")
      .map((event) => {
        const label = event.label ?? "Agent tool";
        const errorKind = event.errorKind ?? "tool_error";
        const toolCallId = event.toolCallId ?? "unknown tool call";
        return `Agent tool ${label} failed with ${errorKind} (${toolCallId})`;
      }),
  };
}

export function evaluateChapterCoverage(options: {
  demoCase: DemoCase;
  events: readonly DemoEvent[];
  endMs: number;
}): ChapterCoverageResult {
  const chapters: DemoArtifactChapter[] = [];
  const failures: string[] = [];
  const completeIntervals: Array<{
    id: string;
    startSequence: number;
    endSequence: number;
  }> = [];

  if (!Number.isFinite(options.endMs) || options.endMs < 0) {
    failures.push("recording end must be finite and non-negative");
  }

  for (const chapter of options.demoCase.chapters) {
    const starts = options.events.filter(
      (event) =>
        event.type === "chapter.started" && event.chapterId === chapter.id,
    );
    const completions = options.events.filter(
      (event) =>
        event.type === "chapter.completed" && event.chapterId === chapter.id,
    );
    if (starts.length !== 1) {
      failures.push(
        `chapter ${chapter.id} must be started exactly once; observed ${starts.length}`,
      );
    }
    if (completions.length !== 1) {
      failures.push(
        `chapter ${chapter.id} must be completed exactly once; observed ${completions.length}`,
      );
    }
    if (starts.length !== 1 || completions.length !== 1) continue;

    const start = starts[0]!;
    const completion = completions[0]!;
    let valid = true;
    if (completion.sequence <= start.sequence) {
      failures.push(`chapter ${chapter.id} must complete after its start`);
      valid = false;
    }
    if (completion.status !== "completed") {
      failures.push(
        `chapter ${chapter.id} completion must have status=completed`,
      );
      valid = false;
    }
    if (
      !Number.isFinite(start.monotonicMs) ||
      !Number.isFinite(completion.monotonicMs) ||
      start.monotonicMs < 0 ||
      completion.monotonicMs < start.monotonicMs
    ) {
      failures.push(`chapter ${chapter.id} timestamps are not ordered`);
      valid = false;
    }
    if (completion.monotonicMs > options.endMs) {
      failures.push(
        `chapter ${chapter.id} completion exceeds the recording end`,
      );
      valid = false;
    }
    if (!valid) continue;

    chapters.push({
      id: chapter.id,
      title: chapter.title,
      startMs: start.monotonicMs,
      endMs: completion.monotonicMs,
    });
    completeIntervals.push({
      id: chapter.id,
      startSequence: start.sequence,
      endSequence: completion.sequence,
    });
  }

  for (let index = 1; index < completeIntervals.length; index += 1) {
    const previous = completeIntervals[index - 1]!;
    const current = completeIntervals[index]!;
    if (current.startSequence <= previous.endSequence) {
      failures.push(
        `declared chapter order is invalid: ${current.id} must start after ${previous.id} completes`,
      );
    }
  }

  return { chapters, failures };
}

export interface DemoSuiteCaseSelectionResult {
  cases: DemoCase[];
  declaredCaseCount: number;
  selectedCaseCount: number;
  failures: string[];
}

export const FULL_DEMO_CASE_IDS = [
  "real-pi-canvas-stage-timeline-v1",
  "feature-workspace-surfaces-v1",
] as const;

function hasExactlyRequiredCaseIds(ids: readonly string[]): boolean {
  return (
    ids.length === FULL_DEMO_CASE_IDS.length &&
    FULL_DEMO_CASE_IDS.every(
      (requiredId) => ids.filter((id) => id === requiredId).length === 1,
    )
  );
}

export function selectDemoSuiteCases(options: {
  suite: DemoSuite;
  selectedCaseId?: string;
  mode: "full" | "selectable";
  requiredSuitePath?: string;
}): DemoSuiteCaseSelectionResult {
  const cases = options.selectedCaseId
    ? options.suite.cases.filter(
        (demoCase) => demoCase.id === options.selectedCaseId,
      )
    : [...options.suite.cases];
  const failures: string[] = [];

  if (options.selectedCaseId && cases.length === 0) {
    failures.push(`demo case not found: ${options.selectedCaseId}`);
  }
  if (options.mode === "full") {
    const expected = FULL_DEMO_CASE_IDS.join(", ");
    const declaredIds = options.suite.cases.map((demoCase) => demoCase.id);
    const selectedIds = cases.map((demoCase) => demoCase.id);
    if (!hasExactlyRequiredCaseIds(declaredIds)) {
      failures.push(
        `full demo suite must declare exactly ${expected}; observed ${declaredIds.join(", ") || "none"}`,
      );
    }
    if (!hasExactlyRequiredCaseIds(selectedIds)) {
      failures.push(
        `full demo suite must select exactly ${expected}; observed ${selectedIds.join(", ") || "none"}`,
      );
    }
    if (
      options.requiredSuitePath !== undefined &&
      options.suite.suitePath !== options.requiredSuitePath
    ) {
      failures.push("full demo recording must use the default suite");
    }
  }

  return {
    cases,
    declaredCaseCount: options.suite.cases.length,
    selectedCaseCount: cases.length,
    failures,
  };
}
