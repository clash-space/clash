import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("CLI exposes HTTP MCP by default and retains explicit stdio mode", () => {
  const source = readFileSync(new URL("./mcp.ts", import.meta.url), "utf8");
  const index = readFileSync(new URL("../index.ts", import.meta.url), "utf8");

  assert.match(index, /mcpCommand/);
  assert.match(source, /new Command\("mcp"\)/);
  assert.match(source, /\.command\("serve"\)/);
  assert.match(source, /startClashMcpHttpServer/);
  assert.match(source, /\.option\("--host <host>"/);
  assert.match(source, /\.option\("--port <port>"/);
  assert.match(source, /serveClashMcpStdio/);
  assert.match(source, /command: process\.execPath/);
  assert.match(source, /argsPrefix: \[process\.argv\[1\]\]/);
});
