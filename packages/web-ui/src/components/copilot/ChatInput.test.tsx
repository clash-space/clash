// @vitest-environment jsdom
import { createRef, forwardRef, Suspense, useImperativeHandle } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatInput } from "./ChatInput";

const milkdownFocus = vi.hoisted(() => vi.fn());

const root = resolve(__dirname, "../../../../..");
const globalCss = readFileSync(resolve(root, "apps/web/app/globals.css"), "utf8");

vi.mock("../MilkdownEditor", () => ({
  default: forwardRef((props: { onSubmit?: () => void }, ref) => {
    useImperativeHandle(ref, () => ({
      clear: vi.fn(),
      focus: milkdownFocus,
      insertAtCursor: vi.fn(),
    }));
    return (
      <div data-testid="milkdown-editor">
        <button type="button" data-testid="milkdown-submit" onClick={() => props.onSubmit?.()} />
      </div>
    );
  }),
}));

describe("ChatInput", () => {
  afterEach(() => {
    cleanup();
    milkdownFocus.mockClear();
    vi.restoreAllMocks();
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

  it("keeps runtime queued send available without hiding stop", async () => {
    const onSubmit = vi.fn();
    const onStop = vi.fn();
    render(
      <Suspense fallback={<div>Loading</div>}>
        <ChatInput
          input="follow up"
          onInputChange={() => undefined}
          onSubmit={onSubmit}
          onStop={onStop}
          isProcessing
          allowSubmitWhileProcessing
        />
      </Suspense>,
    );

    await screen.findByTestId("milkdown-editor");

    const sendButton = screen.getByRole("button", { name: "copilot.chatInput.send" }) as HTMLButtonElement;
    const stopButton = screen.getByRole("button", { name: "copilot.chatInput.stop" }) as HTMLButtonElement;

    expect(sendButton.disabled).toBe(false);
    expect(stopButton.disabled).toBe(false);
  });

  it("does not expose a bare connection status dot in the composer toolbar", async () => {
    render(
      <Suspense fallback={<div>Loading</div>}>
        <ChatInput
          input=""
          onInputChange={() => undefined}
          onSubmit={() => undefined}
          connected={false}
        />
      </Suspense>,
    );

    await screen.findByTestId("milkdown-editor");

    expect(screen.queryByLabelText("copilot.status.connected")).toBeNull();
    expect(screen.queryByLabelText("copilot.status.disconnected")).toBeNull();
  });

  it("does not submit when disabled even if the editor emits submit", async () => {
    const onSubmit = vi.fn();
    render(
      <Suspense fallback={<div>Loading</div>}>
        <ChatInput
          input="blocked room message"
          onInputChange={() => undefined}
          onSubmit={onSubmit}
          disabled
        />
      </Suspense>,
    );

    await screen.findByTestId("milkdown-editor");
    fireEvent.click(screen.getByTestId("milkdown-submit"));

    expect(onSubmit).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "copilot.chatInput.send" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("milkdown-editor").closest(".clash-chat-input-editor")?.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByTestId("milkdown-editor").closest(".clash-chat-input-editor")?.className).toContain("pointer-events-none");
  });

  it("renders the placeholder as a disabled composer hint", async () => {
    render(
      <Suspense fallback={<div>Loading</div>}>
        <ChatInput
          input=""
          onInputChange={() => undefined}
          onSubmit={() => undefined}
          placeholder="Cloud room is unavailable in this local project"
          disabled
        />
      </Suspense>,
    );

    await screen.findByTestId("milkdown-editor");

    expect(screen.getByText("Cloud room is unavailable in this local project")).toBeTruthy();
  });

  it("exposes focus through an explicit handle instead of requiring DOM queries", async () => {
    const inputRef = createRef<{ focus: () => void }>();
    render(
      <Suspense fallback={<div>Loading</div>}>
        <ChatInput
          ref={inputRef}
          input=""
          onInputChange={() => undefined}
          onSubmit={() => undefined}
          variant="hero"
        />
      </Suspense>,
    );

    await screen.findByTestId("milkdown-editor");

    inputRef.current?.focus();

    expect(milkdownFocus).toHaveBeenCalledTimes(1);
  });

  it("points the microphone to Models when local ASR is not configured", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/v1/local/audio")) {
        return new Response(JSON.stringify({
          asr: {
            enabled: false,
            provider: "builtin-funasr",
            base_url: null,
            model: "iic/SenseVoiceSmall",
            has_api_key: false,
            ready: false,
            setup: {
              provider: "funasr",
              runtime: "builtin-rpc",
              status: "disabled",
              default_base_url: null,
              commands: [],
            },
          },
        }), { headers: { "content-type": "application/json" } });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <Suspense fallback={<div>Loading</div>}>
        <ChatInput
          input=""
          onInputChange={() => undefined}
          onSubmit={() => undefined}
        />
      </Suspense>,
    );

    await screen.findByTestId("milkdown-editor");
    fireEvent.click(screen.getByRole("button", { name: "copilot.chatInput.voice" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/local/audio"),
      expect.objectContaining({ credentials: "include" }),
    ));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Deploy an ASR model in Models first.");
    expect(screen.getByRole("link", { name: "Open Models" }).getAttribute("href")).toBe("/settings?section=models");
  });
});
