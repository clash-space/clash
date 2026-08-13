// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import AudioNode from "./AudioNode";

const scope = vi.hoisted(() => ({
  projectId: "project-a",
  assetId: "shared-asset-id",
  decodedDuration: 1,
}));

vi.mock("@xyflow/react", () => ({
  Handle: () => null,
  Position: { Left: "left", Right: "right" },
}));

vi.mock("./SourceHandleMenu", () => ({ default: () => null }));
vi.mock("./DraftPlaceholder", () => ({ default: () => null }));
vi.mock("../MediaViewerContext", () => ({
  useMediaViewer: () => ({ openAssetPreview: vi.fn() }),
}));
vi.mock("../ProjectContext", () => ({
  useProject: () => ({ projectId: scope.projectId }),
}));
vi.mock("@clash/web-ui/lib/hooks/useAsset", () => ({
  useAsset: () => ({
    id: scope.assetId,
    kind: "audio",
    status: "ready",
    url: `https://media.clash.test/${scope.assetId}.wav`,
    metadata: {},
    lifecycle: { state: "active" },
  }),
}));
vi.mock("./NodeModalDialog", () => ({
  NodeModalDialog: ({ open, children }: any) =>
    open ? <div role="dialog">{children}</div> : null,
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  scope.projectId = "project-a";
  scope.assetId = "shared-asset-id";
  scope.decodedDuration = 1;
});

function renderAudioNode() {
  return render(
    <AudioNode
      {...baseNodeProps}
      id={`audio-node-${scope.projectId}`}
      type="audio"
      data={{
        assetId: scope.assetId,
        label: "Narration",
        status: "completed",
      }}
    />,
  );
}

describe("AudioNode waveform cache authority", () => {
  it("does not share decoded waveform facts across Projects with the same Asset id", async () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array([1, 2, 3, 4]))),
    );
    class TestAudioContext {
      async decodeAudioData() {
        return {
          duration: scope.decodedDuration,
          getChannelData: () => new Float32Array([0.1, 0.4, 0.2, 0.8]),
          length: 4,
          numberOfChannels: 1,
        } as unknown as AudioBuffer;
      }

      async close() {}
    }
    vi.stubGlobal("AudioContext", TestAudioContext);

    const first = renderAudioNode();
    fireEvent.doubleClick(first.container.querySelector(".cursor-pointer")!);
    await waitFor(() => expect(screen.getByText("0:01")).toBeTruthy());
    first.unmount();

    scope.projectId = "project-b";
    scope.decodedDuration = 2;
    const second = renderAudioNode();
    fireEvent.doubleClick(second.container.querySelector(".cursor-pointer")!);

    await waitFor(() => expect(screen.getByText("0:02")).toBeTruthy());
  });

  it("evicts the least-recently-used decoded waveform instead of growing for the page lifetime", async () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    const fetchMedia = vi.fn(
      async () => new Response(new Uint8Array([1, 2, 3, 4])),
    );
    vi.stubGlobal("fetch", fetchMedia);
    class TestAudioContext {
      async decodeAudioData() {
        return {
          duration: 1,
          getChannelData: () => new Float32Array([0.1, 0.4, 0.2, 0.8]),
          length: 4,
          numberOfChannels: 1,
        } as unknown as AudioBuffer;
      }

      async close() {}
    }
    vi.stubGlobal("AudioContext", TestAudioContext);

    for (let index = 0; index < 49; index += 1) {
      scope.assetId = `asset-${index}`;
      const rendered = renderAudioNode();
      fireEvent.doubleClick(rendered.container.querySelector(".cursor-pointer")!);
      await waitFor(() => expect(fetchMedia).toHaveBeenCalledTimes(index + 1));
      rendered.unmount();
    }

    scope.assetId = "asset-0";
    const revisited = renderAudioNode();
    fireEvent.doubleClick(revisited.container.querySelector(".cursor-pointer")!);
    await waitFor(() => expect(fetchMedia).toHaveBeenCalledTimes(50));
  });

  it("expires decoded waveform presentation data after its device-cache lifetime", async () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    const fetchMedia = vi.fn(
      async () => new Response(new Uint8Array([1, 2, 3, 4])),
    );
    vi.stubGlobal("fetch", fetchMedia);
    class TestAudioContext {
      async decodeAudioData() {
        return {
          duration: 1,
          getChannelData: () => new Float32Array([0.1, 0.4, 0.2, 0.8]),
          length: 4,
          numberOfChannels: 1,
        } as unknown as AudioBuffer;
      }

      async close() {}
    }
    vi.stubGlobal("AudioContext", TestAudioContext);
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    scope.assetId = "ttl-asset";

    const first = renderAudioNode();
    fireEvent.doubleClick(first.container.querySelector(".cursor-pointer")!);
    await waitFor(() => expect(fetchMedia).toHaveBeenCalledTimes(1));
    first.unmount();

    now += 30 * 60 * 1_000 + 1;
    const expired = renderAudioNode();
    fireEvent.doubleClick(expired.container.querySelector(".cursor-pointer")!);
    await waitFor(() => expect(fetchMedia).toHaveBeenCalledTimes(2));
  });
});
