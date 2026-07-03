// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Switch } from "./switch";

afterEach(() => {
    cleanup();
});

describe("Switch", () => {
    it("styles checked state from Radix data-state so uncontrolled switches render correctly", () => {
        render(<Switch aria-label="Enable provider" defaultChecked />);

        const root = screen.getByRole("switch", { name: "Enable provider" });
        const thumb = root.firstElementChild;

        expect(root.getAttribute("data-state")).toBe("checked");
        expect(root.className).toContain("data-[state=checked]:bg-brand");
        expect(thumb?.className).toContain("data-[state=checked]:translate-x-5");
    });

    it("does not branch visual state from a checked prop in the wrapper", () => {
        const source = readFileSync(
            join(process.cwd(), "packages/web-ui/src/components/ui/switch.tsx"),
            "utf8",
        );

        expect(source).toContain("data-[state=checked]");
        expect(source).not.toContain("checked ? ");
        expect(source).not.toContain("checked, disabled");
    });
});
