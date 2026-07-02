import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (path: string) =>
  readFileSync(join(process.cwd(), path), "utf8");

describe("InviteAgentMenu primitives", () => {
  it("uses the shared Radix-backed dropdown menu instead of hand-rolled portal positioning", () => {
    const source = readSource("packages/web-ui/src/_group-chat/InviteAgentMenu.tsx");
    const dropdown = readSource("packages/web-ui/src/components/ui/dropdown-menu.tsx");

    expect(source).toContain("../components/ui/dropdown-menu");
    expect(source).toContain("DropdownMenu");
    expect(source).toContain("DropdownMenuTrigger");
    expect(source).toContain("DropdownMenuContent");
    expect(source).toContain("DropdownMenuItem");
    expect(source).not.toContain("createPortal");
    expect(source).not.toContain("getBoundingClientRect");
    expect(source).not.toContain("document.addEventListener('mousedown'");

    expect(dropdown).toContain("DropdownMenuPrimitive.Root");
    expect(dropdown).toContain("DropdownMenuPrimitive.Trigger");
    expect(dropdown).toContain("DropdownMenuPrimitive.Content");
    expect(dropdown).toContain("DropdownMenuPrimitive.Item");
  });
});
