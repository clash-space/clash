import { describe, expect, it } from "vitest";

import { selectMarketplaceFeed } from "./marketplace-feed";

describe("Marketplace feed selection", () => {
  it("returns only configured catalog entries in configured order", () => {
    const action = {
      id: "action-1",
      name: "Action One",
      type: "action" as const,
      packageId: "package.action-1",
    };
    const skill = {
      id: "skill-1",
      name: "Skill One",
      type: "skill" as const,
    };

    expect(
      selectMarketplaceFeed({
        actions: [action],
        skills: [skill],
        featuredPluginIds: ["skill-1", "missing", "action-1"],
      }),
    ).toEqual([skill, action]);
  });
});
