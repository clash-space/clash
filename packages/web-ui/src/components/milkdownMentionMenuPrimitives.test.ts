import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (path: string) =>
  readFileSync(join(process.cwd(), path), "utf8");

describe("Milkdown mention menu primitives", () => {
  it("uses the shared popover primitive instead of hand-rolled portal positioning", () => {
    const source = readSource("packages/web-ui/src/components/MilkdownEditor.tsx");
    const popover = readSource("packages/web-ui/src/components/ui/popover.tsx");

    expect(source).toContain("./ui/popover");
    expect(source).toContain("Popover");
    expect(source).toContain("PopoverAnchor");
    expect(source).toContain("PopoverContent");
    expect(source).toContain("@ariakit/react");
    expect(source).toContain("ComboboxProvider");
    expect(source).toContain("ComboboxList");
    expect(source).toContain("ComboboxItem");
    expect(source).toContain("handleMentionComboboxKeyDown");
    expect(source).not.toContain("event.key === 'ArrowDown'");
    expect(source).not.toContain("event.key === 'ArrowUp'");
    expect(source).not.toContain("event.key === 'Escape'");
    expect(source).not.toContain("document.addEventListener('keydown'");
    expect(source).not.toContain("document.removeEventListener('keydown'");
    expect(source).not.toContain("selectedIndex");
    expect(source).not.toContain("setSelectedIndex");
    expect(source).not.toContain("createPortal");
    expect(source).not.toContain("getBoundingClientRect");
    expect(source).not.toContain("<button\n            key={node.id}");

    expect(popover).toContain("PopoverPrimitive.Root");
    expect(popover).toContain("PopoverPrimitive.Anchor");
    expect(popover).toContain("PopoverPrimitive.Content");
  });
});
