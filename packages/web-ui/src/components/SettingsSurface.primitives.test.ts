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

  it("keeps the active section label readable on a tinted dark surface", () => {
    const source = readFileSync(
      join(process.cwd(), "packages/web-ui/src/components/SettingsSurface.tsx"),
      "utf8",
    );

    expect(source).toContain("dark:text-neutral-100");
    expect(source).not.toContain("dark:text-brand-light");
  });

  it("reserves the brand color for the slim active-section indicator", () => {
    const source = readFileSync(
      join(process.cwd(), "packages/web-ui/src/components/SettingsSurface.tsx"),
      "utf8",
    );

    expect(source).toContain(
      "border-warm-border bg-warm-hover text-content-primary shadow-sm",
    );
    expect(source).toContain(
      "absolute left-1 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-brand",
    );
    expect(source).not.toContain(
      "border-brand/35 bg-brand-light text-brand shadow-sm",
    );
    expect(source).not.toContain(
      "className={`h-4 w-4 ${isActive ? 'text-brand' : ''}`}",
    );
  });

  it("keeps inactive section labels readable while hovering in dark mode", () => {
    const source = readFileSync(
      join(process.cwd(), "packages/web-ui/src/components/SettingsSurface.tsx"),
      "utf8",
    );

    expect(source).toContain(
      "border-transparent text-content-secondary hover:bg-warm-hover hover:text-content-primary",
    );
    expect(source).not.toContain(
      "border-transparent text-stone-700 hover:bg-warm-surface/60 hover:text-stone-900 dark:text-stone-200",
    );
  });
});
