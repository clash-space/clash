import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { servePluginStdio, type ResolvedReference } from "@clash/action-sdk";
import {
  createAssetEditPluginModule,
  type AssetEditExecutionInput,
} from "@clash/shared-runtime/browser";
import sharp from "sharp";

const execFileAsync = promisify(execFile);

async function resolvedBytes(
  reference: ResolvedReference,
): Promise<Uint8Array> {
  if (reference.form === "bytes") return reference.bytes;
  if (reference.form === "executor-url" || reference.form === "provider-url") {
    const url =
      reference.form === "executor-url"
        ? reference.executorUrl
        : reference.providerUrl;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Asset source download failed (${response.status}).`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }
  throw new Error("Asset edit requires a binary media reference.");
}

async function renderImage(input: AssetEditExecutionInput, bytes: Uint8Array) {
  if (input.invocation.actionId !== "image-editor") {
    throw new Error("Image renderer received a video Action.");
  }
  let pipeline = sharp(bytes);
  if (input.invocation.params.crop) {
    const { x, y, width, height } = input.invocation.params.crop;
    pipeline = pipeline.extract({ left: x, top: y, width, height });
  }
  if (input.invocation.params.rotation) {
    pipeline = pipeline.rotate(input.invocation.params.rotation);
  }
  return new Uint8Array(await pipeline.png().toBuffer());
}

async function renderVideo(
  input: AssetEditExecutionInput,
  bytes: Uint8Array,
): Promise<{ bytes: Uint8Array; kind: "image" | "video"; mediaType: string }> {
  if (input.invocation.actionId !== "video-clipper") {
    throw new Error("Video renderer received an image Action.");
  }
  const directory = await mkdtemp(join(tmpdir(), "clash-asset-edit-"));
  const sourcePath = join(directory, "source-media");
  const screenshot = input.invocation.params.mode === "screenshot";
  const outputPath = join(directory, screenshot ? "output.png" : "output.mp4");
  await writeFile(sourcePath, bytes);
  try {
    const params = input.invocation.params;
    await execFileAsync(
      ffmpegInstaller.path,
      params.mode === "screenshot"
        ? [
            "-y",
            "-ss",
            String(params.frameTimeSec),
            "-i",
            sourcePath,
            "-frames:v",
            "1",
            outputPath,
          ]
        : [
            "-y",
            "-ss",
            String(params.startSec),
            "-i",
            sourcePath,
            "-t",
            String(params.endSec - params.startSec),
            "-map",
            "0",
            "-c",
            "copy",
            "-movflags",
            "+faststart",
            outputPath,
          ],
      { maxBuffer: 4 * 1024 * 1024 },
    );
    return {
      bytes: new Uint8Array(await readFile(outputPath)),
      kind: screenshot ? "image" : "video",
      mediaType: screenshot ? "image/png" : "video/mp4",
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export const plugin = createAssetEditPluginModule(async (input, context) => {
  if (!input.reference) {
    throw new Error("Asset edit requires one frozen source reference.");
  }
  const source = await resolvedBytes(await context.reference(input.reference));
  if (input.invocation.actionId === "image-editor") {
    return context.upload({
      slot: "output",
      kind: "image",
      mediaType: "image/png",
      bytes: await renderImage(input, source),
    });
  }
  const output = await renderVideo(input, source);
  return context.upload({ slot: "output", ...output });
});

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  void servePluginStdio(plugin).done;
}
