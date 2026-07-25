import { Command } from "commander";

export const mcpCommand = new Command("mcp")
  .description("Expose Clash CLI capabilities through MCP");

mcpCommand
  .command("serve")
  .description("Run the Clash MCP server over Streamable HTTP")
  .option("--host <host>", "HTTP bind host", "127.0.0.1")
  .option("--port <port>", "HTTP port; 0 chooses an available port", (value) => Number(value), 7331)
  .option("--stdio", "Use stdio transport instead of HTTP")
  .action(async (options) => {
    const cliEntry = process.argv[1];
    if (!cliEntry) throw new Error("Unable to resolve the current Clash CLI entrypoint");
    const server = await import("@clash-space/mcp-server/server");
    const common = { command: process.execPath, argsPrefix: [process.argv[1]], cwd: process.cwd() };
    if (options.stdio) {
      await server.serveClashMcpStdio(common);
      return;
    }
    if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) {
      throw new Error("--port must be an integer between 0 and 65535");
    }
    const http = await server.startClashMcpHttpServer({ ...common, host: options.host, port: options.port });
    process.stderr.write(`Clash MCP listening at ${http.url}\n`);
  });
