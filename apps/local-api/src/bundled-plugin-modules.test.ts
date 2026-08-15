import { readFile } from "node:fs/promises";

import { ExecutablePluginManifestSchema } from "@clash/shared-types";
import { describe, expect, it } from "vitest";

import { BUNDLED_PLUGINS } from "./bundled-plugins.js";
import {
  loadTrustedBundledPluginModule,
  TRUSTED_BUNDLED_PLUGIN_MODULES,
} from "./bundled-plugin-modules.js";

describe("trusted bundled Plugin modules", () => {
  it("keeps in-process trust in one closed Host registry", () => {
    expect(TRUSTED_BUNDLED_PLUGIN_MODULES.map(({ id }) => id)).toEqual(
      BUNDLED_PLUGINS.map(({ id }) => id),
    );
    expect(
      TRUSTED_BUNDLED_PLUGIN_MODULES.every(
        (registration) => !Reflect.has(registration, "runtime"),
      ),
    ).toBe(true);
  });

  it("loads every first-party package as an inert module with its declared exports", async () => {
    for (const registration of TRUSTED_BUNDLED_PLUGIN_MODULES) {
      const loaded = await loadTrustedBundledPluginModule(registration.id);
      const manifest = ExecutablePluginManifestSchema.parse(
        JSON.parse(await readFile(loaded.manifestPath, "utf8")),
      );

      expect(loaded.id).toBe(manifest.id);
      expect(loaded.plugin.invoke).toBeTypeOf("function");
      expect(
        loaded.plugin.contributes.map(({ id, kind }) => ({ id, kind })),
      ).toEqual(
        manifest.contributes.functions.map(({ id, kind }) => ({ id, kind })),
      );
    }
  });

  it("loads clash.asr in the module realm without exposing a stdio start surface", async () => {
    const loaded = await loadTrustedBundledPluginModule("clash.asr");
    const manifest = ExecutablePluginManifestSchema.parse(
      JSON.parse(await readFile(loaded.manifestPath, "utf8")),
    );

    expect(manifest.contributes.generators).toEqual([
      {
        id: "speech-analysis",
        kind: "generator",
        path: "generators/speech-analysis.json",
      },
    ]);
    expect(loaded.plugin.invoke).toBeTypeOf("function");
    expect(loaded.plugin).not.toHaveProperty("start");
  });

  it("does not let a caller promote an unregistered package into the trusted realm", async () => {
    await expect(
      loadTrustedBundledPluginModule("third.party.plugin"),
    ).rejects.toThrow(/not a trusted bundled plugin/i);
  });
});
