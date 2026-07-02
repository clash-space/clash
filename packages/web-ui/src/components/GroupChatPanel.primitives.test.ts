import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("GroupChatPanel primitives", () => {
  it("uses Ariakit tab primitives instead of handwritten tab semantics", () => {
    const panelSource = readSource("packages/web-ui/src/components/GroupChatPanel.tsx");
    const pillSource = readSource("packages/web-ui/src/_group-chat/TabPill.tsx");

    expect(panelSource).toContain("@ariakit/react");
    expect(panelSource).toContain("TabProvider");
    expect(panelSource).toContain("TabList");
    expect(panelSource).toContain("TabPanel");
    expect(panelSource).not.toContain('role="tablist"');
    expect(panelSource).not.toContain("onTabKeyDown");

    expect(pillSource).toContain("@ariakit/react");
    expect(pillSource).toContain("<Tab");
    expect(pillSource).not.toContain('role="tab"');
    expect(pillSource).not.toContain('role="button"');
    expect(pillSource).not.toContain("tabIndex={active ? 0 : -1}");
    expect(pillSource).not.toContain("aria-selected={active}");
  });

  it("uses the shared icon button primitive for tab removal controls", () => {
    const pillSource = readSource("packages/web-ui/src/_group-chat/TabPill.tsx");

    expect(pillSource).toContain("../components/ui/icon-button");
    expect(pillSource).toContain("<IconButton");
    expect(pillSource).not.toMatch(/<button[\s\S]*Remove \$\{label\} from room/);
    expect(pillSource).not.toContain(">×</button>");
  });

  it("uses the shared icon button primitive for invite controls", () => {
    const inviteMenuSource = readSource("packages/web-ui/src/_group-chat/InviteAgentMenu.tsx");

    expect(inviteMenuSource).toContain("../components/ui/icon-button");
    expect(inviteMenuSource).toContain("<IconButton");
    expect(inviteMenuSource).not.toMatch(/<motion\.button(?=[^>]*aria-label="Invite agent member")[^>]*>/);
  });

  it("uses the shared icon button primitive for refresh controls", () => {
    const panelSource = readSource("packages/web-ui/src/components/GroupChatPanel.tsx");

    expect(panelSource).toContain("./ui/icon-button");
    expect(panelSource).toMatch(/<IconButton(?=[\s\S]*label="Refresh room")[\s\S]*\/>/);
    expect(panelSource).not.toMatch(/<motion\.button(?=[^>]*aria-label="Refresh room")[^>]*>/);
  });

  it("uses the shared button primitive for jump-to-latest controls", () => {
    const agentViewSource = readSource("packages/web-ui/src/_group-chat/AgentView.tsx");
    const roomViewSource = readSource("packages/web-ui/src/_group-chat/RoomView.tsx");

    expect(agentViewSource).toContain("../components/ui/button");
    expect(roomViewSource).toContain("../components/ui/button");
    expect(agentViewSource).toContain("<Button");
    expect(roomViewSource).toContain("<Button");
    expect(agentViewSource).not.toMatch(/<button(?=[^>]*aria-label="Scroll to latest message")[^>]*>/);
    expect(roomViewSource).not.toMatch(/<button(?=[^>]*aria-label="Scroll to latest message")[^>]*>/);
  });

  it("uses the shared button primitive for retry controls", () => {
    const agentViewSource = readSource("packages/web-ui/src/_group-chat/AgentView.tsx");

    expect(agentViewSource).toMatch(/<Button(?=[\s\S]*aria-label="Retry agent session")[\s\S]*>/);
    expect(agentViewSource).not.toMatch(/<button(?=[^>]*aria-label="Retry agent session")[^>]*>/);
  });

  it("does not keep the deprecated handwritten mention autocomplete path alive", () => {
    const panelSource = readSource("packages/web-ui/src/components/GroupChatPanel.tsx");

    expect(panelSource).not.toContain("useMentionAutocomplete");
    expect(existsSync(join(process.cwd(), "packages/web-ui/src/hooks/useMentionAutocomplete.ts"))).toBe(false);
    expect(existsSync(join(process.cwd(), "packages/web-ui/src/_group-chat/MentionAutocomplete.tsx"))).toBe(false);
  });

  it("uses the shared tooltip primitive for rail icon controls instead of browser title attributes", () => {
    const panelSource = readSource("packages/web-ui/src/components/GroupChatPanel.tsx");
    const pillSource = readSource("packages/web-ui/src/_group-chat/TabPill.tsx");
    const tooltipSource = readSource("packages/web-ui/src/components/ui/tooltip.tsx");

    expect(tooltipSource).toContain("@ariakit/react");
    expect(tooltipSource).toContain("TooltipProvider");
    expect(panelSource).toContain("./ui/tooltip");
    expect(panelSource).toContain("<Tooltip label=");
    expect(panelSource).not.toContain("TooltipProvider");
    expect(panelSource).not.toContain("TooltipAnchor");
    expect(panelSource).not.toContain("title={isCollapsed ? 'Open chat' : 'Collapse'}");
    expect(panelSource).not.toContain('title="Refresh room"');
    expect(panelSource).not.toContain("title={sessionUser?.name ?? 'Settings'}");
    expect(panelSource).not.toContain('title="Credits balance"');
    expect(panelSource).not.toContain("title={syncIndicator.title}");

    expect(pillSource).toContain("../components/ui/tooltip");
    expect(pillSource).toContain("<Tooltip label=");
    expect(pillSource).not.toContain("title=");
  });

  it("uses a mature gesture primitive for panel resizing instead of document mouse listeners", () => {
    const panelSource = readSource("packages/web-ui/src/components/GroupChatPanel.tsx");

    expect(panelSource).toContain("@use-gesture/react");
    expect(panelSource).toContain("useDrag");
    expect(panelSource).toContain("resizeGestureBind()");
    expect(panelSource).not.toContain("document.addEventListener('mousemove'");
    expect(panelSource).not.toContain("document.addEventListener('mouseup'");
  });
});
