// @vitest-environment jsdom
import { Suspense } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";

import { sourceMatches } from "../../test-support/source-match";
import { ChatInput } from "./ChatInput";

const root = resolve(__dirname, "../../../../..");
const globalCss = readFileSync(
  resolve(root, "apps/web/app/globals.css"),
  "utf8",
);

function composer(value: string, variant: "default" | "hero" = "hero") {
  return (
    <MemoryRouter>
      <Suspense fallback={<div>Loading</div>}>
        <ChatInput
          input={value}
          onInputChange={() => undefined}
          onSubmit={() => undefined}
          placeholder="Describe your video idea..."
          variant={variant}
        />
      </Suspense>
    </MemoryRouter>
  );
}

describe("ChatInput content-driven resize", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("grows a real Milkdown contenteditable for multiline content and contracts when cleared", async () => {
    const { container, rerender } = render(composer(""));
    const editor = await screen.findByRole("textbox", {}, { timeout: 10_000 });
    const host = container.querySelector<HTMLElement>(
      ".clash-chat-input-editor",
    )!;

    expect(editor.classList).toContain("ProseMirror");
    expect(editor.getAttribute("contenteditable")).toBe("true");
    expect(host.dataset.inputState).toBe("empty");
    expect(host.style.height).toBe("");

    rerender(composer("First line\n\nSecond line\n\nThird line"));

    await waitFor(() => {
      expect(container.querySelector(".ProseMirror")?.textContent).toContain(
        "Third line",
      );
    });
    expect(host.dataset.inputState).toBe("multiline");
    expect(host.style.height).toBe("");

    rerender(composer(""));

    await waitFor(() => {
      expect(container.querySelector(".ProseMirror")?.textContent).toBe("");
    });
    expect(host.dataset.inputState).toBe("empty");
    expect(container.querySelector(".ProseMirror p")).toHaveAttribute(
      "data-placeholder",
      "Describe your video idea...",
    );
  });

  it("uses one shared 240px content cap and editor-only scroll contract", () => {
    const contextRule = globalCss.match(
      /:where\(\.clash-chat-input-surface, \[data-context="composer"\]\)\s*\{[\s\S]*?\}/,
    )?.[0];
    expect(contextRule).toBeTruthy();
    expect(contextRule).toMatch(/--composer-editor-max-height:\s*15rem/);

    const editorRule = globalCss.match(
      /\.clash-chat-input-editor\s*\{[\s\S]*?\}/,
    )?.[0];
    expect(editorRule).toBeTruthy();
    expect(editorRule).toMatch(
      /max-height:\s*var\(--composer-editor-max-height\)/,
    );
    expect(editorRule).toMatch(/overflow-y:\s*auto/);

    expect(
      sourceMatches(
        globalCss,
        /\.clash-chat-input-surface\s*\{[^}]*max-height:/,
      ),
    ).toBe(false);
  });
});
