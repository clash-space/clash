// @vitest-environment jsdom
import { Suspense } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatInput } from "./ChatInput";

const root = resolve(__dirname, "../../../../..");
const globalCss = readFileSync(resolve(root, "apps/web/app/globals.css"), "utf8");

vi.mock("../MilkdownEditor", () => ({
  default: () => <div data-testid="milkdown-editor" />,
}));

describe("ChatInput", () => {
  afterEach(() => {
    cleanup();
  });

  it("uses the lighter chat-specific input surface classes", async () => {
    const { container } = render(
      <Suspense fallback={<div>Loading</div>}>
        <ChatInput
          input=""
          onInputChange={() => undefined}
          onSubmit={() => undefined}
        />
      </Suspense>,
    );

    await screen.findByTestId("milkdown-editor");

    expect(container.querySelector(".clash-chat-input-surface")).toBeTruthy();
    expect(container.querySelector(".clash-chat-input-actions")).toBeTruthy();
    expect(container.querySelector(".clash-chat-input-toolbar")).toBeNull();
    expect(container.querySelector(".clash-input-surface")).toBeNull();
  });

  it("keeps the default composer caret inset from the rounded edge", async () => {
    const { container } = render(
      <Suspense fallback={<div>Loading</div>}>
        <ChatInput
          input=""
          onInputChange={() => undefined}
          onSubmit={() => undefined}
        />
      </Suspense>,
    );

    await screen.findByTestId("milkdown-editor");

    const editorArea = container.querySelector(".clash-chat-input-editor");
    expect(editorArea?.className).toContain("clash-chat-input-editor--default");
    expect(globalCss).toMatch(/\.clash-chat-input-editor--default \.milkdown-editor-wrapper\s*\{[\s\S]*padding:\s*16px 18px 6px !important;/);
  });

  it("left-aligns the hero editor instead of centering the caret", async () => {
    const { container } = render(
      <Suspense fallback={<div>Loading</div>}>
        <ChatInput
          input=""
          onInputChange={() => undefined}
          onSubmit={() => undefined}
          variant="hero"
        />
      </Suspense>,
    );

    await screen.findByTestId("milkdown-editor");

    const editorArea = container.querySelector(".clash-chat-input-editor");
    expect(editorArea).toBeTruthy();
    expect(editorArea?.className).toContain("text-left");
    expect(editorArea?.className).toContain("w-full");
    expect(editorArea?.className).toContain("clash-chat-input-editor--hero");
    expect(globalCss).toMatch(/\.milkdown-chat-input \.ProseMirror\s*\{[\s\S]*text-align:\s*left;/);
    expect(globalCss).toMatch(/\.clash-chat-input-editor--hero \.milkdown-editor-wrapper\s*\{[\s\S]*padding-left:\s*0 !important;/);
  });
});
