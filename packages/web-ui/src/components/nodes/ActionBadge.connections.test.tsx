// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import PromptActionNode from "./ActionBadge";
import { CanvasTransientUiProvider } from "../CanvasTransientUiContext";

const reactFlowMock = vi.hoisted(() => {
  const nodeConnections: any[] = [];
  return {
    addEdges: vi.fn(),
    getEdges: vi.fn(() => []),
    getNode: vi.fn(),
    getNodes: vi.fn(() => []),
    nodeConnections,
    setEdges: vi.fn(),
    setNodes: vi.fn(),
  };
});

const spawnAssetMock = vi.hoisted(() => ({
  adoptDraft: vi.fn(),
  spawnDraft: vi.fn(),
  spawnPending: vi.fn(),
}));

const layoutMock = vi.hoisted(() => ({
  addNodeWithAutoLayout: vi.fn(),
  addNodeWithLayout: vi.fn(),
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
  Reorder: {
    Group: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    Item: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  },
}));

vi.mock("../ProjectContext", async () => {
  const { MODEL_CARDS } = await import("@clash/shared-types");
  return {
    useProject: () => ({
      projectId: "project-1",
      modelCatalogReady: true,
      enabledModelCatalog: MODEL_CARDS.map((model) => ({ model, tier: "available", selectedRoute: {} })),
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
  default: ({ content }: { content?: string }) => <div data-testid="editor">{content}</div>,
}));

vi.mock("../SignedMedia", () => ({
  SignedImg: ({ alt }: { alt?: string }) => <img alt={alt ?? ""} />,
}));

vi.mock("@clash/web-ui/lib/hooks/useAsset", () => ({
  getAsset: vi.fn(),
}));

vi.mock("@clash/web-ui/lib/hooks/useSignedUrl", () => ({
  getSignedUrl: vi.fn(),
}));

vi.mock("@clash/web-ui/hooks/useCustomActions", () => ({
  useCustomActions: () => [],
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
  useSpawnPendingAsset: () => ({
    adoptDraft: spawnAssetMock.adoptDraft,
    canSpawn: true,
    disabledReason: null,
    outputKind: "audio",
    spawnDraft: spawnAssetMock.spawnDraft,
    spawnPending: spawnAssetMock.spawnPending,
  }),
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
  beforeEach(() => {
    cleanup();
    reactFlowMock.nodeConnections.splice(0);
    reactFlowMock.getEdges.mockReset();
    reactFlowMock.getEdges.mockReturnValue([]);
    reactFlowMock.getNode.mockReset();
    reactFlowMock.getNode.mockReturnValue(undefined);
    reactFlowMock.getNodes.mockReset();
    reactFlowMock.getNodes.mockReturnValue([]);
    spawnAssetMock.adoptDraft.mockReset();
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
      throw new Error("ActionBadge should use getNode(id), not scan getNodes()");
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
        ? { id: "audio-1", type: "audio", data: { assetId: "audio-asset-1", status: "completed" } }
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
    fireEvent.click(modelSelect);
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option", { name: "Seedance 2.0 (Reference)" })).toBeTruthy();
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
    const triggers = screen.getAllByRole("button", { name: "Configure action" });

    fireEvent.click(triggers[0]);
    expect(document.querySelectorAll("[data-action-config-panel]")).toHaveLength(1);
    expect(document.querySelector("[data-action-config-panel='action-1']")).not.toBeNull();

    fireEvent.click(triggers[1]);
    expect(document.querySelectorAll("[data-action-config-panel]")).toHaveLength(1);
    expect(document.querySelector("[data-action-config-panel='action-2']")).not.toBeNull();
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

    await waitFor(() => expect(spawnAssetMock.spawnPending).toHaveBeenCalledTimes(1));
    expect(spawnAssetMock.adoptDraft).not.toHaveBeenCalled();
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
        shots: [{
          id: shotId,
          name: shotId === "shot-a" ? "Lead walk" : "Reverse follow",
          cameraId: `camera-${shotId}`,
          startTime: 0,
          sequenceStartTime: shotId === "shot-a" ? 0 : 4,
          durationSeconds: 4,
          aspectRatio: "16:9" as const,
          transition: "cut" as const,
        }],
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

    await waitFor(() => expect(spawnAssetMock.spawnPending).toHaveBeenCalledTimes(2));
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
    expect(spawnAssetMock.spawnPending).toHaveBeenNthCalledWith(1, expect.objectContaining({
      directorReferencePacket: firstPacket,
      directorShotGroupId: groupNode.id,
      groupIndex: 0,
      labelOverride: "Lead walk",
      parentGroupId: groupNode.id,
      sourceDirectorStageId: "stage-1",
      sourceDirectorStageRevisionId: "stage-revision-7",
      sourceDirectorStageShotId: "shot-a",
    }));
    expect(spawnAssetMock.spawnPending).toHaveBeenNthCalledWith(2, expect.objectContaining({
      directorReferencePacket: secondPacket,
      directorShotGroupId: groupNode.id,
      groupIndex: 1,
      labelOverride: "Reverse follow",
      parentGroupId: groupNode.id,
      sourceDirectorStageId: "stage-1",
      sourceDirectorStageRevisionId: "stage-revision-7",
      sourceDirectorStageShotId: "shot-b",
    }));
  });
});
