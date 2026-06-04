import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { serve } from "@hono/node-server";
import { createLocalApiApp } from "./app.js";
import { createMockExternalAigcService } from "./local-aigc.js";
import { attachLocalAcpSessions, createLocalAcpAdapter } from "./local-acp.js";
import { createMockFalQueueService } from "./fal-mock.js";
import { createLocalWorkflowProcessor } from "./local-processor.js";
import {
  attachLocalSync,
  createRemoteLoroPersistenceFromEnv,
  type RemoteLoroPersistence,
} from "./sync.js";

const port = Number(process.env.PORT ?? 49321);
const dataDir =
  process.env.CLASH_LOCAL_DATA_DIR ??
  join(homedir(), ".clash", "local-api");

export interface LocalApiServerOptions {
  port: number;
  dataDir: string;
  remotePersistence?: RemoteLoroPersistence | null;
}

export function startLocalApiServer(options: LocalApiServerOptions) {
  const localAcp = createLocalAcpAdapter();
  const falMock = createMockFalQueueService();
  const app = createLocalApiApp({ dataDir: options.dataDir, localAcp, falMock });
  const workflowProcessor = createLocalWorkflowProcessor({
    dataDir: options.dataDir,
    aigc: createMockExternalAigcService({
      fal: falMock,
      origin: `http://127.0.0.1:${options.port}`,
    }),
  });
  const remotePersistence = options.remotePersistence === undefined
    ? createRemoteLoroPersistenceFromEnv(process.env)
    : options.remotePersistence ?? undefined;
  let resolveListening!: (server: ReturnType<typeof serve>) => void;
  const listening = new Promise<ReturnType<typeof serve>>((resolve) => {
    resolveListening = resolve;
  });
  const server = serve({ fetch: app.fetch, port: options.port }, (info) => {
    console.log(`[local-api] listening on http://127.0.0.1:${info.port}`);
    console.log(`[local-api] data dir: ${options.dataDir}`);
    if (remotePersistence) console.log("[local-api] remote Loro persistence: enabled");
    resolveListening(server);
  });
  attachLocalSync(server, { dataDir: options.dataDir, remotePersistence, workflowProcessor });
  attachLocalAcpSessions(server, localAcp);
  return listening;
}

const directRunUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === directRunUrl) {
  void startLocalApiServer({ port, dataDir });
}
