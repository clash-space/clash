import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readNodeSource = (file: string) =>
    readFileSync(join(process.cwd(), "packages/web-ui/src/components/nodes", file), "utf8");

const readUiSource = (file: string) =>
    readFileSync(join(process.cwd(), "packages/web-ui/src/components/ui", file), "utf8");

describe("NodeHandleDropdownMenu primitives", () => {
    it("uses the shared dropdown and tooltip primitives for the tiny handle trigger", () => {
        const source = readNodeSource("NodeHandleDropdownMenu.tsx");
        const tooltipSource = readUiSource("tooltip.tsx");

        expect(source).toContain("../ui/icon-button");
        expect(source).toContain("../ui/dropdown-menu");
        expect(tooltipSource).toContain("@ariakit/react");
        expect(source).toContain("../ui/tooltip");
        expect(source).toContain("<Tooltip label={triggerLabel}>");
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
});
