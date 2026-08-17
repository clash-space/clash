// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Dialog } from "./dialog";

afterEach(() => {
    cleanup();
});

describe("Dialog", () => {
    it("lets Radix own modal aria wiring", () => {
        const source = readFileSync(
            join(process.cwd(), "packages/gui/src/components/ui/dialog.tsx"),
            "utf8",
        );

        expect(source).toContain("DialogPrimitive.Content");
        expect(source).toContain("./icon-button");
        expect(source).toContain("<IconButton");
        expect(source).not.toContain('aria-modal="true"');
        expect(source).not.toMatch(/<button[\s\S]*aria-label="Close"/);
    });

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

    it("keeps a non-modal local portal inside its accessible ancestor surface", () => {
        const portalContainer = document.createElement("section");
        portalContainer.setAttribute("aria-label", "Copilot surface");
        document.body.appendChild(portalContainer);

        render(
            <Dialog
                open
                modal={false}
                portalContainer={portalContainer}
                onClose={vi.fn()}
                ariaLabel="Child agent transcript"
            >
                <div>Nested transcript</div>
            </Dialog>,
        );

        expect(portalContainer).not.toHaveAttribute("aria-hidden");
        expect(
            within(portalContainer).getByRole("dialog", { name: "Child agent transcript" }),
        ).toBeInTheDocument();

        portalContainer.remove();
    });
});
