import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("MarketplaceClient primitives", () => {
  it("uses a single-select ToggleGroup for the marketplace filters", () => {
    const source = readFileSync(
      join(process.cwd(), "packages/web-ui/src/components/MarketplaceClient.tsx"),
      "utf8",
    );
    const start = source.indexOf("{/* Search + Filter */}");
    const end = source.indexOf("{/* Results */}", start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const filterSource = source.slice(start, end);

    expect(source).toContain("./ui/toggle-group");
    expect(filterSource).toContain("<ToggleGroup");
    expect(filterSource).toContain("<ToggleGroupItem");
    expect(filterSource).not.toContain("<button");
  });

  it("uses the shared Button primitive for install controls", () => {
    const source = readFileSync(
      join(process.cwd(), "packages/web-ui/src/components/MarketplaceClient.tsx"),
      "utf8",
    );

    expect(source).toContain("./ui/button");
    expect(source).toMatch(/<Button[\s\S]*onClick=\{\(\) => handleToggleInstall\(item\)\}/);
    expect(source).not.toContain("<motion.button");
  });
});
