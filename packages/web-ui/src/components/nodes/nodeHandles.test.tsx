// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, within } from "@testing-library/react";

import { ProjectProvider } from "../ProjectContext";
import TextNode from "./TextNode";
import AudioNode from "./AudioNode";

vi.mock("react-dom", async () => {
  const actual = await vi.importActual<typeof import("react-dom")>("react-dom");
  return {
    ...actual,
    createPortal: (node: React.ReactNode) => node,
  };
});

vi.mock("@xyflow/react", () => ({
  Handle: ({ type, position, ...props }: any) => (
    <div data-testid={`handle-${type}-${position}`} {...props} />
  ),
  Position: {
    Left: "left",
    Right: "right",
  },
  useReactFlow: () => ({
    setNodes: vi.fn(),
  }),
}));

vi.mock("./SourceHandleMenu", () => ({
  default: ({ nodeId }: { nodeId: string }) => (
    <div data-testid="source-handle-menu" data-node-id={nodeId} />
  ),
}));

vi.mock("./DraftPlaceholder", () => ({
  default: ({ nodeId }: { nodeId: string }) => <div data-testid="draft-placeholder" data-node-id={nodeId} />,
}));

vi.mock("../LoroSyncContext", () => ({
  useOptionalLoroSyncContext: () => null,
}));

vi.mock("../MediaViewerContext", () => ({
  useMediaViewer: () => ({
    openViewer: vi.fn(),
    openAssetPreview: vi.fn(),
  }),
}));

vi.mock("../MilkdownEditor", () => ({
  default: () => <div data-testid="milkdown-editor" />,
}));

vi.mock("react-markdown", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="markdown-preview">{children}</div>,
}));

vi.mock("../../../lib/hooks/useAsset", () => ({
  useAsset: () => undefined,
}));

vi.mock("../../../lib/hooks/useSignedUrl", () => ({
  useSignedUrl: (url?: string) => url,
}));

describe("node handle wiring", () => {
  it("keeps the Text card as a drag surface instead of a selectable annotation surface", () => {
    const { container } = render(
      <TextNode
        id="text-1"
        selected={false}
        type="text"
        dragging={false}
        draggable={true}
        selectable={true}
        deletable={true}
        zIndex={1}
        isConnectable={true}
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        data={{
          label: "Outline",
          content: "hello",
          status: "completed",
        }}
      />,
    );

    const dragSurface = within(container).getByTestId("text-node-drag-surface");
    const preview = within(container).getByTestId("text-node-preview");

    expect(dragSurface.className).toContain("cursor-grab");
    expect(dragSurface.className).not.toContain("nodrag");
    expect(preview.className).toContain("pointer-events-none");
    expect(preview.className).toContain("select-none");
    expect(preview.hasAttribute("data-agent-annotation-object-id")).toBe(false);
    expect(within(container).queryByRole("textbox")).toBeNull();
  });

  it("renders downstream source-handle menu for text nodes", () => {
    const { container } = render(
      <TextNode
        id="text-1"
        selected={false}
        type="text"
        dragging={false}
        draggable={true}
        selectable={true}
        deletable={true}
        zIndex={1}
        isConnectable={true}
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        data={{
          label: "Outline",
          content: "hello",
          status: "completed",
        }}
      />,
    );

    const view = within(container);
    expect(view.getByTestId("handle-target-left")).not.toBeNull();
    expect(view.getByTestId("source-handle-menu")).not.toBeNull();
  });

  it("renders an inbound target handle for audio nodes", () => {
    const { container } = render(
      <ProjectProvider projectId="project-test" initialModelCatalog={[]}>
        <AudioNode
          id="audio-1"
          selected={false}
          type="audio"
          dragging={false}
          draggable={true}
          selectable={true}
          deletable={true}
          zIndex={1}
          isConnectable={true}
          positionAbsoluteX={0}
          positionAbsoluteY={0}
          data={{
            label: "Narration",
            status: "draft",
          }}
        />
      </ProjectProvider>,
    );

    const view = within(container);
    expect(view.getByTestId("handle-target-left")).not.toBeNull();
    expect(view.getByTestId("source-handle-menu")).not.toBeNull();
  });
});
