import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createClashMcpServer } from "@clash-space/mcp-server/server";
import { createTimelineAdapter } from "@clash-space/timeline-plugin/adapter";
import { registerTimelinePluginMcp } from "@clash-space/timeline-plugin/server";
import { createDirectorAdapter } from "@clash-space/director-plugin/adapter";
import { registerDirectorPluginMcp } from "@clash-space/director-plugin/server";
import { createHostCliRunner, type HostCliRunner } from "./host-runner.js";
import {
  createPluginHostManager,
  type PluginHostManager,
} from "./plugin-host.js";

export type ClashPluginAppBundles = {
  studio: string;
  canvas: string;
  timeline: string;
  director: string;
};

function bundledApp(name: keyof ClashPluginAppBundles): string {
  return readFileSync(new URL(`./${name}-app-client.js`, import.meta.url), "utf8");
}

export type ClashPluginServerOptions = {
  runner?: HostCliRunner;
  hostManager?: PluginHostManager;
  appBundles?: ClashPluginAppBundles;
};

function composeClashPluginServer(
  runner: HostCliRunner,
  bundles: ClashPluginAppBundles,
): McpServer {
  const server = createClashMcpServer({
    runner,
    bundledAppJavascript: bundles.canvas,
    bundledStudioAppJavascript: bundles.studio,
  });
  const projectionRunner = (args: string[], cwd: string) => runner(args, cwd);
  registerTimelinePluginMcp(
    server,
    createTimelineAdapter({ run: projectionRunner }),
    bundles.timeline,
  );
  registerDirectorPluginMcp(
    server,
    createDirectorAdapter({ run: projectionRunner }),
    bundles.director,
  );
  return server;
}

export function createClashPluginRuntime(options: ClashPluginServerOptions = {}): {
  server: McpServer;
  hostManager?: PluginHostManager;
  close(): Promise<void>;
  closeHost(): Promise<void>;
} {
  const hostManager = options.hostManager ?? (options.runner ? undefined : createPluginHostManager());
  const runner = options.runner ?? createHostCliRunner({ hostManager });
  const bundles = options.appBundles ?? {
    studio: bundledApp("studio"),
    canvas: bundledApp("canvas"),
    timeline: bundledApp("timeline"),
    director: bundledApp("director"),
  };
  const server = composeClashPluginServer(runner, bundles);
  const originalClose = server.close.bind(server);
  let closingHost: Promise<void> | undefined;
  let closingRuntime: Promise<void> | undefined;
  const closeHost = () => {
    closingHost ??= hostManager?.close() ?? Promise.resolve();
    return closingHost;
  };
  const close = () => {
    closingRuntime ??= (async () => {
      try {
        await originalClose();
      } finally {
        await closeHost();
      }
    })();
    return closingRuntime;
  };
  server.close = close;
  return { server, hostManager, close, closeHost };
}

export function createClashPluginServer(options: ClashPluginServerOptions = {}): McpServer {
  return createClashPluginRuntime(options).server;
}

export async function serveClashPluginStdio(options: ClashPluginServerOptions = {}): Promise<void> {
  const runtime = createClashPluginRuntime(options);
  const transport = new StdioServerTransport();
  transport.onclose = () => {
    void runtime.closeHost();
  };
  const shutdown = () => {
    void runtime.close().finally(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  await runtime.server.connect(transport);
}
