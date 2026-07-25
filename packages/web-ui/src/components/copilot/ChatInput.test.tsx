// @vitest-environment jsdom
import { createRef, forwardRef, Suspense, useImperativeHandle } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentAnnotationDraft } from "@clash/shared-types";

import { ChatInput } from "./ChatInput";

const milkdownFocus = vi.hoisted(() => vi.fn());

const root = resolve(__dirname, "../../../../..");
const globalCss = readFileSync(
  resolve(root, "apps/web/app/globals.css"),
  "utf8",
);

vi.mock("../MilkdownEditor", () => ({
  default: forwardRef(
    (
      props: {
        onSubmit?: () => void;
        promptModalities?: string[];
        mentionableNodes?: Array<{ type: string }>;
      },
      ref,
    ) => {
      useImperativeHandle(ref, () => ({
        clear: vi.fn(),
        focus: milkdownFocus,
        insertAtCursor: vi.fn(),
      }));
      return (
        <div
          data-testid="milkdown-editor"
          data-prompt-modalities={props.promptModalities?.join(",")}
          data-mention-types={props.mentionableNodes
            ?.map((node) => node.type)
            .join(",")}
        >
          <button
            type="button"
            data-testid="milkdown-submit"
            onClick={() => props.onSubmit?.()}
          />
        </div>
      );
    },
  ),
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

  it("uses the shared workbench radius instead of a composer-only pill radius", async () => {
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

    const surface = container.querySelector(".clash-chat-input-surface");
    expect(surface?.className).not.toContain("rounded-[18px]");
    expect(globalCss).toMatch(
      /\.clash-chat-input-surface\s*\{[\s\S]*?border-radius:\s*var\(--clash-workbench-surface-radius\)/,
    );
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
    expect(globalCss).toMatch(
      /\.clash-chat-input-editor--default \.milkdown-editor-wrapper\s*\{[\s\S]*padding:\s*16px 18px 6px !important;/,
    );
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
    expect(globalCss).toMatch(
      /\.milkdown-chat-input \.ProseMirror\s*\{[\s\S]*text-align:\s*left;/,
    );
    expect(globalCss).toMatch(
      /\.clash-chat-input-editor--hero \.milkdown-editor-wrapper\s*\{[\s\S]*padding-left:\s*0 !important;/,
    );
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

    const sendButton = screen.getByRole("button", {
      name: "copilot.chatInput.send",
    }) as HTMLButtonElement;
    const stopButton = screen.getByRole("button", {
      name: "copilot.chatInput.stop",
    }) as HTMLButtonElement;

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
    expect(
      (
        screen.getByRole("button", {
          name: "copilot.chatInput.send",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      screen
        .getByTestId("milkdown-editor")
        .closest(".clash-chat-input-editor")
        ?.getAttribute("aria-disabled"),
    ).toBe("true");
    expect(
      screen.getByTestId("milkdown-editor").closest(".clash-chat-input-editor")
        ?.className,
    ).toContain("pointer-events-none");
  });

  it("renders the placeholder as a disabled composer hint", async () => {
    const { container } = render(
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

    const hint = screen.getByText(
      "Cloud room is unavailable in this local project",
    );
    expect(hint).toBeTruthy();
    expect(hint.className).toContain("absolute");
    expect(
      container.querySelector(".clash-chat-input-editor")?.className,
    ).toContain("relative");
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

  it("allows every canvas media type in the mention picker", async () => {
    render(
      <Suspense fallback={<div>Loading</div>}>
        <ChatInput
          input="@"
          onInputChange={() => undefined}
          onSubmit={() => undefined}
          mentionableNodes={[
            { id: "image", type: "image", label: "Image" },
            { id: "video", type: "video", label: "Video" },
            { id: "audio", type: "audio", label: "Audio" },
            { id: "text", type: "text", label: "Text" },
          ]}
        />
      </Suspense>,
    );

    const editor = await screen.findByTestId("milkdown-editor");
    expect(editor.getAttribute("data-prompt-modalities")).toBe(
      "text,image,video,audio",
    );
  });

  it("renders editable agent-annotation blocks and can remove them", async () => {
    const onAnnotationChange = vi.fn();
    const onAnnotationRemove = vi.fn();
    const onAnnotationLocate = vi.fn();
    const annotation: AgentAnnotationDraft = {
      id: "annotation-canvas-1",
      kind: "agent-annotation" as const,
      note: "Use the wider crop.",
      target: {
        projectId: "project-1",
        surface: "canvas" as const,
        surfaceId: "canvas-main",
        surfaceLabel: "Main",
        objectId: "image-1",
        objectType: "image",
        objectLabel: "Hero still",
        objectPath: "canvases/canvas-main/nodes/image-1",
        capabilities: ["read", "modify"],
      },
    };

    render(
      <Suspense fallback={<div>Loading</div>}>
        <ChatInput
          input=""
          onInputChange={() => undefined}
          onSubmit={() => undefined}
          annotationBlocks={[annotation]}
          onAnnotationChange={onAnnotationChange}
          onAnnotationRemove={onAnnotationRemove}
          onAnnotationLocate={onAnnotationLocate}
        />
      </Suspense>,
    );

    await screen.findByTestId("milkdown-editor");

    const tray = screen.getByTestId("agent-annotation-tray");
    expect(tray.textContent).toContain("1");
    expect(tray.textContent).toContain("annotation");

    fireEvent.click(screen.getByRole("button", { name: "Agent annotations" }));

    const item = screen.getByTestId("agent-annotation-item");
    expect(item.dataset.expanded).toBe("true");
    expect(item.textContent).toContain("Canvas");
    expect(item.textContent).toContain("Main");
    expect(item.textContent).toContain("Hero still");
    expect(item.textContent).toContain("Image");
    expect(item.textContent).toContain("canvases/canvas-main/nodes/image-1");

    const annotationEditor = screen.getByRole("textbox", {
      name: "Annotation for Hero still",
    }) as HTMLTextAreaElement;
    expect(document.activeElement).toBe(annotationEditor);
    expect(annotationEditor.selectionStart).toBe(annotation.note.length);
    expect(annotationEditor.selectionEnd).toBe(annotation.note.length);

    fireEvent.change(annotationEditor, {
      target: { value: "Use the wider crop and preserve the title safe area." },
    });
    expect(onAnnotationChange).toHaveBeenCalledWith(
      "annotation-canvas-1",
      "Use the wider crop and preserve the title safe area.",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Locate annotation for Hero still" }),
    );
    expect(onAnnotationLocate).toHaveBeenCalledWith("annotation-canvas-1");

    fireEvent.click(
      screen.getByRole("button", { name: "Remove annotation for Hero still" }),
    );
    expect(onAnnotationRemove).toHaveBeenCalledWith("annotation-canvas-1");
  });

  it("opens the annotation list only when clicked", async () => {
    const annotation: AgentAnnotationDraft = {
      id: "annotation-hover-1",
      kind: "agent-annotation" as const,
      note: "",
      target: {
        projectId: "project-1",
        surface: "canvas" as const,
        surfaceId: "canvas-main",
        surfaceLabel: "Main",
        objectId: "image-1",
        objectType: "canvas-image",
        objectLabel: "Hero still",
        objectPath: "canvases/canvas-main/nodes/image-1",
        capabilities: ["read", "modify"],
      },
    };

    render(
      <Suspense fallback={<div>Loading</div>}>
        <ChatInput
          input=""
          onInputChange={() => undefined}
          onSubmit={() => undefined}
          annotationBlocks={[annotation]}
        />
      </Suspense>,
    );

    await screen.findByTestId("milkdown-editor");
    const tray = screen.getByTestId("agent-annotation-tray");
    expect(tray.dataset.open).toBe("false");

    fireEvent.mouseEnter(tray);
    expect(screen.getByTestId("agent-annotation-tray").dataset.open).toBe(
      "false",
    );
    expect(screen.queryByTestId("agent-annotation-item")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Agent annotations" }));
    fireEvent.mouseLeave(tray);
    expect(screen.getByTestId("agent-annotation-tray").dataset.open).toBe(
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "Agent annotations" }));
    expect(screen.getByTestId("agent-annotation-tray").dataset.open).toBe(
      "false",
    );
  });

  it("numbers listed annotations to match the surface pins", async () => {
    const makeAnnotation = (
      id: string,
      objectLabel: string,
    ): AgentAnnotationDraft => ({
      id,
      kind: "agent-annotation" as const,
      note: "",
      target: {
        projectId: "project-1",
        surface: "timeline" as const,
        surfaceId: "timeline-1",
        surfaceLabel: "Final cut",
        objectId: id,
        objectType: "timeline-track",
        objectLabel,
        objectPath: `timelines/timeline-1/tracks/${id}`,
        capabilities: ["read", "modify"],
      },
    });

    render(
      <Suspense fallback={<div>Loading</div>}>
        <ChatInput
          input=""
          onInputChange={() => undefined}
          onSubmit={() => undefined}
          annotationBlocks={[
            makeAnnotation("track-sfx", "Sound Design"),
            makeAnnotation("track-music", "Music"),
          ]}
        />
      </Suspense>,
    );

    await screen.findByTestId("milkdown-editor");
    fireEvent.click(screen.getByRole("button", { name: "Agent annotations" }));

    // Order in the tray is the pin numbering used on the creative surfaces.
    expect(
      screen.getByRole("button", { name: "Annotation 1: Sound Design" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Annotation 2: Music" }),
    ).toBeTruthy();

    // With multiple annotations, rows start collapsed until clicked.
    const items = screen.getAllByTestId("agent-annotation-item");
    expect(items.map((item) => item.dataset.expanded)).toEqual([
      "false",
      "false",
    ]);

    fireEvent.click(
      screen.getByRole("button", { name: "Annotation 2: Music" }),
    );
    expect(
      screen.getByText("timelines/timeline-1/tracks/track-music"),
    ).toBeTruthy();
  });

  it("submits an annotation block without requiring duplicate prose in the editor", async () => {
    const onSubmit = vi.fn();
    const annotation: AgentAnnotationDraft = {
      id: "annotation-director-1",
      kind: "agent-annotation" as const,
      note: "Rotate the key light toward the actor.",
      target: {
        projectId: "project-1",
        surface: "director-stage" as const,
        surfaceId: "stage-1",
        surfaceLabel: "Courtyard blocking",
        revisionId: "director-revision-2",
        objectId: "key-light",
        objectType: "light",
        objectLabel: "Key light",
        objectPath: "director-stages/stage-1/objects/key-light",
        capabilities: ["read", "modify"],
      },
    };

    render(
      <Suspense fallback={<div>Loading</div>}>
        <ChatInput
          input=""
          onInputChange={() => undefined}
          onSubmit={onSubmit}
          annotationBlocks={[annotation]}
        />
      </Suspense>,
    );

    await screen.findByTestId("milkdown-editor");
    const sendButton = screen.getByRole("button", {
      name: "copilot.chatInput.send",
    }) as HTMLButtonElement;
    expect(sendButton.disabled).toBe(false);

    fireEvent.click(screen.getByTestId("milkdown-submit"));

    expect(onSubmit).toHaveBeenCalledWith("", [], [annotation]);
  });

  it("renders a quoted selection and submits it without requiring an extra comment", async () => {
    const onSubmit = vi.fn();
    const annotation = {
      id: "annotation-selection-1",
      kind: "agent-annotation" as const,
      note: "",
      target: {
        projectId: "project-1",
        surface: "timeline" as const,
        surfaceId: "timeline-1",
        surfaceLabel: "Final cut",
        objectId: "timeline-1",
        objectType: "timeline",
        objectLabel: "Final cut",
        objectPath: "timelines/timeline-1",
        capabilities: ["read", "modify"] as const,
        selection: {
          kind: "text-quote" as const,
          exact: "Director：14 tests Web 相关回归：62 tests",
          prefix: "Timeline：215 tests ",
          suffix: " 三个相关包类型检查通过",
          visualRects: [{ x: 0.12, y: 0.42, width: 0.3, height: 0.04 }],
        },
      },
    } as unknown as AgentAnnotationDraft;

    render(
      <Suspense fallback={<div>Loading</div>}>
        <ChatInput
          input=""
          onInputChange={() => undefined}
          onSubmit={onSubmit}
          annotationBlocks={[annotation]}
        />
      </Suspense>,
    );

    await screen.findByTestId("milkdown-editor");

    fireEvent.click(screen.getByRole("button", { name: "Agent annotations" }));

    expect(
      screen.getByText("Director：14 tests Web 相关回归：62 tests"),
    ).toBeTruthy();
    expect(
      screen.getByPlaceholderText("Add an optional comment…"),
    ).toBeTruthy();

    const sendButton = screen.getByRole("button", {
      name: "copilot.chatInput.send",
    }) as HTMLButtonElement;
    expect(sendButton.disabled).toBe(false);

    fireEvent.click(screen.getByTestId("milkdown-submit"));
    expect(onSubmit).toHaveBeenCalledWith("", [], [annotation]);
  });

  it("points the microphone to Models when local ASR is not configured", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/v1/local/audio")) {
        return new Response(
          JSON.stringify({
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
          }),
          { headers: { "content-type": "application/json" } },
        );
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
    fireEvent.click(
      screen.getByRole("button", { name: "copilot.chatInput.voice" }),
    );

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/local/audio"),
        expect.objectContaining({ credentials: "include" }),
      ),
    );
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Deploy an ASR model in Models first.");
    expect(
      screen.getByRole("link", { name: "Open Models" }).getAttribute("href"),
    ).toBe("/settings?section=models");
  });
});
