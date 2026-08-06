import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { expect, it } from "vitest";
import * as actionsLoader from "./actions-loader";

const { ActionsHost } = actionsLoader;

async function attestTestPlugin(actionsRoot: string, pluginDir: string): Promise<void> {
  const createReceipt = (actionsLoader as Record<string, unknown>)
    .createExecutablePluginActivationReceipt as (dir: string) => Promise<Record<string, unknown>>;
  const receiptPath = (actionsLoader as Record<string, unknown>)
    .executablePluginActivationReceiptPath as (root: string, pluginId: string) => string;
  const manifest = JSON.parse(await import("node:fs/promises").then(({ readFile }) =>
    readFile(join(pluginDir, "manifest.json"), "utf8"))) as { id: string };
  const path = receiptPath(actionsRoot, manifest.id);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(await createReceipt(pluginDir)));
}

it("ActionsHost scans actions under CLASH_HOME", async () => {
  const originalClashHome = process.env.CLASH_HOME;
  const clashHome = await mkdtemp(join(tmpdir(), "clash-actions-home-"));
  process.env.CLASH_HOME = clashHome;
  const host = new ActionsHost({
    serverUrl: "http://127.0.0.1:49321",
    apiKey: "clsh_test",
    runtimeId: "runtime-test",
  });

  try {
    const result = await host.start();

    expect(result.spawned).toEqual([]);
    expect((await stat(join(clashHome, "actions"))).isDirectory()).toBe(true);
  } finally {
    await host.stopAll();
    if (originalClashHome === undefined) {
      delete process.env.CLASH_HOME;
    } else {
      process.env.CLASH_HOME = originalClashHome;
    }
  }
});

it("ActionsHost strictly validates executable plugin Cards before spawning", async () => {
  const originalClashHome = process.env.CLASH_HOME;
  const clashHome = await mkdtemp(join(tmpdir(), "clash-plugin-home-"));
  process.env.CLASH_HOME = clashHome;

  const writePlugin = async (dirName: string, cardId: string) => {
    const root = join(clashHome, "actions", dirName);
    await mkdir(join(root, "cards"), { recursive: true });
    await mkdir(join(root, "dist"), { recursive: true });
    await writeFile(join(root, "dist", "handler.mjs"), "setInterval(() => {}, 1000);\n");
    await writeFile(join(root, "cards", "action.json"), JSON.stringify({
      apiVersion: "clash.card/v1",
      kind: "action-card",
      spec: {
        id: cardId,
        name: "Test Action",
        outputType: "image",
        functionExportId: "test-action",
      },
    }));
    await writeFile(join(root, "manifest.json"), JSON.stringify({
      apiVersion: "clash.plugin/v1",
      id: dirName,
      version: "1.0.0",
      name: "Test Plugin",
      runtime: { kind: "local", transport: "stdio", entrypoint: "dist/handler.mjs" },
      exports: {
        cards: [{ id: "test-action", kind: "action-card", path: "cards/action.json" }],
        functions: [{ id: "test-action", kind: "action", handler: "testAction" }],
      },
      permissions: {},
    }));
    if (cardId === "test-action") await attestTestPlugin(join(clashHome, "actions"), root);
  };

  await writePlugin("valid-plugin", "test-action");
  await writePlugin("invalid-plugin", "wrong-id");
  const host = new ActionsHost({
    serverUrl: "http://127.0.0.1:49321",
    apiKey: "clsh_must_not_reach_new_plugins",
    runtimeId: "runtime-test",
  });

  try {
    const result = await host.start();
    expect(new Set(result.spawned)).toEqual(new Set(["valid-plugin"]));
    expect(new Set(result.skipped)).toEqual(new Set(["invalid-plugin"]));
    expect(host.listIds()).toEqual(["valid-plugin"]);
  } finally {
    await host.stopAll();
    if (originalClashHome === undefined) delete process.env.CLASH_HOME;
    else process.env.CLASH_HOME = originalClashHome;
  }
});

it("v1 plugin processes cannot inherit Clash or provider credentials", () => {
  const buildEnv = (actionsLoader as Record<string, unknown>).credentialFreePluginEnv as
    | ((manifest: unknown, inherited?: NodeJS.ProcessEnv) => NodeJS.ProcessEnv)
    | undefined;
  expect(buildEnv).toBeDefined();
  if (!buildEnv) return;

  const env = buildEnv({ id: "safe-plugin", version: "1.0.0" }, {
    PATH: "/usr/bin",
    LANG: "en_US.UTF-8",
    CLASH_API_KEY: "clsh_secret",
    FAL_KEY: "fal_secret",
    MINIMAX_API_KEY: "minimax_secret",
  });

  expect(env).toMatchObject({
    PATH: "/usr/bin",
    LANG: "en_US.UTF-8",
    CLASH_PLUGIN_ID: "safe-plugin",
    CLASH_PLUGIN_VERSION: "1.0.0",
    CLASH_PLUGIN_TRANSPORT: "stdio",
  });
  expect(env.CLASH_API_KEY).toBeUndefined();
  expect(env.FAL_KEY).toBeUndefined();
  expect(env.MINIMAX_API_KEY).toBeUndefined();
  expect(env.ELECTRON_RUN_AS_NODE).toBe("1");
});

it("v1 plugin processes prefer the explicit Node runtime provided by Electron", () => {
  const resolveNode = (actionsLoader as Record<string, unknown>).resolveExecutablePluginNodePath as
    | ((inherited?: NodeJS.ProcessEnv, fallback?: string) => string)
    | undefined;
  expect(resolveNode).toBeDefined();
  if (!resolveNode) return;

  expect(resolveNode({ CLASH_NODE_EXEC_PATH: "/opt/clash/node" }, "/Applications/Clash/Electron"))
    .toBe("/opt/clash/node");
  expect(resolveNode({}, "/Applications/Clash/Electron"))
    .toBe("/Applications/Clash/Electron");
});

it("stdio sessions invoke plugins and broker only manifest-approved capabilities", async () => {
  const Session = (actionsLoader as Record<string, unknown>).PluginStdioSession as
    | (new (options: Record<string, unknown>) => {
        invoke(value: unknown, options?: { timeoutMs?: number }): Promise<any>;
        close(): void;
      })
    | undefined;
  expect(Session).toBeDefined();
  if (!Session) return;

  const hostToPlugin = new PassThrough();
  const pluginToHost = new PassThrough();
  const brokerCalls: any[] = [];
  const session = new Session({
    manifest: {
      apiVersion: "clash.plugin/v1",
      id: "safe-plugin",
      version: "1.0.0",
      name: "Safe Plugin",
      runtime: { kind: "local", transport: "stdio", entrypoint: "handler.mjs" },
      exports: {
        cards: [],
        functions: [{ id: "project", kind: "provider-projector", handler: "project" }],
      },
      permissions: {
        secrets: ["provider:fal"],
        network: { domains: ["queue.fal.run"] },
      },
    },
    stdin: hostToPlugin,
    stdout: pluginToHost,
    broker: async (request: any, context: any) => {
      brokerCalls.push(request);
      expect(context.invocation.projectId).toBe("project-1");
      expect(context.invocation.invocationId).toBe(request.invocationId);
      return { handle: `clash-secret://${request.invocationId}/provider%3Afal` };
    },
  });
  const readLine = () => new Promise<any>((resolve) => {
    hostToPlugin.once("data", (chunk) => resolve(JSON.parse(chunk.toString("utf8").trim())));
  });

  try {
    const invocation = {
      protocol: "clash.plugin.invoke/v1",
      invocationId: "invocation-1",
      taskId: "task-1",
      projectId: "project-1",
      target: {
        pluginId: "safe-plugin",
        version: "1.0.0",
        exportId: "project",
        schemaHash: `sha256:${"a".repeat(64)}`,
        kind: "provider-projector",
      },
      input: { values: {}, references: [] },
      actor: { kind: "agent", id: "agent-1" },
    };
    const invocationLine = readLine();
    const pendingResult = session.invoke(invocation, { timeoutMs: 1_000 });
    expect(await invocationLine).toMatchObject({ invocationId: "invocation-1" });

    const allowedResponse = readLine();
    pluginToHost.write(`${JSON.stringify({
      protocol: "clash.plugin.broker-request/v1",
      requestId: "broker-1",
      invocationId: "invocation-1",
      operation: { kind: "credential.handle", secretId: "provider:fal" },
    })}\n`);
    expect(await allowedResponse).toMatchObject({
      status: "ok",
      result: { handle: expect.stringMatching(/^clash-secret:\/\//) },
    });
    expect(brokerCalls).toHaveLength(1);

    const deniedResponse = readLine();
    pluginToHost.write(`${JSON.stringify({
      protocol: "clash.plugin.broker-request/v1",
      requestId: "broker-2",
      invocationId: "invocation-1",
      operation: { kind: "credential.handle", secretId: "provider:minimax" },
    })}\n`);
    expect(await deniedResponse).toMatchObject({
      status: "error",
      error: { code: "permission_denied" },
    });
    expect(brokerCalls).toHaveLength(1);

    pluginToHost.write(`${JSON.stringify({
      protocol: "clash.plugin.result/v1",
      invocationId: "invocation-1",
      status: "completed",
      outputs: [],
    })}\n`);
    expect((await pendingResult).status).toBe("completed");
  } finally {
    session.close();
  }
});

it("ActionsHost invokes a supervised v1 plugin over Bridge-owned stdio", async () => {
  const originalClashHome = process.env.CLASH_HOME;
  const clashHome = await mkdtemp(join(tmpdir(), "clash-plugin-invoke-home-"));
  process.env.CLASH_HOME = clashHome;
  const root = join(clashHome, "actions", "invoke-plugin");
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "handler.mjs"), [
    'import { createInterface } from "node:readline";',
    'import { readFileSync } from "node:fs";',
    'const lines = createInterface({ input: process.stdin });',
    'lines.on("line", async (line) => {',
    '  const message = JSON.parse(line);',
    '  if (message.protocol !== "clash.plugin.invoke/v1") return;',
    '  process.stdout.write(JSON.stringify({',
    '    protocol: "clash.plugin.result/v1",',
    '    invocationId: message.invocationId,',
    '    status: "completed",',
    '    outputs: [{ slot: "wire", kind: "value", value: {',
    '      projected: true,',
    '      outsideReadable: (() => { try { readFileSync("/etc/hosts"); return true; } catch { return false; } })(),',
    '      directNetworkDenied: await fetch("http://127.0.0.1:1").then(() => false).catch((error) => error?.code === "ERR_CLASH_PLUGIN_NETWORK_DENIED"),',
    '    } }],',
    '  }) + "\\n");',
    '});',
  ].join("\n"));
  await writeFile(join(root, "manifest.json"), JSON.stringify({
    apiVersion: "clash.plugin/v1",
    id: "invoke-plugin",
    version: "1.0.0",
    name: "Invoke Plugin",
    runtime: { kind: "local", transport: "stdio", entrypoint: "handler.mjs" },
    exports: {
      cards: [],
      functions: [{ id: "project", kind: "provider-projector", handler: "project" }],
    },
    permissions: {},
  }));
  await attestTestPlugin(join(clashHome, "actions"), root);
  const host = new ActionsHost({
    serverUrl: "http://127.0.0.1:49321",
    apiKey: "clsh_legacy_only",
    runtimeId: "runtime-test",
  }) as InstanceType<typeof ActionsHost> & {
    resolveBinding(pluginId: string, exportId: string, kind: "provider-projector"): {
      pluginId: string;
      version: string;
      exportId: string;
      schemaHash: string;
    };
    invoke(pluginId: string, invocation: unknown, options?: { timeoutMs?: number }): Promise<any>;
  };

  try {
    await host.start();
    const binding = host.resolveBinding("invoke-plugin", "project", "provider-projector");
    expect(binding).toEqual({
      pluginId: "invoke-plugin",
      version: "1.0.0",
      exportId: "project",
      schemaHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    });
    expect(typeof host.invoke).toBe("function");
    const result = await host.invoke("invoke-plugin", {
      protocol: "clash.plugin.invoke/v1",
      invocationId: "invocation-host-1",
      taskId: "task-1",
      projectId: "project-1",
      target: {
        ...binding,
        kind: "provider-projector",
      },
      input: { values: {}, references: [] },
      actor: { kind: "agent", id: "agent-1" },
    }, { timeoutMs: 2_000 });
    expect(result).toMatchObject({
      status: "completed",
      outputs: [{ value: { projected: true, outsideReadable: false, directNetworkDenied: true } }],
    });
  } finally {
    await host.stopAll();
    if (originalClashHome === undefined) delete process.env.CLASH_HOME;
    else process.env.CLASH_HOME = originalClashHome;
  }
});

it("ActionsHost refuses executable code changed outside atomic activation", async () => {
  const createReceipt = (actionsLoader as Record<string, unknown>)
    .createExecutablePluginActivationReceipt as
    | ((pluginDir: string) => Promise<Record<string, unknown>>)
    | undefined;
  const receiptPath = (actionsLoader as Record<string, unknown>)
    .executablePluginActivationReceiptPath as
    | ((actionsRoot: string, pluginId: string) => string)
    | undefined;
  expect(createReceipt).toBeDefined();
  expect(receiptPath).toBeDefined();
  if (!createReceipt || !receiptPath) return;

  const clashHome = await mkdtemp(join(tmpdir(), "clash-plugin-attestation-"));
  const actionsRoot = join(clashHome, "actions");
  const pluginDir = join(actionsRoot, "attested-plugin");
  await mkdir(pluginDir, { recursive: true });
  await writeFile(join(pluginDir, "handler.mjs"), "setInterval(() => {}, 1000);\n");
  await writeFile(join(pluginDir, "manifest.json"), JSON.stringify({
    apiVersion: "clash.plugin/v1",
    id: "attested-plugin",
    version: "1.0.0",
    name: "Attested Plugin",
    runtime: { kind: "local", transport: "stdio", entrypoint: "handler.mjs" },
    exports: { cards: [], functions: [] },
    permissions: {},
  }));
  const path = receiptPath(actionsRoot, "attested-plugin");
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(await createReceipt(pluginDir)));

  const first = new ActionsHost({
    serverUrl: "http://127.0.0.1:49321",
    apiKey: "clsh_test",
    runtimeId: "runtime-test",
    actionsRoot,
  });
  try {
    await expect(first.start()).resolves.toMatchObject({ spawned: ["attested-plugin"] });
  } finally {
    await first.stopAll();
  }

  await writeFile(join(pluginDir, "handler.mjs"), "// changed without version bump\nsetInterval(() => {}, 1000);\n");
  const second = new ActionsHost({
    serverUrl: "http://127.0.0.1:49321",
    apiKey: "clsh_test",
    runtimeId: "runtime-test",
    actionsRoot,
  });
  try {
    await expect(second.start()).resolves.toMatchObject({ spawned: [], skipped: ["attested-plugin"] });
    expect(second.listIds()).toEqual([]);
  } finally {
    await second.stopAll();
  }
});
