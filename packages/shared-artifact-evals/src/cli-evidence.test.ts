import { describe, expect, it } from "vitest";

import { matchesRequiredCliCommand } from "./runner";

describe("native CLI execution evidence", () => {
  it("does not count help or version discovery as a product command", () => {
    expect(matchesRequiredCliCommand("timeline render", ["timeline", "render", "--help"]))
      .toBe(false);
    expect(matchesRequiredCliCommand("timeline render", ["timeline", "render", "-h"]))
      .toBe(false);
    expect(matchesRequiredCliCommand("timeline render", ["--version"]))
      .toBe(false);
  });

  it("accepts a successful invocation with the required command prefix", () => {
    expect(matchesRequiredCliCommand("timeline render", [
      "timeline",
      "render",
      "--timeline",
      "character-cut",
      "--json",
    ])).toBe(true);
  });
});
