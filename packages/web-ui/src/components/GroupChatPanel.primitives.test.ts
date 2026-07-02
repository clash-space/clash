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

  it("does not keep the deprecated handwritten mention autocomplete path alive", () => {
    const panelSource = readSource("packages/web-ui/src/components/GroupChatPanel.tsx");

    expect(panelSource).not.toContain("useMentionAutocomplete");
    expect(existsSync(join(process.cwd(), "packages/web-ui/src/hooks/useMentionAutocomplete.ts"))).toBe(false);
    expect(existsSync(join(process.cwd(), "packages/web-ui/src/_group-chat/MentionAutocomplete.tsx"))).toBe(false);
  });
});
