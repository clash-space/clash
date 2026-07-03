import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("root route primitives", () => {
  it("routes error recovery actions through shared button primitives", () => {
    const source = readFileSync(join(process.cwd(), "apps/web/app/root.tsx"), "utf8");

    expect(source).toContain("@clash/web-ui/components/ui/button");
    expect(source).toContain("<Button");
    expect(source).not.toMatch(/<button[\s\S]*window\.location\.reload/);
  });
});
