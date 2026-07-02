import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readNodeSource = (file: string) =>
    readFileSync(join(process.cwd(), "packages/web-ui/src/components/nodes", file), "utf8");

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
});
