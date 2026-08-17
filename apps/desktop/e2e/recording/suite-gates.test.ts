import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  DemoCase,
  DemoSuite,
} from "../../src/demo-recording/contracts.js";
import type { DemoEvent } from "../../src/demo-recording/events.js";
import {
  evaluateChapterCoverage,
  evaluateTrajectoryHealth,
  selectDemoSuiteCases,
} from "./suite-gates.js";

const AGENT_CASE_ID = "real-pi-canvas-stage-timeline-v1";
const FEATURE_CASE_ID = "feature-workspace-surfaces-v1";

function demoCase(
  id: string,
  kind: DemoCase["kind"],
  chapterIds: readonly string[] = ["project-ready", "product-result"],
): DemoCase {
  return {
    id,
    title: id,
    kind,
    driverPath: `/suite/${id}.ts`,
    chapters: chapterIds.map((chapterId) => ({
      id: chapterId,
      title: `Chapter ${chapterId}`,
    })),
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
    theme: "light",
    timeoutMs: 120_000,
  };
}

function chapterEvent(options: {
  sequence: number;
  monotonicMs: number;
  type: "chapter.started" | "chapter.completed";
  chapterId: string;
  status?: "started" | "completed" | "failed";
}): DemoEvent {
  return {
    schemaVersion: 1,
    source: "runner",
    ...options,
  };
}

function demoSuite(cases: DemoCase[]): DemoSuite {
  return {
    schemaVersion: 1,
    id: "clash-desktop-demos-v1",
    suitePath: "/suite/suite.json",
    cases,
  };
}

describe("demo suite chapter coverage", () => {
  it("returns completed manifest chapters without extending them to the recording end", () => {
    const result = evaluateChapterCoverage({
      demoCase: demoCase("feature", "feature"),
      events: [
        chapterEvent({
          sequence: 1,
          monotonicMs: 10,
          type: "chapter.started",
          chapterId: "project-ready",
        }),
        chapterEvent({
          sequence: 2,
          monotonicMs: 20,
          type: "chapter.completed",
          chapterId: "project-ready",
          status: "completed",
        }),
        chapterEvent({
          sequence: 3,
          monotonicMs: 30,
          type: "chapter.started",
          chapterId: "product-result",
        }),
        chapterEvent({
          sequence: 4,
          monotonicMs: 40,
          type: "chapter.completed",
          chapterId: "product-result",
          status: "completed",
        }),
      ],
      endMs: 100,
    });

    assert.deepEqual(result, {
      chapters: [
        {
          id: "project-ready",
          title: "Chapter project-ready",
          startMs: 10,
          endMs: 20,
        },
        {
          id: "product-result",
          title: "Chapter product-result",
          startMs: 30,
          endMs: 40,
        },
      ],
      failures: [],
    });
  });

  it("rejects a missing or duplicate chapter start", () => {
    const targetCase = demoCase("feature", "feature", ["chapter-a"]);
    const missing = evaluateChapterCoverage({
      demoCase: targetCase,
      events: [
        chapterEvent({
          sequence: 1,
          monotonicMs: 10,
          type: "chapter.completed",
          chapterId: "chapter-a",
          status: "completed",
        }),
      ],
      endMs: 100,
    });
    const duplicate = evaluateChapterCoverage({
      demoCase: targetCase,
      events: [
        chapterEvent({
          sequence: 1,
          monotonicMs: 10,
          type: "chapter.started",
          chapterId: "chapter-a",
        }),
        chapterEvent({
          sequence: 2,
          monotonicMs: 20,
          type: "chapter.started",
          chapterId: "chapter-a",
        }),
        chapterEvent({
          sequence: 3,
          monotonicMs: 30,
          type: "chapter.completed",
          chapterId: "chapter-a",
          status: "completed",
        }),
      ],
      endMs: 100,
    });

    assert.equal(missing.chapters.length, 0);
    assert.match(
      missing.failures.join("\n"),
      /chapter-a.*started.*exactly once/iu,
    );
    assert.equal(duplicate.chapters.length, 0);
    assert.match(
      duplicate.failures.join("\n"),
      /chapter-a.*started.*exactly once/iu,
    );
  });

  it("rejects missing, duplicate, failed, or pre-start completion", () => {
    const targetCase = demoCase("feature", "feature", ["chapter-a"]);
    const fixtures: Array<{
      label: string;
      events: DemoEvent[];
      expected: RegExp;
    }> = [
      {
        label: "missing",
        events: [
          chapterEvent({
            sequence: 1,
            monotonicMs: 10,
            type: "chapter.started",
            chapterId: "chapter-a",
          }),
        ],
        expected: /chapter-a.*completed.*exactly once/iu,
      },
      {
        label: "duplicate",
        events: [
          chapterEvent({
            sequence: 1,
            monotonicMs: 10,
            type: "chapter.started",
            chapterId: "chapter-a",
          }),
          chapterEvent({
            sequence: 2,
            monotonicMs: 20,
            type: "chapter.completed",
            chapterId: "chapter-a",
            status: "completed",
          }),
          chapterEvent({
            sequence: 3,
            monotonicMs: 30,
            type: "chapter.completed",
            chapterId: "chapter-a",
            status: "completed",
          }),
        ],
        expected: /chapter-a.*completed.*exactly once/iu,
      },
      {
        label: "failed",
        events: [
          chapterEvent({
            sequence: 1,
            monotonicMs: 10,
            type: "chapter.started",
            chapterId: "chapter-a",
          }),
          chapterEvent({
            sequence: 2,
            monotonicMs: 20,
            type: "chapter.completed",
            chapterId: "chapter-a",
            status: "failed",
          }),
        ],
        expected: /chapter-a.*status=completed/iu,
      },
      {
        label: "before start",
        events: [
          chapterEvent({
            sequence: 1,
            monotonicMs: 10,
            type: "chapter.completed",
            chapterId: "chapter-a",
            status: "completed",
          }),
          chapterEvent({
            sequence: 2,
            monotonicMs: 20,
            type: "chapter.started",
            chapterId: "chapter-a",
          }),
        ],
        expected: /chapter-a.*after its start/iu,
      },
    ];

    for (const fixture of fixtures) {
      const result = evaluateChapterCoverage({
        demoCase: targetCase,
        events: fixture.events,
        endMs: 100,
      });
      assert.equal(result.chapters.length, 0, fixture.label);
      assert.match(result.failures.join("\n"), fixture.expected, fixture.label);
    }
  });

  it("rejects declared chapters that overlap or run out of order", () => {
    const result = evaluateChapterCoverage({
      demoCase: demoCase("feature", "feature", ["chapter-a", "chapter-b"]),
      events: [
        chapterEvent({
          sequence: 1,
          monotonicMs: 10,
          type: "chapter.started",
          chapterId: "chapter-b",
        }),
        chapterEvent({
          sequence: 2,
          monotonicMs: 20,
          type: "chapter.started",
          chapterId: "chapter-a",
        }),
        chapterEvent({
          sequence: 3,
          monotonicMs: 30,
          type: "chapter.completed",
          chapterId: "chapter-b",
          status: "completed",
        }),
        chapterEvent({
          sequence: 4,
          monotonicMs: 40,
          type: "chapter.completed",
          chapterId: "chapter-a",
          status: "completed",
        }),
      ],
      endMs: 100,
    });

    assert.match(result.failures.join("\n"), /declared chapter order/iu);
  });

  it("rejects a chapter whose completion is beyond the captured recording", () => {
    const result = evaluateChapterCoverage({
      demoCase: demoCase("feature", "feature", ["chapter-a"]),
      events: [
        chapterEvent({
          sequence: 1,
          monotonicMs: 10,
          type: "chapter.started",
          chapterId: "chapter-a",
        }),
        chapterEvent({
          sequence: 2,
          monotonicMs: 110,
          type: "chapter.completed",
          chapterId: "chapter-a",
          status: "completed",
        }),
      ],
      endMs: 100,
    });

    assert.equal(result.chapters.length, 0);
    assert.match(result.failures.join("\n"), /chapter-a.*recording end/iu);
  });
});

describe("demo trajectory health", () => {
  it("rejects a case with any failed Agent tool even when later calls recover", () => {
    const result = evaluateTrajectoryHealth([
      {
        schemaVersion: 1,
        sequence: 1,
        monotonicMs: 10,
        source: "acp",
        type: "agent.tool.failed",
        toolCallId: "tool-1",
        label: "Canvas",
        status: "failed",
        errorKind: "invalid_arguments",
      },
      {
        schemaVersion: 1,
        sequence: 2,
        monotonicMs: 20,
        source: "acp",
        type: "agent.tool.completed",
        toolCallId: "tool-2",
        label: "Canvas · list",
        status: "completed",
        dispatcherMode: "execute",
        requestedOperation: "list",
      },
    ]);

    assert.deepEqual(result.failures, [
      "Agent tool Canvas failed with invalid_arguments (tool-1)",
    ]);
  });
});

describe("demo suite case selection", () => {
  const requiredCases = [
    demoCase(AGENT_CASE_ID, "agent"),
    demoCase(FEATURE_CASE_ID, "feature"),
  ];

  it("accepts full mode only when both required cases are declared and selected", () => {
    const result = selectDemoSuiteCases({
      suite: demoSuite(requiredCases),
      mode: "full",
    });

    assert.deepEqual(
      result.cases.map((candidate) => candidate.id),
      [AGENT_CASE_ID, FEATURE_CASE_ID],
    );
    assert.equal(result.declaredCaseCount, 2);
    assert.equal(result.selectedCaseCount, 2);
    assert.deepEqual(result.failures, []);
  });

  it("rejects an ambient single-case selection in full mode", () => {
    const result = selectDemoSuiteCases({
      suite: demoSuite(requiredCases),
      mode: "full",
      selectedCaseId: FEATURE_CASE_ID,
    });

    assert.deepEqual(
      result.cases.map((candidate) => candidate.id),
      [FEATURE_CASE_ID],
    );
    assert.match(result.failures.join("\n"), /full.*select exactly/iu);
  });

  it("rejects an ambient suite path in full mode", () => {
    const result = selectDemoSuiteCases({
      suite: {
        ...demoSuite(requiredCases),
        suitePath: "/suite/ambient.json",
      },
      mode: "full",
      requiredSuitePath: "/suite/default.json",
    });

    assert.match(result.failures.join("\n"), /full.*default suite/iu);
  });

  it("rejects full suites with a missing or extra case", () => {
    const missing = selectDemoSuiteCases({
      suite: demoSuite([requiredCases[0]!]),
      mode: "full",
    });
    const extra = selectDemoSuiteCases({
      suite: demoSuite([
        ...requiredCases,
        demoCase("unrelated-demo-v1", "feature"),
      ]),
      mode: "full",
    });

    assert.match(missing.failures.join("\n"), /full.*declare exactly/iu);
    assert.match(extra.failures.join("\n"), /full.*declare exactly/iu);
  });

  it("allows an ordinary single-case run to select one declared case", () => {
    const result = selectDemoSuiteCases({
      suite: demoSuite(requiredCases),
      mode: "selectable",
      selectedCaseId: FEATURE_CASE_ID,
    });

    assert.deepEqual(
      result.cases.map((candidate) => candidate.id),
      [FEATURE_CASE_ID],
    );
    assert.equal(result.declaredCaseCount, 2);
    assert.equal(result.selectedCaseCount, 1);
    assert.deepEqual(result.failures, []);
  });

  it("rejects a selected case that the suite does not declare", () => {
    const result = selectDemoSuiteCases({
      suite: demoSuite(requiredCases),
      mode: "selectable",
      selectedCaseId: "missing-case-v1",
    });

    assert.deepEqual(result.cases, []);
    assert.match(result.failures.join("\n"), /not found.*missing-case-v1/iu);
  });
});
