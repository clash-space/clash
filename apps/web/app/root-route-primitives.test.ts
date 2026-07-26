import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("root route primitives", () => {
  it("keeps the agent-creative philosophy consistent in public metadata", () => {
    const html = readFileSync(
      new URL("../index.html", import.meta.url),
      "utf8",
    );
    const manifest = JSON.parse(
      readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
    ) as { description?: string; keywords?: string[] };
    const readme = readFileSync(
      new URL("../../../README.md", import.meta.url),
      "utf8",
    );

    expect(html).toContain(
      "<title>Clash — Creative Platform for Agents</title>",
    );
    expect(html).toContain(
      'content="Where agents co-create, humans are welcome too. A desktop creative platform that gives agents real tools for planning, editing, directing, and producing."',
    );
    expect(html).toContain(
      '<link rel="canonical" href="https://clash.video/" />',
    );
    expect(html).toContain('<meta property="og:type" content="website" />');
    expect(html).toContain(
      '<meta property="og:url" content="https://clash.video/" />',
    );
    expect(manifest.description).toBe(
      "Where agents co-create, humans are welcome too.",
    );
    expect(manifest.keywords).toEqual(
      expect.arrayContaining(["creative-platform", "agent-platform"]),
    );
    expect(readme).toContain("# Clash — Creative Platform for Agents");
    expect(html).not.toContain(
      "AI-powered video creation and editing platform",
    );
    expect(html).not.toContain("Multi-agent canvas for creative video work");
  });

  it("publishes crawl directives and a focused public sitemap", () => {
    const robots = readFileSync(
      new URL("../public/robots.txt", import.meta.url),
      "utf8",
    );
    const sitemap = readFileSync(
      new URL("../public/sitemap.xml", import.meta.url),
      "utf8",
    );

    expect(robots).toContain("User-agent: *");
    expect(robots).toContain("Allow: /");
    expect(robots).toContain("Sitemap: https://clash.video/sitemap.xml");
    expect(sitemap).toContain("<loc>https://clash.video/</loc>");
    expect(sitemap).toContain("<loc>https://clash.video/download</loc>");
    expect(sitemap).toContain("<loc>https://clash.video/docs</loc>");
    expect(sitemap).not.toContain("/login");
  });

  it("publishes cache-busted Clash C install icons", () => {
    const html = readFileSync(
      new URL("../index.html", import.meta.url),
      "utf8",
    );
    const webManifest = JSON.parse(
      readFileSync(new URL("../public/site.webmanifest", import.meta.url), "utf8"),
    ) as { icons?: Array<{ src?: string }> };

    expect(html).toContain('href="/favicon-c.svg"');
    expect(html).toContain('href="/apple-touch-icon-c.png"');
    expect(webManifest.icons?.map((icon) => icon.src)).toEqual([
      "/icon-c-192.png",
      "/icon-c-512.png",
      "/maskable-icon-c-512.png",
    ]);
  });

  it("keeps the desktop runtime callout legible in dark mode", () => {
    const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

    expect(css).toContain(
      ".dark .clash-landing-runtime-panel strong {\n  color: #f5f5f4;",
    );
    expect(css).toContain(
      ".dark .clash-landing-runtime-panel p {\n  color: #d6d3d1;",
    );
  });

  it("routes error recovery actions through shared button primitives", () => {
    const source = readFileSync(new URL("./root.tsx", import.meta.url), "utf8");

    expect(source).toContain("@clash/web-ui/components/ui/button");
    expect(source).toContain("<Button");
    expect(source).not.toMatch(/<button[\s\S]*window\.location\.reload/);
  });

  it("shows response data when a route error has no status text", () => {
    const source = readFileSync(new URL("./root.tsx", import.meta.url), "utf8");

    expect(source).toContain("readRouteErrorDetail(error.data)");
    expect(source).not.toContain(
      'detail: error.statusText || "This route returned without a readable status message."',
    );
  });
});
