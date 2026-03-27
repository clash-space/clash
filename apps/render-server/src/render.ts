import path from "path";
import fs from "fs";
import os from "os";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";

// Cache the bundle path across renders
let bundlePath: string | null = null;

async function ensureBundle(): Promise<string> {
  if (bundlePath && fs.existsSync(bundlePath)) return bundlePath;

  const entryPoint = path.resolve(
    import.meta.dirname,
    "../../../packages/remotion-components/src/Root.tsx"
  );

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
