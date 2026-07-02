import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readNodeSource = (file: string) =>
    readFileSync(join(process.cwd(), "packages/web-ui/src/components/nodes", file), "utf8");

describe("ActionBadge popover primitives", () => {
    it("uses shared popover primitives for picker menus instead of hand-rolled document listeners", () => {
        const source = readNodeSource("ActionBadge.tsx");

        expect(source).toContain("../ui/popover");
        expect(source).toContain("PopoverContent");
        expect(source).toContain("open={showPanel}");
        expect(source).toContain("PopoverTrigger asChild");
        expect(source).not.toContain("createPortal");
        expect(source).not.toContain("document.addEventListener('mousedown'");
        expect(source).not.toContain("document.removeEventListener('mousedown'");
        expect(source).not.toContain("document.addEventListener('pointerdown'");
        expect(source).not.toContain("document.addEventListener('keydown', onEsc");
    });

    it("computes reference picker candidates for both legacy and slot-target pickers", () => {
        const source = readNodeSource("ActionBadge.tsx");

        expect(source).toContain("showRefPicker || refPickerTarget !== null");
    });

    it("uses the shared node modal shell for the expanded prompt editor", () => {
        const source = readNodeSource("ActionBadge.tsx");

        expect(source).toContain("./NodeModalDialog");
        expect(source).not.toContain("fixed inset-0 z-[9999] flex items-center justify-center p-8");
    });

    it("uses Ariakit combobox primitives for the inline asset mention picker", () => {
        const source = readNodeSource("ActionBadge.tsx");

        expect(source).toContain("@ariakit/react");
        expect(source).toContain("ComboboxProvider");
        expect(source).toContain("ComboboxList");
        expect(source).toContain("ComboboxItem");
        expect(source).not.toContain("@ mention dropdown with thumbnails");
        expect(source).not.toContain("absolute left-4 right-4 bottom-full mb-1 bg-warm-surface border border-warm-border rounded-xl shadow-lg z-50 max-h-48 overflow-y-auto");
    });
});
