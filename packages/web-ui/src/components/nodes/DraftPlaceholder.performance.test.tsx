// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, within } from "@testing-library/react";

import DraftPlaceholder from "./DraftPlaceholder";

const reactFlowMock = vi.hoisted(() => {
  const connectionLookup = new Map<string, Map<string, any>>();
  const nodeLookup = new Map<string, any>();

  nodeLookup.set("draft-1", {
    id: "draft-1",
    type: "image",
    data: {
      label: "Draft image",
      status: "draft",
    },
  });
  nodeLookup.set("action-1", {
    id: "action-1",
    type: "action-badge",
    data: {
      content: "Generate a draft",
      modelId: "nano-banana-2",
    },
  });

  connectionLookup.set(
    "draft-1",
    new Map([
      [
        "action-1-draft-1",
        {
          edgeId: "action-1-draft-1",
          source: "action-1",
          sourceHandle: null,
          target: "draft-1",
          targetHandle: null,
        },
      ],
    ]),
  );
  connectionLookup.set(
    "action-1",
    new Map([
      [
        "action-1-draft-1",
        {
          edgeId: "action-1-draft-1",
          source: "action-1",
          sourceHandle: null,
          target: "draft-1",
          targetHandle: null,
        },
      ],
    ]),
  );

  return {
    connectionLookup,
    nodeLookup,
    setNodes: vi.fn(),
  };
});

vi.mock("@xyflow/react", () => ({
  useReactFlow: () => ({
    setNodes: reactFlowMock.setNodes,
  }),
  useStore: (selector: (state: any) => unknown) =>
    selector({
      connectionLookup: reactFlowMock.connectionLookup,
      nodeLookup: reactFlowMock.nodeLookup,
    }),
}));

vi.mock("framer-motion", () => ({
  motion: {
    button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  },
}));

vi.mock("../LoroSyncContext", () => ({
  useOptionalLoroSyncContext: () => null,
}));

vi.mock("./BuildPlanDialog", () => ({
  default: () => null,
}));

describe("DraftPlaceholder canvas subscriptions", () => {
  it("renders the build affordance without subscribing to all nodes or edges", () => {
    const { getByRole } = render(<DraftPlaceholder nodeId="draft-1" modality="image" />);

    expect(getByRole("button", { name: "Build this draft" })).not.toBeNull();
  });

  it("renders audio drafts as a compact row without a nested dashed card", () => {
    const { getByRole } = render(
      <DraftPlaceholder nodeId="draft-1" modality="audio" compact />,
    );

    const placeholder = getByRole("group", {
      name: "Draft audio placeholder",
    });
    expect(placeholder.className).toContain("flex-row");
    expect(placeholder.className).not.toContain("border-dashed");
    expect(within(placeholder).getByRole("button", { name: "Build this draft" })).not.toBeNull();
  });
});
