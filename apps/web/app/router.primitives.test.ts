import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("app router primitives", () => {
  it("redirects the retired standalone Assets route to Projects", () => {
    const source = readFileSync(new URL("./router.tsx", import.meta.url), "utf8");

    expect(source).toContain('path: "assets"');
    expect(source).toContain('loader: () => redirect("/projects")');
    expect(source).not.toContain('import("./routes/assets")');
  });
});
