import { realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assemblePlugin,
  defineExecutor,
  type StdioExecutablePluginOptions,
} from "@clash/action-sdk";

import { minimaxAdapter } from "./minimax-adapter";
import { minimaxTimeoutMs } from "./timeout.js";

export { MINIMAX_DEFAULT_TIMEOUT_MS } from "./timeout.js";

/**
 * What this plugin is: one Provider.
 *
 * It used to be one of four executors inside `clash.media`, so connecting MiniMax installed fal,
 * Google and the mock alongside it, and a route naming `clash.media` named a plugin that mostly
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
  "minimax-execute": defineExecutor(minimaxAdapter),
};

export const plugin = assemblePlugin({
  manifestDir: join(fileURLToPath(new URL(".", import.meta.url)), ".."),
  contributes: CONTRIBUTIONS,
});

/**
 * Music generation is synchronous at the vendor boundary and has exceeded the
 * SDK's general 30-second broker default in live traffic. Provider execution
 * itself is bounded per submit or poll at 30 minutes, so MiniMax aligns its
 * longest individual broker round trip with that enclosing invocation.
 */
export function startMiniMaxPlugin(
  options: StdioExecutablePluginOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  return plugin.start({
    hostRequestTimeoutMs: minimaxTimeoutMs(env),
    ...options,
  });
}

if (process.argv[1]
  && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  void startMiniMaxPlugin();
}
