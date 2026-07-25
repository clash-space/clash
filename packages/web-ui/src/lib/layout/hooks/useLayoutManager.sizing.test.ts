import { describe, expect, it } from "vitest";

import { getNodeSizeWithData } from "./useLayoutManager";

describe("layout manager node sizing", () => {
  it("uses the rendered action capsule bounds for every action-badge", () => {
    expect(getNodeSizeWithData("action-badge", {
      actionType: "text-gen",
      modelId: "any-enabled-model",
    })).toEqual({ width: 260, height: 58 });
  });
});
