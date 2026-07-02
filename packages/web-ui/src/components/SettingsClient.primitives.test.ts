import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (path: string) =>
  readFileSync(join(process.cwd(), path), "utf8");

describe("SettingsClient primitives", () => {
  it("uses native form submission instead of hand-rolled Enter key handlers", () => {
    const source = readSource("packages/web-ui/src/components/SettingsClient.tsx");

    expect(source).not.toContain("onKeyDown={(e) => e.key === 'Enter' && handleCreate()}");
    expect(source).not.toContain("onKeyDown={(e) => e.key === 'Enter' && handleAddVariable()}");
    expect(source).toContain("onSubmit={handleCreateTokenSubmit}");
    expect(source).toContain("onSubmit={handleAddVariableSubmit}");
  });
});
