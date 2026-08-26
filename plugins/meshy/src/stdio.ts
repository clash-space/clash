import { realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { assemblePlugin, defineExecutor } from "@clash/action-sdk";

import { meshyAdapter } from "./meshy-adapter.js";

/**
 * What this plugin is: one Provider.
 *
 * The key here is the contribution id `manifest.json` declares. Framing, dispatch, the
 * submit/poll split and error frames belong to the SDK; this file only names which adapter answers
 * `meshy-execute`.
 */
export const CONTRIBUTIONS = {
  "meshy-execute": defineExecutor(meshyAdapter),
};

export const plugin = assemblePlugin({
  manifestDir: join(fileURLToPath(new URL(".", import.meta.url)), ".."),
  contributes: CONTRIBUTIONS,
});

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  void plugin.start();
}
