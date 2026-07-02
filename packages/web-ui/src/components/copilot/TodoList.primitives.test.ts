import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = () =>
    readFileSync(join(process.cwd(), "packages/web-ui/src/components/copilot/TodoList.tsx"), "utf8");

describe("TodoList primitives", () => {
    it("uses the shared collapsible primitive for the plan disclosure", () => {
        const source = readSource();

        expect(source).toContain("../ui/collapsible");
        expect(source).toContain("Collapsible");
        expect(source).toContain("CollapsibleTrigger");
        expect(source).toContain("CollapsibleContent");
        expect(source).not.toContain("onClick={() => setIsExpanded(!isExpanded)}");
        expect(source).not.toContain("cursor-pointer transition-all hover:shadow-md w-64");
    });
});
