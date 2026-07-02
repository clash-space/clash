import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readNodeSource = (file: string) =>
    readFileSync(join(process.cwd(), "packages/web-ui/src/components/nodes", file), "utf8");

const readUiSource = (file: string) =>
    readFileSync(join(process.cwd(), "packages/web-ui/src/components/ui", file), "utf8");

describe("media node description disclosure primitives", () => {
    it.each(["ImageNode.tsx", "VideoNode.tsx"])("%s uses the shared collapsible primitive for description disclosure", (file) => {
        const source = readNodeSource(file);

        expect(source).toContain("../ui/collapsible");
        expect(source).toContain("Collapsible");
        expect(source).toContain("CollapsibleTrigger asChild");
        expect(source).toContain("CollapsibleContent");
        expect(source).not.toContain("setShowDescription(!showDescription)");
        expect(source).not.toContain("{showDescription && (");
    });

    it.each(["ImageNode.tsx", "VideoNode.tsx"])("%s uses the shared tooltip primitive for description icon controls", (file) => {
        const source = readNodeSource(file);
        const tooltipSource = readUiSource("tooltip.tsx");

        expect(tooltipSource).toContain("@ariakit/react");
        expect(tooltipSource).toContain("TooltipProvider");
        expect(tooltipSource).toContain("TooltipAnchor");
        expect(source).toContain("../ui/tooltip");
        expect(source).toContain("<Tooltip label={descriptionOpen ? 'Hide description' : 'Show description'}>");
        expect(source).not.toContain("title={descriptionOpen ? 'Hide description' : 'Show description'}");
        expect(source).not.toContain("TooltipProvider");
        expect(source).not.toContain("TooltipAnchor");
    });

    it("VideoNode uses the shared tooltip primitive for thumbnail refresh", () => {
        const source = readNodeSource("VideoNode.tsx");

        expect(source).toContain("<Tooltip label=\"Refresh thumbnail\">");
        expect(source).toContain("ArrowClockwise");
        expect(source).toContain('aria-label="Refresh thumbnail"');
        expect(source).not.toContain("<svg xmlns=\"http://www.w3.org/2000/svg\"");
        expect(source).not.toContain('title="Refresh Thumbnail"');
    });

    it.each(["ImageNode.tsx", "VideoNode.tsx"])("%s lets ReactFlow own media control event boundaries", (file) => {
        const source = readNodeSource(file);

        expect(source).toContain("MEDIA_NODE_CONTROL_CLASS");
        expect(source).toContain("nodrag nopan");
        expect(source).not.toContain("onClick={(e) => e.stopPropagation()}");
    });
});
