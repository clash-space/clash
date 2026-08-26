import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { sourceContains, sourceMatches } from "../test-support/source-match";

const readComponentSource = (file: string) =>
  readFileSync(
    join(process.cwd(), "packages/web-ui/src/components", file),
    "utf8",
  );

describe("ChatbotCopilot primitives", () => {
  it("uses the shared warning surface for runtime authentication recovery", () => {
    const source = readComponentSource("ChatbotCopilot.tsx");

    expect(source).toContain("./ui/feedback");
    expect(sourceMatches(source, /<FeedbackSurface\s+tone="warning"/)).toBe(
      true,
    );
    expect(source).not.toContain("border-amber-200/80 bg-amber-50/80");
  });

  it("renders runtime failures as an error card instead of assistant prose", () => {
    const source = readComponentSource("ChatbotCopilot.tsx");

    expect(sourceContains(source, 'part.type === "event_note"')).toBe(true);
    expect(source).toContain("<InlineAlert");
    expect(source).toContain('tone="error"');
    expect(source).not.toContain(
      'className="text-sm text-red-700 dark:text-red-300"',
    );
    expect(source).toContain("part.detail");
  });

  it("routes local harness recovery to the Agents settings section", () => {
    const source = readComponentSource("ChatbotCopilot.tsx");

    expect(sourceContains(source, 'actionLabel: "Open Agents"')).toBe(true);
    expect(
      sourceContains(source, 'actionHref: "/settings?section=agents"'),
    ).toBe(true);
    expect(sourceContains(source, 'actionLabel: "Open Runtimes"')).toBe(false);
    expect(
      sourceContains(source, 'actionHref: "/settings?section=runtimes"'),
    ).toBe(false);
  });

  it("uses the shared combobox primitive for the slash command palette", () => {
    const source = readComponentSource("ChatbotCopilot.tsx");
    const comboboxPath = join(
      process.cwd(),
      "packages/gui/src/components/ui/combobox.tsx",
    );
    const comboboxSource = existsSync(comboboxPath)
      ? readFileSync(comboboxPath, "utf8")
      : "";

    expect(existsSync(comboboxPath)).toBe(true);
    expect(comboboxSource).toContain("@ariakit/react");
    expect(source).toContain("./ui/combobox");
    expect(source).toContain("ComboboxProvider");
    expect(source).toContain("ComboboxList");
    expect(source).toContain("ComboboxItem");
    expect(source).not.toContain("@ariakit/react");
    expect(source).not.toContain('role="listbox"');
    expect(source).not.toContain('role="option"');
    expect(source).not.toContain("selectValueOnClick={false}");
    expect(source).not.toContain("onClick={() => onPick(command)}");
  });

  it("uses the shared tooltip primitive for slash command labels instead of browser title attributes", () => {
    const source = readComponentSource("ChatbotCopilot.tsx");

    expect(source).toContain("./ui/tooltip");
    expect(source).toContain(
      "<Tooltip key={command.name} label={description ?? `/${name}`}>",
    );
    expect(source).not.toContain("title={description ?? `/${name}`}");
  });

  it("uses the shared sheet primitive for the mobile copilot panel", () => {
    const source = readComponentSource("ChatbotCopilot.tsx");

    expect(source).toContain("./ui/sheet");
    expect(source).toContain("Sheet");
    expect(source).toContain("SheetContent");
    expect(source).not.toContain("useFocusTrap");
    expect(source).not.toContain("aria-modal=");
    expect(source).not.toContain(
      "role={isMobile && !isCollapsed ? 'dialog' : undefined}",
    );
  });

  it("routes queued prompt reordering through the shared sortable primitive", () => {
    const source = readComponentSource("ChatbotCopilot.tsx");

    expect(source).toContain("./ui/sortable");
    expect(source).toContain("SortableList");
    expect(source).toContain("useSortableItem");
    expect(source).not.toContain("@dnd-kit/");
    expect(source).not.toContain("DndContext");
    expect(source).not.toContain("SortableContext");
    expect(source).not.toMatch(/\buseSortable\b/);
    expect(source).not.toContain("dataTransfer");
    expect(source).not.toContain("draggable");
  });

  it("uses a mature gesture primitive for desktop panel resizing instead of document mouse listeners", () => {
    const source = readComponentSource("ChatbotCopilot.tsx");

    expect(source).toContain("./ui/gesture");
    expect(source).toContain("useDragGesture");
    expect(source).toContain("resizeGestureBind()");
    expect(source).toContain("onResizeStateChange?.(true)");
    expect(source).toContain("onResizeStateChange?.(false)");
    expect(source).not.toContain("@use-gesture/react");
    expect(source).not.toMatch(/\buseDrag\b/);
    expect(source).not.toContain("document.addEventListener('mousemove'");
    expect(source).not.toContain("document.addEventListener('mouseup'");
  });

  it("coalesces desktop resize previews and only commits the width when the gesture ends", () => {
    const source = readComponentSource("ChatbotCopilot.tsx");

    expect(source).toContain("clampCopilotPanelWidthForViewport");
    expect(source).toContain("requestAnimationFrame");
    expect(source).toContain("cancelAnimationFrame");
    expect(source).toContain("onWidthPreview?.(nextWidth)");
    expect(source).toContain("panelRef.current.style.width");
    expect(source).toMatch(/if \(last\)[\s\S]*?onWidthChange\(nextWidth\)/);
    expect(source).not.toContain("const COPILOT_PANEL_MAX_WIDTH_FRACTION");
    expect(source).not.toContain("const COPILOT_PANEL_MIN_WIDTH");
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

    expect(
      sourceMatches(
        source,
        /<DropdownMenu>.{0,300}<DropdownMenuTrigger asChild>.{0,300}label=\{t\("copilot\.header\.history"\)\}/,
      ),
    ).toBe(true);
    expect(source).not.toContain("const [showHistory, setShowHistory]");
    expect(source).not.toContain("setShowHistory(false)");
    expect(source).not.toContain("<DropdownMenu open={showHistory}");
    expect(source).not.toContain("onOpenChange={setShowHistory}");
  });

  it("lets the runtime dropdown primitive own open state", () => {
    const source = readComponentSource("ChatbotCopilot.tsx");

    expect(sourceContains(source, 'label={t("copilot.header.runOn")}')).toBe(
      true,
    );
    expect(source).not.toContain("const [runtimeMenuOpen, setRuntimeMenuOpen]");
    expect(source).not.toContain("setRuntimeMenuOpen(false)");
    expect(source).not.toContain("open={runtimeMenuOpen}");
    expect(source).not.toContain("setRuntimeMenuOpen(open)");
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
    const triggerStart = source.lastIndexOf(
      "<CollapsibleTrigger",
      fallbackStart,
    );
    const fallbackEnd = source.indexOf("</Collapsible>", fallbackStart);
    const fallbackSource = source.slice(triggerStart, fallbackEnd);

    expect(fallbackSource).toContain("CollapsibleTrigger asChild");
    expect(fallbackSource).toContain("<Button");
    expect(fallbackSource).toContain("Manual fallback");
    expect(fallbackSource).not.toContain("<CollapsibleTrigger className=");
  });

  it("lets the shared collapsible primitive own copilot panel trigger aria state", () => {
    const source = readComponentSource("ChatbotCopilot.tsx");

    expect(sourceContains(source, "Collapsible open={!isCollapsed}")).toBe(
      true,
    );
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
