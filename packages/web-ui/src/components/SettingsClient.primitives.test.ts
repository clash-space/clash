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
    expect(source).not.toContain("onKeyDown={(e) => {\n                                        if (e.key === 'Enter')");
    expect(source).toContain("onSubmit={handleCreateTokenSubmit}");
    expect(source).toContain("onSubmit={handleAddVariableSubmit}");
    expect(source).toContain("onSubmit={handleProviderKeyEditorSubmit}");
  });

  it("uses shared collapsible primitives for agent auth fallback copy", () => {
    const source = readSource("packages/web-ui/src/components/SettingsClient.tsx");

    expect(source).toContain("./ui/collapsible");
    expect(source).toContain("Collapsible");
    expect(source).toContain("CollapsibleTrigger");
    expect(source).toContain("CollapsibleContent");
    expect(source).not.toContain("<details");
    expect(source).not.toContain("<summary");
  });

  it("uses shared collapsible primitives for agent runtime groups", () => {
    const source = readSource("packages/web-ui/src/components/SettingsClient.tsx");

    expect(source).toMatch(/<Collapsible\s+[\s\S]*open=\{!collapsed\}[\s\S]*onOpenChange=\{\(open\) => setRuntimeCollapsed\(group\.id, !open\)\}/);
    expect(source).toContain("CollapsibleTrigger asChild");
    expect(source).toContain("CollapsibleContent asChild");
    expect(source).not.toContain("aria-expanded={!collapsed}");
    expect(source).not.toContain("onClick={() => toggleRuntimeCollapsed(group.id)}");
    expect(source).not.toContain("const toggleRuntimeCollapsed");
  });

  it("keeps provider key editor focus inside React refs instead of document queries", () => {
    const source = readSource("packages/web-ui/src/components/SettingsClient.tsx");

    expect(source).toContain("providerKeyInputRef");
    expect(source).not.toContain("document.querySelector<HTMLInputElement>('[data-provider-key-input=\"true\"]')?.focus()");
    expect(source).not.toContain('data-provider-key-input="true"');
  });
});
