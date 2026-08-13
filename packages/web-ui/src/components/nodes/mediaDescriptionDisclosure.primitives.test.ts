import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readNodeSource = (file: string) =>
    readFileSync(join(process.cwd(), "packages/web-ui/src/components/nodes", file), "utf8");

const readUiSource = (file: string) =>
    readFileSync(join(process.cwd(), "packages/gui/src/components/ui", file), "utf8");

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
        expect(source).toContain('<Tooltip label="Toggle description">');
        expect(source).toContain('label="Toggle description"');
        expect(source).not.toContain("descriptionOpen ? 'Hide description' : 'Show description'");
        expect(source).not.toContain("title={descriptionOpen ? 'Hide description' : 'Show description'}");
        expect(source).not.toContain("TooltipProvider");
        expect(source).not.toContain("TooltipAnchor");
    });

    it.each(["ImageNode.tsx", "VideoNode.tsx"])("%s lets the collapsible primitive own description disclosure state", (file) => {
        const source = readNodeSource(file);

        expect(source).not.toContain("const [descriptionOpen, setDescriptionOpen]");
        expect(source).not.toContain("open={descriptionOpen}");
        expect(source).not.toContain("onOpenChange={setDescriptionOpen}");
        expect(source).toContain("group-data-[state=open]/description:");
    });

    it.each(["ImageNode.tsx", "VideoNode.tsx"])("%s lets ReactFlow own media control event boundaries", (file) => {
        const source = readNodeSource(file);

        expect(source).toContain("MEDIA_NODE_CONTROL_CLASS");
        expect(source).toContain("nodrag nopan");
        expect(source).not.toContain("onClick={(e) => e.stopPropagation()}");
    });

    it.each(["ImageNode.tsx", "VideoNode.tsx"])("%s uses shared IconButton primitives for media overlay controls", (file) => {
        const source = readNodeSource(file);

        expect(source).toContain("../ui/icon-button");
        expect(source).toContain("<IconButton");
        expect(source).not.toMatch(/<button[\s\S]*MEDIA_NODE_CONTROL_CLASS/);
    });
});
