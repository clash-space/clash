/**
 * Pre-compile the Remotion bundle at Docker build time.
 *
 * Without this, the runtime container would call `bundle()` on the first
 * /render request — webpack + esbuild against React + Remotion source takes
 * 60-90s, which exceeds Cloudflare Containers' DO fetch cap and causes
 * spurious WorkflowInternalError retries.
 *
 * Layout assumptions: built file lands at apps/render-server/dist/prebundle.js
 * and runs from the workspace root, so paths go up four levels.
 */
import path from "path";
import fs from "fs";
import { bundle } from "@remotion/bundler";

const entryPoint = path.resolve(
  import.meta.dirname,
  "../../../packages/remotion-components/src/Root.tsx",
);
const outDir = path.resolve(import.meta.dirname, "../../../.remotion-bundle");

if (!fs.existsSync(entryPoint)) {
  throw new Error(`Remotion entry point not found: ${entryPoint}`);
}

console.log("[prebundle] entry:", entryPoint);
console.log("[prebundle] out:  ", outDir);

const result = await bundle({
  entryPoint,
  outDir,
  onProgress: (pct) => {
    if (pct % 10 === 0) console.log(`[prebundle] ${pct}%`);
  },
});

console.log("[prebundle] Done:", result);
