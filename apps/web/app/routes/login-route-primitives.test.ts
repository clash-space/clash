import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("login route primitives", () => {
  it("routes form controls through shared input and button primitives", () => {
    const source = readFileSync(join(process.cwd(), "apps/web/app/routes/login.tsx"), "utf8");

    expect(source).toContain("@clash/web-ui/components/ui/button");
    expect(source).toContain("@clash/web-ui/components/ui/input");
    expect(source).toContain("<Button");
    expect(source).toContain("<Input");
    expect(source).not.toContain("<input");
    expect(source).not.toContain("<button");
    expect(source).not.toContain("<motion.button");
  });
});
