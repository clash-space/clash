import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readNodeSource = (file: string) =>
    readFileSync(join(process.cwd(), "packages/web-ui/src/components/nodes", file), "utf8");

describe("NodeHandleDropdownMenu primitives", () => {
    it("uses the shared dropdown without a tooltip competing with the hover menu", () => {
        const source = readNodeSource("NodeHandleDropdownMenu.tsx");

        expect(source).toContain("../ui/icon-button");
        expect(source).toContain("../ui/dropdown-menu");
        expect(source).not.toContain("../ui/tooltip");
        expect(source).not.toContain("<Tooltip");
        expect(source).toContain("DropdownMenuTrigger asChild");
        expect(source).toMatch(/<IconButton[\s\S]*label=\{triggerLabel\}/);
        expect(source).not.toMatch(/<button[\s\S]*aria-label=\{triggerLabel\}/);
        expect(source).not.toContain("TooltipProvider");
        expect(source).not.toContain("TooltipAnchor");
    });

    it("keeps node handle menu items off browser title tooltips", () => {
        const pipelineSource = readNodeSource("ActionBadgePipelineMenu.tsx");
        const sourceHandleSource = readNodeSource("SourceHandleMenu.tsx");

        expect(pipelineSource).not.toContain("title=");
        expect(sourceHandleSource).not.toContain("title=");
    });

    it("lets Radix trigger state drive the handle open styling", () => {
        const source = readNodeSource("NodeHandleDropdownMenu.tsx");

        expect(source).toContain("group/handle-trigger");
        expect(source).toContain("group-data-[state=open]/handle-trigger:!bg-brand");
        expect(source).not.toContain("useState");
        expect(source).not.toContain("open ? ");
        expect(source).not.toContain("setOpen(nextOpen)");
    });
});
