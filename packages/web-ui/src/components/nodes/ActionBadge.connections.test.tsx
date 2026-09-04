// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  CustomActionDefinitionSchema,
  MODEL_CARDS,
  type ModelCatalogEntry,
  type ModelUpstreamRoute,
} from "@clash/shared-types";

import PromptActionNode, {
  normalizeActionAspectRatioOptions,
  planKeyframeInsertion,
} from "./ActionBadge";
import { CanvasTransientUiProvider } from "../CanvasTransientUiContext";
import { CustomActionsProvider } from "../CustomActionsContext";

const reactFlowMock = vi.hoisted(() => {
  const nodeConnections: any[] = [];
  return {
    addEdges: vi.fn(),
    getEdges: vi.fn(() => []),
    getNode: vi.fn((_id: string): any => undefined),
    getNodes: vi.fn((): any[] => []),
    nodeConnections,
    setEdges: vi.fn(),
    setNodes: vi.fn(),
  };
});

const spawnAssetMock = vi.hoisted(() => ({
  adoptDraft: vi.fn(),
  latestInput: null as any,
  spawnDraft: vi.fn(),
  spawnPending: vi.fn(),
}));

const layoutMock = vi.hoisted(() => ({
  addNodeWithAutoLayout: vi.fn(),
  addNodeWithLayout: vi.fn(),
}));

const projectContextMock = vi.hoisted(() => ({
  enabledModelCatalog: null as ModelCatalogEntry[] | null,
}));

const refPickerAssetMock = vi.hoisted(() => ({
  asset: undefined as
    | {
        id: string;
        kind: "video";
        status: "ready";
        url: string;
        thumbnailUrl?: string;
        metadata: Record<string, never>;
        lifecycle: { state: "active" };
      }
    | undefined,
}));

vi.mock("@xyflow/react", () => ({
  Handle: ({ type, position, ...props }: any) => (
    <div data-testid={`handle-${type}-${position}`} {...props} />
  ),
  Position: {
    Left: "left",
    Right: "right",
    Top: "top",
    Bottom: "bottom",
  },
  NodeToolbar: ({ children, isVisible }: any) =>
    isVisible ? <div data-testid="node-toolbar">{children}</div> : null,
  useNodeConnections: () => reactFlowMock.nodeConnections,
  useReactFlow: () => ({
    addEdges: reactFlowMock.addEdges,
    getEdges: reactFlowMock.getEdges,
    getNode: reactFlowMock.getNode,
    getNodes: reactFlowMock.getNodes,
    setEdges: reactFlowMock.setEdges,
    setNodes: reactFlowMock.setNodes,
  }),
}));

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  useReducedMotion: () => true,
  Reorder: {
    Group: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    Item: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    button: ({ children, ...props }: any) => (
      <button {...props}>{children}</button>
    ),
  },
}));

vi.mock("../ProjectContext", async () => {
  const { MODEL_CARDS } = await import("@clash/shared-types");
  return {
    useProject: () => ({
      projectId: "project-1",
      modelCatalogReady: true,
      enabledModelCatalog:
        projectContextMock.enabledModelCatalog ??
        MODEL_CARDS.map((model) => ({
          model,
          tier: "available",
          selectedRoute: {},
        })),
    }),
  };
});

vi.mock("../LoroSyncContext", () => ({
  useOptionalLoroSyncContext: () => null,
}));

vi.mock("../PresenceAwarenessContext", () => ({
  usePeersSelectingNode: () => [],
}));

vi.mock("../ConfirmDialog", () => ({
  useConfirm: () => vi.fn(),
}));

vi.mock("../MilkdownEditor", () => ({
  default: ({ content }: { content?: string }) => (
    <div data-testid="editor">{content}</div>
  ),
}));

vi.mock("../ProjectedMedia", () => ({
  ProjectedImage: ({ src, alt }: { src?: string; alt?: string }) => (
    <img src={src} alt={alt ?? ""} />
  ),
}));

vi.mock("@clash/web-ui/lib/hooks/useAsset", () => ({
  getAsset: vi.fn(),
  useAsset: () => refPickerAssetMock.asset,
}));

vi.mock("@clash/web-ui/hooks/useRuntimes", () => ({
  RUNTIME_OFFLINE_LABEL: "Offline",
  RUNTIME_OFFLINE_TOOLTIP: "Runtime offline",
  isCustomActionRuntimeOnline: () => true,
  useRuntimes: () => ({ loading: false, runtimes: [] }),
}));

vi.mock("@clash/web-ui/lib/layout", () => ({
  useLayoutManager: () => layoutMock,
}));

vi.mock("./useSpawnPendingAsset", () => ({
  useSpawnPendingAsset: (input: any) => {
    spawnAssetMock.latestInput = input;
    return {
      adoptDraft: spawnAssetMock.adoptDraft,
      canSpawn: true,
      disabledReason: null,
      outputKind: "audio",
      spawnDraft: spawnAssetMock.spawnDraft,
      spawnPending: spawnAssetMock.spawnPending,
    };
  },
}));

vi.mock("./ActionBadgePipelineMenu", () => ({
  default: () => null,
}));

vi.mock("./AttributionLine", () => ({
  default: () => null,
}));

const baseNodeProps = {
  selected: false,
  dragging: false,
  draggable: true,
  selectable: true,
  deletable: true,
  zIndex: 1,
  isConnectable: true,
  positionAbsoluteX: 0,
  positionAbsoluteY: 0,
};

describe("ActionBadge canvas subscriptions", () => {
  it("removes presentation aliases before Action passes ratio options to its picker", () => {
    expect(
      normalizeActionAspectRatioOptions({
        id: "aspect_ratio",
        label: "Aspect Ratio",
        type: "select",
        required: false,
        options: [
          { label: "Landscape (16:9)", value: "16:9" },
          { label: "Ultrawide (21:9)", value: "21:9" },
        ],
      }),
    ).toEqual([
      { label: "16:9", value: "16:9" },
      { label: "21:9", value: "21:9" },
    ]);
  });

  it("redistributes untouched timing but preserves custom timing when adding a keyframe", () => {
    expect(planKeyframeInsertion([0, 60, 120], 120, false)).toEqual({
      insertionIndex: 2,
      frameIndices: [0, 40, 80, 120],
    });
    expect(planKeyframeInsertion([0, 24, 120], 120, true)).toEqual({
      insertionIndex: 2,
      frameIndices: [0, 24, 72, 120],
    });
    // Equal gaps choose the later slot so insertion still feels append-like.
    expect(planKeyframeInsertion([0, 60, 120], 120, true)).toEqual({
      insertionIndex: 2,
      frameIndices: [0, 60, 90, 120],
    });
  });

  beforeEach(() => {
    cleanup();
    Element.prototype.scrollIntoView = vi.fn();
    reactFlowMock.nodeConnections.splice(0);
    reactFlowMock.getEdges.mockReset();
    reactFlowMock.getEdges.mockReturnValue([]);
    reactFlowMock.getNode.mockReset();
    reactFlowMock.getNode.mockReturnValue(undefined);
    reactFlowMock.getNodes.mockReset();
    reactFlowMock.getNodes.mockReturnValue([]);
    reactFlowMock.addEdges.mockReset();
    reactFlowMock.setNodes.mockReset();
    spawnAssetMock.adoptDraft.mockReset();
    spawnAssetMock.latestInput = null;
    spawnAssetMock.adoptDraft.mockResolvedValue({ id: "draft-1" });
    spawnAssetMock.spawnDraft.mockReset();
    spawnAssetMock.spawnPending.mockReset();
    spawnAssetMock.spawnPending.mockResolvedValue({ id: "new-output" });
    layoutMock.addNodeWithAutoLayout.mockReset();
    layoutMock.addNodeWithAutoLayout.mockImplementation((node: any) => ({
      ...node,
      position: { x: 320, y: 0 },
    }));
    layoutMock.addNodeWithLayout.mockReset();
    projectContextMock.enabledModelCatalog = null;
    refPickerAssetMock.asset = undefined;
  });

  it("disables a parameter only when every configured provider excludes it", () => {
    const seedAudio = MODEL_CARDS.find((model) => model.id === "seed-audio-1")!;
    const hiloRoute = {
      modelCode: seedAudio.id,
      kind: seedAudio.kind,
      providerId: "hilo-hub",
      upstreamId: "hilo-hub",
      upstreamModel: "seed-audio-1.0",
      apiShape: "hilo-hub",
      priority: 1,
      excludedParameterIds: ["voice_id"],
      executorBinding: {
        pluginId: "hilo.hub-media",
        version: "1.0.0",
        exportId: "hilo-hub-execute",
        schemaHash: `sha256:${"a".repeat(64)}`,
      },
    } satisfies ModelUpstreamRoute;
    const officialRoute = {
      ...hiloRoute,
      providerId: "volcengine-speech",
      upstreamId: "volcengine-speech",
      apiShape: "volcengine-speech",
      excludedParameterIds: undefined,
      executorBinding: {
        pluginId: "clash.volcengine",
        version: "1.0.0",
        exportId: "volcengine-speech-execute",
        schemaHash: `sha256:${"b".repeat(64)}`,
      },
    } satisfies ModelUpstreamRoute;
    const catalogEntry = (
      routes: ModelUpstreamRoute[],
      unavailableParameterIds: string[],
    ): ModelCatalogEntry => ({
      model: seedAudio,
      tier: "available",
      routes,
      selectedRoute: routes[0] ?? null,
      candidateProviders: routes.flatMap((route) =>
        route.providerId ? [route.providerId] : [],
      ),
      unavailableParameterIds,
      missingCredentials: [],
      missingOAuth: [],
    });
    const renderEditor = () =>
      render(
        <CanvasTransientUiProvider>
          <PromptActionNode
            {...baseNodeProps}
            id="seed-audio-action"
            type="action-badge"
            data={{
              actionType: "audio-gen",
              content: "A calm narrator",
              label: "Generate audio",
              modelId: seedAudio.id,
            }}
          />
        </CanvasTransientUiProvider>,
      );
    const openParameters = () => {
      fireEvent.click(screen.getByRole("button", { name: "Configure action" }));
      fireEvent.click(screen.getByRole("button", { name: /WAV/ }));
    };

    projectContextMock.enabledModelCatalog = [
      catalogEntry([hiloRoute], ["voice_id"]),
    ];
    const first = renderEditor();
    openParameters();
    expect(screen.getByRole("button", { name: /Voice ID/i })).toBeDisabled();

    first.unmount();
    projectContextMock.enabledModelCatalog = [
      catalogEntry([hiloRoute, officialRoute], []),
    ];
    renderEditor();
    openParameters();
    const voiceIdControl = screen.getByRole("button", { name: /Voice ID/i });
    expect(voiceIdControl).toBeEnabled();
    fireEvent.click(voiceIdControl);
    fireEvent.change(screen.getByRole("textbox", { name: "Voice ID" }), {
      target: { value: "speaker-123" },
    });
    expect(spawnAssetMock.latestInput.pluginBinding).toMatchObject({
      pluginId: "clash.volcengine",
      exportId: "volcengine-speech-execute",
    });
  });

  it("mounts from node-scoped connections without subscribing to every edge", () => {
    const { getByText } = render(
      <CanvasTransientUiProvider>
        <PromptActionNode
          {...baseNodeProps}
          id="action-1"
          type="action-badge"
          data={{
            actionType: "image-gen",
            content: "Generate a variant",
            label: "Generate",
            modelId: "nano-banana-2",
          }}
        />
      </CanvasTransientUiProvider>,
    );

    expect(getByText("Generate")).not.toBeNull();
  });

  it("keeps the selected capsule fill uniform while the configure half is hovered", () => {
    render(
      <CanvasTransientUiProvider>
        <PromptActionNode
          {...baseNodeProps}
          selected
          id="action-1"
          type="action-badge"
          data={{
            actionType: "text-gen",
            content: "Write a brief",
            label: "Agent Brief",
            modelId: "gpt-5.4",
          }}
        />
      </CanvasTransientUiProvider>,
    );

    expect(
      screen.getByRole("button", { name: "Configure action" }).className,
    ).toContain("hover:bg-transparent");
  });

  it("renders direct-only Lyrics while connected Text references remain Prompt references", () => {
    reactFlowMock.nodeConnections.push({
      edgeId: "lyrics-text-music-action",
      source: "lyrics-text",
      target: "music-action",
    });
    const lyricsNode = {
      id: "lyrics-text",
      type: "text",
      data: { label: "Chorus draft", content: "Stay until morning" },
    };
    reactFlowMock.getNode.mockImplementation((id: string) =>
      id === lyricsNode.id ? lyricsNode : undefined,
    );
    reactFlowMock.getNodes.mockReturnValue([lyricsNode]);

    render(
      <CanvasTransientUiProvider>
        <PromptActionNode
          {...baseNodeProps}
          id="music-action"
          type="action-badge"
          data={{
            actionType: "audio-gen",
            content: "Dreamy synth pop",
            label: "Night song",
            lyrics: "[Verse]\nNeon rain",
            modelId: "minimax-music-3",
          }}
        />
      </CanvasTransientUiProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Configure action" }));

    const lyricsInput = screen.getByRole("textbox", { name: "Lyrics" });
    expect((lyricsInput as HTMLTextAreaElement).value).toBe(
      "[Verse]\nNeon rain",
    );
    expect(
      screen.queryByRole("button", { name: "Add lyrics reference" }),
    ).toBeNull();
    expect(spawnAssetMock.latestInput.lyrics).toBe("[Verse]\nNeon rain");
    expect(spawnAssetMock.latestInput.refNodeIds).toEqual(["lyrics-text"]);
    expect(spawnAssetMock.latestInput.lyricsRefNodeIds).toBeUndefined();

    fireEvent.change(lyricsInput, { target: { value: "[Chorus]\nStay" } });
    expect(spawnAssetMock.latestInput.lyrics).toBe("[Chorus]\nStay");
  });

  it("does not render a Lyrics input for non-music models", () => {
    render(
      <CanvasTransientUiProvider>
        <PromptActionNode
          {...baseNodeProps}
          id="video-action"
          type="action-badge"
          data={{
            actionType: "video-gen",
            content: "A quiet street",
            label: "Generate video",
            modelId: "minimax-h3",
          }}
        />
      </CanvasTransientUiProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Configure action" }));
    expect(screen.queryByRole("textbox", { name: "Lyrics" })).toBeNull();
  });

  it("presents FLUX 3 keyframes as an independent model card", () => {
    render(
      <CanvasTransientUiProvider>
        <PromptActionNode
          {...baseNodeProps}
          id="flux-action"
          type="action-badge"
          data={{
            actionType: "video-gen",
            content: "Connect these moments",
            label: "FLUX 3",
            modelId: "flux-3-video-keyframes",
          }}
        />
      </CanvasTransientUiProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Configure action" }));
    expect(
      screen.queryByRole("combobox", { name: "FLUX 3 Video workflow" }),
    ).toBeNull();
    const strip = screen.getByTestId("frame-reference-strip");
    expect(strip.getAttribute("data-frame-layout")).toBe("scroll");
    expect(
      screen.getByRole("button", { name: "Pick Start keyframe" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Pick End keyframe" }),
    ).toBeTruthy();
    expect(strip.textContent).toContain("Start");
    expect(strip.textContent).toContain("End");
    expect(strip.textContent).toContain("0s");
    expect(strip.textContent).toContain("5s");
    expect(screen.queryByText(/0\/10 keyframes/)).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Add reference from canvas" }),
    ).toBeNull();
    expect(screen.queryByTestId("keyframe-timeline-track")).toBeNull();

    fireEvent.click(screen.getByRole("combobox", { name: "Model" }));
    expect(screen.getByRole("option", { name: "FLUX 3 Video" })).toBeTruthy();
    expect(
      screen.getByRole("option", { name: "FLUX 3 Video (Keyframes)" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("option", { name: "FLUX 3 Video (Continue)" }),
    ).toBeTruthy();
  });

  it("uses the shared frame strip for fixed start/end slots", () => {
    render(
      <CanvasTransientUiProvider>
        <PromptActionNode
          {...baseNodeProps}
          id="start-end-action"
          type="action-badge"
          data={{
            actionType: "video-gen",
            content: "Move between these frames",
            label: "Start and end",
            modelId: "minimax-h3-startend",
          }}
        />
      </CanvasTransientUiProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Configure action" }));
    const strip = screen.getByTestId("frame-reference-strip");
    expect(strip.getAttribute("data-frame-layout")).toBe("fixed");
    expect(
      screen.getByRole("button", { name: "Pick Start frame" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pick End frame" })).toBeTruthy();
  });

  it("gives FLUX 3 continuation a single semantic Source video slot", () => {
    render(
      <CanvasTransientUiProvider>
        <PromptActionNode
          {...baseNodeProps}
          id="flux-continue-action"
          type="action-badge"
          data={{
            actionType: "video-gen",
            content: "Keep the shot moving",
            label: "Continue",
            modelId: "flux-3-video-continue",
          }}
        />
      </CanvasTransientUiProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Configure action" }));
    expect(
      screen.queryByRole("combobox", { name: "FLUX 3 Video workflow" }),
    ).toBeNull();
    expect(screen.getByText("Source video")).toBeTruthy();
    expect(screen.getByText("MP4 · up to 15s · 50 MB")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Choose source video" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Add reference from canvas" }),
    ).toBeNull();
  });

  it("never sends a source-video playback URL through the reference-picker image decoder", () => {
    const sourceVideo = {
      id: "source-video",
      type: "video",
      data: { assetId: "source-video-asset", label: "Opening clip" },
    };
    reactFlowMock.getNodes.mockReturnValue([sourceVideo]);
    refPickerAssetMock.asset = {
      id: "source-video-asset",
      kind: "video",
      status: "ready",
      url: "https://media.clash.test/source-video.mp4",
      metadata: {},
      lifecycle: { state: "active" },
    };

    render(
      <CanvasTransientUiProvider>
        <PromptActionNode
          {...baseNodeProps}
          id="flux-continue-action"
          type="action-badge"
          data={{
            actionType: "video-gen",
            content: "Keep the shot moving",
            label: "Continue",
            modelId: "flux-3-video-continue",
          }}
        />
      </CanvasTransientUiProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Configure action" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose source video" }));

    expect(
      document.querySelector(
        'img[src="https://media.clash.test/source-video.mp4"]',
      ),
    ).toBeNull();
    expect(
      document.querySelector("video")?.getAttribute("src"),
    ).toBe("https://media.clash.test/source-video.mp4");
  });

  it("lets Seedance continuation collect videos up to the card's declared limit", () => {
    const sourceVideo = {
      id: "seedance-source-1",
      type: "video",
      data: { label: "Opening clip" },
    };
    reactFlowMock.nodeConnections.push({
      edgeId: "seedance-source-1-seedance-extend-action",
      source: sourceVideo.id,
      target: "seedance-extend-action",
    });
    reactFlowMock.getNode.mockImplementation((id: string) =>
      id === sourceVideo.id ? sourceVideo : undefined,
    );

    render(
      <CanvasTransientUiProvider>
        <PromptActionNode
          {...baseNodeProps}
          id="seedance-extend-action"
          type="action-badge"
          data={{
            actionType: "video-gen",
            content: "Bridge these source clips",
            label: "Extend",
            modelId: "seedance-2-extend",
          }}
        />
      </CanvasTransientUiProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Configure action" }));
    expect(screen.getByText("Source videos")).toBeTruthy();
    expect(screen.getByText("1–3 videos · up to 15s total")).toBeTruthy();
    expect(screen.getByText("Opening clip")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Add source video" }),
    ).toBeTruthy();
  });

  it("labels and evenly times the first and last FLUX 3 keyframes", () => {
    const keyframes = Array.from({ length: 2 }, (_, index) => ({
      id: `frame-${index + 1}`,
      type: "image",
      data: { label: `Frame ${index + 1}` },
    }));
    reactFlowMock.nodeConnections.push(
      ...keyframes.map((frame) => ({
        edgeId: `${frame.id}-flux-action`,
        source: frame.id,
        target: "flux-action",
      })),
    );
    reactFlowMock.getNode.mockImplementation((id: string) =>
      keyframes.find((frame) => frame.id === id),
    );

    render(
      <CanvasTransientUiProvider>
        <PromptActionNode
          {...baseNodeProps}
          id="flux-action"
          type="action-badge"
          data={{
            actionType: "video-gen",
            content: "Connect these moments",
            label: "FLUX 3",
            modelId: "flux-3-video-keyframes",
            referenceImageOrder: keyframes.map((frame) => frame.id),
          }}
        />
      </CanvasTransientUiProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Configure action" }));
    const editor = screen.getByRole("list", { name: "FLUX 3 keyframes" });
    const strip = screen.getByTestId("frame-reference-strip");
    expect(strip.getAttribute("data-frame-layout")).toBe("scroll");
    expect(strip.className).not.toMatch(
      /rounded-xl|border-warm-border|bg-warm-surface|shadow-sm/,
    );
    expect(editor.textContent).toContain("Start");
    expect(editor.textContent).toContain("End");
    expect(editor.textContent).toContain("0s");
    expect(editor.textContent).toContain("5s");
    expect(screen.queryByText(/2\/10 keyframes/)).toBeNull();
    expect(
      screen.getByRole("button", { name: "Add middle keyframe" }),
    ).toBeTruthy();
    expect(screen.queryByTestId("keyframe-timeline-track")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Edit keyframe timing" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Edit keyframe timing" }),
    ).toBeTruthy();
    expect(screen.getByTestId("keyframe-timeline-track")).toBeTruthy();
  });

  it("edits an intermediate FLUX 3 keyframe at exact 24 fps positions in the timing dialog", async () => {
    const keyframes = Array.from({ length: 3 }, (_, index) => ({
      id: `timed-frame-${index + 1}`,
      type: "image",
      data: { label: `Timed frame ${index + 1}` },
    }));
    reactFlowMock.nodeConnections.push(
      ...keyframes.map((frame) => ({
        edgeId: `${frame.id}-timed-action`,
        source: frame.id,
        target: "timed-action",
      })),
    );
    reactFlowMock.getNode.mockImplementation((id: string) =>
      keyframes.find((frame) => frame.id === id),
    );

    render(
      <CanvasTransientUiProvider>
        <PromptActionNode
          {...baseNodeProps}
          id="timed-action"
          type="action-badge"
          data={{
            actionType: "video-gen",
            content: "Hit the exact beat",
            label: "Timed FLUX 3",
            modelId: "flux-3-video-keyframes",
            modelParams: {
              duration: 5,
              keyframe_frame_indices: "[0,48,120]",
              keyframe_timing_customized: true,
            },
            referenceImageOrder: keyframes.map((frame) => frame.id),
          }}
        />
      </CanvasTransientUiProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Configure action" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Edit keyframe timing" }),
    );
    const timingDialog = screen.getByRole("dialog", {
      name: "Edit keyframe timing",
    });
    const timeSlots = timingDialog.querySelectorAll(
      '[data-testid="keyframe-time-slot"]',
    );
    expect(timeSlots).toHaveLength(3);
    for (const slot of timeSlots) {
      expect(slot.className).toContain("flex");
      expect(slot.className).toContain("h-4");
      expect(slot.className).toContain("w-10");
      expect(slot.className).toContain("items-center");
      expect(slot.className).toContain("justify-center");
      expect(slot.className).toContain("leading-none");
    }
    const track = screen.getByTestId("keyframe-timeline-track");
    vi.spyOn(track, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 480,
      bottom: 100,
      width: 480,
      height: 100,
      toJSON: () => ({}),
    });
    const markerContent = screen
      .getAllByLabelText("Frame 2 at 2s")
      .find((element) => element.closest('[role="dialog"]')) as HTMLElement;
    const marker = markerContent.parentElement as HTMLElement;
    marker.setPointerCapture = vi.fn();
    fireEvent.pointerDown(marker, { pointerId: 7, clientX: 100 });
    fireEvent.pointerMove(marker, { pointerId: 7, clientX: 196 });
    fireEvent.pointerUp(marker, { pointerId: 7, clientX: 196 });

    await waitFor(() => {
      const dragged = reactFlowMock.setNodes.mock.calls.some(([update]) => {
        if (typeof update !== "function") return false;
        const [nextNode] = update([{ id: "timed-action", data: {} }]);
        return (
          nextNode?.data?.modelParams?.keyframe_frame_indices === "[0,72,120]"
        );
      });
      expect(dragged).toBe(true);
    });

    const timeInput = screen.getByRole("spinbutton", {
      name: "Frame 2 time in seconds",
    }) as HTMLInputElement;
    expect(timeInput.value).toBe("2.00");
    fireEvent.change(timeInput, { target: { value: "3" } });
    fireEvent.blur(timeInput);

    await waitFor(() => {
      const persisted = reactFlowMock.setNodes.mock.calls.some(([update]) => {
        if (typeof update !== "function") return false;
        const [nextNode] = update([{ id: "timed-action", data: {} }]);
        return (
          nextNode?.data?.modelParams?.keyframe_frame_indices ===
            "[0,72,120]" &&
          nextNode?.data?.modelParams?.keyframe_timing_customized === true
        );
      });
      expect(persisted).toBe(true);
    });
  });

  it("stops offering keyframes at the model card limit", () => {
    const keyframes = Array.from({ length: 10 }, (_, index) => ({
      id: `frame-${index + 1}`,
      type: "image",
      data: { label: `Frame ${index + 1}` },
    }));
    reactFlowMock.nodeConnections.push(
      ...keyframes.map((frame) => ({
        edgeId: `${frame.id}-flux-action`,
        source: frame.id,
        target: "flux-action",
      })),
    );
    reactFlowMock.getNode.mockImplementation((id: string) =>
      keyframes.find((frame) => frame.id === id),
    );

    render(
      <CanvasTransientUiProvider>
        <PromptActionNode
          {...baseNodeProps}
          id="flux-action"
          type="action-badge"
          data={{
            actionType: "video-gen",
            content: "Connect every beat",
            label: "FLUX 3",
            modelId: "flux-3-video-keyframes",
            referenceImageOrder: keyframes.map((frame) => frame.id),
          }}
        />
      </CanvasTransientUiProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Configure action" }));
    const editor = screen.getByRole("list", { name: "FLUX 3 keyframes" });
    expect(editor.className).toContain("min-w-max");
    const strip = screen.getByTestId("frame-reference-strip");
    const scrollViewport = screen.getByTestId("frame-reference-scroll");
    const timingButton = screen.getByRole("button", {
      name: "Edit keyframe timing",
    });
    expect(scrollViewport.className).toContain("overflow-x-auto");
    expect(strip.className).toContain("w-[18rem]");
    expect(strip.className).toContain("max-w-[min(18rem,calc(100vw-3rem))]");
    expect(strip.className).toContain("min-w-0");
    expect(strip.className).toContain("flex-none");
    expect(strip.style.width).toBe("18rem");
    expect(strip.style.maxWidth).toBe("calc(100vw - 3rem)");
    expect(strip.style.minWidth).toBe("0px");
    expect(scrollViewport.contains(timingButton)).toBe(false);
    expect(strip.contains(timingButton)).toBe(true);
    expect(strip.querySelectorAll(".clash-node-ref-index")).toHaveLength(0);
    expect(screen.queryByText(/10\/10 keyframes/)).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Add middle keyframe" }),
    ).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Edit keyframe timing" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Edit keyframe timing" });
    expect(dialog.querySelectorAll(".clash-node-ref-index")).toHaveLength(0);
  });

  it("switches between independent FLUX 3 model cards through the model picker", async () => {
    render(
      <CanvasTransientUiProvider>
        <PromptActionNode
          {...baseNodeProps}
          id="flux-action"
          type="action-badge"
          data={{
            actionType: "video-gen",
            content: "A moving portrait",
            label: "FLUX 3",
            modelId: "flux-3-video",
          }}
        />
      </CanvasTransientUiProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Configure action" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Model" }));
    fireEvent.click(
      screen.getByRole("option", { name: "FLUX 3 Video (Continue)" }),
    );

    await waitFor(() => {
      const persisted = reactFlowMock.setNodes.mock.calls.some(([update]) => {
        if (typeof update !== "function") return false;
        const [nextNode] = update([{ id: "flux-action", data: {} }]);
        return nextNode?.data?.modelId === "flux-3-video-continue";
      });
      expect(persisted).toBe(true);
    });
  });

  it("resolves connected source nodes by id without scanning the whole node array", () => {
    reactFlowMock.nodeConnections.push({
      edgeId: "image-1-action-1",
      source: "image-1",
      sourceHandle: null,
      target: "action-1",
      targetHandle: null,
    });
    reactFlowMock.getNode.mockImplementation((id: string) =>
      id === "image-1"
        ? {
            id: "image-1",
            type: "image",
            data: {
              naturalHeight: 180,
              naturalWidth: 320,
            },
          }
        : undefined,
    );
    reactFlowMock.getNodes.mockImplementation(() => {
      throw new Error(
        "ActionBadge should use getNode(id), not scan getNodes()",
      );
    });

    const { getByText } = render(
      <CanvasTransientUiProvider>
        <PromptActionNode
          {...baseNodeProps}
          id="action-1"
          type="action-badge"
          data={{
            actionType: "image-gen",
            content: "Generate a variant",
            label: "Generate",
            modelId: "nano-banana-2",
            referenceImageOrder: ["image-1"],
          }}
        />
      </CanvasTransientUiProvider>,
    );

    expect(getByText("Generate")).not.toBeNull();
    expect(reactFlowMock.getNode).toHaveBeenCalledWith("image-1");
  });

  it("offers only audio-compatible video models for an attached audio reference", () => {
    reactFlowMock.nodeConnections.push({
      edgeId: "audio-1-action-1",
      source: "audio-1",
      sourceHandle: null,
      target: "action-1",
      targetHandle: null,
    });
    reactFlowMock.getNode.mockImplementation((id: string) =>
      id === "audio-1"
        ? {
            id: "audio-1",
            type: "audio",
            data: { assetId: "audio-asset-1", status: "completed" },
          }
        : undefined,
    );

    render(
      <CanvasTransientUiProvider>
        <PromptActionNode
          {...baseNodeProps}
          id="action-1"
          type="action-badge"
          data={{
            actionType: "video-gen",
            content: "Animate to this audio",
            label: "Video Prompt",
            modelId: "seedance-2-ref",
          }}
        />
      </CanvasTransientUiProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Configure action" }));

    const modelSelect = screen.getByRole("combobox", { name: "Model" });
    expect(modelSelect.hasAttribute("disabled")).toBe(false);
    expect(modelSelect.textContent).toContain("Seedance 2.0 (全能参考)");
    fireEvent.click(modelSelect);
    expect(
      screen.getByRole("option", { name: "Seedance 2.5 (全能参考)" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("option", { name: "Seedance 2.0 Fast (全能参考)" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("option", { name: "Seedance 2.0 Mini (全能参考)" }),
    ).toBeTruthy();
    expect(screen.getByRole("option", { name: "Kling Avatar" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Sora 2" })).toBeNull();
    expect(
      screen.queryByRole("option", { name: "Seedance 2.0 (Start/End)" }),
    ).toBeNull();
    expect(
      screen.queryByRole("option", { name: "MiniMax H3 (全能参考)" }),
    ).toBeNull();
  });

  it("selects a form Custom Action from the Image Gen model picker", async () => {
    const action = CustomActionDefinitionSchema.parse({
      id: "codex-imagegen",
      name: "Codex ImageGen",
      outputType: "image",
      presentation: { type: "form" },
      parameters: [
        {
          id: "aspect_ratio",
          label: "Aspect Ratio",
          type: "select",
          options: [{ label: "Square", value: "1:1" }],
          defaultValue: "1:1",
        },
      ],
    });

    render(
      <CanvasTransientUiProvider>
        <CustomActionsProvider actions={[action]}>
          <PromptActionNode
            {...baseNodeProps}
            id="action-1"
            type="action-badge"
            data={{
              actionType: "image-gen",
              content: "Draw a quiet forest",
              label: "Image Prompt",
              modelId: "nano-banana-2",
            }}
          />
        </CustomActionsProvider>
      </CanvasTransientUiProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Configure action" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Model" }));
    fireEvent.click(screen.getByRole("option", { name: "Codex ImageGen" }));

    await waitFor(() =>
      expect(spawnAssetMock.latestInput).toMatchObject({
        actionType: "custom:codex-imagegen",
        isCustom: true,
        customActionParams: { aspect_ratio: "1:1" },
        customDef: { id: "codex-imagegen" },
      }),
    );
  });

  it("opens the aspect-ratio secondary panel directly from its toolbar chip", async () => {
    render(
      <CanvasTransientUiProvider>
        <PromptActionNode
          {...baseNodeProps}
          id="ratio-action"
          type="action-badge"
          data={{
            actionType: "image-gen",
            content: "A vertical studio portrait",
            label: "Image Prompt",
            modelId: "nano-banana-2",
          }}
        />
      </CanvasTransientUiProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Configure action" }));
    fireEvent.click(screen.getByRole("button", { name: "Aspect Ratio: 16:9" }));

    expect(screen.getByLabelText("Model aspect ratio")).toBeTruthy();
    expect(screen.getByText("Aspect ratio")).toBeTruthy();
    expect(screen.queryByText("Choose a preset or drag the frame")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "9:16" }));

    await waitFor(() =>
      expect(spawnAssetMock.latestInput.modelParams).toMatchObject({
        aspect_ratio: "9:16",
      }),
    );
  });

  it("shows only the ratio on a custom action's aspect-ratio toolbar chip", () => {
    const action = CustomActionDefinitionSchema.parse({
      id: "custom-ultrawide-image",
      name: "Custom Ultrawide Image",
      outputType: "image",
      presentation: { type: "form" },
      parameters: [
        {
          id: "aspect_ratio",
          label: "Aspect Ratio",
          type: "select",
          options: [
            { label: "Landscape (16:9)", value: "16:9" },
            { label: "Ultrawide (21:9)", value: "21:9" },
          ],
          defaultValue: "16:9",
        },
      ],
    });

    render(
      <CanvasTransientUiProvider>
        <CustomActionsProvider actions={[action]}>
          <PromptActionNode
            {...baseNodeProps}
            id="custom-ratio-action"
            type="action-badge"
            data={{
              actionType: "custom:custom-ultrawide-image",
              customActionId: "custom-ultrawide-image",
              customActionParams: { aspect_ratio: "21:9" },
              content: "A cat",
              label: "Image Prompt",
            }}
          />
        </CustomActionsProvider>
      </CanvasTransientUiProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Configure action" }));

    expect(screen.getByRole("button", { name: "Aspect Ratio: 21:9" })).toBeTruthy();
    expect(screen.queryByText("Ultrawide (21:9)")).toBeNull();
  });

  it("requires an explicit update before running a Custom Action with a newer definition", async () => {
    const previousBinding = {
      pluginId: "clash.codex-imagegen",
      version: "0.1.0",
      exportId: "generate-image",
      schemaHash: `sha256:${"a".repeat(64)}` as const,
    };
    const currentBinding = {
      ...previousBinding,
      version: "0.1.1",
      schemaHash: `sha256:${"b".repeat(64)}` as const,
    };
    const action = CustomActionDefinitionSchema.parse({
      id: "codex-imagegen",
      name: "Codex ImageGen",
      outputType: "image",
      presentation: { type: "form" },
      parameters: [],
      runtime: "local",
      version: currentBinding.version,
      pluginBinding: currentBinding,
    });

    render(
      <CanvasTransientUiProvider>
        <CustomActionsProvider actions={[action]}>
          <PromptActionNode
            {...baseNodeProps}
            id="stale-action"
            type="action-badge"
            data={{
              actionType: "custom:codex-imagegen",
              customActionId: "codex-imagegen",
              content: "A cat",
              label: "Codex ImageGen",
              pluginBinding: previousBinding,
            }}
          />
        </CustomActionsProvider>
      </CanvasTransientUiProvider>,
    );

    expect(screen.getByText("Action definition updated")).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Action definition updated. Update before running.",
      }),
    ).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Update action" }));

    await waitFor(() => {
      const persisted = reactFlowMock.setNodes.mock.calls.some(([update]) => {
        if (typeof update !== "function") return false;
        const [nextNode] = update([
          {
            id: "stale-action",
            type: "action-badge",
            data: { pluginBinding: previousBinding },
          },
        ]);
        return nextNode?.data?.pluginBinding?.schemaHash ===
          currentBinding.schemaHash;
      });
      expect(persisted).toBe(true);
    });
  });

  it("copies a checkpointed Custom Action onto its current executable definition", async () => {
    const previousBinding = {
      pluginId: "clash.codex-imagegen",
      version: "0.1.0",
      exportId: "generate-image",
      schemaHash: `sha256:${"a".repeat(64)}` as const,
    };
    const currentBinding = {
      ...previousBinding,
      version: "0.1.1",
      schemaHash: `sha256:${"b".repeat(64)}` as const,
    };
    const action = CustomActionDefinitionSchema.parse({
      id: "codex-imagegen",
      name: "Codex ImageGen",
      outputType: "image",
      presentation: { type: "form" },
      parameters: [],
      runtime: "local",
      version: currentBinding.version,
      pluginBinding: currentBinding,
    });
    reactFlowMock.getEdges.mockImplementation(
      () =>
        [
          { id: "stale-output", source: "stale-action", target: "output-1" },
        ] as any,
    );
    reactFlowMock.getNode.mockImplementation((nodeId: string) =>
      nodeId === "stale-action"
        ? { id: nodeId, position: { x: 10, y: 20 } }
        : nodeId === "output-1"
          ? { id: nodeId, type: "image", data: { status: "failed" } }
          : undefined,
    );

    render(
      <CanvasTransientUiProvider>
        <CustomActionsProvider actions={[action]}>
          <PromptActionNode
            {...baseNodeProps}
            id="stale-action"
            type="action-badge"
            data={{
              actionType: "custom:codex-imagegen",
              customActionId: "codex-imagegen",
              customActionParams: { aspect_ratio: "1:1" },
              content: "A cat",
              hasRun: true,
              label: "Codex ImageGen",
              pluginBinding: previousBinding,
            }}
          />
        </CustomActionsProvider>
      </CanvasTransientUiProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy to update" }));

    await waitFor(() => {
      const copied = reactFlowMock.setNodes.mock.calls.some(([update]) => {
        if (typeof update !== "function") return false;
        const nextNodes = update([
          {
            id: "stale-action",
            type: "action-badge",
            position: { x: 10, y: 20 },
            data: { pluginBinding: previousBinding },
          },
        ]);
        const copy = nextNodes.find((node: any) => node.id !== "stale-action");
        return (
          copy?.data?.customActionId === "codex-imagegen" &&
          copy?.data?.customActionParams?.aspect_ratio === "1:1" &&
          copy?.data?.pluginBinding?.schemaHash === currentBinding.schemaHash
        );
      });
      expect(copied).toBe(true);
    });
  });

  it("shrinks the aspect-ratio popover while Auto hides the numeric editor", async () => {
    render(
      <CanvasTransientUiProvider>
        <PromptActionNode
          {...baseNodeProps}
          id="adaptive-ratio-action"
          type="action-badge"
          data={{
            actionType: "video-gen",
            content: "Animate this reference",
            label: "Video Prompt",
            modelId: "minimax-h3",
            modelParams: {
              aspect_ratio: "adaptive",
              duration: 5,
              resolution: "2K",
            },
          }}
        />
      </CanvasTransientUiProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Configure action" }));
    fireEvent.click(screen.getByRole("button", { name: "Aspect Ratio: Auto" }));

    const popover = document.querySelector<HTMLElement>(
      '[data-aspect-ratio-popover]',
    );
    expect(popover).toHaveAttribute("data-aspect-ratio-popover", "automatic");
    expect(popover).toHaveStyle({ width: "22rem" });
    expect(screen.queryByLabelText("Aspect ratio preview")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "16:9" }));

    await waitFor(() => {
      expect(popover).toHaveAttribute("data-aspect-ratio-popover", "editable");
      expect(popover).toHaveStyle({ width: "32.5rem" });
    });
  });

  it("keeps exactly one action configuration panel open", () => {
    render(
      <CanvasTransientUiProvider>
        <PromptActionNode
          {...baseNodeProps}
          id="action-1"
          type="action-badge"
          data={{
            actionType: "image-gen",
            content: "First prompt",
            label: "First",
            modelId: "nano-banana-2",
          }}
        />
        <PromptActionNode
          {...baseNodeProps}
          id="action-2"
          type="action-badge"
          data={{
            actionType: "image-gen",
            content: "Second prompt",
            label: "Second",
            modelId: "nano-banana-2",
          }}
        />
      </CanvasTransientUiProvider>,
    );
    const triggers = screen.getAllByRole("button", {
      name: "Configure action",
    });

    fireEvent.click(triggers[0]);
    expect(
      document.querySelectorAll("[data-action-config-panel]"),
    ).toHaveLength(1);
    expect(
      document.querySelector("[data-action-config-panel='action-1']"),
    ).not.toBeNull();

    fireEvent.click(triggers[1]);
    expect(
      document.querySelectorAll("[data-action-config-panel]"),
    ).toHaveLength(1);
    expect(
      document.querySelector("[data-action-config-panel='action-2']"),
    ).not.toBeNull();
  });

  it("Run creates a fresh pending output instead of adopting a downstream draft", async () => {
    reactFlowMock.nodeConnections.push({
      edgeId: "action-1-draft-1",
      source: "action-1",
      sourceHandle: null,
      target: "draft-1",
      targetHandle: null,
    });
    reactFlowMock.getNode.mockImplementation((id: string) =>
      id === "draft-1"
        ? { id: "draft-1", type: "audio", data: { status: "draft" } }
        : undefined,
    );

    render(
      <CanvasTransientUiProvider>
        <PromptActionNode
          {...baseNodeProps}
          id="action-1"
          type="action-badge"
          data={{
            actionType: "audio-gen",
            content: "Read this line",
            label: "Audio Prompt",
            modelId: "gemini-3.1-flash-tts",
          }}
        />
      </CanvasTransientUiProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Run action" }));

    await waitFor(() =>
      expect(spawnAssetMock.spawnPending).toHaveBeenCalledTimes(1),
    );
    expect(spawnAssetMock.adoptDraft).not.toHaveBeenCalled();
  });

  it("surfaces Model Card media constraints before spawning generation", async () => {
    reactFlowMock.nodeConnections.push({
      edgeId: "image-oversize-action-1",
      source: "image-oversize",
      target: "action-1",
    });
    reactFlowMock.getNode.mockImplementation((id: string) =>
      id === "image-oversize"
        ? {
            id,
            type: "image",
            data: {
              assetId: "asset-oversize",
              naturalWidth: 1024,
              naturalHeight: 1024,
              metadata: { bytes: 31 * 1024 * 1024, contentType: "image/png" },
            },
          }
        : undefined,
    );

    render(
      <CanvasTransientUiProvider>
        <PromptActionNode
          {...baseNodeProps}
          id="action-1"
          type="action-badge"
          data={{
            actionType: "video-gen",
            content: "Animate this frame",
            label: "Animate",
            modelId: "minimax-h3-startend",
          }}
        />
      </CanvasTransientUiProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Run action" }));

    expect((await screen.findByText(/30 MB/)).textContent).toContain("30 MB");
    expect(spawnAssetMock.spawnPending).not.toHaveBeenCalled();
  });

  it("shows a media compatibility error as soon as the model changes", async () => {
    reactFlowMock.nodeConnections.push({
      edgeId: "video-long-action-1",
      source: "video-long",
      target: "action-1",
    });
    reactFlowMock.getNode.mockImplementation((id: string) =>
      id === "video-long"
        ? {
            id,
            type: "video",
            data: {
              assetId: "asset-long",
              naturalWidth: 1280,
              naturalHeight: 720,
              metadata: { durationMs: 20_000, contentType: "video/mp4" },
            },
          }
        : undefined,
    );

    const { rerender } = render(
      <CanvasTransientUiProvider>
        <PromptActionNode
          {...baseNodeProps}
          id="action-1"
          type="action-badge"
          data={{
            actionType: "video-gen",
            content: "Restyle this clip",
            label: "Restyle",
            modelId: "seedance-2.5-ref",
          }}
        />
      </CanvasTransientUiProvider>,
    );

    expect(screen.queryByText(/at most 15 seconds/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Configure action" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Model" }));
    fireEvent.click(
      screen.getByRole("option", { name: "MiniMax H3 (全能参考)" }),
    );

    await waitFor(() => {
      const persisted = reactFlowMock.setNodes.mock.calls.some(([update]) => {
        if (typeof update !== "function") return false;
        const [nextNode] = update([{ id: "action-1", data: {} }]);
        return nextNode?.data?.modelId === "minimax-h3";
      });
      expect(persisted).toBe(true);
    });
    rerender(
      <CanvasTransientUiProvider>
        <PromptActionNode
          {...baseNodeProps}
          id="action-1"
          type="action-badge"
          data={{
            actionType: "video-gen",
            content: "Restyle this clip",
            label: "Restyle",
            modelId: "minimax-h3",
          }}
        />
      </CanvasTransientUiProvider>,
    );

    expect(await screen.findByText(/at most 15 seconds/i)).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Run action" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(reactFlowMock.setEdges).not.toHaveBeenCalled();
  });

  it("shows a conditional media error as soon as edit mode is enabled", async () => {
    reactFlowMock.nodeConnections.push({
      edgeId: "video-short-action-1",
      source: "video-short",
      target: "action-1",
    });
    reactFlowMock.getNode.mockImplementation((id: string) =>
      id === "video-short"
        ? {
            id,
            type: "video",
            data: {
              assetId: "asset-short",
              naturalWidth: 640,
              naturalHeight: 640,
              metadata: { durationMs: 3_999, contentType: "video/mp4" },
            },
          }
        : undefined,
    );

    render(
      <CanvasTransientUiProvider>
        <PromptActionNode
          {...baseNodeProps}
          id="action-1"
          type="action-badge"
          data={{
            actionType: "video-gen",
            content: "Edit this clip",
            label: "Edit",
            modelId: "seedance-2.5-ref",
          }}
        />
      </CanvasTransientUiProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Configure action" }));
    fireEvent.click(
      screen.getByRole("button", { name: /5s .* 720p .* On .* Off/i }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Edit referenced video.*Off/i }),
    );
    fireEvent.click(
      screen.getByRole("combobox", { name: "Edit referenced video" }),
    );
    fireEvent.click(screen.getByRole("option", { name: "On" }));

    expect(await screen.findByText(/at least 4 seconds/i)).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Run action" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(reactFlowMock.setEdges).not.toHaveBeenCalled();
  });

  it("turns Director Shot packets into one visual Shot Group and one generation per Shot", async () => {
    const packet = (shotId: string, assetId: string) => ({
      schemaVersion: 1 as const,
      stageId: "stage-1",
      stageRevisionId: "stage-revision-7",
      exportedAt: "2026-07-24T10:00:00.000Z",
      aspectRatio: "16:9" as const,
      durationSeconds: 4,
      fps: 30,
      scope: { kind: "shot" as const, selectedShotIds: [shotId] },
      cameraIds: [`camera-${shotId}`],
      referenceVideo: {
        assetId,
        mimeType: "video/webm",
      },
      referenceStills: [],
      shotSpec: {
        shots: [
          {
            id: shotId,
            name: shotId === "shot-a" ? "Lead walk" : "Reverse follow",
            cameraId: `camera-${shotId}`,
            startTime: 0,
            sequenceStartTime: shotId === "shot-a" ? 0 : 4,
            durationSeconds: 4,
            aspectRatio: "16:9" as const,
            transition: "cut" as const,
          },
        ],
      },
    });
    const firstPacket = packet("shot-a", "director-shot-a-video");
    const secondPacket = packet("shot-b", "director-shot-b-video");

    reactFlowMock.nodeConnections.push({
      edgeId: "stage-1-action-1",
      source: "stage-1",
      sourceHandle: null,
      target: "action-1",
      targetHandle: null,
    });
    reactFlowMock.getNode.mockImplementation((id: string) =>
      id === "stage-1"
        ? {
            id: "stage-1",
            type: "director-stage",
            data: {
              directorShotReferencePackets: [firstPacket, secondPacket],
              outputVideoAssetId: "director-sequence-preview",
            },
          }
        : undefined,
    );

    render(
      <CanvasTransientUiProvider>
        <PromptActionNode
          {...baseNodeProps}
          id="action-1"
          type="action-badge"
          data={{
            actionType: "video-gen",
            content: "Preserve the blocking and cinematic camera language",
            label: "Generate selected shots",
            modelId: "seedance-2-ref",
          }}
        />
      </CanvasTransientUiProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Run action" }));

    await waitFor(() =>
      expect(spawnAssetMock.spawnPending).toHaveBeenCalledTimes(2),
    );
    expect(layoutMock.addNodeWithAutoLayout).toHaveBeenCalledTimes(1);
    const groupNode = layoutMock.addNodeWithAutoLayout.mock.calls[0][0];
    expect(groupNode).toMatchObject({
      type: "group",
      data: {
        label: "Director shots · 2",
        sourceDirectorStageId: "stage-1",
        sourceDirectorStageRevisionId: "stage-revision-7",
        selectedDirectorShotIds: ["shot-a", "shot-b"],
      },
    });
    expect(spawnAssetMock.spawnPending).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        directorReferencePacket: firstPacket,
        directorShotGroupId: groupNode.id,
        groupIndex: 0,
        labelOverride: "Lead walk",
        parentGroupId: groupNode.id,
        sourceDirectorStageId: "stage-1",
        sourceDirectorStageRevisionId: "stage-revision-7",
        sourceDirectorStageShotId: "shot-a",
      }),
    );
    expect(spawnAssetMock.spawnPending).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        directorReferencePacket: secondPacket,
        directorShotGroupId: groupNode.id,
        groupIndex: 1,
        labelOverride: "Reverse follow",
        parentGroupId: groupNode.id,
        sourceDirectorStageId: "stage-1",
        sourceDirectorStageRevisionId: "stage-revision-7",
        sourceDirectorStageShotId: "shot-b",
      }),
    );
  });

  it("consumes selected Director Shots from referenced video output nodes", async () => {
    const packet = (shotId: string, assetId: string) => ({
      schemaVersion: 1 as const,
      stageId: "stage-1",
      stageRevisionId: "stage-revision-8",
      exportedAt: "2026-07-24T10:00:00.000Z",
      aspectRatio: "16:9" as const,
      durationSeconds: 4,
      fps: 30,
      scope: { kind: "shot" as const, selectedShotIds: [shotId] },
      cameraIds: [`camera-${shotId}`],
      referenceVideo: { assetId, mimeType: "video/webm" },
      referenceStills: [],
      shotSpec: {
        shots: [
          {
            id: shotId,
            name: shotId === "shot-a" ? "Lead walk" : "Reverse follow",
            cameraId: `camera-${shotId}`,
            startTime: 0,
            sequenceStartTime: shotId === "shot-a" ? 0 : 4,
            durationSeconds: 4,
            aspectRatio: "16:9" as const,
            transition: "cut" as const,
          },
        ],
      },
    });
    const firstPacket = packet("shot-a", "director-shot-a-video");
    const secondPacket = packet("shot-b", "director-shot-b-video");

    reactFlowMock.nodeConnections.push(
      {
        edgeId: "output-a-action-1",
        source: "output-a",
        sourceHandle: null,
        target: "action-1",
        targetHandle: null,
      },
      {
        edgeId: "output-b-action-1",
        source: "output-b",
        sourceHandle: null,
        target: "action-1",
        targetHandle: null,
      },
    );
    reactFlowMock.getNode.mockImplementation((id: string) => {
      if (id === "output-a") {
        return {
          id,
          type: "video",
          data: {
            assetId: firstPacket.referenceVideo.assetId,
            directorReferencePacket: firstPacket,
          },
        };
      }
      if (id === "output-b") {
        return {
          id,
          type: "video",
          data: {
            assetId: secondPacket.referenceVideo.assetId,
            directorReferencePacket: secondPacket,
          },
        };
      }
      return undefined;
    });

    render(
      <CanvasTransientUiProvider>
        <PromptActionNode
          {...baseNodeProps}
          id="action-1"
          type="action-badge"
          data={{
            actionType: "video-gen",
            content: "Preserve each rendered Director shot",
            label: "Generate selected shots",
            modelId: "seedance-2-ref",
          }}
        />
      </CanvasTransientUiProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Run action" }));

    await waitFor(() =>
      expect(spawnAssetMock.spawnPending).toHaveBeenCalledTimes(2),
    );
    expect(spawnAssetMock.spawnPending).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        directorReferencePacket: firstPacket,
        sourceDirectorStageId: "stage-1",
        sourceDirectorStageRevisionId: "stage-revision-8",
        sourceDirectorStageShotId: "shot-a",
      }),
    );
    expect(spawnAssetMock.spawnPending).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        directorReferencePacket: secondPacket,
        sourceDirectorStageId: "stage-1",
        sourceDirectorStageRevisionId: "stage-revision-8",
        sourceDirectorStageShotId: "shot-b",
      }),
    );
  });
});
