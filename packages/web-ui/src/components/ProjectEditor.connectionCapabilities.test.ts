import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("ProjectEditor generation connection guard", () => {
    it("checks the selected model capability before adding a generation edge", () => {
        const source = readFileSync(
            join(process.cwd(), "packages/web-ui/src/components/ProjectEditor.tsx"),
            "utf8",
        );

        expect(source).toContain("generationConnectionAcceptsSource");
        expect(source).toMatch(/tgt\?\.type === 'action-badge' && !generationConnectionAcceptsSource\(\{/);
    });
});
