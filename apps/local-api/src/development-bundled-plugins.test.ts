import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it } from "vitest";

import { BUNDLED_PLUGINS } from "./bundled-plugins.js";
import { prepareDevelopmentBundledPlugins } from "./development-bundled-plugins.js";

it("prepares every bundled plugin from workspace source without a manual dist build", async () => {
  const root = await mkdtemp(join(tmpdir(), "clash-development-plugins-"));
  const actionsRoot = join(root, "actions");
  const workspaceRoot = join(__dirname, "../../..");
  const tsconfigPath = join(__dirname, "../tsconfig.dev.json");

  const first = await prepareDevelopmentBundledPlugins({
    actionsRoot,
    tsconfigPath,
    root: workspaceRoot,
  });
  expect(first.refreshed).toEqual(BUNDLED_PLUGINS.map((plugin) => plugin.id));

  for (const plugin of BUNDLED_PLUGINS) {
    const manifest = JSON.parse(
      await readFile(join(actionsRoot, plugin.id, "manifest.json"), "utf8"),
    ) as { runtime: { entrypoint: string } };
    // The installed contract remains the production `dist` path, while the development-only bytes
    // at that path load src/stdio.ts through tsx. Removing dist before this test would not change
    // preparation because no dist file is read.
    expect(manifest.runtime.entrypoint).toBe("dist/stdio.mjs");
    const launcher = await readFile(
      join(actionsRoot, plugin.id, manifest.runtime.entrypoint),
      "utf8",
    );
    expect(launcher).toContain("tsx/dist/esm/api/");
    expect(launcher).toContain(`/plugins/${plugin.workspaceDir}/src/stdio.ts`);
    expect(first.watchRoots[plugin.id]).toContain(
      join(workspaceRoot, "plugins", plugin.workspaceDir, "src"),
    );
    expect(first.watchRoots[plugin.id]).toContain(
      join(workspaceRoot, "packages", "shared-types", "src"),
    );
  }
  expect(first.watchRoots["clash.google"]).toContain(
    join(workspaceRoot, "packages", "action-sdk", "src"),
  );
  expect(first.watchRoots["clash.minimax"]).toContain(
    join(workspaceRoot, "packages", "action-sdk", "src"),
  );
  expect(first.watchRoots["clash.volcengine"]).toContain(
    join(workspaceRoot, "packages", "action-sdk", "src"),
  );
  expect(first.watchRoots["clash.codex-imagegen"]).not.toContain(
    join(workspaceRoot, "packages", "action-sdk", "src"),
  );

  // A local-api source restart must not churn activated packages or accumulate backups when the
  // workspace package declaration and launcher are unchanged.
  await expect(
    prepareDevelopmentBundledPlugins({
      actionsRoot,
      tsconfigPath,
      root: workspaceRoot,
    }),
  ).resolves.toMatchObject({ refreshed: [] });
}, 30_000);
