import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("login route primitives", () => {
  it("routes form controls through shared input and button primitives", () => {
    const source = readFileSync(new URL("./login.tsx", import.meta.url), "utf8");

    expect(source).toContain("@clash/gui/components/ui/button");
    expect(source).toContain("@clash/gui/components/ui/input");
    expect(source).toContain("<Button");
    expect(source).toContain("<Input");
    expect(source).not.toContain("<input");
    expect(source).not.toContain("<button");
    expect(source).not.toContain("<motion.button");
  });
});
