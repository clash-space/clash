// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

import PromptActionNode from "./ActionBadge";

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

vi.mock("../ProjectContext", () => ({
  useProject: () => ({ projectId: "project-1" }),
}));

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
  useLayoutManager: () => ({
    addNodeWithAutoLayout: vi.fn(),
  }),
}));

vi.mock("./useSpawnPendingAsset", () => ({
  useSpawnPendingAsset: () => ({
    adoptDraft: vi.fn(),
    canSpawn: true,
    disabledReason: null,
    outputKind: "image",
    spawnDraft: vi.fn(),
    spawnPending: vi.fn(),
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
  });

  it("mounts from node-scoped connections without subscribing to every edge", () => {
    const { getByText } = render(
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
      />,
    );

    expect(getByText("Generate")).not.toBeNull();
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
      />,
    );

    expect(getByText("Generate")).not.toBeNull();
    expect(reactFlowMock.getNode).toHaveBeenCalledWith("image-1");
  });
});
