import { describe, expect, it } from "vitest";

import { resolveHarnessProjectSkillDirectory } from "./agent-skills";

describe("agent Skill project directories", () => {
  it("maps Clash harness ids to the project paths published by skills 1.5.20", () => {
    const expected = {
      "codex-acp": ".agents/skills",
      "claude-acp": ".claude/skills",
      gemini: ".agents/skills",
      opencode: ".agents/skills",
      cursor: ".agents/skills",
      "qwen-code": ".qwen/skills",
      "github-copilot-cli": ".agents/skills",
      kilo: ".kilocode/skills",
      "grok-build": ".grok/skills",
      "amp-acp": ".agents/skills",
      goose: ".goose/skills",
      cline: ".agents/skills",
      auggie: ".augment/skills",
    } as const;

    expect(
      Object.fromEntries(
        Object.keys(expected).map((harnessId) => [
          harnessId,
          resolveHarnessProjectSkillDirectory(harnessId),
        ]),
      ),
    ).toEqual(expected);
  });

  it("does not guess a directory for an unknown or custom harness", () => {
    expect(resolveHarnessProjectSkillDirectory("custom-acp")).toBeUndefined();
    expect(resolveHarnessProjectSkillDirectory("hermes")).toBeUndefined();
    expect(resolveHarnessProjectSkillDirectory("openclaw")).toBeUndefined();
    expect(resolveHarnessProjectSkillDirectory("")).toBeUndefined();
  });
});
