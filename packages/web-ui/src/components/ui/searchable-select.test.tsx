// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
    it("opens a Radix popover and filters model options through cmdk", () => {
        const onValueChange = vi.fn();

        render(
            <SearchableSelect
                ariaLabel="Model to test"
                commandLabel="Search test models"
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

        expect(document.querySelector('[data-radix-popper-content-wrapper]')).toBeTruthy();
        expect(screen.getByRole("listbox", { name: "Model to test" })).toBeTruthy();

        fireEvent.change(screen.getByRole("combobox", { name: "Search test models" }), {
            target: { value: "image" },
        });
        fireEvent.click(screen.getByRole("option", { name: "Mock Image Model" }));

        expect(onValueChange).toHaveBeenCalledWith(
            "image-model",
            expect.objectContaining({ value: "image-model" }),
        );
    });
});
