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
    expect(source).not.toContain("createPortal");
    expect(source).not.toContain("getBoundingClientRect");

    expect(popover).toContain("PopoverPrimitive.Root");
    expect(popover).toContain("PopoverPrimitive.Anchor");
    expect(popover).toContain("PopoverPrimitive.Content");
  });
});
