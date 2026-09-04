import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { validateExecutablePluginPackage } from "../../../../packages/shared-types/src/executable-plugin.js";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const json = async (path: string) =>
  JSON.parse(await readFile(join(root, path), "utf8"));

describe("official Storyboard plugin", () => {
  it("contributes exactly one View and no Generator or executable function", async () => {
    const manifest = await json("manifest.json");
    const viewPath = manifest.contributes.views[0].path as string;
    const view = await json(viewPath);
    const validated = validateExecutablePluginPackage(manifest, {}, {}, {
      views: { [viewPath]: view },
    });

    expect(validated.manifest.id).toBe("clash.storyboard");
    expect(validated.manifest.contributes.views).toHaveLength(1);
    expect(validated.manifest.contributes.generators).toEqual([]);
    expect(validated.manifest.contributes.functions).toEqual([]);
    expect(view.spec.initialState).toEqual({
      keyElements: [],
      shots: [],
      audioLayers: [],
      uncategorized: [],
    });
  });
});
