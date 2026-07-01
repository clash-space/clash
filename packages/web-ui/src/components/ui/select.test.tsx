// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SelectMenu } from "./select";

afterEach(() => {
    cleanup();
});

describe("SelectMenu", () => {
    it("uses native select semantics for simple option lists", () => {
        const onValueChange = vi.fn();

        render(
            <SelectMenu
                value="alpha"
                ariaLabel="Example select"
                options={[
                    { value: "alpha", label: "Alpha" },
                    { value: "beta", label: "Beta" },
                ]}
                onValueChange={onValueChange}
            />,
        );

        const trigger = screen.getByRole("combobox", { name: "Example select" });
        expect(trigger.textContent).toContain("Alpha");

        fireEvent.click(trigger);

        expect(screen.getByRole("listbox", { name: "Example select" })).toBeTruthy();
        fireEvent.click(screen.getByRole("option", { name: "Beta" }));

        expect(onValueChange).toHaveBeenCalledWith("beta", expect.objectContaining({ value: "beta" }));
    });
});
