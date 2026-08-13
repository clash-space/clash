import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("app router primitives", () => {
  it("loads the first-class Global Assets product route", () => {
    const source = readFileSync(new URL("./router.tsx", import.meta.url), "utf8");

    expect(source).toContain('path: "assets"');
    expect(source).toContain('import("./routes/assets")');
    expect(source).not.toContain('loader: () => redirect("/projects")');
  });
});
