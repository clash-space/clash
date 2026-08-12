import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it } from "vitest";

import * as actionsLoader from "./actions-loader";

it("runs declared plugin contracts with fixture-only scoped-store data", async () => {
  const runContracts = (actionsLoader as Record<string, unknown>)
    .runExecutablePluginContractTests as
    | ((pluginDir: string) => Promise<{
        passed: number;
        tests: Array<{ id: string; status: "passed" }>;
      }>)
    | undefined;
  expect(runContracts).toBeDefined();
  if (!runContracts) return;

  const pluginDir = await mkdtemp(join(tmpdir(), "clash-plugin-contract-"));
  await mkdir(join(pluginDir, "contract-tests"), { recursive: true });
  await writeFile(join(pluginDir, "handler.mjs"), [
    'import { createInterface } from "node:readline";',
    'const lines = createInterface({ input: process.stdin });',
    'const pending = new Map();',
    'lines.on("line", (line) => {',
    '  const message = JSON.parse(line);',
    '  if (message.protocol === "clash.plugin.broker-response/v1") {',
    '    const invocation = pending.get(message.requestId);',
    '    process.stdout.write(JSON.stringify({',
    '      protocol: "clash.plugin.result/v1", invocationId: invocation.invocationId,',
    '      status: "completed", outputs: [{ slot: "request", kind: "value", value: {',
    '        prompt: invocation.input.values.prompt, accountValue: message.result.value,',
    '      } }],',
    '    }) + "\\n");',
    '    return;',
    '  }',
    '  if (message.protocol !== "clash.plugin.invoke/v1") return;',
    '  pending.set("broker-1", message);',
    '  process.stdout.write(JSON.stringify({',
    '    protocol: "clash.plugin.broker-request/v1", requestId: "broker-1",',
    '    invocationId: message.invocationId,',
    '    operation: { kind: "store.get", key: "apiKey" },',
    '  }) + "\\n");',
    '});',
  ].join("\n"));
  await writeFile(join(pluginDir, "manifest.json"), JSON.stringify({
    apiVersion: "clash.plugin/v1",
    id: "test.contract-plugin",
    version: "1.0.0",
    name: "Contract Plugin",
    runtime: { kind: "local", transport: "stdio", entrypoint: "handler.mjs" },
    contributes: {
      cards: [],
      functions: [{ id: "execute", kind: "provider-executor" }],
    },
    contractTests: ["contract-tests/project.json"],
  }));
  await writeFile(join(pluginDir, "contract-tests", "project.json"), JSON.stringify({
    apiVersion: "clash.plugin.contract-test/v1",
    id: "project-basic",
    target: { exportId: "execute", kind: "provider-executor" },
    input: { values: { prompt: "Turn around" }, references: [] },
    brokerFixtures: [{
      operation: { kind: "store.get", key: "apiKey" },
      response: { status: "ok", result: { value: "fixture-key" } },
    }],
    expect: {
      status: "completed",
      outputs: [{
        slot: "request",
        kind: "value",
        value: {
          prompt: "Turn around",
          accountValue: "fixture-key",
        },
      }],
    },
  }));

  await expect(runContracts(pluginDir)).resolves.toEqual({
    passed: 1,
    tests: [{ id: "project-basic", status: "passed" }],
  });
});
