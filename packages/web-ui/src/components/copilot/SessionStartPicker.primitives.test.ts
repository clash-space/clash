import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("SessionStartPicker primitives", () => {
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
});
