import path from "path";
import fs from "fs";
import os from "os";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";

// Cache the bundle path across renders
let bundlePath: string | null = null;

async function ensureBundle(): Promise<string> {
  if (bundlePath && fs.existsSync(bundlePath)) return bundlePath;

  // Path is relative to the BUILT entry's dirname, not the source layout.
  // Monorepo source: apps/render-server/src/render.ts → ../../../packages/...
  // Container runtime (pnpm deploy --prod, see Dockerfile): /app/dist/index.js
  // → ../packages/... (workspace `packages/` is shipped alongside via an
  // explicit COPY in the runtime stage; see Dockerfile).
  // import.meta.dirname disambiguates dev (tsx watch on src/) vs prod (built dist/).
  const isBuilt = import.meta.dirname.endsWith("dist");
  const entryPoint = isBuilt
    ? path.resolve(import.meta.dirname, "../packages/remotion-components/src/Root.tsx")
    : path.resolve(import.meta.dirname, "../../../packages/remotion-components/src/Root.tsx");

  if (!fs.existsSync(entryPoint)) {
    throw new Error(`Remotion entry point not found: ${entryPoint}`);
  }

  console.log("[render] Bundling Remotion components...");
  bundlePath = await bundle({
    entryPoint,
    onProgress: (pct) => {
      if (pct % 25 === 0) console.log(`[render] Bundle progress: ${pct}%`);
    },
  });
  console.log("[render] Bundle ready:", bundlePath);
  return bundlePath;
}

export async function renderTimeline(
  timelineDsl: Record<string, any>,
  taskId: string
): Promise<Buffer> {
  const bundled = await ensureBundle();

  const {
    tracks = [],
    compositionWidth = 1920,
    compositionHeight = 1080,
    fps = 30,
    durationInFrames = 300,
  } = timelineDsl;

  const inputProps = { tracks, compositionWidth, compositionHeight, fps, durationInFrames };

  const composition = await selectComposition({
    serveUrl: bundled,
    id: "VideoComposition",
    inputProps,
  });

  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "render-"));
  const outputPath = path.join(outputDir, `${taskId}.mp4`);

  console.log(`[render] Rendering: ${compositionWidth}x${compositionHeight} @${fps}fps, ${durationInFrames} frames`);

  await renderMedia({
    composition,
    serveUrl: bundled,
    codec: "h264",
    outputLocation: outputPath,
    inputProps,
    onProgress: ({ progress }) => {
      if (Math.round(progress * 100) % 25 === 0) {
        console.log(`[render] Progress: ${Math.round(progress * 100)}%`);
      }
    },
  });

  const buffer = fs.readFileSync(outputPath);

  // Cleanup
  fs.rmSync(outputDir, { recursive: true, force: true });

  return buffer;
}
