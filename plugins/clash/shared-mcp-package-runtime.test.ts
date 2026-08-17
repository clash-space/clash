import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

type PackageRuntimeProbe = {
  canvasSchemaKeys: string[];
  compositionSchemaKeys: string[];
  canvasIndexText: string;
  canvasOperationKeys: string[];
  canvasContractName?: string;
  canvasContractText: string;
  compositionContractNames?: Array<string | undefined>;
  compositionContractsText: string;
};

const PACKAGE_RUNTIME_PROBE = String.raw`
  import { createClashPluginServer } from "clash";
  import { Client } from "@modelcontextprotocol/sdk/client/index.js";
  import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

  const textContent = (value) =>
    Array.isArray(value?.content)
      ? value.content
          .filter((entry) => entry?.type === "text" && typeof entry.text === "string")
          .map((entry) => entry.text)
          .join("\n")
      : "";

  const server = createClashPluginServer({
    client: {
      resolveContext: async () => ({ projectId: "project-test", source: "explicit" }),
      request: async () => ({
        projectId: "project-test",
        value: { nodes: [], versions: {} },
      }),
    },
    appBundles: { studio: "", canvas: "", timeline: "", director: "" },
  });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({
    name: "shared-mcp-package-runtime-client",
    version: "1.0.0",
  });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const rootTools = await client.listTools();
    const canvasSchema = rootTools.tools.find(({ name }) => name === "clash_canvas")?.inputSchema;
    const compositionSchema = rootTools.tools.find(({ name }) => name === "clash_composition")?.inputSchema;
    const canvasIndex = await client.callTool({ name: "clash_canvas", arguments: {} });
    const canvasContract = await client.callTool({
      name: "clash_canvas",
      arguments: { contract: "add" },
    });
    const compositionContracts = await client.callTool({
      name: "clash_composition",
      arguments: { kind: "timeline", contracts: ["create", "get"] },
    });
    process.stdout.write(JSON.stringify({
      canvasSchemaKeys: Object.keys(canvasSchema?.properties ?? {}).sort(),
      compositionSchemaKeys: Object.keys(compositionSchema?.properties ?? {}).sort(),
      canvasIndexText: textContent(canvasIndex),
      canvasOperationKeys: Object.keys(canvasIndex.structuredContent?.operations?.[0] ?? {}).sort(),
      canvasContractName: canvasContract.structuredContent?.contract?.name,
      canvasContractText: textContent(canvasContract),
      compositionContractNames: compositionContracts.structuredContent?.contracts?.map(({ name }) => name),
      compositionContractsText: textContent(compositionContracts),
    }));
  } finally {
    await client.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
`;

test("the packaged Clash runtime contains current shared-mcp dispatcher contracts", () => {
  const output = execFileSync(
    process.execPath,
    ["--input-type=module", "--eval", PACKAGE_RUNTIME_PROBE],
    {
      cwd: new URL(".", import.meta.url),
      encoding: "utf8",
      env: {
        ...process.env,
        NODE_OPTIONS: "",
        TSX_TSCONFIG_PATH: "",
      },
    },
  );
  const probe = JSON.parse(output) as PackageRuntimeProbe;

  assert.ok(probe.canvasSchemaKeys.includes("contract"));
  assert.ok(probe.canvasSchemaKeys.includes("contracts"));
  assert.ok(probe.compositionSchemaKeys.includes("contract"));
  assert.ok(probe.compositionSchemaKeys.includes("contracts"));
  assert.deepEqual(probe.canvasOperationKeys, [
    "destructive",
    "name",
    "operation",
    "readOnly",
    "title",
  ]);
  assert.match(probe.canvasIndexText, /clash_canvas_add/u);
  assert.equal(probe.canvasContractName, "clash_canvas_add");
  assert.match(probe.canvasContractText, /clash_canvas_add/u);
  assert.deepEqual(probe.compositionContractNames, [
    "clash_timeline_create",
    "clash_timeline_get",
  ]);
  assert.match(probe.compositionContractsText, /clash_timeline_create/u);
  assert.match(probe.compositionContractsText, /clash_timeline_get/u);
});
