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
        expect(source).not.toContain("document.addEventListener('pointerdown'");
        expect(source).not.toContain("document.addEventListener('keydown', onEsc");
    });

    it("computes reference picker candidates for both legacy and slot-target pickers", () => {
        const source = readNodeSource("ActionBadge.tsx");

        expect(source).toContain("showRefPicker || refPickerTarget !== null");
    });
});
