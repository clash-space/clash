import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readGroupChatSource = (file: string) =>
  readFileSync(join(process.cwd(), "packages/web-ui/src/_group-chat", file), "utf8");

describe("MentionAutocomplete primitives", () => {
  it("uses Ariakit combobox list primitives instead of hand-written ARIA listbox markup", () => {
    const source = readGroupChatSource("MentionAutocomplete.tsx");

    expect(source).toContain("@ariakit/react");
    expect(source).toContain("ComboboxProvider");
    expect(source).toContain("ComboboxList");
    expect(source).toContain("ComboboxItem");
    expect(source).not.toContain('role="listbox"');
    expect(source).not.toContain('role="option"');
  });
});
