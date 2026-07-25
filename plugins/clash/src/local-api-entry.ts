import { join } from "node:path";
import {
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
  const ownerClientId = process.env.CLASH_PLUGIN_OWNER_CLIENT_ID?.trim();
  if (!ownerClientId) throw new Error("CLASH_PLUGIN_OWNER_CLIENT_ID is required");
  const dataDir = defaultLocalApiDataDir(process.env);
  const runDir = process.env.CLASH_HOST_RUN_DIR?.trim() || join(dataDir, "..", "run");
  server = await startLocalApiServer({
    port: Number(process.env.PORT ?? 0),
    dataDir,
    discovery: {
      enabled: true,
      runDir,
      launchMode: "plugin",
      startedBy: "plugin",
      ownerClientId,
    },
  });
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
