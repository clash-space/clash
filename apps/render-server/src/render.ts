import path from "path";
import fs from "fs";
import os from "os";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";

// Cache the bundle path across renders
let bundlePath: string | null = null;

// Pre-built bundle written by prebundle.ts during Docker build, copied into
// the runtime stage at /app/.remotion-bundle. See Dockerfile.
const PREBUILT_BUNDLE = path.resolve(import.meta.dirname, "../.remotion-bundle");

async function ensureBundle(): Promise<string> {
  if (bundlePath && fs.existsSync(bundlePath)) return bundlePath;

  if (fs.existsSync(PREBUILT_BUNDLE)) {
    bundlePath = PREBUILT_BUNDLE;
    console.log("[render] Using pre-built bundle:", bundlePath);
    return bundlePath;
  }

  // Dev fallback (tsx watch on src/): compile from source. Slow first time
  // but only happens once per process and the dev DX of editing components
  // and re-rendering is worth it.
  const entryPoint = path.resolve(
    import.meta.dirname,
    "../../../packages/remotion-components/src/Root.tsx",
  );
  if (!fs.existsSync(entryPoint)) {
    throw new Error(`Remotion entry point not found: ${entryPoint}`);
  }

  console.log("[render] Bundling Remotion components from source (dev)...");
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
