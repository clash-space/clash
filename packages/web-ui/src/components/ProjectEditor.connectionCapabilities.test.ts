import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sourceContains, sourceMatches } from "../test-support/source-match";

describe("ProjectEditor generation connection guard", () => {
    it("checks the selected model capability before adding a generation edge", () => {
        const source = readFileSync(
            join(process.cwd(), "packages/web-ui/src/components/ProjectEditor.tsx"),
            "utf8",
        );

        expect(sourceContains(source, "generationConnectionAcceptsSource"), "mechanism missing").toBe(true);
        expect(sourceMatches(source, /tgt\?\.type === 'action-badge' && !generationConnectionAcceptsSource\(\{/), "mechanism missing").toBe(true);
    });
});
