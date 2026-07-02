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
});
