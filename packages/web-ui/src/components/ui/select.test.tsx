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

    it("uses Radix dropdown positioning for nested option menus", () => {
        const onValueChange = vi.fn();

        render(
            <SelectMenu
                value="alpha"
                ariaLabel="Nested select"
                onValueChange={onValueChange}
                sections={[
                    {
                        id: "main",
                        options: [
                            { value: "alpha", label: "Alpha" },
                            {
                                value: "model",
                                label: "Model",
                                hasSubmenu: true,
                                submenuSections: [
                                    {
                                        id: "models",
                                        label: "Models",
                                        options: [
                                            { value: "beta", label: "Beta" },
                                            { value: "gamma", label: "Gamma" },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                ]}
            />,
        );

        fireEvent.pointerDown(screen.getByRole("button", { name: "Nested select" }));

        const menu = screen.getByRole("menu", { name: "Nested select" });
        expect(menu.getAttribute("data-side")).toBe("bottom");
        expect(menu.getAttribute("data-align")).toBe("start");
        expect(screen.getByRole("menuitem", { name: "Model" })).toBeTruthy();
    });

    it("preserves explicit checked state in nested dropdown sections", () => {
        const onValueChange = vi.fn();

        render(
            <SelectMenu
                value="model-alpha"
                ariaLabel="Session config"
                onValueChange={onValueChange}
                sections={[
                    {
                        id: "harness",
                        label: "Harness",
                        options: [
                            { value: "codex", label: "Codex", selected: true },
                            { value: "cursor", label: "Cursor" },
                        ],
                    },
                    {
                        id: "model",
                        label: "Model",
                        options: [
                            {
                                value: "model-alpha",
                                label: "Alpha model",
                                selected: true,
                                hasSubmenu: true,
                                submenuSections: [
                                    {
                                        id: "effort",
                                        label: "Effort",
                                        options: [
                                            { value: "medium", label: "Medium", selected: true },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                ]}
            />,
        );

        fireEvent.pointerDown(screen.getByRole("button", { name: "Session config" }));

        expect(screen.getByRole("menuitemradio", { name: "Codex" }).getAttribute("aria-checked")).toBe("true");
        expect(screen.getByRole("menuitemradio", { name: "Cursor" }).getAttribute("aria-checked")).toBe("false");
    });
});
