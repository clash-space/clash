import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";

test("plugin manifest starts one bundled MCP runtime and keeps product state in the shared local host", async () => {
  const manifest = JSON.parse(await readFile(new URL("../.codex-plugin/plugin.json", import.meta.url), "utf8"));
  const mcp = JSON.parse(await readFile(new URL("../.mcp.json", import.meta.url), "utf8"));

  assert.equal(manifest.name, "clash");
  assert.equal(manifest.mcpServers, "./.mcp.json");
  assert.deepEqual(mcp.mcpServers.clash, {
    command: "node",
    args: ["./runtime/index.js"],
    cwd: ".",
  });
});

test("bundled self-host entry derives discovery from the canonical Clash home", async () => {
  const source = await readFile(
    new URL("./local-api-entry.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /join\(clashHomeForLocalDataDir\(dataDir\), "run"\)/,
  );
  assert.doesNotMatch(source, /join\(dataDir, "\.\.", "run"\)/);
});

test("bundled self-host agents do not recursively embed the Clash plugin", async () => {
  const runtime = JSON.parse(
    await readFile(
      new URL("../runtime/agents/master-clash/runtime.json", import.meta.url),
      "utf8",
    ),
  );

  assert.deepEqual(runtime.plugins, ["clash"]);
  await assert.rejects(
    access(
      new URL(
        "../runtime/agents/master-clash/plugins/clash/runtime/index.js",
        import.meta.url,
      ),
    ),
  );
});

test("plugin packaging builds core, then bridge agents, then the non-recursive standalone bundle", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as { scripts?: Record<string, string> };
  const bridgePackage = JSON.parse(
    await readFile(new URL("../../../packages/clash-bridge/package.json", import.meta.url), "utf8"),
  ) as { scripts?: Record<string, string> };
  const localApiPackage = JSON.parse(
    await readFile(new URL("../../../apps/local-api/package.json", import.meta.url), "utf8"),
  ) as { scripts?: Record<string, string> };
  const hostCore = await readFile(
    new URL("../scripts/build-host-runtime.ts", import.meta.url),
    "utf8",
  );
  const bundleAgents = await readFile(
    new URL("../scripts/bundle-agent-runtime.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    packageJson.scripts?.build ?? "",
    /build:core.*@clash-space\/bridge build.*bundle:agents/,
  );
  assert.match(bridgePackage.scripts?.build ?? "", /build:runtime.*bundle:agents/);
  assert.match(localApiPackage.scripts?.["build:deps"] ?? "", /clash-bridge run build:runtime/);
  assert.doesNotMatch(hostCore, /sourceAgentsDir/);
  assert.match(hostCore, /rm\(resolve\(runtimeDir, "agents"\)/);
  assert.match(bundleAgents, /"packages",[\s\S]*"clash-bridge",[\s\S]*"dist",[\s\S]*"agents"/);
  assert.match(bundleAgents, /recursivePluginDir/);
});

test("the packaged MCP entry has no unresolved workspace package imports", async () => {
  const runtime = await readFile(
    new URL("../runtime/index.js", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(runtime, /from\s+["']@master-clash\//);
  assert.doesNotMatch(runtime, /from\s+["']@clash-space\//);
  assert.doesNotMatch(runtime, /from\s+["']@clash\//);
});

test("the MCP host client uses the shared canonical Clash home helper, not the local-api server entry", async () => {
  const source = await readFile(
    new URL("./plugin-host.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /from "@clash\/shared-runtime\/local-paths"/);
  assert.doesNotMatch(source, /from "@master-clash\/local-api"/);
});

test("the packaged MCP entry completes an initialize handshake in plain Node", async () => {
  const entry = new URL("../runtime/index.js", import.meta.url);
  const child = spawn(process.execPath, [entry.pathname], {
    cwd: new URL("../", import.meta.url),
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  child.stdin.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "clash-package-boundary-test", version: "1" },
    },
  })}\n`);

  try {
    const response = await new Promise<Record<string, unknown>>((resolveResponse, rejectResponse) => {
      const timeout = setTimeout(() => {
        rejectResponse(new Error(`Timed out waiting for MCP initialize response.\n${stderr}`));
      }, 10_000);
      const inspect = () => {
        const line = stdout.split("\n").find((candidate) => candidate.trim());
        if (!line) return;
        clearTimeout(timeout);
        try {
          resolveResponse(JSON.parse(line) as Record<string, unknown>);
        } catch (error) {
          rejectResponse(error);
        }
      };
      child.stdout.on("data", inspect);
      child.once("exit", (code) => {
        clearTimeout(timeout);
        rejectResponse(new Error(`MCP runtime exited with ${code} before initialize.\n${stderr}`));
      });
      inspect();
    });
    assert.equal(response.jsonrpc, "2.0");
    assert.equal(response.id, 1);
    assert.ok(response.result && typeof response.result === "object");
  } finally {
    child.kill("SIGTERM");
  }
});

test("the retired Claude-only plugin is not a second packaged skill source", async () => {
  const workspace = await readFile(
    new URL("../../../pnpm-workspace.yaml", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(workspace, /packages\/claude-code-plugin/);
  await assert.rejects(
    access(new URL("../../../packages/claude-code-plugin/package.json", import.meta.url)),
  );
});
