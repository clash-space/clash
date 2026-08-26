import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sourceContains, sourceMatches } from "../test-support/source-match";

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

  it("uses shared tabs for machine selection and shared settings rows for agents", () => {
    const source = readSource("packages/web-ui/src/components/SettingsClient.tsx");
    const agentsStart = source.indexOf("function AgentsSection()");
    const agentsEnd = source.indexOf(
      "function UninstallHarnessDialog",
      agentsStart,
    );
    const agentsSource = source.slice(agentsStart, agentsEnd);

    expect(agentsSource).toContain("<TabProvider");
    expect(agentsSource).toContain('aria-label="Runtime machines"');
    expect(agentsSource).toContain("<Tab");
    expect(agentsSource).toContain("<SettingsCollection");
    expect(agentsSource).toContain("<SettingsRow");
    expect(agentsSource).not.toContain("RuntimeGroupCollapsible");
    expect(agentsSource).not.toContain("Collapse ${group.label}");
    expect(agentsSource).not.toContain("Expand ${group.label}");
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

  it("keeps disclosure on a shared primitive rather than hand-rolled open state", () => {
    const source = readSource("packages/web-ui/src/components/SettingsClient.tsx");

    // "Provider order" renders inline rather than behind a disclosure, so an earlier
    // assertion that it must sit inside an `<Accordion type="single">` described a
    // design that was never adopted -- none of the hand-rolled state names it forbade
    // (`expandedModelProviderOrderId`, `providerOrderOpen`) exist either.
    //
    // The rule that does apply is AGENTS.md's: where this file *does* collapse a
    // section, a shared primitive owns it.
    expect(sourceContains(source, "from './ui/collapsible'")).toBe(true);
    expect(sourceContains(source, "<Collapsible")).toBe(true);
    // Hand-rolled disclosure must not come back. Bound the gap explicitly: normalized
    // source is a single line, so `[^\n]*` would span the whole file and match an
    // unrelated `expanded` prop thousands of lines away.
    expect(sourceMatches(source, /useState.{0,40}providerOrderOpen/i)).toBe(false);
    expect(sourceContains(source, 'role="button"')).toBe(false);
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

  it("does not render native buttons, selects, or textareas directly in SettingsClient", () => {
    const source = readSource("packages/web-ui/src/components/SettingsClient.tsx");

    expect(sourceContains(source, "<button")).toBe(false);
    expect(sourceContains(source, "<select")).toBe(false);
    expect(sourceContains(source, "<textarea")).toBe(false);
  });

  it("keeps model detail fields, wireless lists, and save actions on shared primitives", () => {
    const source = readSource("packages/web-ui/src/components/SettingsClient.tsx");
    const detailStart = source.indexOf("const renderModelDetail =");
    const detailEnd = source.indexOf(
      "\n  return (\n    <SettingsSectionLayout>",
      detailStart,
    );
    const detailSource = source.slice(detailStart, detailEnd);

    expect(detailStart).toBeGreaterThan(-1);
    expect(detailEnd).toBeGreaterThan(detailStart);
    expect(sourceContains(detailSource, '<SettingsFieldGroup label="Model description">')).toBe(true);
    expect(sourceContains(detailSource, '<Textarea aria-label="Model description"')).toBe(true);
    expect(sourceContains(detailSource, '<SettingsFieldGroup label="Prompt guidance">')).toBe(true);
    expect(sourceContains(detailSource, '<Textarea aria-label="Prompt guidance"')).toBe(true);
    expect(sourceContains(detailSource, '<SettingsCollection as="ul"')).toBe(true);
    expect(sourceContains(detailSource, '<SettingsRow as="li"')).toBe(true);
    expect(sourceContains(detailSource, '<SettingsActions className="justify-between pt-2">')).toBe(true);
    expect(sourceMatches(detailSource, /<Button.{0,100}type="submit".{0,100}variant="primary".{0,180}Save model card/)).toBe(true);
  });
});
