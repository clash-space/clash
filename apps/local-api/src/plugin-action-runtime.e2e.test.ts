import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ActionsHost } from "@clash-space/bridge/actions-host";
import { PluginHostClient, startPluginHostIpcServer } from "@clash-space/bridge/plugin-host";
import {
  activateExecutablePluginDraft,
  checkoutExecutablePluginDraft,
  rollbackDownloadedActionPackage,
  scaffoldExecutablePluginDraft,
} from "@clash-space/cli/actions";
import { expect, it } from "vitest";

import { createBridgeExecutablePluginActionInvoker } from "./plugin-action-runtime";

async function waitForBindingVersion(
  client: PluginHostClient,
  version: string,
  timeoutMs = 8_000,
) {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const binding = await client.resolveBinding("caption-helper", "caption-helper", "action");
      if (binding.version === version) return binding;
      lastError = new Error(`Expected ${version}, received ${binding.version}.`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`Timed out waiting for caption-helper ${version}.`);
}

it("runs an agent-created action Card through activation, hot host discovery, and exact stdio ABI", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "clash-agent-action-e2e-"));
  const pluginDir = join(workspace, "drafts", "caption-helper");
  const actionsRoot = join(workspace, "actions");
  await scaffoldExecutablePluginDraft({
    pluginDir,
    id: "caption-helper",
    name: "Caption Helper",
    kind: "action",
  });
  await activateExecutablePluginDraft({
    pluginDir,
    root: actionsRoot,
    approvePermissionIncrease: async () => true,
  });

  const host = new ActionsHost({
    serverUrl: "http://127.0.0.1:49321",
    apiKey: "",
    runtimeId: "plugin-action-e2e",
    actionsRoot,
    executablePluginsOnly: true,
  });
  const socketPath = join(workspace, "plugin-host.sock");
  let ipc: Awaited<ReturnType<typeof startPluginHostIpcServer>> | null = null;
  try {
    await host.start();
    ipc = await startPluginHostIpcServer({ host, socketPath });
    const client = new PluginHostClient({ socketPath });
    const [registration] = await client.listCards();
    expect(registration).toMatchObject({
      pluginId: "caption-helper",
      version: "0.1.0",
      document: { kind: "action-card", spec: { id: "caption-helper" } },
    });
    const binding = await client.resolveBinding("caption-helper", "caption-helper", "action");
    const result = await createBridgeExecutablePluginActionInvoker({ client })({
      binding,
      taskId: "task-caption-e2e",
      projectId: "project-caption-e2e",
      nodeId: "node-caption-e2e",
      input: { values: { prompt: "Caption this" }, references: [] },
      actor: { kind: "agent", id: "agent-e2e" },
    });
    expect(result).toMatchObject({
      status: "completed",
      outputs: [{ slot: "result", kind: "value", value: { text: "Caption this" } }],
    });

    const v2Draft = join(workspace, "drafts", "caption-helper-v2");
    await checkoutExecutablePluginDraft({
      id: "caption-helper",
      pluginDir: v2Draft,
      root: actionsRoot,
    });
    const manifestPath = join(v2Draft, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.version = "0.2.0";
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    // Edit the source the manifest declares, not the built entrypoint. The host compiles
    // `runtime.build.source` during validation, so this also exercises that an edited
    // draft is never checked against a stale bundle.
    const sourcePath = join(v2Draft, "src", "stdio.ts");
    const handler = await readFile(sourcePath, "utf8");
    const edited = handler.replace("value: { text: prompt }", "value: { text: `v2:${prompt}` }");
    if (edited === handler) {
      throw new Error(`Scaffold output changed; update this edit. Source:\n${handler}`);
    }
    await writeFile(sourcePath, edited);
    const contractPath = join(v2Draft, "contract-tests", "caption-helper.json");
    const contract = JSON.parse(await readFile(contractPath, "utf8"));
    contract.expect.outputs[0].value.text = "v2:Describe the result";
    await writeFile(contractPath, `${JSON.stringify(contract, null, 2)}\n`);

    await activateExecutablePluginDraft({
      pluginDir: v2Draft,
      root: actionsRoot,
      approvePermissionIncrease: async () => true,
    });
    const v2Binding = await waitForBindingVersion(client, "0.2.0");
    expect(v2Binding.schemaHash).not.toBe(binding.schemaHash);
    const v2Result = await createBridgeExecutablePluginActionInvoker({ client })({
      binding: v2Binding,
      taskId: "task-caption-v2",
      projectId: "project-caption-e2e",
      nodeId: "node-caption-e2e",
      input: { values: { prompt: "Caption this" }, references: [] },
      actor: { kind: "agent", id: "agent-e2e" },
    });
    expect(v2Result.status).toBe("completed");
    if (v2Result.status !== "completed") throw new Error(v2Result.error.message);
    expect(v2Result.outputs).toEqual([
      { slot: "result", kind: "value", value: { text: "v2:Caption this" } },
    ]);

    await rollbackDownloadedActionPackage(actionsRoot, "caption-helper");
    const restoredBinding = await waitForBindingVersion(client, "0.1.0");
    expect(restoredBinding.schemaHash).toBe(binding.schemaHash);
    const restoredResult = await createBridgeExecutablePluginActionInvoker({ client })({
      binding: restoredBinding,
      taskId: "task-caption-restored",
      projectId: "project-caption-e2e",
      nodeId: "node-caption-e2e",
      input: { values: { prompt: "Caption this" }, references: [] },
      actor: { kind: "agent", id: "agent-e2e" },
    });
    expect(restoredResult.status).toBe("completed");
    if (restoredResult.status !== "completed") throw new Error(restoredResult.error.message);
    expect(restoredResult.outputs).toEqual([
      { slot: "result", kind: "value", value: { text: "Caption this" } },
    ]);
  } finally {
    await ipc?.close();
    await host.stopAll();
  }
});
