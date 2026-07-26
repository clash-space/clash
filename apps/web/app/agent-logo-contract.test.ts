import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "../../..");

const readRepoFile = (path: string) =>
  readFileSync(join(repoRoot, path), "utf8");

describe("Clash agent logo contract", () => {
  it("uses the chatbot avatar for the packaged desktop application", () => {
    const source = readRepoFile("apps/desktop/build/icon.svg");

    expect(source).toContain('aria-label="Clash app icon"');
    expect(source.match(/<ellipse/g)).toHaveLength(2);
    expect(source).toContain('stroke="#171412"');
    expect(source).toContain('fill="#FF6B50"');
    expect(source).not.toContain("Clash C app icon");
  });

  it("uses the chatbot avatar across browser and product logo surfaces", () => {
    const favicon = readRepoFile("apps/web/public/favicon.svg");
    const mark = readRepoFile("apps/web/public/brand/logo-mark.svg");
    const html = readRepoFile("apps/web/index.html");
    const consumers = [
      "apps/web/app/root.tsx",
      "apps/web/app/routes/login.tsx",
      "packages/web-ui/src/components/ProjectsClient.tsx",
      "packages/web-ui/src/components/SettingsClient.tsx",
      "packages/web-ui/src/components/TopNavigation.tsx",
    ]
      .map(readRepoFile)
      .join("\n");

    expect(favicon).toBe(mark);
    expect(mark.match(/<ellipse/g)).toHaveLength(2);
    expect(mark).toContain("#FF6B50");
    expect(html).toContain('href="/favicon.svg"');
    expect(html).not.toContain('href="/favicon-c.svg"');
    expect(consumers).toContain("/brand/logo-mark.svg");
    expect(consumers).not.toContain("/brand/logo-c");
  });
});
