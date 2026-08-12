import { realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { assemblePlugin, defineExecutor } from "@clash/action-sdk";

import { googleAdapter } from "./google-adapter";

/**
 * What this plugin is: one Provider.
 *
 * It used to be one of four executors inside `clash.media`, so connecting Google installed fal,
 * MiniMax and the mock alongside it, and a route naming `clash.media` named a plugin that mostly
 * served somebody else.
 *
 * The keys here are the contribution ids `manifest.json` declares. Nothing repeats the kind, because the
 * manifest already states it and the host copies it onto every invocation -- a second table in code
 * is what let `google-execute` exist in source, in tests and on thirteen routes while the installed
 * manifest never mentioned it.
 *
 * Framing, dispatch, the submit/poll split and error frames belong to the SDK.
 */
export const CONTRIBUTIONS = {
  "google-execute": defineExecutor(googleAdapter),
};

export const plugin = assemblePlugin({
  manifestDir: join(fileURLToPath(new URL(".", import.meta.url)), ".."),
  contributes: CONTRIBUTIONS,
});

if (process.argv[1]
  && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  void plugin.start();
}
