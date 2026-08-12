import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const primitiveFiles = [
    "select.tsx",
    "searchable-select.tsx",
    "dropdown-menu.tsx",
    "context-menu.tsx",
    "popover.tsx",
];

const composerFiles = [
    "../ChatbotCopilot.tsx",
    "../copilot/AnnotationDomPinLayer.tsx",
    "../copilot/AgentAnnotationBlock.tsx",
    "../copilot/SessionHarnessUpdateBanner.tsx",
];

describe("dark popup surface primitives", () => {
    it.each(primitiveFiles)("keeps %s on the semantic neutral palette", (fileName) => {
        const source = readFileSync(join(process.cwd(), "packages/gui/src/components/ui", fileName), "utf8");

        expect(source).not.toMatch(/dark:(?:bg|border|hover:bg|data-\[[^\]]+\]:bg)-slate-(?:7|8|9)00/);
    });

    it.each(composerFiles)("keeps Composer surface %s neutral", (relativePath) => {
        const source = readFileSync(join(process.cwd(), "packages/web-ui/src/components/ui", relativePath), "utf8");

        expect(source).not.toMatch(/dark:(?:bg|border|hover:bg|data-\[[^\]]+\]:bg)-slate-(?:7|8|9)00/);
    });
});
