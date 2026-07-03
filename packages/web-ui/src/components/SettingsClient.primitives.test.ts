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

  it("uses the shared button primitive for agent auth fallback triggers", () => {
    const source = readSource("packages/web-ui/src/components/SettingsClient.tsx");
    const fallbackStart = source.indexOf("needsAuth && harness.auth?.command");
    const fallbackEnd = source.indexOf("</Collapsible>", fallbackStart);
    const fallbackSource = source.slice(fallbackStart, fallbackEnd);

    expect(fallbackSource).toContain("CollapsibleTrigger asChild");
    expect(fallbackSource).toContain("<Button");
    expect(fallbackSource).toContain("Manual fallback");
    expect(fallbackSource).not.toContain("<CollapsibleTrigger className=");
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

  it("uses the shared radio group primitive for sync mode selection", () => {
    const source = readSource("packages/web-ui/src/components/SettingsClient.tsx");

    expect(source).toContain("./ui/radio-group");
    expect(source).toContain("RadioGroup");
    expect(source).toContain("RadioGroupItem");
    expect(source).not.toContain('name="sync-mode"');
    expect(source).not.toContain('type="radio"');
  });

  it("keeps provider key editor focus inside React refs instead of document queries", () => {
    const source = readSource("packages/web-ui/src/components/SettingsClient.tsx");

    expect(source).toContain("providerKeyInputRef");
    expect(source).not.toContain("document.querySelector<HTMLInputElement>('[data-provider-key-input=\"true\"]')?.focus()");
    expect(source).not.toContain('data-provider-key-input="true"');
  });

  it("uses shared button primitives for token, variable, action, and skill controls", () => {
    const source = readSource("packages/web-ui/src/components/SettingsClient.tsx");

    expect(source).toContain("./ui/button");
    expect(source).toContain("./ui/icon-button");
    expect(source).toContain("<Button");
    expect(source).toContain("<IconButton");
    expect(source).not.toContain("<motion.button");
    expect(source).not.toMatch(/<button[\s\S]{0,240}handleCopy\(revealedToken/);
    expect(source).not.toMatch(/<button[\s\S]{0,180}setRevealedToken\(null\)/);
    expect(source).not.toMatch(/<button[\s\S]{0,180}handleRevoke\(token\.id\)/);
    expect(source).not.toMatch(/<button[\s\S]{0,240}setNewVarKey\(preset\.defaultSecretId\)/);
    expect(source).not.toMatch(/<button[\s\S]{0,180}setShowVarValue\(!showVarValue\)/);
    expect(source).not.toMatch(/<button[\s\S]{0,180}handleDeleteVariable\(v\.id\)/);
    expect(source).not.toMatch(/<button[\s\S]{0,180}handleUninstallAction\(action\.actionId\)/);
    expect(source).not.toMatch(/<button[\s\S]{0,180}handleUninstallSkill\(skill\.skillId\)/);
  });

  it("uses shared button primitives for provider and model routing controls", () => {
    const source = readSource("packages/web-ui/src/components/SettingsClient.tsx");

    expect(source).not.toMatch(/<button[\s\S]{0,240}aria-label=\{`Drag \$\{accountLabel\}`\}/);
    expect(source).not.toMatch(/<button[\s\S]{0,220}onClick=\{onOpen\}/);
    expect(source).not.toMatch(/<button[\s\S]{0,240}onMoveUp\(\)/);
    expect(source).not.toMatch(/<button[\s\S]{0,240}onMoveDown\(\)/);
    expect(source).not.toMatch(/<button[\s\S]{0,260}setExpandedModelProviderOrderId/);
    expect(source).not.toMatch(/<button[\s\S]{0,220}moveModelProvider\(index, index - 1\)/);
    expect(source).not.toMatch(/<button[\s\S]{0,220}moveModelProvider\(index, index \+ 1\)/);
    expect(source).not.toMatch(/<button[\s\S]{0,220}deployLocalAsrModel\(entry\)/);
    expect(source).not.toMatch(/<button[\s\S]{0,220}setSelectedProviderKey\(row\.key\)/);
  });

  it("uses shared button primitives for provider key editor controls", () => {
    const source = readSource("packages/web-ui/src/components/SettingsClient.tsx");

    expect(source).not.toMatch(/<button[\s\S]{0,220}closeProviderKeyEditor/);
    expect(source).not.toMatch(/<button[\s\S]{0,260}onStartProviderOAuth/);
    expect(source).not.toMatch(/<button[\s\S]{0,260}onCompleteProviderOAuth/);
    expect(source).not.toMatch(/<button[\s\S]{0,220}setSupportedModelIdsDraft/);
    expect(source).not.toMatch(/<button[\s\S]{0,220}runProviderTest\(\)/);
    expect(source).not.toMatch(/<button[\s\S]{0,220}deleteSavedAccount\(\)/);
    expect(source).not.toMatch(/<button[\s\S]{0,260}setSelectedProviderKey\(null\)/);
    expect(source).not.toMatch(/<button[\s\S]{0,220}openPrioritizedKeyEditor/);
  });

  it("uses shared button primitives for runtime machine and audio setup controls", () => {
    const source = readSource("packages/web-ui/src/components/SettingsClient.tsx");

    expect(source).not.toMatch(/<button[\s\S]{0,220}onRemoveRuntime\(runtime\.id, label\)/);
    expect(source).not.toMatch(/<button[\s\S]{0,220}onClick=\{openSetupDialog\}/);
    expect(source).not.toMatch(/<button[\s\S]{0,180}setSetupDialog\(null\)/);
  });

  it("does not render native buttons directly in SettingsClient", () => {
    const source = readSource("packages/web-ui/src/components/SettingsClient.tsx");

    expect(source).not.toContain("<button");
  });
});
