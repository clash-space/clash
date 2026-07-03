// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RadioGroup, RadioGroupItem } from "./radio-group";

afterEach(() => {
    cleanup();
});

describe("RadioGroup", () => {
    it("uses radio semantics and reports the selected value", () => {
        const onValueChange = vi.fn();

        render(
            <RadioGroup aria-label="Agent" value="codex" onValueChange={onValueChange}>
                <RadioGroupItem value="codex">Codex</RadioGroupItem>
                <RadioGroupItem value="claude">Claude</RadioGroupItem>
            </RadioGroup>,
        );

        expect(screen.getByRole("radiogroup", { name: "Agent" })).toBeTruthy();
        expect(screen.getByRole("radio", { name: "Codex" }).getAttribute("aria-checked")).toBe("true");

        fireEvent.click(screen.getByRole("radio", { name: "Claude" }));

        expect(onValueChange).toHaveBeenCalledWith("claude");
    });
});
