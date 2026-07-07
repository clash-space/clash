// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { VideoEditorProvider, useVideoEditor } from "./VideoEditorContext";

const { mockLoroSync, mockAutoInsertNode, mockEditorState } = vi.hoisted(() => ({
  mockLoroSync: {
    connected: true,
    addNode: vi.fn(),
    addEdge: vi.fn(),
    updateNode: vi.fn(),
    applyTimelineDsl: vi.fn(() => true),
    sendSideband: vi.fn(),
  },
  mockAutoInsertNode: vi.fn(() => ({
    position: { x: 320, y: 180 },
    pushedNodes: new Map(),
  })),
  mockEditorState: {
    tracks: [
      {
        id: "track-1",
        name: "Track 1",
        type: "video",
        items: [
          {
            id: "item-1",
            from: 0,
            durationInFrames: 90,
            assetId: "asset-node-1",
            type: "video",
          },
        ],
      },
    ],
    selectedItemId: null,
    selectedTrackId: null,
    currentFrame: 0,
    playing: false,
    zoom: 1,
    assets: [],
    compositionWidth: 1920,
    compositionHeight: 1080,
    fps: 30,
    durationInFrames: 300,
  } as any,
}));

vi.mock("@master-clash/remotion-ui", () => ({
  Editor: (props: any) => {
    props.stateRef.current = mockEditorState;
    return (
      <div data-testid="mock-editor">
        <button onClick={props.onBack}>Back</button>
      </div>
    );
  },
}));

vi.mock("./LoroSyncContext", () => ({
  useOptionalLoroSyncContext: () => mockLoroSync,
}));

vi.mock('../lib/layout', () => ({
  autoInsertNode: mockAutoInsertNode,
}));

function Harness() {
  const { openEditor, exportVideo } = useVideoEditor();

  return (
    <>
      <button
        onClick={() =>
          openEditor([], "editor-node-1", {
            tracks: mockEditorState.tracks,
            compositionWidth: mockEditorState.compositionWidth,
            compositionHeight: mockEditorState.compositionHeight,
            fps: mockEditorState.fps,
            durationInFrames: mockEditorState.durationInFrames,
          })
        }
      >
        Open
      </button>
      <button onClick={() => void exportVideo()}>Export</button>
    </>
  );
}

describe("VideoEditorProvider", () => {
  beforeEach(() => {
    mockLoroSync.addNode.mockReset();
    mockLoroSync.addEdge.mockReset();
    mockLoroSync.updateNode.mockReset();
    mockLoroSync.applyTimelineDsl.mockClear();
    mockLoroSync.sendSideband.mockClear();
    mockAutoInsertNode.mockClear();
    vi.spyOn(Date, "now").mockReturnValue(1700000000000);
    vi.spyOn(window, "alert").mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("opens the editor as a main control surface without unmounting the project surface", async () => {
    render(
      <VideoEditorProvider>
        <div data-testid="project-surface">Project canvas</div>
        <Harness />
      </VideoEditorProvider>,
    );

    fireEvent.click(screen.getByText("Open"));

    const dialog = await screen.findByRole("dialog", { name: "Video editor" });
    expect(dialog).toBeTruthy();
    expect(screen.getByTestId("video-editor-panel")).toBeTruthy();
    expect(screen.getByTestId("project-surface")).toBeTruthy();
  });

  it("pushes editor composition size into the pending render node", async () => {
    render(
      <VideoEditorProvider
        nodes={[
          {
            id: "editor-node-1",
            type: "video-editor",
            position: { x: 0, y: 0 },
            data: {},
          } as any,
        ]}
        edges={[]}
      >
        <Harness />
      </VideoEditorProvider>,
    );

    fireEvent.click(screen.getByText("Open"));
    await waitFor(() => expect(screen.getByTestId("mock-editor")).toBeTruthy());

    fireEvent.click(screen.getByText("Export"));

    await waitFor(() => expect(mockLoroSync.addNode).toHaveBeenCalledTimes(1));

    const [, createdNode] = mockLoroSync.addNode.mock.calls[0];
    expect(createdNode.data.naturalWidth).toBe(1920);
    expect(createdNode.data.naturalHeight).toBe(1080);
    expect(createdNode.width).toBe(500);
    expect(createdNode.height).toBe(281);
  });

  it("saves timeline edits through explicit timeline apply instead of generic node patch", async () => {
    render(
      <VideoEditorProvider>
        <Harness />
      </VideoEditorProvider>,
    );

    fireEvent.click(screen.getByText("Open"));
    await waitFor(() => expect(screen.getByTestId("mock-editor")).toBeTruthy());

    fireEvent.click(screen.getByText("Back"));

    expect(mockLoroSync.applyTimelineDsl).toHaveBeenCalledWith("editor-node-1", {
      tracks: [
        expect.objectContaining({
          id: "track-1",
          items: [
            expect.objectContaining({
              id: "item-1",
              assetId: "asset-node-1",
              sourceNodeId: "asset-node-1",
            }),
          ],
        }),
      ],
      compositionWidth: 1920,
      compositionHeight: 1080,
      fps: 30,
      durationInFrames: 300,
    });
    expect(mockLoroSync.updateNode).not.toHaveBeenCalledWith("editor-node-1", expect.objectContaining({
      data: expect.objectContaining({ timelineDsl: expect.anything() }),
    }));
  });
});
