import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("SettingsSurface primitives", () => {
  it("uses the same compact identity and navigation rhythm as the project sidebar", () => {
    const source = readFileSync(
      join(process.cwd(), "packages/web-ui/src/components/SettingsSurface.tsx"),
      "utf8",
    );

    expect(source).toContain(
      'className="clash-settings-sidebar-header flex h-10 shrink-0 items-center px-2"',
    );
    expect(source).toContain(
      "relative flex h-8 w-full items-center gap-2 rounded-md",
    );
    expect(source).not.toContain("Workspace controls");
    expect(source).not.toContain("px-4 py-4");
  });

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
