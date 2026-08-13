// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

import { ProjectProvider } from "../ProjectContext";
import ImageNode from "./ImageNode";
import VideoNode from "./VideoNode";

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

vi.mock("../MediaViewerContext", () => ({
  useMediaViewer: () => ({
    openViewer: vi.fn(),
  }),
}));

vi.mock("../LoroSyncContext", () => ({
  useOptionalLoroSyncContext: () => null,
}));

vi.mock("../PresenceAwarenessContext", () => ({
  usePeersSelectingNode: () => [],
}));

vi.mock("./PeerSelectionRing", () => ({
  default: () => null,
}));

vi.mock("./AttributionLine", () => ({
  default: () => null,
}));

vi.mock("@clash/web-ui/lib/hooks/useAsset", () => ({
  useAsset: () => undefined,
  invalidateAsset: vi.fn(),
}));

vi.mock("@clash/web-ui/lib/hooks/useSignedUrl", () => ({
  useSignedUrl: (url?: string) => url,
}));

vi.mock("@clash/web-ui/lib/runtimeConfig", () => ({
  runtimeApiUrl: (path: string) => path,
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

describe("media node sizing", () => {
  it("renders image nodes from node props width and height without subscribing to all nodes", () => {
    const { container } = render(
      <ProjectProvider projectId="project-test" initialModelCatalog={[]}>
        <ImageNode
          {...baseNodeProps}
          id="image-1"
          type="image"
          width={260}
          height={190}
          data={{
            label: "Preview image",
            status: "completed",
            previewUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E",
          }}
        />
      </ProjectProvider>,
    );

    const card = container.querySelector(".bg-warm-surface") as HTMLElement | null;
    expect(card?.style.width).toBe("260px");
    expect(card?.style.height).toBe("190px");
  });

  it("renders video nodes from node props width and height without subscribing to all nodes", () => {
    const { container } = render(
      <ProjectProvider projectId="project-test" initialModelCatalog={[]}>
        <VideoNode
          {...baseNodeProps}
          id="video-1"
          type="video"
          width={320}
          height={180}
          data={{
            label: "Preview video",
            status: "completed",
            previewUrl: "data:video/mp4;base64,",
          }}
        />
      </ProjectProvider>,
    );

    const card = container.querySelector(".bg-warm-surface") as HTMLElement | null;
    expect(card?.style.width).toBe("320px");
    expect(card?.style.height).toBe("180px");
  });
});
