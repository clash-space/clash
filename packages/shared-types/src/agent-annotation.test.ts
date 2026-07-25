import { describe, expect, it } from "vitest";

import {
  AgentAnnotationDraftSchema,
  serializeAgentAnnotationPromptBlock,
} from "./agent-annotation";

describe("agent text-selection annotations", () => {
  it("preserves an exact text quote and its visual anchor in the shared contract", () => {
    const annotation = AgentAnnotationDraftSchema.parse({
      id: "annotation-selection-1",
      kind: "agent-annotation",
      note: "",
      target: {
        projectId: "project-1",
        surface: "timeline",
        surfaceId: "timeline-1",
        surfaceLabel: "Final cut",
        objectId: "timeline-1",
        objectType: "timeline",
        objectLabel: "Final cut",
        objectPath: "timelines/timeline-1",
        capabilities: ["read", "modify"],
        selection: {
          kind: "text-quote",
          exact: "Director：14 tests Web 相关回归：62 tests",
          prefix: "Timeline：215 tests ",
          suffix: " 三个相关包类型检查通过",
          visualRects: [
            { x: 0.12, y: 0.42, width: 0.3, height: 0.04 },
          ],
        },
      },
    });

    expect(annotation.target.selection).toEqual({
      kind: "text-quote",
      exact: "Director：14 tests Web 相关回归：62 tests",
      prefix: "Timeline：215 tests ",
      suffix: " 三个相关包类型检查通过",
      visualRects: [
        { x: 0.12, y: 0.42, width: 0.3, height: 0.04 },
      ],
    });
    expect(serializeAgentAnnotationPromptBlock([annotation])).toContain(
      '"kind":"text-quote"',
    );
  });
});
