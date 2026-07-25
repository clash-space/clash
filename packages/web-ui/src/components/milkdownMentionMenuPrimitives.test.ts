import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (path: string) =>
  readFileSync(join(process.cwd(), path), "utf8");

describe("Milkdown mention menu primitives", () => {
  it("uses the shared popover primitive with a body-level anchor for transformed chat panels", () => {
    const source = readSource("packages/web-ui/src/components/MilkdownEditor.tsx");
    const popover = readSource("packages/web-ui/src/components/ui/popover.tsx");
    const comboboxPath = join(process.cwd(), "packages/web-ui/src/components/ui/combobox.tsx");
    const comboboxSource = existsSync(comboboxPath) ? readFileSync(comboboxPath, "utf8") : "";

    expect(source).toContain("./ui/popover");
    expect(source).toContain("./ui/combobox");
    expect(source).toContain("Popover");
    expect(source).toContain("PopoverAnchor");
    expect(source).toContain("PopoverContent");
    expect(existsSync(comboboxPath)).toBe(true);
    expect(comboboxSource).toContain("@ariakit/react");
    expect(source).toContain("ComboboxProvider");
    expect(source).toContain("ComboboxList");
    expect(source).toContain("ComboboxItem");
    expect(source).not.toContain("@ariakit/react");
    expect(source).toContain("handleMentionComboboxKeyDown");
    expect(source).not.toContain("event.key === 'ArrowDown'");
    expect(source).not.toContain("event.key === 'ArrowUp'");
    expect(source).not.toContain("event.key === 'Escape'");
    expect(source).not.toContain("document.addEventListener('keydown'");
    expect(source).not.toContain("document.removeEventListener('keydown'");
    expect(source).not.toContain("selectedIndex");
    expect(source).not.toContain("setSelectedIndex");
    expect(source).toContain("createPortal");
    expect(source).toContain("document.body");
    expect(source).not.toContain("getBoundingClientRect");
    expect(source).not.toContain("querySelector('.ProseMirror')");
    expect(source).not.toContain("<button\n            key={node.id}");

    expect(popover).toContain("PopoverPrimitive.Root");
    expect(popover).toContain("PopoverPrimitive.Anchor");
    expect(popover).toContain("PopoverPrimitive.Content");
  });
});
