import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  clashHomeForLocalDataDir,
  createHeadlessDirectorStageRenderer,
  createRemotionTimelineRenderer,
  defaultLocalApiDataDir,
  startLocalApiServer,
} from "@master-clash/local-api";

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
  const startedBy = process.env.CLASH_DAEMON_STARTED_BY === "cli" ? "cli" : "plugin";
  const dataDir = defaultLocalApiDataDir(process.env);
  const remotionBundle =
    process.env.CLASH_REMOTION_BUNDLE_PATH?.trim() ||
    fileURLToPath(new URL("./remotion-bundle", import.meta.url));
  if (!existsSync(remotionBundle)) {
    throw new Error(`Packaged Remotion bundle is missing: ${remotionBundle}`);
  }
  const timelineRenderer = createRemotionTimelineRenderer({
    resolveServeUrl: async () => remotionBundle,
    loadRenderer: async () => {
      const renderer = await import("@remotion/renderer");
      return {
        selectComposition: (options) => renderer.selectComposition(options as never),
        renderMedia: (options) => renderer.renderMedia(options as never),
      };
    },
  });
  const directorBundle =
    process.env.CLASH_DIRECTOR_BUNDLE_PATH?.trim() ||
    fileURLToPath(new URL("./director-bundle", import.meta.url));
  if (!existsSync(directorBundle)) {
    throw new Error(`Packaged Director bundle is missing: ${directorBundle}`);
  }
  const directorStageRenderer = createHeadlessDirectorStageRenderer({
    bundleDir: directorBundle,
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
