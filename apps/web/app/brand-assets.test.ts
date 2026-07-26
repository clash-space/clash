import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "../../..");

describe("Clash brand assets", () => {
  it("uses the theme-colored Clash C for the browser tab favicon", () => {
    const favicon = readFileSync(
      join(repoRoot, "apps/web/public/favicon-c.svg"),
      "utf8",
    );
    const mark = readFileSync(
      join(repoRoot, "apps/web/public/brand/logo-mark.svg"),
      "utf8",
    );
    const html = readFileSync(join(repoRoot, "apps/web/index.html"), "utf8");

    expect(favicon).toBe(mark);
    expect(favicon).toContain("#FF6B50");
    expect(favicon).toContain('aria-label="Clash C"');
    expect(favicon).not.toMatch(/<ellipse|Clash agent|logo-mark-animated/);
    expect(html).toContain('href="/favicon-c.svg"');
  });

  it("keeps the editable social preview brand source on the same Clash C wordmark", () => {
    const source = readFileSync(
      join(repoRoot, ".github/social-preview-brand.svg"),
      "utf8",
    );

    expect(source).toContain('aria-label="Clash"');
    expect(source).toContain('class="clash-c"');
    expect(source).toContain('fill="#FF6B50"');
    expect(source).toContain(">C</text>");
    expect(source).toContain(">lash</text>");
    expect(source).not.toMatch(/<ellipse|agent|face/i);
  });

  it("uses the Clash C for the packaged desktop application icon", () => {
    const source = readFileSync(
      join(repoRoot, "apps/desktop/build/icon.svg"),
      "utf8",
    );

    expect(source).toContain('aria-label="Clash C app icon"');
    expect(source).toContain("#FF6B50");
    expect(source).not.toMatch(/<ellipse|agent|face/i);
  });

  it("uses cache-busted Clash C assets on product logo surfaces", () => {
    const consumers = [
      "apps/web/app/root.tsx",
      "apps/web/app/routes/login.tsx",
      "packages/web-ui/src/components/ProjectsClient.tsx",
      "packages/web-ui/src/components/SettingsClient.tsx",
      "packages/web-ui/src/components/TopNavigation.tsx",
    ]
      .map((path) => readFileSync(join(repoRoot, path), "utf8"))
      .join("\n");

    expect(consumers).toContain("/brand/logo-c.svg");
    expect(consumers).toContain("/brand/logo-c-animated.svg");
    expect(consumers).toContain("/brand/logo-c-error.svg");
    expect(consumers).not.toContain("/brand/logo-mark");
  });
});
