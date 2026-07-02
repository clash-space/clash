import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("SettingsSurface primitives", () => {
  it("uses the shared Button primitive for sign out instead of a raw button", () => {
    const source = readFileSync(
      join(process.cwd(), "packages/web-ui/src/components/SettingsSurface.tsx"),
      "utf8",
    );

    expect(source).toContain("./ui/button");
    expect(source).toMatch(/<Button[\s\S]*onClick=\{handleSignOut\}[\s\S]*Sign out/);
    expect(source).not.toMatch(/<button[\s\S]*onClick=\{handleSignOut\}/);
  });
});
