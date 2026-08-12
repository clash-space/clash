import { realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { assemblePlugin, defineExecutor } from "@clash/action-sdk";

import { volcengineAdapter } from "./modelark.js";
import { volcengineSpeechAdapter } from "./speech.js";

export const CONTRIBUTIONS = {
  "volcengine-execute": defineExecutor(volcengineAdapter),
  "volcengine-speech-execute": defineExecutor(volcengineSpeechAdapter),
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
