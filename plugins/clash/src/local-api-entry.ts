import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  clashHomeForLocalDataDir,
  createHeadlessDirectorStageRenderer,
  createRemotionTimelineRenderer,
  defaultLocalApiDataDir,
  prepareDevelopmentBundledPlugins,
  startLocalApiServer,
} from "@clash/local-api";
import { createDevelopmentBrowserAssets } from "./development-browser-assets.js";

type LocalApiServer = Awaited<ReturnType<typeof startLocalApiServer>>;

let server: LocalApiServer | undefined;
let stopping = false;

async function closeServer(exitCode: number): Promise<void> {
  if (stopping) return;
  stopping = true;
  if (!server) {
    process.exit(exitCode);
    return;
  }
  await new Promise<void>((resolveClose) => {
    server!.close(() => resolveClose());
  });
  process.exit(exitCode);
}

process.once("SIGINT", () => { void closeServer(0); });
process.once("SIGTERM", () => { void closeServer(0); });

async function main(): Promise<void> {
  const startedBy = process.env.CLASH_DAEMON_STARTED_BY === "desktop"
    ? "desktop"
    : process.env.CLASH_DAEMON_STARTED_BY === "cli"
      ? "cli"
      : "plugin";
  const dataDir = defaultLocalApiDataDir(process.env);
  const sourceRuntime = process.env.CLASH_SOURCE_RUNTIME === "1";
  const pluginDevelopment = sourceRuntime
    ? await prepareDevelopmentBundledPlugins({
        actionsRoot: join(clashHomeForLocalDataDir(dataDir), "actions"),
        tsconfigPath: fileURLToPath(
          new URL("../../../apps/local-api/tsconfig.dev.json", import.meta.url),
        ),
      })
    : undefined;
  if (pluginDevelopment && pluginDevelopment.refreshed.length > 0) {
    process.stderr.write(
      `[local-api] refreshed source-backed plugins: ${pluginDevelopment.refreshed.join(", ")}\n`,
    );
  }
  const configuredRemotionBundle =
    process.env.CLASH_REMOTION_BUNDLE_PATH?.trim();
  const configuredDirectorBundle =
    process.env.CLASH_DIRECTOR_BUNDLE_PATH?.trim();
  const developmentAssets = sourceRuntime &&
      (!configuredRemotionBundle || !configuredDirectorBundle)
    ? createDevelopmentBrowserAssets({
        repoRoot: fileURLToPath(new URL("../../..", import.meta.url)),
      })
    : undefined;
  const remotionBundle = configuredRemotionBundle ||
    (sourceRuntime
      ? undefined
      : fileURLToPath(new URL("./remotion-bundle", import.meta.url)));
  if (remotionBundle && !existsSync(remotionBundle)) {
    throw new Error(`Remotion bundle is missing: ${remotionBundle}`);
  }
  const timelineRenderer = createRemotionTimelineRenderer({
    resolveServeUrl: remotionBundle
      ? async () => remotionBundle
      : () => developmentAssets!.resolveRemotionServeUrl(),
    loadRenderer: async () => {
      const renderer = await import("@remotion/renderer");
      return {
        selectComposition: (options) => renderer.selectComposition(options as never),
        renderMedia: (options) => renderer.renderMedia(options as never),
      };
    },
  });
  const directorBundle = configuredDirectorBundle ||
    (sourceRuntime
      ? developmentAssets!.directorBundleDir
      : fileURLToPath(new URL("./director-bundle", import.meta.url)));
  if ((configuredDirectorBundle || !sourceRuntime) && !existsSync(directorBundle)) {
    throw new Error(`Director bundle is missing: ${directorBundle}`);
  }
  const directorStageRenderer = createHeadlessDirectorStageRenderer({
    bundleDir: directorBundle,
    ...(configuredDirectorBundle || !sourceRuntime
      ? {}
      : { prepareBundle: () => developmentAssets!.prepareDirectorBundle() }),
    openBrowser: async () => {
      const renderer = await import("@remotion/renderer");
      return renderer.openBrowser("chrome", {
        chromiumOptions: { gl: "angle" },
        logLevel: "error",
      }) as never;
    },
  });
  const runDir =
    process.env.CLASH_HOST_RUN_DIR?.trim() ||
    join(clashHomeForLocalDataDir(dataDir), "run");
  server = await startLocalApiServer({
    port: Number(process.env.PORT ?? 0),
    dataDir,
    timelineRenderer,
    directorStageRenderer,
    ...(pluginDevelopment
      ? { developmentPluginWatchRoots: pluginDevelopment.watchRoots }
      : {}),
    discovery: {
      enabled: true,
      runDir,
      launchMode: "user-service",
      startedBy,
    },
  });
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
