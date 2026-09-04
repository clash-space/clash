import { describe, expect, it, vi } from "vitest";

import { loadExecutablePluginViews } from "./useExecutablePluginViews";

describe("loadExecutablePluginViews", () => {
  it("loads activated declarative Views from the local Kernel", async () => {
    const fetch = vi.fn(async () => Response.json({
      views: [{
        pluginId: "community.storyboard",
        version: "1.0.0",
        schemaHash: `sha256:${"a".repeat(64)}`,
        definitionId: "storyboard",
        name: "Storyboard",
        presentation: { type: "storyboard" },
        initialState: {
          keyElements: [],
          shots: [],
          audioLayers: [],
          uncategorized: [],
        },
      }],
    }));

    const views = await loadExecutablePluginViews(fetch as typeof globalThis.fetch);

    expect(fetch).toHaveBeenCalledWith("/api/v1/plugin-views", expect.objectContaining({
      credentials: "include",
    }));
    expect(views[0]).toMatchObject({ definitionId: "storyboard" });
  });
});
