// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Dialog } from "./dialog";

afterEach(() => {
    cleanup();
});

describe("Dialog", () => {
    it("uses Radix dialog state while preserving close affordances", () => {
        const onClose = vi.fn();

        render(
            <Dialog open onClose={onClose} title="Provider test">
                <button type="button">Inside action</button>
            </Dialog>,
        );

        const dialog = screen.getByRole("dialog", { name: "Provider test" });
        expect(dialog.getAttribute("data-state")).toBe("open");

        fireEvent.keyDown(document, { key: "Escape" });
        expect(onClose).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByRole("button", { name: "Close" }));
        expect(onClose).toHaveBeenCalledTimes(2);
    });
});
