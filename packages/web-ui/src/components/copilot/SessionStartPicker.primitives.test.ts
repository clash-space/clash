import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("SessionStartPicker primitives", () => {
  it("uses shared warning feedback for authentication recovery", () => {
    const source = readFileSync(
      join(process.cwd(), "packages/web-ui/src/components/copilot/SessionStartPicker.tsx"),
      "utf8",
    );

    expect(source).toContain("../ui/feedback");
    expect(source).toContain('<InlineAlert\n          tone="warning"');
    expect(source).not.toContain("border-amber-200");
  });

  it("uses the shared Button primitive for auth refresh and start actions", () => {
    const source = readFileSync(
      join(process.cwd(), "packages/web-ui/src/components/copilot/SessionStartPicker.tsx"),
      "utf8",
    );

    expect(source).toContain("../ui/button");
    expect(source).toMatch(/<Button[\s\S]*onClick=\{onRecheckAuth\}[\s\S]*Check again/);
    expect(source).toMatch(/<Button[\s\S]*onClick=\{\(\) => onStart/);
    expect(source).not.toMatch(/<button[\s\S]*onClick=\{onRecheckAuth\}/);
    expect(source).not.toMatch(/<button[\s\S]*onClick=\{\(\) => onStart/);
  });

  it("uses the shared Radix-backed radio group primitive for agent and resume choices", () => {
    const source = readFileSync(
      join(process.cwd(), "packages/web-ui/src/components/copilot/SessionStartPicker.tsx"),
      "utf8",
    );

    expect(source).toContain("../ui/radio-group");
    expect(source).toContain("RadioGroup");
    expect(source).toContain("RadioGroupItem");
    expect(source).not.toContain('type="radio"');
    expect(source).not.toContain('name="picker-agent"');
    expect(source).not.toContain('name="picker-session"');
  });
});
