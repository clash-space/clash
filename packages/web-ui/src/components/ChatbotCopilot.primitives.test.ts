import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readComponentSource = (file: string) =>
  readFileSync(join(process.cwd(), "packages/web-ui/src/components", file), "utf8");

describe("ChatbotCopilot primitives", () => {
  it("uses Ariakit combobox primitives for the slash command palette", () => {
    const source = readComponentSource("ChatbotCopilot.tsx");

    expect(source).toContain("@ariakit/react");
    expect(source).toContain("ComboboxProvider");
    expect(source).toContain("ComboboxList");
    expect(source).toContain("ComboboxItem");
    expect(source).not.toContain('role="listbox"');
    expect(source).not.toContain('role="option"');
  });
});
