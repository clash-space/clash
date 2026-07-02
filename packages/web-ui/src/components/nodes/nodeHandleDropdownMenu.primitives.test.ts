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

        expect(source).toContain("../ui/dropdown-menu");
        expect(tooltipSource).toContain("@ariakit/react");
        expect(source).toContain("../ui/tooltip");
        expect(source).toContain("<Tooltip label={triggerLabel}>");
        expect(source).toContain("DropdownMenuTrigger asChild");
        expect(source).not.toContain("TooltipProvider");
        expect(source).not.toContain("TooltipAnchor");
    });
});
