import { describe, expect, it } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BUNDLED_PLUGINS, ensureBundledPlugin } from "./bundled-plugins.js";

/**
 * First-party Providers ship with the host.
 *
 * They are not installed the way a third-party plugin is. `clash.google` and `clash.minimax` were
 * activated through `clash plugin activate` during development, which put them under
 * `~/.clash/actions` -- and the host still reported only `hilo-hub`, because what the host seeds at
 * startup is this list, not that directory.
 *
 * The seeding function was written for exactly one plugin: its id was a constant, its paths came
 * from one hard-coded `require.resolve`, and it threw if the manifest said anything else. Splitting
 * one plugin per Provider made that shape untenable, which is what this covers.
 */
function pluginSource(id: string) {
  const dir = mkdtempSync(join(tmpdir(), "bundled-"));
  mkdirSync(join(dir, "dist"), { recursive: true });
  writeFileSync(join(dir, "dist", "stdio.mjs"), "// entrypoint");
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify({
      apiVersion: "clash.plugin/v1",
      id,
      version: "0.1.0",
      name: id,
      runtime: {
        kind: "local",
        transport: "stdio",
        entrypoint: "dist/stdio.mjs",
        args: [],
      },
      contributes: { functions: [] },
    }),
  );
  return dir;
}

describe("bundled plugins", () => {
  it("names every first-party Provider, not just one", () => {
    // One plugin per Provider. A list with a single entry is what left clash.google and
    // clash.minimax unseeded after the split.
    const ids = BUNDLED_PLUGINS.map((plugin) => plugin.id);
    expect(ids).toContain("clash.fal");
    expect(ids).toContain("clash.google");
    expect(ids).toContain("clash.minimax");
    expect(ids).toContain("clash.volcengine");
  });

  it("seeds a plugin into the actions root", async () => {
    const source = pluginSource("clash.google");
    const actionsRoot = mkdtempSync(join(tmpdir(), "actions-"));
    const result = await ensureBundledPlugin({
      id: "clash.google",
      actionsRoot,
      manifestPath: join(source, "manifest.json"),
      entrypointPath: join(source, "dist", "stdio.mjs"),
    });
    expect(result.installed).toBe(true);
    expect(existsSync(join(actionsRoot, "clash.google", "manifest.json"))).toBe(
      true,
    );
  });

  it("refuses a manifest whose id is not the one being seeded", async () => {
    // Seeding a plugin under another's directory name gives two ids for one install, and the route
    // bound to either finds a manifest that disagrees with where it lives.
    const source = pluginSource("clash.minimax");
    const actionsRoot = mkdtempSync(join(tmpdir(), "actions-"));
    await expect(
      ensureBundledPlugin({
        id: "clash.google",
        actionsRoot,
        manifestPath: join(source, "manifest.json"),
        entrypointPath: join(source, "dist", "stdio.mjs"),
      }),
    ).rejects.toThrow(/clash\.google/);
  });

  it("leaves an existing install alone", async () => {
    // The installed directory is the user's editable copy. Overwriting it at startup would discard
    // an agent's edits every time the app restarted.
    const source = pluginSource("clash.google");
    const actionsRoot = mkdtempSync(join(tmpdir(), "actions-"));
    mkdirSync(join(actionsRoot, "clash.google"), { recursive: true });
    writeFileSync(
      join(actionsRoot, "clash.google", "manifest.json"),
      '{"id":"edited"}',
    );

    const result = await ensureBundledPlugin({
      id: "clash.google",
      actionsRoot,
      manifestPath: join(source, "manifest.json"),
      entrypointPath: join(source, "dist", "stdio.mjs"),
    });
    expect(result.installed).toBe(false);
    expect(
      readFileSync(join(actionsRoot, "clash.google", "manifest.json"), "utf8"),
    ).toContain("edited");
  });

  it("carries the provider declarations the real Provider ships", async () => {
    // Seeding the entrypoint without these produces a Provider nobody can configure: the
    // declaration is what the settings screen renders and what `--set` validates against.
    //
    // The real plugin rather than a fixture, because seeding runs the contract tests -- a stub
    // entrypoint answers nothing and fails as "closed its stdio channel", which says nothing about
    // provider documents either way.
    const workspace = join(__dirname, "../../../plugins/google");
    const actionsRoot = mkdtempSync(join(tmpdir(), "actions-"));
    await ensureBundledPlugin({
      id: "clash.google",
      actionsRoot,
      manifestPath: join(workspace, "manifest.json"),
      entrypointPath: join(workspace, "dist", "stdio.mjs"),
    });
    expect(
      existsSync(join(actionsRoot, "clash.google", "providers", "google.json")),
    ).toBe(true);
    const declared = JSON.parse(
      readFileSync(
        join(actionsRoot, "clash.google", "providers", "google.json"),
        "utf8",
      ),
    ) as {
      spec: { auth?: { methods: { id: string; form?: { key?: string }[] }[] } };
    };

    // `methods`, not a flat `form`: Google has three coherent configurations and they do not share
    // a field list -- AI Studio has no region, and a service account must not be offered a service.
    const methods = declared.spec.auth?.methods ?? [];
    expect(methods.map((method) => method.id)).toEqual([
      "ai-studio",
      "agent-platform-key",
      "service-account",
    ]);
    expect(
      methods.flatMap((method) => (method.form ?? []).map((item) => item.key)),
    ).toContain("apiKey");
  });
});
