import { realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { assemblePlugin, defineExecutor } from "@clash/action-sdk";

import { hubAdapter } from "./hub-adapter";

/**
 * What this plugin is: one third-party Provider.
 *
 * It is not bundled with the host the way `clash.google` and `clash.minimax` are. It arrives the
 * way any other publisher's plugin arrives -- downloaded, attested, activated -- which is the whole
 * point of keeping it out of `BUNDLED_PLUGINS`: the normal install path has something real to
 * carry.
 *
 * The keys here are the contribution ids `manifest.json` declares. Nothing repeats the kind or points at
 * a function name, because the manifest already states the first and the id *is* the second. The
 * old manifest carried `"handler": "executeHubModel"`, a name whose only job was to point at
 * another name, and which could therefore point at nothing.
 *
 * Framing, dispatch, the submit/poll split and error frames belong to the SDK.
 */
export const CONTRIBUTIONS = {
  "hilo-hub-execute": defineExecutor(hubAdapter),
};

export const plugin = assemblePlugin({
  manifestDir: join(fileURLToPath(new URL(".", import.meta.url)), ".."),
  contributes: CONTRIBUTIONS,
});

if (process.argv[1]
  && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  void plugin.start();
}
