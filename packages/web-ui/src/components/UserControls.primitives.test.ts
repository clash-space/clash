import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = () =>
  readFileSync(join(process.cwd(), "packages/web-ui/src/components/UserControls.tsx"), "utf8");

describe("UserControls primitive contracts", () => {
  it("uses the shared Button primitive for the hosted account menu trigger", () => {
    const source = readSource();

    expect(source).toContain("./ui/button");
    expect(source).toMatch(/<Button[\s\S]*aria-label=\{`Account menu/);
    expect(source).not.toMatch(/<button[\s\S]*aria-label=\{`Account menu/);
  });
});
