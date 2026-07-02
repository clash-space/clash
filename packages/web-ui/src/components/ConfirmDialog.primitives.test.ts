// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { ConfirmDialogProvider, useConfirm } from "./ConfirmDialog";

const readSource = (path: string) =>
  readFileSync(join(process.cwd(), path), "utf8");

describe("ConfirmDialog primitives", () => {
  afterEach(() => {
    cleanup();
  });

  it("uses the shared Radix-backed alert dialog shell", () => {
    const source = readSource("packages/web-ui/src/components/ConfirmDialog.tsx");
    const shell = readSource(
      "packages/web-ui/src/components/ui/alert-dialog.tsx",
    );

    expect(source).toContain("./ui/alert-dialog");
    expect(source).not.toContain("AlertDialogPrimitive");
    expect(source).not.toContain("fixed inset-0 z-[10000]");

    expect(shell).toContain("AlertDialogPrimitive.Root");
    expect(shell).toContain("AlertDialogPrimitive.Overlay");
    expect(shell).toContain("AlertDialogPrimitive.Content");
    expect(shell).toContain("AlertDialogPrimitive.Action");
    expect(shell).toContain("AlertDialogPrimitive.Cancel");
  });

  it("does not hand-roll Enter key confirmation on the dialog surface", () => {
    const source = readSource("packages/web-ui/src/components/ConfirmDialog.tsx");

    expect(source).not.toContain("onKeyDown={(event) =>");
    expect(source).not.toContain("event.key === 'Enter'");
  });

  it("uses the shared Button primitive for footer actions", () => {
    const source = readSource("packages/web-ui/src/components/ConfirmDialog.tsx");

    expect(source).toContain("./ui/button");
    expect(source).toMatch(/<Button[\s\S]*clash-confirm-secondary[\s\S]*>/);
    expect(source).toMatch(/<Button[\s\S]*confirmBtnRef[\s\S]*>/);
    expect(source).not.toMatch(/<button[\s\S]{0,300}clash-confirm-secondary/);
    expect(source).not.toMatch(/<button[\s\S]{0,300}confirmBtnRef/);
  });

  it("does not confirm when Enter is pressed while the cancel button is focused", async () => {
    function ConfirmHarness() {
      const confirm = useConfirm();
      const [result, setResult] = useState("idle");

      return createElement(
        "div",
        null,
        createElement(
          "button",
          {
            type: "button",
            onClick: () => {
              void confirm({
                title: "Delete project?",
                message: "This cannot be undone.",
                confirmText: "Delete",
                cancelText: "Cancel",
                destructive: true,
              }).then((ok) => setResult(ok ? "confirmed" : "cancelled"));
            },
          },
          "Open confirm",
        ),
        createElement("div", { "aria-label": "confirm result" }, result),
      );
    }

    render(
      createElement(
        ConfirmDialogProvider,
        null,
        createElement(ConfirmHarness),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Open confirm" }));
    const cancel = screen.getByRole("button", { name: "Cancel" });
    cancel.focus();

    fireEvent.keyDown(cancel, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByLabelText("confirm result").textContent).not.toBe("confirmed");
    });
  });
});
