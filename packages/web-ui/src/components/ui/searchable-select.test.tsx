// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SearchableSelect } from "./searchable-select";

beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal(
        "ResizeObserver",
        vi.fn(function ResizeObserver() {
            return {
                disconnect: vi.fn(),
                observe: vi.fn(),
                unobserve: vi.fn(),
            };
        }),
    );
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe("SearchableSelect", () => {
    it("is backed by Ariakit select and combobox primitives instead of a hand-assembled popover command menu", () => {
        const source = readFileSync(
            join(process.cwd(), "packages/web-ui/src/components/ui/searchable-select.tsx"),
            "utf8",
        );

        expect(source).toContain("@ariakit/react");
        expect(source).toContain("ComboboxProvider");
        expect(source).toContain("ComboboxList");
        expect(source).toContain("ComboboxItem");
        expect(source).toContain("SelectProvider");
        expect(source).toContain("SelectPopover");
        expect(source).not.toContain("cmdk");
        expect(source).not.toContain("PopoverPrimitive");
        expect(source).not.toContain('role="listbox"');
        expect(source).not.toContain('role="option"');
        expect(source).not.toContain("aria-selected");
        expect(source).not.toContain("onKeyDown={(event) =>");
        expect(source).not.toContain("selectActiveComboboxOption");
    });

    it("lets Ariakit own select disclosure state instead of mirroring it locally", () => {
        const source = readFileSync(
            join(process.cwd(), "packages/web-ui/src/components/ui/searchable-select.tsx"),
            "utf8",
        );

        expect(source).toContain("<SelectProvider");
        expect(source).not.toContain("const [open, setOpen]");
        expect(source).not.toContain("open={open}");
        expect(source).not.toContain("setOpen={setOpen}");
        expect(source).not.toContain("setOpen(false)");
    });

    it("renders a select trigger with an in-popover searchable combobox", () => {
        const onValueChange = vi.fn();

        render(
            <SearchableSelect
                ariaLabel="Model to test"
                emptyMessage="No matching models."
                listboxLabel="Model to test"
                onValueChange={onValueChange}
                options={[
                    { value: "text-model", label: "Mock Text Model" },
                    { value: "image-model", label: "Mock Image Model" },
                ]}
                searchAriaLabel="Search test models"
                searchPlaceholder="Search models..."
                value="text-model"
            />,
        );

        const trigger = screen.getByRole("combobox", { name: "Model to test" });
        expect(trigger.tagName).toBe("BUTTON");
        expect(trigger.textContent).toContain("Mock Text Model");

        fireEvent.click(trigger);

        expect(document.querySelector('[data-radix-popper-content-wrapper]')).toBeNull();
        expect(screen.getByRole("listbox", { name: "Model to test" })).toBeTruthy();

        const search = screen.getByRole("combobox", { name: "Search test models" }) as HTMLInputElement;
        expect(search.tagName).toBe("INPUT");

        fireEvent.change(search, {
            target: { value: "image" },
        });
        expect(screen.queryByRole("option", { name: "Mock Text Model" })).toBeNull();
        fireEvent.click(screen.getByRole("option", { name: "Mock Image Model" }));

        expect(onValueChange).toHaveBeenCalledWith(
            "image-model",
            expect.objectContaining({ value: "image-model" }),
        );
    });

    it("selects the active filtered option from the keyboard", async () => {
        const onValueChange = vi.fn();

        render(
            <SearchableSelect
                ariaLabel="Model to test"
                emptyMessage="No matching models."
                listboxLabel="Model to test"
                onValueChange={onValueChange}
                options={[
                    { value: "text-model", label: "Mock Text Model" },
                    { value: "image-model", label: "Mock Image Model" },
                ]}
                searchAriaLabel="Search test models"
                searchPlaceholder="Search models..."
                value="text-model"
            />,
        );

        fireEvent.click(screen.getByRole("combobox", { name: "Model to test" }));
        const search = screen.getByRole("combobox", { name: "Search test models" });
        fireEvent.change(search, { target: { value: "image" } });
        await waitFor(() => {
            expect(screen.getByRole("option", { name: "Mock Image Model" })).toBeTruthy();
        });
        fireEvent.keyDown(search, { key: "ArrowDown" });
        fireEvent.keyUp(search, { key: "ArrowDown" });
        fireEvent.keyDown(search, { key: "Enter" });
        fireEvent.keyUp(search, { key: "Enter" });

        await waitFor(() => {
            expect(onValueChange).toHaveBeenCalledWith(
                "image-model",
                expect.objectContaining({ value: "image-model" }),
            );
        });
    });

    it("indexes text from rich option labels and descriptions", () => {
        const onValueChange = vi.fn();

        render(
            <SearchableSelect
                ariaLabel="Model to test"
                emptyMessage="No matching models."
                listboxLabel="Model to test"
                onValueChange={onValueChange}
                options={[
                    {
                        value: "vision-model",
                        label: (
                            <span>
                                <strong>Vision Model</strong>
                                <span>image</span>
                            </span>
                        ),
                        description: <span>fal-ai/vision</span>,
                    },
                    { value: "text-model", label: "Text Model", description: "openai/text" },
                ]}
                searchAriaLabel="Search test models"
                searchPlaceholder="Search models..."
                value="text-model"
            />,
        );

        fireEvent.click(screen.getByRole("combobox", { name: "Model to test" }));
        fireEvent.change(screen.getByRole("combobox", { name: "Search test models" }), {
            target: { value: "fal-ai/vision" },
        });

        expect(screen.getByRole("option", { name: /Vision Model/ })).toBeTruthy();
        expect(screen.queryByRole("option", { name: /Text Model/ })).toBeNull();
    });
});
