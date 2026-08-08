// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import RemotionComponentNode from "./RemotionComponentNode";

const mocks = vi.hoisted(() => ({
  updateNode: vi.fn(() => true),
  applyTimelineState: vi.fn((_id: string, _state: Record<string, unknown>) => true),
  setNodes: vi.fn(),
  timeline: {
    id: "timeline-main",
    name: "Main cut",
    state: { tracks: [], fps: 30, durationInFrames: 180 },
  },
}));

vi.mock("@xyflow/react", () => ({
  Handle: () => null,
  Position: { Left: "left", Right: "right" },
  useReactFlow: () => ({ setNodes: mocks.setNodes }),
}));

vi.mock("@remotion/player", () => ({
  Player: ({ inputProps }: { inputProps: { source: string } }) => (
    <div data-testid="remotion-player" data-source={inputProps.source} />
  ),
}));

vi.mock("@master-clash/remotion-components", () => ({
  RemotionSourceComposition: () => null,
}));

vi.mock("../LoroSyncContext", () => ({
  useOptionalLoroSyncContext: () => ({
    timelines: [mocks.timeline],
    updateNode: mocks.updateNode,
    applyTimelineState: mocks.applyTimelineState,
  }),
}));

vi.mock("./NodeModalDialog", () => ({
  NodeModalDialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div role="dialog">{children}</div> : null,
}));

vi.mock("../ui/select", () => ({
  SelectMenu: ({ value }: { value: string }) => <div data-testid="timeline-select">{value}</div>,
}));

const baseProps = {
  id: "remotion-greeting",
  selected: false,
  type: "remotion-component",
  dragging: false,
  draggable: true,
  selectable: true,
  deletable: true,
  zIndex: 1,
  isConnectable: true,
  positionAbsoluteX: 0,
  positionAbsoluteY: 0,
  data: {
    label: "Greeting",
    componentId: "Greeting",
    content: "export default function Greeting(){ return <div>Before</div>; }",
    compositionWidth: 720,
    compositionHeight: 1280,
    fps: 30,
    durationInFrames: 120,
  },
} as const;

describe("RemotionComponentNode", () => {
  afterEach(cleanup);

  beforeEach(() => {
    mocks.updateNode.mockClear();
    mocks.applyTimelineState.mockClear();
    mocks.setNodes.mockClear();
  });

  it("is a distinct code-editable node with a real Remotion Player preview", () => {
    render(<RemotionComponentNode {...baseProps} />);

    expect(screen.getByTestId("remotion-player").getAttribute("data-source")).toContain("Before");
    expect(screen.getByRole("button", { name: "Edit code" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /render|export/i })).toBeNull();
  });

  it("modifies source on the same Canvas node id", () => {
    render(<RemotionComponentNode {...baseProps} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit code" }));
    const editor = screen.getByRole("textbox", { name: "Remotion TSX source" });
    fireEvent.change(editor, {
      target: { value: "export default function Greeting(){ return <div>After</div>; }" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save component" }));

    expect(mocks.updateNode).toHaveBeenCalledWith("remotion-greeting", {
      data: expect.objectContaining({
        content: expect.stringContaining("After"),
      }),
    });
  });

  it("adds only a live sourceNodeId reference to Timeline", () => {
    render(<RemotionComponentNode {...baseProps} />);

    fireEvent.click(screen.getByRole("button", { name: "Add to Timeline" }));

    expect(mocks.applyTimelineState).toHaveBeenCalledTimes(1);
    expect(mocks.applyTimelineState).toHaveBeenCalledWith(
      "timeline-main",
      expect.objectContaining({
        tracks: [
          expect.objectContaining({
            items: [
              expect.objectContaining({
                type: "composition",
                runtime: "remotion",
                sourceNodeId: "remotion-greeting",
              }),
            ],
          }),
        ],
      }),
    );
    const next = mocks.applyTimelineState.mock.calls[0]?.[1] as {
      tracks: Array<{ items: Array<Record<string, unknown>> }>;
    };
    expect(next.tracks[0]?.items[0]).not.toHaveProperty("componentSource");
    expect(next.tracks[0]?.items[0]).not.toHaveProperty("renderedAssetPath");
  });
});
