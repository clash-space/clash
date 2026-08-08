import { fileURLToPath } from "node:url";
import { startClashMcpHttpServer } from "./server";

export * from "./canvas-app";
export * from "./canvas-contract";
export * from "./canvas-gateway";
export * from "./server";
export * from "./studio-app";

const launchedDirectly = process.argv[1]
  ? fileURLToPath(import.meta.url) === process.argv[1]
  : false;

if (launchedDirectly) {
  const http = await startClashMcpHttpServer();
  process.stderr.write(`Clash MCP listening at ${http.url}\n`);
}
