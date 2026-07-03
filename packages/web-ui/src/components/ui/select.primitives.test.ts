import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = () =>
    readFileSync(
        join(process.cwd(), "packages/web-ui/src/components/ui/select.tsx"),
        "utf8",
    );

function readFunction(sourceText: string, functionName: string) {
    const start = sourceText.indexOf(`function ${functionName}`);
    expect(start).toBeGreaterThanOrEqual(0);
    const nextFunction = sourceText.indexOf("\nfunction ", start + 1);
    return sourceText.slice(start, nextFunction === -1 ? undefined : nextFunction);
}

describe("SelectMenu primitives", () => {
    it("uses the shared button primitive for the Radix dropdown trigger", () => {
        const selectSource = source();
        const dropdownSource = readFunction(selectSource, "DropdownSelectMenu");

        expect(selectSource).toContain("./button");
        expect(dropdownSource).toContain("<Button");
        expect(dropdownSource).toContain("<DropdownMenuPrimitive.Trigger asChild>");
        expect(dropdownSource).not.toContain("<button");
    });
});
