import { describe, expect, it } from "vitest";

import {
  AgentAnnotationDraftSchema,
  serializeAgentAnnotationPromptBlock,
} from "./agent-annotation.js";

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
          visualRects: [{ x: 0.12, y: 0.42, width: 0.3, height: 0.04 }],
        },
      },
    });

    expect(annotation.target.selection).toEqual({
      kind: "text-quote",
      exact: "Director：14 tests Web 相关回归：62 tests",
      prefix: "Timeline：215 tests ",
      suffix: " 三个相关包类型检查通过",
      visualRects: [{ x: 0.12, y: 0.42, width: 0.3, height: 0.04 }],
    });
    expect(serializeAgentAnnotationPromptBlock([annotation])).toContain(
      '"kind":"text-quote"',
    );
  });

  it("preserves Backchat browser element context in the agent prompt", () => {
    const result = AgentAnnotationDraftSchema.safeParse({
      id: "annotation-browser-1",
      kind: "agent-annotation",
      note: "Make this call to action clearer.",
      target: {
        projectId: "project-1",
        surface: "browser",
        surfaceId: "browser-tab-1",
        surfaceLabel: "Clash docs",
        objectId: "#hero-cta",
        objectType: "browser-element",
        objectLabel: "Start creating",
        objectPath: "browsers/browser-tab-1/elements/%23hero-cta",
        capabilities: ["read", "modify"],
        browser: {
          kind: "element",
          url: "https://clash.example/docs",
          title: "Clash docs",
          selector: "#hero-cta",
          domPath: "html > body > main > a",
          tagName: "a",
          text: "Start creating",
          outerHtml: '<a id="hero-cta">Start creating</a>',
          computedStyles: {
            color: "rgb(255, 255, 255)",
            background: "rgb(25, 25, 25)",
          },
          rect: { x: 120, y: 240, width: 160, height: 40 },
          viewport: { width: 1280, height: 720, devicePixelRatio: 2 },
        },
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.target.browser?.kind).toBe("element");
    if (result.data.target.browser?.kind !== "element") return;
    expect(result.data.target.browser.selector).toBe("#hero-cta");
    expect(serializeAgentAnnotationPromptBlock([result.data])).toContain(
      '"url":"https://clash.example/docs"',
    );
  });
});
