// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import AudioNode from "./AudioNode";
import ImageNode from "./ImageNode";
import VideoNode from "./VideoNode";

const openAssetPreview = vi.fn();

vi.mock("@xyflow/react", () => ({
  Handle: () => null,
  Position: { Left: "left", Right: "right" },
  useReactFlow: () => ({ setNodes: vi.fn() }),
}));

vi.mock("./SourceHandleMenu", () => ({ default: () => null }));
vi.mock("./DraftPlaceholder", () => ({ default: () => null }));
vi.mock("./AttributionLine", () => ({ default: () => null }));
vi.mock("./PeerSelectionRing", () => ({ default: () => null }));
vi.mock("../PresenceAwarenessContext", () => ({
  usePeersSelectingNode: () => [],
}));
vi.mock("../LoroSyncContext", () => ({
  useOptionalLoroSyncContext: () => null,
}));
vi.mock("../MediaViewerContext", () => ({
  useMediaViewer: () => ({
    openViewer: vi.fn(),
    openAssetPreview,
  }),
}));
vi.mock("@clash/web-ui/lib/hooks/useAsset", () => ({
  useAsset: (assetId?: string) =>
    assetId ? { id: assetId, srcR2Key: `/assets/${assetId}` } : undefined,
  invalidateAsset: vi.fn(),
}));
vi.mock("@clash/web-ui/lib/hooks/useSignedUrl", () => ({
  useSignedUrl: (url?: string) => url,
}));
vi.mock("@clash/web-ui/lib/runtimeConfig", () => ({
  runtimeApiUrl: (path: string) => path,
}));
vi.mock("./NodeModalDialog", () => ({
  NodeModalDialog: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" aria-label="Audio Player" /> : null,
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

afterEach(() => {
  cleanup();
  openAssetPreview.mockClear();
});

describe("asset node preview navigation", () => {
  it("keeps a single click on an audio node from opening the enlarged player", () => {
    const { container } = render(
      <AudioNode
        {...baseNodeProps}
        id="audio-node"
        type="audio"
        data={{
          assetId: "audio-asset",
          label: "Narration",
          status: "completed",
        }}
      />,
    );

    fireEvent.click(container.querySelector(".cursor-pointer")!);

    expect(screen.queryByRole("dialog", { name: "Audio Player" })).toBeNull();
  });

  it.each([
    ["image", ImageNode, "image-asset"],
    ["video", VideoNode, "video-asset"],
    ["audio", AudioNode, "audio-asset"],
  ] as const)(
    "opens the shared project preview from the %s node button",
    (_kind, Component, assetId) => {
      const { unmount } = render(
        <Component
          {...baseNodeProps}
          id={`${assetId}-node`}
          type={_kind}
          width={320}
          height={180}
          data={{
            assetId,
            label: `${_kind} material`,
            status: "completed",
            previewUrl: `data:${_kind}/mock;base64,`,
          }}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "Preview asset" }));

      expect(openAssetPreview).toHaveBeenCalledWith(assetId);
      unmount();
      openAssetPreview.mockClear();
    },
  );
});
