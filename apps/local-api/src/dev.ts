import { fileURLToPath } from "node:url";
import { join } from "node:path";

// Source development must never mutate the production profile under ~/.clash. Setting the default
// here still lets an explicit CLASH_PROFILE/CLASH_HOME select another isolated development home.
process.env.CLASH_PROFILE ??= "dev";
process.env.CLASH_CLI_ENTRY_PATH ??= fileURLToPath(
  new URL("../../../packages/cli/src/index.ts", import.meta.url),
);
process.env.TSX_TSCONFIG_PATH ??= fileURLToPath(
  new URL("../../../packages/cli/tsconfig.dev.json", import.meta.url),
);

const {
  clashHomeForLocalDataDir,
  defaultLocalApiDataDir,
  startLocalApiServer,
} = await import("./server.js");
const { prepareDevelopmentBundledPlugins } =
  await import("./development-bundled-plugins.js");
const dataDir = defaultLocalApiDataDir();
const pluginDevelopment = await prepareDevelopmentBundledPlugins({
  actionsRoot: join(clashHomeForLocalDataDir(dataDir), "actions"),
  tsconfigPath: fileURLToPath(new URL("../tsconfig.dev.json", import.meta.url)),
});
if (pluginDevelopment.refreshed.length > 0) {
  process.stderr.write(
    `[local-api] refreshed source-backed plugins: ${pluginDevelopment.refreshed.join(", ")}\n`,
  );
}

await startLocalApiServer({
  port: Number(process.env.PORT ?? 49321),
  dataDir,
  developmentPluginWatchRoots: pluginDevelopment.watchRoots,
});
