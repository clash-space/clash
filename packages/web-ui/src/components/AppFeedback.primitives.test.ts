import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

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

  it("uses the shared Button primitive for dialog actions", () => {
    const source = readFileSync(
      join(process.cwd(), "packages/web-ui/src/components/AppFeedback.tsx"),
      "utf8",
    );

    expect(source).toMatch(/<Button[\s\S]*className="clash-settings-primary[\s\S]*dialog\?\.actionLabel/);
    expect(source).not.toMatch(/<button[\s\S]{0,300}className="clash-settings-primary/);
  });
});
