import { describe, expect, it } from "vitest";

import { visibleUserPromptText } from "./prompt-content.js";

describe("visibleUserPromptText", () => {
  it("keeps the authored prompt while removing internal protocol comments", () => {
    expect(visibleUserPromptText([
      '<!-- clash-workspace-context {"version":1} -->',
      '<!-- clash-agent-annotations {"version":1,"annotations":[]} -->',
      "Run pwd with your shell tool.",
    ].join("\n"))).toBe("Run pwd with your shell tool.");
  });
});
