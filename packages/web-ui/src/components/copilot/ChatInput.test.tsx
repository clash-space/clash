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
import { MemoryRouter, useLocation } from "react-router";
import type { AgentAnnotationDraft } from "@clash/shared-types";

import { ChatInput } from "./ChatInput";

const milkdownFocus = vi.hoisted(() => vi.fn());
const milkdownInsert = vi.hoisted(() => vi.fn());

const root = resolve(__dirname, "../../../../..");
const globalCss = readFileSync(
  resolve(root, "apps/web/app/globals.css"),
  "utf8",
);

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="location-probe">{`${location.pathname}${location.search}`}</output>
  );
}

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
        insertAtCursor: milkdownInsert,
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
    milkdownInsert.mockClear();
    vi.restoreAllMocks();
  });

  it("imports project media through the Project Asset endpoint", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
      "00000000-0000-4000-8000-000000000001",
    );
    const assetId = "asset-00000000-0000-4000-8000-000000000001";
    const mediaUrl = `https://media.clash.test/api/v1/projects/project-1/assets/${assetId}/media`;
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        if (String(input).includes("/assets/import-file")) {
          return Response.json({
            id: assetId,
            kind: "image",
            name: "opening.png",
            metadata: {
              originalName: "opening.png",
              contentType: "image/png",
              bytes: 3,
            },
            lifecycle: { state: "active" },
            status: "ready",
            url: mediaUrl,
            thumbnailUrl: mediaUrl,
          });
        }
        return Response.json({
          asr: {
            enabled: false,
            ready: false,
            provider: "builtin-funasr",
            base_url: null,
            model: "iic/SenseVoiceSmall",
          },
        });
      });
    const { container } = render(
      <Suspense fallback={<div>Loading</div>}>
        <ChatInput
          input=""
          projectId="project-1"
          onInputChange={() => undefined}
          onSubmit={() => undefined}
        />
      </Suspense>,
    );
    await screen.findByTestId("milkdown-editor");
    const file = new File(["png"], "opening.png", { type: "image/png" });
    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: { files: [file] },
    });

    await waitFor(() =>
      expect(milkdownInsert).toHaveBeenCalledWith(
        `![opening.png](${mediaUrl} "clash-project-asset:${assetId}") `,
      ),
    );
    const [url, init] = fetchSpy.mock.calls.find(([input]) =>
      String(input).includes("/assets/import-file"),
    )!;
    expect(url).toBe("/api/v1/projects/project-1/assets/import-file");
    const form = init?.body as FormData;
    expect(form.get("file")).toBe(file);
    expect(form.get("kind")).toBe("image");
    expect(form.get("projectAssetId")).toBe(assetId);
  });

  it("submits imported media as a typed Project Asset reference without its Host URL", async () => {
    const onSubmit = vi.fn();
    const markedAssetId = "asset/stable";
    const input = [
      `![marked](https://media.clash.test/api/v1/projects/project-1/assets/url-id/media "clash-project-asset:${encodeURIComponent(markedAssetId)}")`,
      "![unmarked](https://media.clash.test/api/v1/projects/project-1/assets/inferred-id/media)",
    ].join(" ");
    render(
      <Suspense fallback={<div>Loading</div>}>
        <ChatInput
          input={input}
          projectId="project-1"
          onInputChange={() => undefined}
          onSubmit={onSubmit}
        />
      </Suspense>,
    );

    await screen.findByTestId("milkdown-editor");
    fireEvent.click(screen.getByTestId("milkdown-submit"));

    expect(onSubmit).toHaveBeenCalledWith(
      [
        `@[marked](project-asset:${encodeURIComponent(markedAssetId)})`,
        "![unmarked](https://media.clash.test/api/v1/projects/project-1/assets/inferred-id/media)",
      ].join(" "),
      [
        {
          projectAssetId: markedAssetId,
          kind: "image",
          label: "marked",
        },
      ],
      [],
    );
    expect(JSON.stringify(onSubmit.mock.calls[0])).not.toContain("url-id/media");
  });

  it("types a Project Asset mention separately from a real Canvas node mention", async () => {
    const onSubmit = vi.fn();
    const input =
      "Use @[Logo](project-asset:asset-logo) with @[Render](node:action-1)";
    render(
      <Suspense fallback={<div>Loading</div>}>
        <ChatInput
          input={input}
          projectId="project-1"
          onInputChange={() => undefined}
          onSubmit={onSubmit}
          mentionableNodes={[
            {
              id: "asset-logo",
              type: "image",
              label: "Logo",
              kind: "asset",
              scope: "project-assets",
            },
            {
              id: "action-1",
              type: "action",
              label: "Render",
              kind: "node",
              scope: "current-canvas",
            },
          ]}
        />
      </Suspense>,
    );

    await screen.findByTestId("milkdown-editor");
    fireEvent.click(screen.getByTestId("milkdown-submit"));

    expect(onSubmit).toHaveBeenCalledWith(
      input,
      [
        {
          projectAssetId: "asset-logo",
          kind: "image",
          label: "Logo",
        },
      ],
      [],
    );
  });

  it("does not expose the generic attachment entry outside a Project scope", async () => {
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
    expect(
      screen.queryByRole("button", { name: "copilot.chatInput.attach" }),
    ).toBeNull();
    const fileInput = container.querySelector<HTMLInputElement>(
      'input[type="file"]',
    );
    expect(fileInput?.accept).toContain("image/*");
    expect(fileInput?.accept).not.toContain("application/pdf");
    expect(fileInput?.accept).not.toContain("text/plain");
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

  it("keeps the composer controls in separate shrinkable lanes at narrow panel widths", async () => {
    const { container } = render(
      <Suspense fallback={<div>Loading</div>}>
        <ChatInput
          input=""
          onInputChange={() => undefined}
          onSubmit={() => undefined}
          toolbarAccessory={<div data-testid="left-accessory">left</div>}
          rightToolbarAccessory={<div data-testid="right-accessory">right</div>}
        />
      </Suspense>,
    );

    await screen.findByTestId("milkdown-editor");

    expect(
      container.querySelector(".clash-chat-input-toolbar-row"),
    ).toBeTruthy();
    expect(
      container.querySelector(".clash-chat-input-toolbar-start"),
    ).toBeTruthy();
    expect(
      container.querySelector(".clash-chat-input-toolbar-end"),
    ).toBeTruthy();
    expect(
      container.querySelector(".clash-chat-input-toolbar-accessory"),
    ).toBeTruthy();
    expect(
      container.querySelector(".clash-chat-input-toolbar-config"),
    ).toBeTruthy();
    expect(globalCss).toMatch(
      /\.clash-chat-input-surface\s*\{[\s\S]*?container-type:\s*inline-size;[\s\S]*?container-name:\s*clash-chat-composer;/,
    );
    expect(globalCss).toMatch(
      /\.clash-chat-input-toolbar-row\s*\{[\s\S]*?grid-template-columns:\s*minmax\(2\.25rem,\s*1fr\)\s+minmax\(0,\s*max-content\);/,
    );
    expect(globalCss).toMatch(
      /@container clash-chat-composer \(max-width:\s*32rem\)\s*\{[\s\S]*?\.clash-session-state-tag-label\s*\{[\s\S]*?display:\s*none;/,
    );
    expect(globalCss).toMatch(
      /\.clash-session-config-trigger\s*\{[\s\S]*?width:\s*max-content;[\s\S]*?min-width:\s*max-content;[\s\S]*?max-width:\s*100%;/,
    );
    expect(globalCss).toMatch(
      /@container clash-chat-composer \(max-width:\s*32rem\)\s*\{[\s\S]*?\.clash-session-config-effort\s*\{[\s\S]*?display:\s*none;/,
    );
    expect(globalCss).toMatch(
      /@container clash-chat-composer \(max-width:\s*24\.5rem\)\s*\{[\s\S]*?\.clash-session-config-trigger\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?max-width:\s*7\.25rem;/,
    );
  });

  it("keeps the same runtime controls when only the composer size is hero", async () => {
    render(
      <Suspense fallback={<div>Loading</div>}>
        <ChatInput
          input=""
          onInputChange={() => undefined}
          onSubmit={() => undefined}
          variant="hero"
          toolbarAccessory={
            <div data-testid="hero-left-accessory">permission</div>
          }
          rightToolbarAccessory={
            <div data-testid="hero-right-accessory">model</div>
          }
        />
      </Suspense>,
    );

    await screen.findByTestId("milkdown-editor");

    expect(screen.getByTestId("hero-left-accessory")).toBeTruthy();
    expect(screen.getByTestId("hero-right-accessory")).toBeTruthy();
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

  it("only gives the composer accent focus when the editor itself is focused", () => {
    expect(globalCss).not.toMatch(
      /\.clash-chat-input-surface:focus-within\s*\{/,
    );
    expect(globalCss).toMatch(
      /\.clash-chat-input-surface:has\(\.clash-chat-input-editor:focus-within\)\s*\{/,
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

  it("routes annotation clicks to the shared inspector instead of editing in a popover", async () => {
    const onAnnotationOpen = vi.fn();
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
          onAnnotationOpen={onAnnotationOpen}
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
    fireEvent.click(
      screen.getByRole("button", { name: "Annotation 1: Hero still" }),
    );

    expect(onAnnotationOpen).toHaveBeenCalledWith("annotation-canvas-1");
    expect(
      screen.queryByRole("textbox", { name: "Annotation for Hero still" }),
    ).toBeNull();
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

  it("does not enter recording and points the microphone to Audio when voice input is disabled", async () => {
    const mediaDevicesDescriptor = Object.getOwnPropertyDescriptor(
      navigator,
      "mediaDevices",
    );
    const getUserMedia = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });
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
      <MemoryRouter initialEntries={["/projects/project-1"]}>
        <Suspense fallback={<div>Loading</div>}>
          <ChatInput
            input=""
            onInputChange={() => undefined}
            onSubmit={() => undefined}
          />
        </Suspense>
        <LocationProbe />
      </MemoryRouter>,
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
    expect(alert.textContent).toContain(
      "Enable voice input in Voice input settings first.",
    );
    expect(
      screen
        .getByRole("link", { name: "Open Voice input" })
        .getAttribute("href"),
    ).toBe("/settings?section=audio");
    fireEvent.click(screen.getByRole("link", { name: "Open Voice input" }));
    await waitFor(() =>
      expect(screen.getByTestId("location-probe").textContent).toBe(
        "/settings?section=audio",
      ),
    );
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("region", { name: "copilot.chatInput.voice" }),
    ).toBeNull();

    if (mediaDevicesDescriptor) {
      Object.defineProperty(navigator, "mediaDevices", mediaDevicesDescriptor);
    } else {
      Reflect.deleteProperty(navigator, "mediaDevices");
    }
  });

  it("anchors homepage voice setup beside the microphone and shows immediate progress", async () => {
    const mediaDevicesDescriptor = Object.getOwnPropertyDescriptor(
      navigator,
      "mediaDevices",
    );
    const stopTracks = vi.fn();
    const getUserMedia = vi.fn(
      async () =>
        ({
          getTracks: () => [{ stop: stopTracks }],
        }) as unknown as MediaStream,
    );
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });

    class ImmediateMediaRecorder {
      state: RecordingState = "inactive";
      mimeType = "audio/webm";
      ondataavailable: ((event: BlobEvent) => void) | null = null;
      onstop: (() => void) | null = null;

      static isTypeSupported() {
        return true;
      }

      constructor(_stream: MediaStream) {}

      start() {
        this.state = "recording";
      }

      stop() {
        if (this.state === "inactive") return;
        this.state = "inactive";
        this.ondataavailable?.({
          data: new Blob(["voice"], { type: this.mimeType }),
        } as BlobEvent);
        this.onstop?.();
      }
    }

    class ImmediateAudioContext {
      createMediaStreamSource() {
        return {
          connect: vi.fn(),
          disconnect: vi.fn(),
        } as unknown as MediaStreamAudioSourceNode;
      }

      createAnalyser() {
        return {
          fftSize: 0,
          frequencyBinCount: 16,
          getFloatTimeDomainData: vi.fn((values: Float32Array) =>
            values.fill(0),
          ),
        } as unknown as AnalyserNode;
      }

      close() {
        return Promise.resolve();
      }
    }

    vi.stubGlobal("MediaRecorder", ImmediateMediaRecorder);
    vi.stubGlobal("AudioContext", ImmediateAudioContext);
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 0),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    let resolveAudioConfig!: (response: Response) => void;
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL) =>
        new Promise<Response>((resolveFetch) => {
          resolveAudioConfig = resolveFetch;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Suspense fallback={<div>Loading</div>}>
          <ChatInput
            input=""
            onInputChange={() => undefined}
            onSubmit={() => undefined}
            variant="hero"
          />
        </Suspense>
      </MemoryRouter>,
    );

    await screen.findByTestId("milkdown-editor");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/api/v1/local/audio/voice-input",
    );
    const voiceButton = screen.getByRole("button", {
      name: "copilot.chatInput.voice",
    });
    fireEvent.click(voiceButton);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const recording = await screen.findByRole("region", {
      name: "copilot.chatInput.voice",
    });
    expect(
      recording.querySelector('[data-waveform-engine="wavesurfer-record"]'),
    ).toBeTruthy();
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(
      screen.queryByRole("dialog", { name: "Voice input setup" }),
    ).toBeNull();

    resolveAudioConfig(
      new Response(
        JSON.stringify({
          asr: {
            enabled: false,
            provider: "builtin-funasr",
            base_url: null,
            model: "iic/SenseVoiceSmall",
            ready: false,
            setup: {
              provider: "funasr",
              runtime: "builtin-rpc",
              status: "disabled",
            },
          },
        }),
        { headers: { "content-type": "application/json" } },
      ),
    );

    const setup = await screen.findByRole("dialog", {
      name: "Voice input setup",
    });
    expect(setup.textContent).toContain(
      "Enable voice input in Voice input settings first.",
    );
    expect(
      screen.queryByRole("region", { name: "copilot.chatInput.voice" }),
    ).toBeNull();
    expect(stopTracks).toHaveBeenCalledTimes(1);
    expect(
      screen
        .getByRole("link", { name: "Open Voice input" })
        .getAttribute("href"),
    ).toBe("/settings?section=audio");

    fireEvent.click(
      screen.getByRole("button", { name: "copilot.chatInput.voice" }),
    );
    expect(
      screen.queryByRole("dialog", { name: "Voice input setup" }),
    ).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    if (mediaDevicesDescriptor) {
      Object.defineProperty(navigator, "mediaDevices", mediaDevicesDescriptor);
    } else {
      Reflect.deleteProperty(navigator, "mediaDevices");
    }
  });

  it("prefetches voice readiness for project composers and reuses the home snapshot", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            asr: {
              enabled: false,
              provider: "builtin-funasr",
              base_url: null,
              model: "iic/SenseVoiceSmall",
              ready: false,
              setup: {
                provider: "funasr",
                runtime: "builtin-rpc",
                status: "disabled",
              },
            },
          }),
          { headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const home = render(
      <MemoryRouter initialEntries={["/"]}>
        <Suspense fallback={<div>Loading</div>}>
          <ChatInput
            input=""
            onInputChange={() => undefined}
            onSubmit={() => undefined}
            variant="hero"
          />
        </Suspense>
      </MemoryRouter>,
    );

    await screen.findByTestId("milkdown-editor");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    home.unmount();

    render(
      <MemoryRouter initialEntries={["/projects/project-1"]}>
        <Suspense fallback={<div>Loading</div>}>
          <ChatInput
            input=""
            onInputChange={() => undefined}
            onSubmit={() => undefined}
          />
        </Suspense>
      </MemoryRouter>,
    );

    await screen.findByTestId("milkdown-editor");
    fireEvent.click(
      screen.getByRole("button", { name: "copilot.chatInput.voice" }),
    );
    await screen.findByRole("alert");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rechecks an unavailable shared voice snapshot after its short cache window", async () => {
    let now = 10_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            asr: {
              enabled: false,
              provider: "builtin-funasr",
              base_url: null,
              model: "iic/SenseVoiceSmall",
              ready: false,
              setup: {
                provider: "funasr",
                runtime: "builtin-rpc",
                status: "disabled",
              },
            },
          }),
          { headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const home = render(
      <MemoryRouter initialEntries={["/"]}>
        <Suspense fallback={<div>Loading</div>}>
          <ChatInput
            input=""
            onInputChange={() => undefined}
            onSubmit={() => undefined}
            variant="hero"
          />
        </Suspense>
      </MemoryRouter>,
    );

    await screen.findByTestId("milkdown-editor");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    home.unmount();

    now += 1_001;
    render(
      <MemoryRouter initialEntries={["/projects/project-1"]}>
        <Suspense fallback={<div>Loading</div>}>
          <ChatInput
            input=""
            onInputChange={() => undefined}
            onSubmit={() => undefined}
          />
        </Suspense>
      </MemoryRouter>,
    );

    await screen.findByTestId("milkdown-editor");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("points an enabled voice input with an undeployed ASR model to Models", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            asr: {
              enabled: true,
              provider: "builtin-funasr",
              base_url: null,
              model: "iic/SenseVoiceSmall",
              ready: false,
            },
          }),
          { headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemoryRouter initialEntries={["/projects/project-1"]}>
        <Suspense fallback={<div>Loading</div>}>
          <ChatInput
            input=""
            onInputChange={() => undefined}
            onSubmit={() => undefined}
          />
        </Suspense>
        <LocationProbe />
      </MemoryRouter>,
    );

    await screen.findByTestId("milkdown-editor");
    fireEvent.click(
      screen.getByRole("button", { name: "copilot.chatInput.voice" }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "Deploy the selected ASR model in Models first.",
    );
    fireEvent.click(screen.getByRole("link", { name: "Open Models" }));
    await waitFor(() =>
      expect(screen.getByTestId("location-probe").textContent).toBe(
        "/settings?section=models",
      ),
    );
  });

  it("keeps recording in the composer toolbar and supports transcribe-only or transcribe-and-send", async () => {
    const mediaDevicesDescriptor = Object.getOwnPropertyDescriptor(
      navigator,
      "mediaDevices",
    );
    const stopTracks = vi.fn();
    const stream = {
      getTracks: () => [{ stop: stopTracks }],
    } as unknown as MediaStream;
    const getUserMedia = vi.fn(async () => stream);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });

    class TestMediaRecorder {
      state: RecordingState = "inactive";
      mimeType = "audio/webm";
      ondataavailable: ((event: BlobEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      onstop: (() => void) | null = null;
      private readonly listeners = new Map<string, Array<() => void>>();

      constructor(_stream: MediaStream) {}

      static isTypeSupported() {
        return true;
      }

      start() {
        this.state = "recording";
      }

      stop() {
        if (this.state === "inactive") return;
        this.state = "inactive";
        this.ondataavailable?.({
          data: new Blob(["voice"], { type: this.mimeType }),
        } as BlobEvent);
        this.onstop?.();
        this.listeners.get("stop")?.forEach((listener) => listener());
      }

      addEventListener(name: string, listener: () => void) {
        this.listeners.set(name, [
          ...(this.listeners.get(name) ?? []),
          listener,
        ]);
      }
    }

    const getByteFrequencyData = vi.fn((values: Uint8Array) => values.fill(0));
    const getByteTimeDomainData = vi.fn((values: Uint8Array) => {
      values.fill(128);
      values[0] = 196;
    });

    class TestAudioContext {
      createAnalyser() {
        return {
          fftSize: 0,
          smoothingTimeConstant: 0,
          frequencyBinCount: 24,
          getByteFrequencyData,
          getByteTimeDomainData,
          getFloatTimeDomainData: vi.fn((values: Float32Array) =>
            values.fill(0.25),
          ),
        } as unknown as AnalyserNode;
      }

      createMediaStreamSource() {
        return {
          connect: vi.fn(),
          disconnect: vi.fn(),
        } as unknown as MediaStreamAudioSourceNode;
      }

      close() {
        return Promise.resolve();
      }
    }

    vi.stubGlobal("MediaRecorder", TestMediaRecorder);
    vi.stubGlobal("AudioContext", TestAudioContext);
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 0),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const onInputChange = vi.fn();
    const onSubmit = vi.fn();
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes("/api/v1/local/audio/voice-input/warmup")) {
          expect(init?.method).toBe("POST");
          return Response.json({ warmed: true, runtime: "builtin-rpc" });
        }
        if (String(input).includes("/api/v1/local/audio/transcriptions")) {
          expect(init?.method).toBe("POST");
          expect(init?.body).toBeInstanceOf(FormData);
          return new Response(JSON.stringify({ text: "hello from ASR" }), {
            headers: { "content-type": "application/json" },
          });
        }
        if (String(input).includes("/api/v1/local/audio")) {
          return new Response(
            JSON.stringify({
              asr: {
                enabled: true,
                ready: true,
                provider: "builtin-funasr",
                base_url: null,
                model: "iic/SenseVoiceSmall",
                setup: { runtime: "builtin-rpc" },
              },
            }),
            { headers: { "content-type": "application/json" } },
          );
        }
        return new Response("not found", { status: 404 });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      render(
        <MemoryRouter>
          <Suspense fallback={<div>Loading</div>}>
            <ChatInput
              input="existing"
              onInputChange={onInputChange}
              onSubmit={onSubmit}
              variant="hero"
            />
          </Suspense>
        </MemoryRouter>,
      );

      await screen.findByTestId("milkdown-editor");
      fireEvent.click(
        screen.getByRole("button", { name: "copilot.chatInput.voice" }),
      );
      const recording = await screen.findByRole("region", {
        name: "copilot.chatInput.voice",
      });
      expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
      expect(
        recording.classList.contains("clash-voice-recording-toolbar"),
      ).toBe(true);
      const waveform = recording.querySelector(
        ".clash-voice-recording-waveform",
      );
      expect(waveform).toBeTruthy();
      expect(
        waveform?.querySelector('[data-waveform-engine="wavesurfer-record"]'),
      ).toBeTruthy();
      expect(waveform?.querySelector("svg")).toBeNull();
      expect(screen.getByText("0:00")).toBeTruthy();
      expect(recording.querySelector(".animate-spin")).toBeNull();
      await waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining("/api/v1/local/audio/voice-input/warmup"),
          expect.objectContaining({ method: "POST" }),
        ),
      );

      fireEvent.click(
        screen.getByRole("button", {
          name: "copilot.chatInput.stopAndTranscribe",
        }),
      );

      await waitFor(() =>
        expect(onInputChange).toHaveBeenCalledWith("existing hello from ASR"),
      );
      expect(onSubmit).not.toHaveBeenCalled();
      expect(stopTracks).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/local/audio/transcriptions"),
        expect.objectContaining({ method: "POST" }),
      );

      fireEvent.click(
        screen.getByRole("button", { name: "copilot.chatInput.voice" }),
      );
      await screen.findByRole("region", { name: "copilot.chatInput.voice" });
      fireEvent.click(
        screen.getByRole("button", {
          name: "copilot.chatInput.stopTranscribeAndSend",
        }),
      );

      await waitFor(() =>
        expect(onSubmit).toHaveBeenCalledWith(
          "existing hello from ASR",
          [],
          [],
        ),
      );
      expect(onInputChange).toHaveBeenLastCalledWith("");
      expect(stopTracks).toHaveBeenCalledTimes(2);
    } finally {
      if (mediaDevicesDescriptor) {
        Object.defineProperty(
          navigator,
          "mediaDevices",
          mediaDevicesDescriptor,
        );
      } else {
        Reflect.deleteProperty(navigator, "mediaDevices");
      }
    }
  });
});
