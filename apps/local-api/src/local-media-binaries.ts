import { accessSync, chmodSync, constants, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

export type LocalMediaTool = "ffmpeg" | "ffprobe";

export interface SelectLocalMediaBinaryOptions {
  tool: LocalMediaTool;
  env: Record<string, string | undefined>;
  packagedPath?: string | null;
  systemPaths: readonly string[];
  platform: NodeJS.Platform;
}

type LocalMediaPackageLoader = (packageName: string) => unknown;

export interface ResolveLocalMediaBinaryOptions {
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  systemPaths?: readonly string[];
  loadPackage?: LocalMediaPackageLoader;
}

const nodeRequire = createRequire(import.meta.url);

const installerPackage: Record<LocalMediaTool, string> = {
  ffmpeg: "@ffmpeg-installer/ffmpeg",
  ffprobe: "@ffprobe-installer/ffprobe",
};

function packageBinaryPath(
  tool: LocalMediaTool,
  loadPackage: LocalMediaPackageLoader,
): string | null {
  try {
    const loaded = loadPackage(installerPackage[tool]);
    const value =
      loaded && typeof loaded === "object" && "default" in loaded
        ? (loaded as { default: unknown }).default
        : loaded;
    return value && typeof value === "object" && "path" in value
      ? String((value as { path: unknown }).path)
      : null;
  } catch {
    return null;
  }
}

function defaultSystemPaths(tool: LocalMediaTool): string[] {
  return [
    `/opt/homebrew/bin/${tool}`,
    `/usr/local/bin/${tool}`,
    `/usr/bin/${tool}`,
  ];
}

function isExecutableFile(path: string, platform: NodeJS.Platform): boolean {
  if (/(?:^|[\\/])app\.asar(?:[\\/]|$)/.test(path)) return false;
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function preparePackagedExecutable(
  path: string | null,
  platform: NodeJS.Platform,
): string | null {
  if (!path || /(?:^|[\\/])app\.asar(?:[\\/]|$)/.test(path)) return path;
  if (platform !== "win32" && !isExecutableFile(path, platform)) {
    try {
      if (statSync(path).isFile()) chmodSync(path, 0o755);
    } catch {
      return path;
    }
  }
  return path;
}

export function selectLocalMediaBinary(
  options: SelectLocalMediaBinaryOptions,
): string | null {
  const overrideName =
    options.tool === "ffmpeg" ? "FFMPEG_PATH" : "FFPROBE_PATH";
  const candidates = [
    options.env[overrideName],
    options.packagedPath,
    ...options.systemPaths,
  ];
  return (
    candidates
      .filter((candidate): candidate is string => Boolean(candidate))
      .find((candidate) => isExecutableFile(candidate, options.platform)) ??
    null
  );
}

export function resolveLocalMediaBinary(
  tool: LocalMediaTool,
  options: ResolveLocalMediaBinaryOptions = {},
): string | null {
  const loadPackage = options.loadPackage ?? ((name) => nodeRequire(name));
  const platform = options.platform ?? process.platform;
  const env = { ...(options.env ?? process.env) };
  if (tool === "ffprobe" && !env.FFPROBE_PATH && env.FFMPEG_PATH) {
    env.FFPROBE_PATH = join(dirname(env.FFMPEG_PATH), "ffprobe");
  }
  return selectLocalMediaBinary({
    tool,
    env,
    packagedPath: preparePackagedExecutable(
      packageBinaryPath(tool, loadPackage),
      platform,
    ),
    systemPaths: options.systemPaths ?? defaultSystemPaths(tool),
    platform,
  });
}

export function localFfmpegPath(): string | null {
  return resolveLocalMediaBinary("ffmpeg");
}

export function localFfprobePath(): string | null {
  return resolveLocalMediaBinary("ffprobe");
}
