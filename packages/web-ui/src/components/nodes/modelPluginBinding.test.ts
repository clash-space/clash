import { describe, expect, it } from "vitest";
import type { ExecutablePluginBinding } from "@clash/shared-types";
import { resolveModelProjectorBinding } from "./modelPluginBinding";

const oldBinding: ExecutablePluginBinding = {
  pluginId: "first-party-fal-media",
  version: "1.0.0",
  exportId: "fal-h3",
  schemaHash: `sha256:${"1".repeat(64)}`,
};

const currentBinding: ExecutablePluginBinding = {
  ...oldBinding,
  version: "1.1.0",
  schemaHash: `sha256:${"2".repeat(64)}`,
};

describe("resolveModelProjectorBinding", () => {
  it("preserves the exact historical version for the same projector export", () => {
    expect(resolveModelProjectorBinding(oldBinding, currentBinding)).toEqual({
      binding: oldBinding,
      persistRouteBinding: false,
    });
  });

  it("persists the catalog binding when the selected model uses a different projector", () => {
    const seedanceBinding: ExecutablePluginBinding = {
      pluginId: "first-party-fal-media",
      version: "1.1.0",
      exportId: "fal-seedance-2",
      schemaHash: `sha256:${"3".repeat(64)}`,
    };

    expect(resolveModelProjectorBinding(oldBinding, seedanceBinding)).toEqual({
      binding: seedanceBinding,
      persistRouteBinding: true,
    });
  });

  it("pins a newly resolved route and keeps an orphaned historical pin fail-closed", () => {
    expect(resolveModelProjectorBinding(undefined, currentBinding)).toEqual({
      binding: currentBinding,
      persistRouteBinding: true,
    });
    expect(resolveModelProjectorBinding(oldBinding, undefined)).toEqual({
      binding: oldBinding,
      persistRouteBinding: false,
    });
  });
});
