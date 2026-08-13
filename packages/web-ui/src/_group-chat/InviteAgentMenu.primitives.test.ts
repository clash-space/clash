import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (path: string) =>
  readFileSync(join(process.cwd(), path), "utf8");

describe("InviteAgentMenu primitives", () => {
  it("uses the shared Radix-backed dropdown menu instead of hand-rolled portal positioning", () => {
    const source = readSource("packages/web-ui/src/_group-chat/InviteAgentMenu.tsx");
    const dropdown = readSource("packages/gui/src/components/ui/dropdown-menu.tsx");

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

  it("uses the shared tooltip primitive for the trigger and removes redundant browser title attributes", () => {
    const source = readSource("packages/web-ui/src/_group-chat/InviteAgentMenu.tsx");
    const tooltipSource = readSource("packages/gui/src/components/ui/tooltip.tsx");

    expect(tooltipSource).toContain("@ariakit/react");
    expect(source).toContain("../components/ui/tooltip");
    expect(source).toContain('<Tooltip label="Invite agent">');
    expect(source).not.toContain('title="Invite agent"');
    expect(source).not.toContain("title={offline ? 'Runtime offline' : ''}");
  });

  it("lets the dropdown primitive own open state instead of proxying parent state", () => {
    const menuSource = readSource("packages/web-ui/src/_group-chat/InviteAgentMenu.tsx");
    const panelSource = readSource("packages/web-ui/src/components/GroupChatPanel.tsx");

    expect(menuSource).toContain("<DropdownMenu>");
    expect(menuSource).not.toContain("open:");
    expect(menuSource).not.toContain("onToggle:");
    expect(menuSource).not.toContain("handleOpenChange");
    expect(menuSource).not.toContain("<DropdownMenu open=");
    expect(panelSource).not.toContain("showAddMenu");
    expect(panelSource).not.toContain("setShowAddMenu");
  });
});
