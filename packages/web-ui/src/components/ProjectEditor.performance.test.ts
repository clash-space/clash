import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("ProjectEditor canvas performance", () => {
  it("keeps ReactFlow viewport virtualization enabled", () => {
    const source = readFileSync(
      join(process.cwd(), "packages/web-ui/src/components/ProjectEditor.tsx"),
      "utf8",
    );

    expect(source).toMatch(/onlyRenderVisibleElements/);
  });
});
