// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

import SourceHandleMenu from "./SourceHandleMenu";

vi.mock("@xyflow/react", () => ({
  Handle: ({ type, position, ...props }: any) => (
    <div data-testid={`handle-${type}-${position}`} {...props} />
  ),
  Position: {
    Right: "right",
  },
  useReactFlow: () => ({
    addEdges: vi.fn(),
    getNodes: vi.fn(() => []),
    getEdges: vi.fn(() => []),
    setNodes: vi.fn(),
  }),
}));

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  },
}));

vi.mock("../LoroSyncContext", () => ({
  useOptionalLoroSyncContext: () => null,
}));

vi.mock("../ProjectContext", () => ({
  useProject: () => ({ projectId: "project-1" }),
}));

vi.mock("@clash/web-ui/lib/layout", () => ({
  useLayoutManager: () => ({
    addNodeWithAutoLayout: vi.fn(),
    addNodeWithLayout: vi.fn(),
  }),
}));

vi.mock("./CloneTrajectoryDialog", () => ({
  default: () => null,
}));

describe("SourceHandleMenu closed state", () => {
  it("renders the source handle without subscribing to all nodes or edges", () => {
    const { getByTestId } = render(<SourceHandleMenu nodeId="image-1" sourceType="image" />);

    expect(getByTestId("handle-source-right")).not.toBeNull();
  });
});
