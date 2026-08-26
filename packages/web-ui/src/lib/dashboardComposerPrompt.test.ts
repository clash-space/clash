import { describe, expect, it } from "vitest";

import { buildDashboardComposerPrompt } from "./dashboardComposerPrompt";

describe("buildDashboardComposerPrompt", () => {
  it("sends an ordinary draft unchanged when it has no Skill references", () => {
    expect(buildDashboardComposerPrompt("  Make a quiet forest scene  ", [])).toBe(
      "Make a quiet forest scene",
    );
  });

  it("turns each Skill reference into an agent-recognizable invocation", () => {
    expect(
      buildDashboardComposerPrompt("Make a quiet forest scene", [
        { id: "skill-seedance", name: "sd25-pe" },
        { id: "skill-storyboard", name: "storyboard" },
      ]),
    ).toBe("$sd25-pe $storyboard\n\nMake a quiet forest scene");
  });

  it("does not repeat the same Skill invocation", () => {
    expect(
      buildDashboardComposerPrompt("Make a quiet forest scene", [
        { id: "skill-seedance", name: "sd25-pe" },
        { id: "skill-seedance", name: "sd25-pe" },
      ]),
    ).toBe("$sd25-pe\n\nMake a quiet forest scene");
  });
});
