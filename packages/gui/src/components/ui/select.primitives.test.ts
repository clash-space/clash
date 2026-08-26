import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { sourceContains } from "../../../test-support/source-match";

const source = () =>
    readFileSync(
        join(process.cwd(), "packages/gui/src/components/ui/select.tsx"),
        "utf8",
    );

function readFunction(sourceText: string, functionName: string) {
    const start = sourceText.indexOf(`function ${functionName}`);
    expect(start).toBeGreaterThanOrEqual(0);
    const nextFunction = sourceText.indexOf("\nfunction ", start + 1);
    return sourceText.slice(start, nextFunction === -1 ? undefined : nextFunction);
}

describe("SelectMenu primitives", () => {
    it("shares the select visual adapter across Radix Select and DropdownMenu", () => {
        const selectSource = source();

        expect(selectSource).toContain("app-select-trigger");
        expect(selectSource).toContain("app-select-content");
        expect(selectSource).toContain("app-select-item");
        expect(selectSource).toContain("app-select-focus");
        expect(selectSource).not.toMatch(/dark:bg-slate-(?:8|9)00/);
        expect(selectSource).not.toMatch(/dark:border-slate-700/);
    });

    it("uses the shared button primitive for the Radix dropdown trigger", () => {
        const selectSource = source();
        const dropdownSource = readFunction(selectSource, "DropdownSelectMenu");

        expect(selectSource).toContain("./button");
        expect(sourceContains(dropdownSource, "<Button")).toBe(true);
        expect(sourceContains(dropdownSource, "<DropdownMenuPrimitive.Trigger asChild>")).toBe(true);
        expect(dropdownSource).not.toContain("<button");
    });

    it("keeps nested menus inside the pointer corridor and gives trailing controls breathing room", () => {
        const selectSource = source();
        const sectionSource = readFunction(selectSource, "DropdownSelectMenuSection");

        expect(selectSource).toContain("const SUBMENU_OFFSET = 2");
        expect(sourceContains(sectionSource, "sideOffset={SUBMENU_OFFSET}")).toBe(true);
        expect(selectSource).toContain("pl-2 pr-3");
    });
});
