import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("root route primitives", () => {
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
