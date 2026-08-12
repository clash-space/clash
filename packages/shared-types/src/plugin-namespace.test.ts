import { describe, expect, it } from "vitest";

import { parsePluginId, pluginIdSchema } from "./plugin-namespace.js";

/**
 * A plugin id is `publisher.name`.
 *
 * The same shape VS Code settled on (`ms-python.python`, `dbaeumer.vscode-eslint`), and for the
 * same reason: the publisher segment is what makes two people's `google` plugin two plugins rather
 * than a collision. Ours are `clash.google` and `clash.minimax`.
 *
 * The version is not part of the id. An updated plugin is the same plugin, which is what lets a
 * route bound to `clash.google` keep working across an upgrade -- and also why the id is an
 * identity and not a permission: whoever publishes the next version publishes under the same name.
 */
describe("plugin ids", () => {
  it("splits into a publisher and a name", () => {
    expect(parsePluginId("clash.google")).toEqual({ publisher: "clash", name: "google" });
    expect(parsePluginId("clash.minimax")).toEqual({ publisher: "clash", name: "minimax" });
  });

  it("accepts a hyphenated name, which is how most published ids read", () => {
    expect(parsePluginId("dbaeumer.vscode-eslint"))
      .toEqual({ publisher: "dbaeumer", name: "vscode-eslint" });
  });

  it("refuses an id with no publisher", () => {
    // `google` alone says nothing about who ships it, and the first third party to publish one
    // would silently take over routes bound to ours.
    expect(pluginIdSchema.safeParse("google").success).toBe(false);
  });

  it("refuses more than two segments", () => {
    // `clash.media.google` invites a hierarchy nothing reads, and two spellings of one plugin.
    expect(pluginIdSchema.safeParse("clash.media.google").success).toBe(false);
  });

  it("refuses empty segments", () => {
    for (const id of ["clash.", ".google", "clash..google"]) {
      expect(pluginIdSchema.safeParse(id).success).toBe(false);
    }
  });

  it("refuses a version in the id", () => {
    // The version travels beside the id, never inside it. Folding it in would make every upgrade a
    // different plugin and break every route bound to the old spelling.
    expect(pluginIdSchema.safeParse("clash.google@1.2.0").success).toBe(false);
  });
});
