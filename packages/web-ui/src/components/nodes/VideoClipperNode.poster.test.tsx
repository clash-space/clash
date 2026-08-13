// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import VideoClipperNode from "./VideoClipperNode";

const resolvedVideo = vi.hoisted(() => ({
  id: "video-asset",
  kind: "video" as const,
  status: "ready" as const,
  url: "https://media.clash.test/video-asset.mp4",
  thumbnailUrl: undefined as string | undefined,
  metadata: { durationMs: 12_000 },
  lifecycle: { state: "active" as const },
}));

vi.mock("@xyflow/react", () => ({
  Handle: () => null,
  Position: { Left: "left", Right: "right" },
  useNodeConnections: () => [
    { source: "source-video-node", target: "video-clipper" },
  ],
  useReactFlow: () => ({ getEdges: () => [], getNodes: () => [] }),
  useStore: (selector: (state: unknown) => unknown) =>
    selector({
      nodeLookup: new Map([
        [
          "source-video-node",
          { type: "video", data: { assetId: "video-asset" } },
        ],
      ]),
    }),
}));

vi.mock("../VideoClipperContext", () => ({
  useVideoClipper: () => ({ openEditor: vi.fn() }),
}));

vi.mock("../ProjectContext", () => ({
  useProject: () => ({ projectId: "project-1" }),
}));

vi.mock("@clash/web-ui/lib/hooks/useAsset", () => ({
  useAsset: () => resolvedVideo,
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

afterEach(cleanup);

describe("VideoClipperNode source poster", () => {
  it("never sends a video playback projection through an image decoder", () => {
    const { container } = render(
      <VideoClipperNode
        {...baseNodeProps}
        id="video-clipper"
        type="videoClipper"
        data={{}}
      />,
    );

    expect(
      container.querySelector(
        'img[src="https://media.clash.test/video-asset.mp4"]',
      ),
    ).toBeNull();
    expect(container.querySelector("video")?.getAttribute("src")).toBe(
      "https://media.clash.test/video-asset.mp4",
    );
  });
});
