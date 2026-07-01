// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
    it("is backed by Ariakit combobox primitives instead of a hand-assembled popover command menu", () => {
        const source = readFileSync(
            join(process.cwd(), "packages/web-ui/src/components/ui/searchable-select.tsx"),
            "utf8",
        );

        expect(source).toContain("@ariakit/react");
        expect(source).toContain("ComboboxProvider");
        expect(source).toContain("ComboboxPopover");
        expect(source).toContain("ComboboxItem");
        expect(source).not.toContain("cmdk");
        expect(source).not.toContain("PopoverPrimitive");
    });

    it("renders one editable combobox and filters model options", () => {
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
                searchPlaceholder="Search models..."
                value="text-model"
            />,
        );

        const combobox = screen.getByRole("combobox", { name: "Model to test" }) as HTMLInputElement;
        expect(combobox.tagName).toBe("INPUT");
        expect(combobox.value).toBe("Mock Text Model");

        fireEvent.click(combobox);

        expect(document.querySelector('[data-radix-popper-content-wrapper]')).toBeNull();
        expect(screen.getByRole("listbox", { name: "Model to test" })).toBeTruthy();

        fireEvent.change(combobox, {
            target: { value: "image" },
        });
        expect(screen.queryByRole("option", { name: "Mock Text Model" })).toBeNull();
        fireEvent.click(screen.getByRole("option", { name: "Mock Image Model" }));

        expect(onValueChange).toHaveBeenCalledWith(
            "image-model",
            expect.objectContaining({ value: "image-model" }),
        );
    });
});
