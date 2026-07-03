import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readComponentSource = (file: string) =>
  readFileSync(join(process.cwd(), "packages/web-ui/src/components", file), "utf8");

describe("ChatbotCopilot primitives", () => {
  it("uses Ariakit combobox primitives for the slash command palette", () => {
    const source = readComponentSource("ChatbotCopilot.tsx");

    expect(source).toContain("@ariakit/react");
    expect(source).toContain("ComboboxProvider");
    expect(source).toContain("ComboboxList");
    expect(source).toContain("ComboboxItem");
    expect(source).not.toContain('role="listbox"');
    expect(source).not.toContain('role="option"');
    expect(source).not.toContain("selectValueOnClick={false}");
    expect(source).not.toContain("onClick={() => onPick(command)}");
  });

  it("uses the shared tooltip primitive for slash command labels instead of browser title attributes", () => {
    const source = readComponentSource("ChatbotCopilot.tsx");

    expect(source).toContain("./ui/tooltip");
    expect(source).toContain("<Tooltip key={command.name} label={description ?? `/${name}`}>");
    expect(source).not.toContain("title={description ?? `/${name}`}");
  });

  it("uses the shared sheet primitive for the mobile copilot panel", () => {
    const source = readComponentSource("ChatbotCopilot.tsx");

    expect(source).toContain("./ui/sheet");
    expect(source).toContain("Sheet");
    expect(source).toContain("SheetContent");
    expect(source).not.toContain("useFocusTrap");
    expect(source).not.toContain("aria-modal=");
    expect(source).not.toContain('role={isMobile && !isCollapsed ? \'dialog\' : undefined}');
  });

  it("uses dnd-kit primitives for queued prompt reordering", () => {
    const source = readComponentSource("ChatbotCopilot.tsx");

    expect(source).toContain("@dnd-kit/core");
    expect(source).toContain("@dnd-kit/sortable");
    expect(source).toContain("DndContext");
    expect(source).toContain("SortableContext");
    expect(source).toContain("useSortable");
    expect(source).not.toContain("dataTransfer");
    expect(source).not.toContain("draggable");
  });

  it("uses a mature gesture primitive for desktop panel resizing instead of document mouse listeners", () => {
    const source = readComponentSource("ChatbotCopilot.tsx");

    expect(source).toContain("@use-gesture/react");
    expect(source).toContain("useDrag");
    expect(source).toContain("resizeGestureBind()");
    expect(source).not.toContain("document.addEventListener('mousemove'");
    expect(source).not.toContain("document.addEventListener('mouseup'");
  });

  it("uses the shared dropdown primitive for queued prompt row actions", () => {
    const source = readComponentSource("ChatbotCopilot.tsx");

    expect(source).toContain("DropdownMenuTrigger");
    expect(source).toContain("DropdownMenuContent");
    expect(source).toContain("DropdownMenuItem");
    expect(source).not.toContain("openMenuTurnId");
    expect(source).not.toContain("menuOpen");
    expect(source).not.toContain("onMenuOpenChange");
    expect(source).not.toContain("absolute right-0 top-8 z-40");
  });

  it("lets the history dropdown primitive own open state", () => {
    const source = readComponentSource("ChatbotCopilot.tsx");
    const historyFallbackStart = source.indexOf("label={t('copilot.header.history')}");
    const historyStart = source.lastIndexOf("\n                                    <DropdownMenu", historyFallbackStart);
    const historyEnd = source.indexOf("{!isDesktopLocalMode", historyFallbackStart);
    const historySource = source.slice(historyStart, historyEnd);

    expect(historyStart).toBeGreaterThan(-1);
    expect(source).not.toContain("const [showHistory, setShowHistory]");
    expect(source).not.toContain("setShowHistory(false)");
    expect(historySource).toContain("<DropdownMenu>");
    expect(historySource).not.toContain("<DropdownMenu open=");
    expect(historySource).not.toContain("onOpenChange={setShowHistory}");
  });

  it("lets the shared dropdown primitive own trigger aria state", () => {
    const source = readComponentSource("ChatbotCopilot.tsx");

    expect(source).toContain("DropdownMenuTrigger asChild");
    expect(source).not.toContain('aria-haspopup="menu"');
    expect(source).not.toContain("aria-expanded={showHistory}");
    expect(source).not.toContain("aria-expanded={runtimeMenuOpen}");
    expect(source).not.toContain("aria-controls={historyMenuId}");
    expect(source).not.toContain("aria-controls={runtimeMenuId}");
  });

  it("uses the shared collapsible primitive for auth manual fallback copy", () => {
    const source = readComponentSource("ChatbotCopilot.tsx");

    expect(source).toContain("./ui/collapsible");
    expect(source).toContain("Collapsible");
    expect(source).toContain("CollapsibleTrigger");
    expect(source).toContain("CollapsibleContent");
    expect(source).not.toContain("<details");
    expect(source).not.toContain("<summary");
  });

  it("uses the shared button primitive for auth manual fallback triggers", () => {
    const source = readComponentSource("ChatbotCopilot.tsx");
    const noticeStart = source.indexOf("function RuntimeAuthNotice");
    const fallbackStart = source.indexOf("Manual fallback", noticeStart);
    const triggerStart = source.lastIndexOf("<CollapsibleTrigger", fallbackStart);
    const fallbackEnd = source.indexOf("</Collapsible>", fallbackStart);
    const fallbackSource = source.slice(triggerStart, fallbackEnd);

    expect(fallbackSource).toContain("CollapsibleTrigger asChild");
    expect(fallbackSource).toContain("<Button");
    expect(fallbackSource).toContain("Manual fallback");
    expect(fallbackSource).not.toContain("<CollapsibleTrigger className=");
  });

  it("lets the shared collapsible primitive own copilot panel trigger aria state", () => {
    const source = readComponentSource("ChatbotCopilot.tsx");

    expect(source).toContain("Collapsible open={!isCollapsed}");
    expect(source).toContain("CollapsibleTrigger asChild");
    expect(source).not.toContain("aria-expanded={false}");
    expect(source).not.toContain("aria-expanded={true}");
  });

  it("uses shared button primitives for copilot launcher, prompts, auth, and queue controls", () => {
    const source = readComponentSource("ChatbotCopilot.tsx");

    expect(source).toContain("./ui/button");
    expect(source).toContain("./ui/icon-button");
    expect(source).toContain("<Button");
    expect(source).toContain("<IconButton");
    expect(source).not.toContain("<motion.button");
    expect(source).not.toContain("<button");
  });
});
