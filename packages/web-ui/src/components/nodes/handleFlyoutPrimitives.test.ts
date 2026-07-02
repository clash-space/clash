import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const nodesDir = join(process.cwd(), "packages/web-ui/src/components/nodes");

function readNodeSource(fileName: string): string {
    return readFileSync(join(nodesDir, fileName), "utf8");
}

describe("node handle flyout primitives", () => {
    it("uses one Radix-backed dropdown shell for downstream handle menus", () => {
        const shell = readNodeSource("NodeHandleDropdownMenu.tsx");
        const sourceHandleMenu = readNodeSource("SourceHandleMenu.tsx");
        const actionBadgePipelineMenu = readNodeSource("ActionBadgePipelineMenu.tsx");

        expect(shell).toContain("DropdownMenu");
        expect(shell).toContain("DropdownMenuTrigger");
        expect(shell).toContain("DropdownMenuContent");
        expect(shell).toContain("DropdownMenuItem");

        for (const source of [sourceHandleMenu, actionBadgePipelineMenu]) {
            expect(source).toContain("NodeHandleDropdownMenu");
            expect(source).not.toContain("AnimatePresence");
            expect(source).not.toContain("leaveTimerRef");
            expect(source).not.toContain("setTimeout");
            expect(source).not.toContain('role="menu"');
            expect(source).not.toContain("left: 'calc(100% + 16px)'");
        }
    });
});
