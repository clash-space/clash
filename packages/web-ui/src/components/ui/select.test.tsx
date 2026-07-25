// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SelectMenu } from "./select";

afterEach(() => {
    cleanup();
});

describe("SelectMenu", () => {
    it("closes a controlled section menu when its trigger is pressed again", () => {
        Object.defineProperties(HTMLElement.prototype, {
            hasPointerCapture: { configurable: true, value: () => false },
            releasePointerCapture: { configurable: true, value: () => undefined },
            setPointerCapture: { configurable: true, value: () => undefined },
        });

        function ControlledSectionMenu() {
            const [open, setOpen] = useState(false);

            return (
                <SelectMenu
                    value="mock-acp"
                    ariaLabel="Harness"
                    open={open}
                    onOpenChange={setOpen}
                    onValueChange={() => undefined}
                    triggerTestId="harness-trigger"
                    sections={[
                        {
                            id: "harness",
                            label: "Harness",
                            options: [{ value: "mock-acp", label: "Mock ACP" }],
                        },
                    ]}
                />
            );
        }

        render(<ControlledSectionMenu />);

        const trigger = screen.getByTestId("harness-trigger");
        fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
        expect(screen.getByRole("menu", { name: "Harness" })).toBeTruthy();

        fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
        expect(screen.queryByRole("menu", { name: "Harness" })).toBeNull();
    });

    it("keeps section menus on one interaction primitive when submenu data changes", () => {
        const { rerender } = render(
            <SelectMenu
                value="mock-acp"
                ariaLabel="Session config"
                onValueChange={() => undefined}
                sections={[
                    {
                        id: "harness",
                        options: [{ value: "mock-acp", label: "Mock ACP" }],
                    },
                ]}
            />,
        );

        expect(screen.getByRole("button", { name: "Session config" })).toBeTruthy();
        expect(screen.queryByRole("combobox", { name: "Session config" })).toBeNull();

        rerender(
            <SelectMenu
                value="mock-acp"
                ariaLabel="Session config"
                onValueChange={() => undefined}
                sections={[
                    {
                        id: "harness",
                        options: [{ value: "mock-acp", label: "Mock ACP" }],
                    },
                    {
                        id: "model",
                        options: [
                            {
                                value: "model",
                                label: "Model",
                                hasSubmenu: true,
                                submenuSections: [
                                    {
                                        id: "models",
                                        options: [{ value: "gpt", label: "GPT" }],
                                    },
                                ],
                            },
                        ],
                    },
                ]}
            />,
        );

        expect(screen.getByRole("button", { name: "Session config" })).toBeTruthy();
        expect(screen.queryByRole("combobox", { name: "Session config" })).toBeNull();
    });

    it("switches between section menu triggers in one pointer action", () => {
        render(
            <>
                <SelectMenu
                    value="mock-acp"
                    ariaLabel="Harness"
                    onValueChange={() => undefined}
                    sections={[
                        {
                            id: "harness",
                            options: [{ value: "mock-acp", label: "Mock ACP" }],
                        },
                    ]}
                />
                <SelectMenu
                    value="agent"
                    ariaLabel="Permission"
                    onValueChange={() => undefined}
                    sections={[
                        {
                            id: "permission",
                            options: [{ value: "agent", label: "Agent" }],
                        },
                    ]}
                />
            </>,
        );

        fireEvent.pointerDown(screen.getByRole("button", { name: "Harness" }), { button: 0, ctrlKey: false });
        expect(screen.getByRole("menu", { name: "Harness" })).toBeTruthy();

        fireEvent.pointerDown(screen.getByRole("button", { name: "Permission" }), { button: 0, ctrlKey: false });
        expect(screen.queryByRole("menu", { name: "Harness" })).toBeNull();
        expect(screen.getByRole("menu", { name: "Permission" })).toBeTruthy();
    });

    it("routes trigger help text through the shared tooltip primitive instead of browser title attributes", () => {
        const source = readFileSync(join(process.cwd(), "packages/web-ui/src/components/ui/select.tsx"), "utf8");
        const tooltipSource = readFileSync(join(process.cwd(), "packages/web-ui/src/components/ui/tooltip.tsx"), "utf8");

        expect(tooltipSource).toContain("@ariakit/react");
        expect(source).toContain("./tooltip");
        expect(source).toContain("<Tooltip label={title}>");
        expect(source).not.toContain("title={title}");
        expect(source).not.toContain("TooltipProvider");
        expect(source).not.toContain("TooltipAnchor");
    });

    it("does not expose dead submenu mode props without a behavior contract", () => {
        const source = readFileSync(join(process.cwd(), "packages/web-ui/src/components/ui/select.tsx"), "utf8");
        const copilotSource = readFileSync(join(process.cwd(), "packages/web-ui/src/components/ChatbotCopilot.tsx"), "utf8");

        expect(source).not.toContain("submenuMode");
        expect(copilotSource).not.toContain("submenuMode");
    });

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

    it("keeps trigger focus when a simple select is opened by pointer", () => {
        render(
            <SelectMenu
                value="alpha"
                ariaLabel="Pointer select"
                options={[
                    { value: "alpha", label: "Alpha" },
                    { value: "beta", label: "Beta" },
                ]}
                onValueChange={() => undefined}
            />,
        );

        const trigger = screen.getByRole("combobox", { name: "Pointer select" });
        trigger.focus();
        fireEvent.click(trigger);

        expect(screen.getByRole("listbox", { name: "Pointer select" })).toBeTruthy();
        expect(document.activeElement).toBe(trigger);
    });

    it("keeps the combobox as the stable focus owner when opened from the keyboard", () => {
        render(
            <SelectMenu
                value="alpha"
                ariaLabel="Keyboard select"
                options={[
                    { value: "alpha", label: "Alpha" },
                    { value: "beta", label: "Beta" },
                ]}
                onValueChange={() => undefined}
            />,
        );

        const trigger = screen.getByRole("combobox", { name: "Keyboard select" });
        trigger.focus();
        fireEvent.keyDown(trigger, { key: "ArrowDown" });

        expect(screen.getByRole("listbox", { name: "Keyboard select" })).toBeTruthy();
        expect(document.activeElement).toBe(trigger);
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

    it("lets Radix own nested submenu open state and pointer behavior", () => {
        const source = readFileSync(join(process.cwd(), "packages/web-ui/src/components/ui/select.tsx"), "utf8");

        expect(source).toContain("<DropdownMenuPrimitive.Sub");
        expect(source).not.toContain("openSubmenu");
        expect(source).not.toContain("setOpenSubmenu");
        expect(source).not.toContain("onMouseEnter");
        expect(source).not.toContain("event.preventDefault()");
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
