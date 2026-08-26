// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const dnd = vi.hoisted(() => ({
  useDraggable: vi.fn(() => ({
    attributes: {},
    isDragging: false,
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
  })),
}));

vi.mock("@dnd-kit/core", () => ({
  useDraggable: dnd.useDraggable,
}));

import { useMarketplaceSkillReferenceDraggable } from "./MarketplaceSkillReferenceDnd";

function SkillDragProbe({ requestAdd }: { requestAdd: () => void }) {
  useMarketplaceSkillReferenceDraggable({
    item: { id: "skill-1", name: "Prompt guide", type: "skill" },
    enabled: true,
    requestAdd,
  });
  return null;
}

describe("MarketplaceSkillReferenceDnd", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("publishes the unified dashboard skill drag data through dnd-kit", () => {
    const requestAdd = vi.fn();
    render(<SkillDragProbe requestAdd={requestAdd} />);

    expect(dnd.useDraggable).toHaveBeenCalledWith(
      expect.objectContaining({
        disabled: false,
        data: {
          type: "dashboard-skill-reference",
          reference: { id: "skill-1", name: "Prompt guide" },
          requestAdd,
        },
      }),
    );
  });
});
