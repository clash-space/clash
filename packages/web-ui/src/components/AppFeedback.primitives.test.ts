import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { sourceMatches } from "../test-support/source-match";

describe("AppFeedback primitives", () => {
  it("uses the shared IconButton primitive for toast dismiss controls", () => {
    const source = readFileSync(
      join(process.cwd(), "packages/web-ui/src/components/AppFeedback.tsx"),
      "utf8",
    );

    expect(source).toContain("./ui/icon-button");
    expect(source).toContain("<IconButton");
    expect(source).not.toMatch(/<button[\s\S]*aria-label="Dismiss notification"/);
  });

  it("uses the shared Button primitive for toast action controls", () => {
    const source = readFileSync(
      join(process.cwd(), "packages/web-ui/src/components/AppFeedback.tsx"),
      "utf8",
    );

    expect(source).toContain("./ui/button");
    expect(source).toMatch(/<Button[\s\S]*toast\.onAction\(\)[\s\S]*>/);
    expect(source).not.toMatch(/<button[\s\S]{0,300}toast\.onAction\(\)/);
  });

  it("does not keep a second, unused dialog feedback channel", () => {
    const source = readFileSync(
      join(process.cwd(), "packages/web-ui/src/components/AppFeedback.tsx"),
      "utf8",
    );

    expect(sourceMatches(source, /\bshowDialog\b/)).toBe(false);
    expect(sourceMatches(source, /<Dialog\b/)).toBe(false);
  });
});
