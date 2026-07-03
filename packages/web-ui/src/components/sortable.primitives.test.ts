import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("Sortable primitives", () => {
  it("centralizes vertical dnd-kit wiring behind a shared primitive", async () => {
    const sortablePath = join(process.cwd(), "packages/web-ui/src/components/ui/sortable.tsx");

    expect(existsSync(sortablePath)).toBe(true);

    const sortableSource = readFileSync(sortablePath, "utf8");
    expect(sortableSource).toContain("@dnd-kit/core");
    expect(sortableSource).toContain("@dnd-kit/sortable");
    expect(sortableSource).toContain("SortableList");
    expect(sortableSource).toContain("useSortableItem");

    const sortable = await import("./ui/sortable");
    expect(sortable.reorderItemsById(["a", "b", "c"], "a", "c")).toEqual(["b", "c", "a"]);
    expect(sortable.reorderItemsById(["a", "b", "c"], "b", "b")).toBeNull();
    expect(sortable.reorderItemsById(["a", "b", "c"], "missing", "c")).toBeNull();
  });

  it.each([
    "packages/web-ui/src/components/SettingsClient.tsx",
    "packages/web-ui/src/components/ChatbotCopilot.tsx",
  ])("%s routes sortable behavior through the shared primitive", (file) => {
    const source = readSource(file);

    expect(source).toContain("/ui/sortable");
    expect(source).not.toContain("@dnd-kit/");
    expect(source).not.toContain("DndContext");
    expect(source).not.toContain("SortableContext");
    expect(source).not.toMatch(/\buseSortable\b/);
    expect(source).not.toContain("arrayMove");
    expect(source).not.toContain("CSS.Transform");
    expect(source).not.toContain("DragEndEvent");
    expect(source).not.toContain("PointerSensor");
    expect(source).not.toContain("KeyboardSensor");
  });
});
