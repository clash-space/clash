import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import * as actionsLoader from "./actions-loader";

const { ActionsHost } = actionsLoader;

async function attestTestPlugin(
  actionsRoot: string,
  pluginDir: string,
): Promise<void> {
  const createReceipt = (actionsLoader as Record<string, unknown>)
    .createExecutablePluginActivationReceipt as (
    dir: string,
  ) => Promise<Record<string, unknown>>;
  const receiptPath = (actionsLoader as Record<string, unknown>)
    .executablePluginActivationReceiptPath as (
    root: string,
    pluginId: string,
  ) => string;
  const manifest = JSON.parse(
    await import("node:fs/promises").then(({ readFile }) =>
      readFile(join(pluginDir, "manifest.json"), "utf8"),
    ),
  ) as { id: string };
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
    await writeFile(
      join(root, "dist", "handler.mjs"),
      "setInterval(() => {}, 1000);\n",
    );
    await writeFile(
      join(root, "cards", "action.json"),
      JSON.stringify({
        apiVersion: "clash.card/v1",
        kind: "action-card",
        spec: {
          id: cardId,
          name: "Test Action",
          outputType: "image",
          functionExportId: "test-action",
        },
      }),
    );
    await writeFile(
      join(root, "manifest.json"),
      JSON.stringify({
        apiVersion: "clash.plugin/v1",
        id: dirName,
        version: "1.0.0",
        name: "Test Plugin",
        runtime: {
          kind: "local",
          transport: "stdio",
          entrypoint: "dist/handler.mjs",
        },
        contributes: {
          cards: [
            {
              id: "test-action",
              kind: "action-card",
              path: "cards/action.json",
            },
          ],
          functions: [{ id: "test-action", kind: "action" }],
        },
      }),
    );
    if (cardId === "test-action")
      await attestTestPlugin(join(clashHome, "actions"), root);
  };

  await writePlugin("test.valid-plugin", "test-action");
  await writePlugin("invalid-plugin", "wrong-id");
  const host = new ActionsHost({
    serverUrl: "http://127.0.0.1:49321",
    apiKey: "clsh_must_not_reach_new_plugins",
    runtimeId: "runtime-test",
  });

  try {
    const result = await host.start();
    expect(new Set(result.spawned)).toEqual(new Set(["test.valid-plugin"]));
    expect(new Set(result.skipped)).toEqual(new Set(["invalid-plugin"]));
    expect(host.listIds()).toEqual(["test.valid-plugin"]);
  } finally {
    await host.stopAll();
    if (originalClashHome === undefined) delete process.env.CLASH_HOME;
    else process.env.CLASH_HOME = originalClashHome;
  }
});

it("ActionsHost discovers independently exported Providers and model bindings", async () => {
  const clashHome = await mkdtemp(join(tmpdir(), "clash-provider-artifacts-"));
  const actionsRoot = join(clashHome, "actions");
  const root = join(actionsRoot, "hilo.hub-media");
  await mkdir(join(root, "providers"), { recursive: true });
  await mkdir(join(root, "bindings"), { recursive: true });
  await writeFile(join(root, "stdio.mjs"), "setInterval(() => {}, 1000);\n");
  await writeFile(
    join(root, "providers", "hilo-hub.json"),
    JSON.stringify({
      apiVersion: "clash.provider/v1",
      kind: "provider",
      spec: {
        id: "hilo-hub",
        name: "MiniMax Hilo Hub",
        upstreamId: "hilo-hub",
        apiShape: "hilo-hub",
        executorExportId: "hilo-hub-execute",
        auth: {
          methods: [
            {
              id: "sign-in",
              label: "Sign in",
              flow: {
                open: "https://hub.minimax.io/login",
                callback: { type: "scheme", scheme: "minimax-hub" },
                credential: {
                  from: "query",
                  name: "accessToken",
                  storeAs: "accessToken",
                },
              },
            },
          ],
        },
      },
    }),
  );
  await writeFile(
    join(root, "bindings", "minimax-h3.json"),
    JSON.stringify({
      apiVersion: "clash.binding/v1",
      kind: "model-provider-binding",
      spec: {
        id: "hilo-hub-minimax-h3",
        modelId: "minimax-h3",
        providerId: "hilo-hub",
        upstreamId: "hilo-hub",
        upstreamModel: "MiniMax-H3",
        apiShape: "hilo-hub",
        executorExportId: "hilo-hub-execute",
        requiredOAuth: ["hilo-hub"],
      },
    }),
  );
  await writeFile(
    join(root, "manifest.json"),
    JSON.stringify({
      apiVersion: "clash.plugin/v1",
      id: "hilo.hub-media",
      version: "1.0.0",
      name: "Hilo Hub Media",
      runtime: { kind: "local", transport: "stdio", entrypoint: "stdio.mjs" },
      contributes: {
        cards: [],
        providers: [
          { id: "hilo-hub", kind: "provider", path: "providers/hilo-hub.json" },
        ],
        modelBindings: [
          {
            id: "hilo-hub-minimax-h3",
            kind: "model-provider-binding",
            path: "bindings/minimax-h3.json",
          },
        ],
        functions: [{ id: "hilo-hub-execute", kind: "provider-executor" }],
      },
    }),
  );
  await attestTestPlugin(actionsRoot, root);
  const host = new ActionsHost({
    serverUrl: "http://127.0.0.1:49321",
    apiKey: "clsh_test",
    runtimeId: "runtime-test",
    actionsRoot,
  }) as InstanceType<typeof ActionsHost> & {
    listProviders(): Array<{
      pluginId: string;
      document: { spec: { id: string } };
    }>;
    listModelBindings(): Array<{
      pluginId: string;
      document: { spec: { modelId: string } };
    }>;
  };

  try {
    await host.start();
    expect(host.listProviders()).toMatchObject([
      {
        pluginId: "hilo.hub-media",
        document: { spec: { id: "hilo-hub" } },
      },
    ]);
    expect(host.listModelBindings()).toMatchObject([
      {
        pluginId: "hilo.hub-media",
        document: { spec: { modelId: "minimax-h3" } },
      },
    ]);
  } finally {
    await host.stopAll();
  }
});

it("v1 plugin processes cannot inherit Clash or provider credentials", () => {
  const buildEnv = (actionsLoader as Record<string, unknown>)
    .credentialFreePluginEnv as
    | ((manifest: unknown, inherited?: NodeJS.ProcessEnv) => NodeJS.ProcessEnv)
    | undefined;
  expect(buildEnv).toBeDefined();
  if (!buildEnv) return;

  const env = buildEnv(
    { id: "test.safe-plugin", version: "1.0.0" },
    {
      PATH: "/usr/bin",
      LANG: "en_US.UTF-8",
      CLASH_API_KEY: "clsh_secret",
      FAL_KEY: "fal_secret",
      MINIMAX_API_KEY: "minimax_secret",
    },
  );

  expect(env).toMatchObject({
    PATH: "/usr/bin",
    LANG: "en_US.UTF-8",
    CLASH_PLUGIN_ID: "test.safe-plugin",
    CLASH_PLUGIN_VERSION: "1.0.0",
    CLASH_PLUGIN_TRANSPORT: "stdio",
  });
  expect(env.CLASH_API_KEY).toBeUndefined();
  expect(env.FAL_KEY).toBeUndefined();
  expect(env.MINIMAX_API_KEY).toBeUndefined();
  expect(env.ELECTRON_RUN_AS_NODE).toBe("1");
});

it("v1 plugin processes prefer the explicit Node runtime provided by Electron", () => {
  const resolveNode = (actionsLoader as Record<string, unknown>)
    .resolveExecutablePluginNodePath as
    ((inherited?: NodeJS.ProcessEnv, fallback?: string) => string) | undefined;
  expect(resolveNode).toBeDefined();
  if (!resolveNode) return;

  expect(
    resolveNode(
      { CLASH_NODE_EXEC_PATH: "/opt/clash/node" },
      "/Applications/Clash/Electron",
    ),
  ).toBe("/opt/clash/node");
  expect(resolveNode({}, "/Applications/Clash/Electron")).toBe(
    "/Applications/Clash/Electron",
  );
});

it("ActionsHost invokes a supervised Python v1 plugin over host-owned stdio", async () => {
  const originalClashHome = process.env.CLASH_HOME;
  const originalPython = process.env.CLASH_ACTIONS_PYTHON;
  const clashHome = await mkdtemp(join(tmpdir(), "clash-plugin-python-home-"));
  process.env.CLASH_HOME = clashHome;
  process.env.CLASH_ACTIONS_PYTHON = "python3";
  const root = join(clashHome, "actions", "test.python-plugin");
  const trafficPath = join(clashHome, "python-replay.jsonl");
  await writeFile(trafficPath, "", "utf8");
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, "stdio.py"),
    [
      "import json",
      "import os",
      "import sys",
      "for line in sys.stdin:",
      "    line = line.strip()",
      "    if not line:",
      "        continue",
      "    message = json.loads(line)",
      "    if message.get('protocol') != 'clash.plugin.invoke/v1':",
      "        continue",
      "    print(json.dumps({",
      "        'protocol': 'clash.plugin.result/v1',",
      "        'invocationId': message['invocationId'],",
      "        'status': 'completed',",
      "        'outputs': [{'slot': 'wire', 'kind': 'value', 'value': {",
      "            'pythonRuntime': True,",
      "            'pythonInstrumentation': os.environ.get('CLASH_PROVIDER_TRAFFIC_MODE') == 'replay' and 'sitecustomize' in sys.modules,",
      "        }}],",
      "    }), flush=True)",
    ].join("\n"),
  );
  await writeFile(
    join(root, "manifest.json"),
    JSON.stringify({
      apiVersion: "clash.plugin/v1",
      id: "test.python-plugin",
      version: "1.0.0",
      name: "Python Plugin",
      runtime: { kind: "local", transport: "stdio", entrypoint: "stdio.py" },
      contributes: {
        cards: [],
        functions: [{ id: "project", kind: "provider-projector" }],
      },
    }),
  );
  await attestTestPlugin(join(clashHome, "actions"), root);
  const host = new ActionsHost({
    serverUrl: "http://127.0.0.1:49321",
    apiKey: "clsh_legacy_only",
    runtimeId: "runtime-test",
    providerHttpInstrumentation: {
      mode: "replay",
      trafficPath,
      modulePath: join(clashHome, "node-provider-instrumentation.ts"),
    },
  }) as InstanceType<typeof ActionsHost> & {
    resolveBinding(
      pluginId: string,
      exportId: string,
      kind: "provider-projector",
    ): {
      pluginId: string;
      version: string;
      exportId: string;
      schemaHash: string;
    };
    invoke(
      pluginId: string,
      invocation: unknown,
      options?: { timeoutMs?: number },
    ): Promise<any>;
  };

  try {
    await host.start();
    const binding = host.resolveBinding(
      "test.python-plugin",
      "project",
      "provider-projector",
    );
    const result = await host.invoke(
      "test.python-plugin",
      {
        protocol: "clash.plugin.invoke/v1",
        invocationId: "invocation-python-1",
        taskId: "task-1",
        projectId: "project-1",
        target: {
          ...binding,
          kind: "provider-projector",
        },
        input: { values: {}, references: [] },
        actor: { kind: "agent", id: "agent-1" },
      },
      { timeoutMs: 15_000 },
    );
    expect(result).toMatchObject({
      status: "completed",
      outputs: [
        {
          value: { pythonRuntime: true, pythonInstrumentation: true },
        },
      ],
    });
  } finally {
    await host.stopAll();
    if (originalClashHome === undefined) delete process.env.CLASH_HOME;
    else process.env.CLASH_HOME = originalClashHome;
    if (originalPython === undefined) delete process.env.CLASH_ACTIONS_PYTHON;
    else process.env.CLASH_ACTIONS_PYTHON = originalPython;
  }
}, 30_000);

it("contract tests drive Python entrypoints through scoped-store fixtures", async () => {
  const originalPython = process.env.CLASH_ACTIONS_PYTHON;
  process.env.CLASH_ACTIONS_PYTHON = "python3";
  const pluginDir = await mkdtemp(join(tmpdir(), "clash-python-contract-"));
  await mkdir(join(pluginDir, "contract-tests"), { recursive: true });
  await writeFile(
    join(pluginDir, "stdio.py"),
    [
      "import json",
      "import sys",
      "",
      "request_seq = 0",
      "",
      "",
      "def broker(operation):",
      "    global request_seq",
      "    request_seq += 1",
      "    request_id = f'py-broker-{request_seq}'",
      "    print(json.dumps({",
      "        'protocol': 'clash.plugin.broker-request/v1',",
      "        'requestId': request_id,",
      "        'invocationId': CURRENT_INVOCATION,",
      "        'operation': operation,",
      "    }), flush=True)",
      "    for raw in sys.stdin:",
      "        raw = raw.strip()",
      "        if not raw:",
      "            continue",
      "        response = json.loads(raw)",
      "        if response.get('protocol') != 'clash.plugin.broker-response/v1':",
      "            continue",
      "        if response.get('requestId') != request_id:",
      "            continue",
      "        if response.get('status') != 'ok':",
      "            raise RuntimeError(response.get('error', {}).get('message', 'broker error'))",
      "        return response.get('result')",
      "    raise RuntimeError('broker stream closed')",
      "",
      "",
      "for line in sys.stdin:",
      "    line = line.strip()",
      "    if not line:",
      "        continue",
      "    message = json.loads(line)",
      "    if message.get('protocol') != 'clash.plugin.invoke/v1':",
      "        continue",
      "    CURRENT_INVOCATION = message['invocationId']",
      "    state = broker({'kind': 'store.get', 'key': 'apiKey'})",
      "    print(json.dumps({",
      "        'protocol': 'clash.plugin.result/v1',",
      "        'invocationId': message['invocationId'],",
      "        'status': 'completed',",
      "        'outputs': [{'slot': 'media', 'kind': 'value', 'value': {",
      "            'apiKey': state['value'],",
      "            'prompt': message['input']['values'].get('prompt'),",
      "        }}],",
      "    }), flush=True)",
    ].join("\n"),
  );
  await writeFile(
    join(pluginDir, "manifest.json"),
    JSON.stringify({
      apiVersion: "clash.plugin/v1",
      id: "test.py-gateway",
      version: "1.0.0",
      name: "Python Gateway",
      runtime: { kind: "local", transport: "stdio", entrypoint: "stdio.py" },
      contributes: {
        cards: [],
        functions: [{ id: "execute", kind: "provider-executor" }],
      },
      contractTests: ["contract-tests/echo.json"],
    }),
  );
  await writeFile(
    join(pluginDir, "contract-tests", "echo.json"),
    JSON.stringify({
      apiVersion: "clash.plugin.contract-test/v1",
      id: "py-echo",
      target: { exportId: "execute", kind: "provider-executor" },
      context: { projectId: "project-contract" },
      input: { values: { prompt: "A paper moon" }, references: [] },
      brokerFixtures: [
        {
          operation: { kind: "store.get", key: "apiKey" },
          response: { status: "ok", result: { value: "contract-key" } },
        },
      ],
      expect: {
        status: "completed",
        outputs: [
          {
            slot: "media",
            kind: "value",
            value: {
              apiKey: "contract-key",
              prompt: "A paper moon",
            },
          },
        ],
      },
    }),
  );

  try {
    const run = await actionsLoader.runExecutablePluginContractTests(pluginDir);
    expect(run).toEqual({
      passed: 1,
      tests: [{ id: "py-echo", status: "passed" }],
    });
  } finally {
    if (originalPython === undefined) delete process.env.CLASH_ACTIONS_PYTHON;
    else process.env.CLASH_ACTIONS_PYTHON = originalPython;
  }
}, 30_000);

it("contract tests run serve()-based Python plugins with the SDK on PYTHONPATH", async () => {
  const originalPython = process.env.CLASH_ACTIONS_PYTHON;
  process.env.CLASH_ACTIONS_PYTHON = "python3";
  const pluginDir = await mkdtemp(join(tmpdir(), "clash-python-serve-"));
  await mkdir(join(pluginDir, "contract-tests"), { recursive: true });
  await writeFile(
    join(pluginDir, "stdio.py"),
    [
      "from clash_sdk.executable import serve",
      "",
      "",
      "async def execute(invocation, context):",
      "    api_key = await context.store.get('apiKey')",
      "    return [{'slot': 'media', 'kind': 'value', 'value': {",
      "        'apiKey': api_key,",
      "        'prompt': invocation['input']['values'].get('prompt'),",
      "    }}]",
      "",
      "",
      "serve({'execute': {'submit': execute}})",
    ].join("\n"),
  );
  await writeFile(
    join(pluginDir, "manifest.json"),
    JSON.stringify({
      apiVersion: "clash.plugin/v1",
      id: "test.py-serve",
      version: "1.0.0",
      name: "Python Serve Plugin",
      runtime: { kind: "local", transport: "stdio", entrypoint: "stdio.py" },
      contributes: {
        cards: [],
        functions: [{ id: "execute", kind: "provider-executor" }],
      },
      contractTests: ["contract-tests/echo.json"],
    }),
  );
  await writeFile(
    join(pluginDir, "contract-tests", "echo.json"),
    JSON.stringify({
      apiVersion: "clash.plugin.contract-test/v1",
      id: "py-serve-echo",
      target: { exportId: "execute", kind: "provider-executor" },
      context: { projectId: "project-contract" },
      input: { values: { prompt: "A paper moon" }, references: [] },
      brokerFixtures: [
        {
          operation: { kind: "store.get", key: "apiKey" },
          response: { status: "ok", result: { value: "serve-key" } },
        },
      ],
      expect: {
        status: "completed",
        outputs: [
          {
            slot: "media",
            kind: "value",
            value: {
              apiKey: "serve-key",
              prompt: "A paper moon",
            },
          },
        ],
      },
    }),
  );

  try {
    const run = await actionsLoader.runExecutablePluginContractTests(pluginDir);
    expect(run).toEqual({
      passed: 1,
      tests: [{ id: "py-serve-echo", status: "passed" }],
    });
  } finally {
    if (originalPython === undefined) delete process.env.CLASH_ACTIONS_PYTHON;
    else process.env.CLASH_ACTIONS_PYTHON = originalPython;
  }
}, 30_000);

it("ActionsHost refuses executable code changed outside atomic activation", async () => {
  const createReceipt = (actionsLoader as Record<string, unknown>)
    .createExecutablePluginActivationReceipt as
    ((pluginDir: string) => Promise<Record<string, unknown>>) | undefined;
  const receiptPath = (actionsLoader as Record<string, unknown>)
    .executablePluginActivationReceiptPath as
    ((actionsRoot: string, pluginId: string) => string) | undefined;
  expect(createReceipt).toBeDefined();
  expect(receiptPath).toBeDefined();
  if (!createReceipt || !receiptPath) return;

  const clashHome = await mkdtemp(join(tmpdir(), "clash-plugin-attestation-"));
  const actionsRoot = join(clashHome, "actions");
  const pluginDir = join(actionsRoot, "test.attested-plugin");
  await mkdir(pluginDir, { recursive: true });
  await writeFile(
    join(pluginDir, "handler.mjs"),
    "setInterval(() => {}, 1000);\n",
  );
  await writeFile(
    join(pluginDir, "manifest.json"),
    JSON.stringify({
      apiVersion: "clash.plugin/v1",
      id: "test.attested-plugin",
      version: "1.0.0",
      name: "Attested Plugin",
      runtime: { kind: "local", transport: "stdio", entrypoint: "handler.mjs" },
      contributes: {
        cards: [],
        functions: [{ id: "run", kind: "provider-executor" as const }],
      },
    }),
  );
  const path = receiptPath(actionsRoot, "test.attested-plugin");
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(await createReceipt(pluginDir)));

  const first = new ActionsHost({
    serverUrl: "http://127.0.0.1:49321",
    apiKey: "clsh_test",
    runtimeId: "runtime-test",
    actionsRoot,
  });
  try {
    await expect(first.start()).resolves.toMatchObject({
      spawned: ["test.attested-plugin"],
    });
  } finally {
    await first.stopAll();
  }

  await writeFile(
    join(pluginDir, "handler.mjs"),
    "// changed without version bump\nsetInterval(() => {}, 1000);\n",
  );
  const second = new ActionsHost({
    serverUrl: "http://127.0.0.1:49321",
    apiKey: "clsh_test",
    runtimeId: "runtime-test",
    actionsRoot,
  });
  try {
    await expect(second.start()).resolves.toMatchObject({
      spawned: [],
      skipped: ["test.attested-plugin"],
    });
    expect(second.listIds()).toEqual([]);
  } finally {
    await second.stopAll();
  }
});
