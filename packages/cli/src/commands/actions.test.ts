import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { access, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as actions from "./actions";

const { customActionSecretHint } = actions;

async function writeDraftPlugin(
  parent: string,
  options: { expectedPrompt?: string; permissions?: Record<string, unknown> } = {},
): Promise<string> {
  const pluginDir = join(parent, "draft-plugin");
  await mkdir(join(pluginDir, "contract-tests"), { recursive: true });
  await writeFile(join(pluginDir, "handler.mjs"), [
    'import { createInterface } from "node:readline";',
    'const lines = createInterface({ input: process.stdin });',
    'lines.on("line", (line) => {',
    '  const message = JSON.parse(line);',
    '  if (message.protocol !== "clash.plugin.invoke/v1") return;',
    '  process.stdout.write(JSON.stringify({',
    '    protocol: "clash.plugin.result/v1", invocationId: message.invocationId,',
    '    status: "completed", outputs: [{ slot: "request", kind: "value", value: {',
    '      prompt: message.input.values.prompt,',
    '    } }],',
    '  }) + "\\n");',
    '});',
  ].join("\n"));
  await writeFile(join(pluginDir, "manifest.json"), JSON.stringify({
    apiVersion: "clash.plugin/v1",
    id: "draft-plugin",
    version: "1.0.0",
    name: "Draft Plugin",
    runtime: { kind: "local", transport: "stdio", entrypoint: "handler.mjs" },
    exports: {
      cards: [],
      functions: [{ id: "project", kind: "provider-projector", handler: "project" }],
    },
    permissions: options.permissions ?? {},
    contractTests: ["contract-tests/project.json"],
  }));
  await writeFile(join(pluginDir, "contract-tests", "project.json"), JSON.stringify({
    apiVersion: "clash.plugin.contract-test/v1",
    id: "project-basic",
    target: { exportId: "project", kind: "provider-projector" },
    input: { values: { prompt: "Turn around" }, references: [] },
    expect: {
      status: "completed",
      outputs: [{
        slot: "request",
        kind: "value",
        value: { prompt: options.expectedPrompt ?? "Turn around" },
      }],
    },
  }));
  return pluginDir;
}

test("local custom action secret hint does not point users to remote vars", () => {
  const hint = customActionSecretHint("local");

  assert.match(hint, /local runtime environment/);
  assert.doesNotMatch(hint, /clash vars/);
});

test("remote worker custom action secret hint does not point to removed local vars CLI", () => {
  assert.match(customActionSecretHint("worker"), /hosted\/remote Settings/);
  assert.match(customActionSecretHint(undefined), /hosted\/remote Settings/);
  assert.doesNotMatch(customActionSecretHint("worker"), /clash vars/);
  assert.doesNotMatch(customActionSecretHint(undefined), /clash vars/);
});

test("action CLI exposes agent-facing validate and activate draft commands", () => {
  const commandNames = actions.actionsCommand.commands.map((command) => command.name());
  assert.ok(commandNames.includes("init-plugin"));
  assert.ok(commandNames.includes("checkout"));
  assert.ok(commandNames.includes("validate"));
  assert.ok(commandNames.includes("activate"));
});

test("registry install can fall back to the local marketplace package endpoint", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const request = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({
      actionId: "codex-imagegen",
      packageId: "clash-codex-imagegen",
      installed: true,
      targetDir: "/tmp/actions/clash-codex-imagegen",
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const result = await actions.tryInstallLocalMarketplaceAction({
    packageId: "clash-codex-imagegen",
    serverUrl: "http://127.0.0.1:49321",
    apiKey: "local-token",
    request,
  });

  assert.deepEqual(result, {
    actionId: "codex-imagegen",
    packageId: "clash-codex-imagegen",
    installed: true,
    targetDir: "/tmp/actions/clash-codex-imagegen",
  });
  assert.equal(calls[0]?.url, "http://127.0.0.1:49321/api/marketplace/actions/clash-codex-imagegen/install");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.equal((calls[0]?.init?.headers as Record<string, string>)?.Authorization, "Bearer local-token");
});

test("plugin draft validation ignores workspace node_modules symlinks", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "clash-plugin-workspace-"));
  const pluginDir = await writeDraftPlugin(workspace);
  const dependencyDir = join(workspace, "shared-types");
  await mkdir(dependencyDir);
  await mkdir(join(pluginDir, "node_modules"));
  await symlink(dependencyDir, join(pluginDir, "node_modules", "@clash-shared-types"));

  const validated = await actions.validateExecutablePluginDraft(pluginDir);

  assert.equal(validated.contractTests.passed, 1);
});

test("agent checks out an attested active plugin into a non-destructive editable draft", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "clash-plugin-checkout-"));
  const sourceDraft = await writeDraftPlugin(workspace);
  const actionsRoot = join(workspace, "actions");
  await actions.activateExecutablePluginDraft({
    pluginDir: sourceDraft,
    root: actionsRoot,
    approvePermissionIncrease: async () => true,
  });
  const checkoutDir = join(workspace, "editable-copy");

  const checkedOut = await actions.checkoutExecutablePluginDraft({
    id: "draft-plugin",
    pluginDir: checkoutDir,
    root: actionsRoot,
  });

  assert.equal(checkedOut.pluginDir, checkoutDir);
  assert.equal(
    JSON.parse(await readFile(join(checkoutDir, "manifest.json"), "utf8")).version,
    "1.0.0",
  );
  assert.match(
    await readFile(join(checkoutDir, "handler.mjs"), "utf8"),
    /clash\.plugin\.result\/v1/,
  );
  await assert.rejects(
    actions.checkoutExecutablePluginDraft({
      id: "draft-plugin",
      pluginDir: checkoutDir,
      root: actionsRoot,
    }),
    /already exists/,
  );

  await writeFile(join(actionsRoot, "draft-plugin", "handler.mjs"), "// unactivated edit\n");
  await assert.rejects(
    actions.checkoutExecutablePluginDraft({
      id: "draft-plugin",
      pluginDir: join(workspace, "unsafe-copy"),
      root: actionsRoot,
    }),
    /differs from its activation receipt/,
  );
});

test("agent can scaffold a contract-tested editable action plugin without hand-writing ABI files", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "clash-plugin-scaffold-"));
  const pluginDir = join(workspace, "caption-helper");

  const created = await actions.scaffoldExecutablePluginDraft({
    pluginDir,
    id: "caption-helper",
    name: "Caption Helper",
    kind: "action",
  });

  assert.equal(created.pluginDir, pluginDir);
  assert.equal(created.contractTests.passed, 1);
  const manifest = JSON.parse(await readFile(join(pluginDir, "manifest.json"), "utf8"));
  // What matters is that the draft declares how it runs and that the declaration is
  // honoured -- `contractTests.passed` above already executed it. The entrypoint's
  // filename is the host's business, so pinning it here would only make a change of
  // build output look like a regression.
  assert.equal(manifest.runtime.kind, "local");
  assert.equal(manifest.runtime.transport, "stdio");
  assert.ok(manifest.runtime.entrypoint, "runtime must name an entrypoint");
  // A TypeScript draft ships source and lets the host compile it, so an edited draft
  // is never validated against a stale bundle.
  assert.equal(manifest.runtime.build.source, "src/stdio.ts");
  assert.ok(
    existsSync(join(pluginDir, "src", "stdio.ts")),
    "scaffold must write the source it declares",
  );
  assert.equal(manifest.exports.cards[0].kind, "action-card");
  assert.equal(manifest.exports.functions[0].kind, "action");
  assert.equal(
    JSON.parse(await readFile(join(pluginDir, "cards", "caption-helper.json"), "utf8")).kind,
    "action-card",
  );

  await assert.rejects(
    actions.scaffoldExecutablePluginDraft({
      pluginDir,
      id: "caption-helper",
      kind: "action",
    }),
    /already exists/,
  );
  assert.equal(JSON.parse(await readFile(join(pluginDir, "manifest.json"), "utf8")).name, "Caption Helper");
});

test("agent can scaffold an editable model Card and provider projector as one plugin", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "clash-projector-scaffold-"));
  const pluginDir = join(workspace, "provider-video");

  const created = await actions.scaffoldExecutablePluginDraft({
    pluginDir,
    id: "provider-video",
    name: "Provider Video",
    kind: "provider-projector",
  });

  assert.equal(created.contractTests.passed, 1);
  const card = JSON.parse(
    await readFile(join(pluginDir, "cards", "provider-video.json"), "utf8"),
  );
  assert.equal(card.kind, "model-card");
  assert.equal(card.spec.providerImplementations[0].projectorExportId, "provider-video");
  assert.equal(card.spec.providerImplementations[0].upstreamModel, "replace-me");
  assert.equal(
    JSON.parse(await readFile(join(pluginDir, "manifest.json"), "utf8"))
      .exports.functions[0].kind,
    "provider-projector",
  );
});

test("downloaded executable plugins are fully validated before any file is installed", () => {
  const validate = (actions as Record<string, unknown>).validateDownloadedActionPackage as
    | ((pkg: unknown) => { format: string; manifest: { id: string } })
    | undefined;
  assert.ok(validate);
  if (!validate) return;

  const card = {
    apiVersion: "clash.card/v1",
    kind: "action-card",
    spec: {
      id: "remove-background",
      name: "Remove Background",
      outputType: "image",
      functionExportId: "remove-background",
    },
  };
  const pkg = {
    id: "first-party-actions",
    manifest: {
      apiVersion: "clash.plugin/v1",
      id: "first-party-actions",
      version: "1.0.0",
      name: "First-party actions",
      runtime: {
        kind: "local",
        transport: "stdio",
        entrypoint: "dist/handler.mjs",
      },
      exports: {
        cards: [{
          id: "remove-background",
          kind: "action-card",
          path: "cards/remove-background.json",
        }],
        functions: [{
          id: "remove-background",
          kind: "action",
          handler: "removeBackground",
        }],
      },
      permissions: {},
      contractTests: ["contract-tests/remove-background.json"],
    },
    files: {
      "cards/remove-background.json": Buffer.from(JSON.stringify(card)).toString("base64"),
      "contract-tests/remove-background.json": Buffer.from(JSON.stringify({
        apiVersion: "clash.plugin.contract-test/v1",
        id: "remove-background-basic",
        target: { exportId: "remove-background", kind: "action" },
        input: { values: { prompt: "Remove it" }, references: [] },
        expect: { status: "completed", outputs: [] },
      })).toString("base64"),
      "dist/handler.mjs": Buffer.from("export {};\n").toString("base64"),
    },
  };

  const validated = validate(pkg);
  assert.equal(validated.format, "executable-plugin");
  assert.equal(validated.manifest.id, "first-party-actions");
  assert.throws(
    () => validate({ ...pkg, files: { ...pkg.files, "dist/handler.mjs": undefined } }),
    /entrypoint/,
  );
  assert.throws(
    () => validate({
      ...pkg,
      files: { ...pkg.files, "contract-tests/remove-background.json": undefined },
    }),
    /contract test/,
  );
  assert.throws(
    () => validate({
      ...pkg,
      files: {
        ...pkg.files,
        "cards/remove-background.json": Buffer.from(JSON.stringify({
          ...card,
          spec: { ...card.spec, id: "wrong-id" },
        })).toString("base64"),
      },
    }),
    /does not match export id/,
  );
});

test("plugin drafts preserve independent Provider and model binding artifacts", () => {
  const provider = {
    apiVersion: "clash.provider/v1",
    kind: "provider",
    spec: {
      id: "hilo-hub",
      name: "MiniMax Hilo Hub",
      upstreamId: "hilo-hub",
      apiShape: "hilo-hub",
      executorExportId: "hilo-hub-execute",
      auth: [],
    },
  };
  const binding = {
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
    },
  };
  const contract = {
    apiVersion: "clash.plugin.contract-test/v1",
    id: "hilo-hub-basic",
    target: { exportId: "hilo-hub-execute", kind: "provider-executor" },
    input: { values: { prompt: "Turn around" }, references: [] },
    expect: { status: "completed", outputs: [] },
  };

  const validated = actions.validateDownloadedActionPackage({
    id: "hilo-hub-media",
    manifest: {
      apiVersion: "clash.plugin/v1",
      id: "hilo-hub-media",
      version: "1.0.0",
      name: "Hilo Hub Media",
      runtime: { kind: "local", transport: "stdio", entrypoint: "stdio.mjs" },
      exports: {
        cards: [],
        providers: [{ id: "hilo-hub", kind: "provider", path: "providers/hilo-hub.json" }],
        modelBindings: [{ id: "hilo-hub-minimax-h3", kind: "model-provider-binding", path: "bindings/minimax-h3.json" }],
        functions: [{ id: "hilo-hub-execute", kind: "provider-executor", handler: "execute" }],
      },
      permissions: {},
      contractTests: ["contract-tests/basic.json"],
    },
    files: {
      "stdio.mjs": Buffer.from("export {};\n").toString("base64"),
      "providers/hilo-hub.json": Buffer.from(JSON.stringify(provider)).toString("base64"),
      "bindings/minimax-h3.json": Buffer.from(JSON.stringify(binding)).toString("base64"),
      "contract-tests/basic.json": Buffer.from(JSON.stringify(contract)).toString("base64"),
    },
  });

  assert.equal(validated.format, "executable-plugin");
  assert.equal(validated.manifest.id, "hilo-hub-media");
});

test("plugin activation is atomic and keeps the previous version for rollback", async () => {
  const activate = (actions as Record<string, unknown>).activateDownloadedActionPackage as
    | ((pkg: unknown, root: string) => Promise<{ targetDir: string; rollbackDir?: string }>)
    | undefined;
  const rollback = (actions as Record<string, unknown>).rollbackDownloadedActionPackage as
    | ((root: string, id: string) => Promise<{ version: string }>)
    | undefined;
  assert.ok(activate);
  assert.ok(rollback);
  if (!activate || !rollback) return;

  const root = await mkdtemp(join(tmpdir(), "clash-plugin-activation-"));
  const makePackage = (version: string) => ({
    id: "atomic-plugin",
    format: "executable-plugin",
    manifest: {
      apiVersion: "clash.plugin/v1",
      id: "atomic-plugin",
      version,
      name: "Atomic Plugin",
      runtime: { kind: "local", transport: "stdio", entrypoint: "handler.mjs" },
      exports: { cards: [], functions: [] },
      permissions: {},
    },
    files: {
      "handler.mjs": Buffer.from(`// ${version}\n`).toString("base64"),
    },
  });

  const first = await activate(makePackage("1.0.0"), root);
  assert.equal(first.rollbackDir, undefined);
  assert.equal(JSON.parse(await readFile(join(first.targetDir, "manifest.json"), "utf8")).version, "1.0.0");
  assert.match(
    JSON.parse(await readFile(join(`${root}.activations`, "atomic-plugin.json"), "utf8")).contentHash,
    /^sha256:[0-9a-f]{64}$/,
  );

  const second = await activate(makePackage("1.1.0"), root);
  assert.ok(second.rollbackDir);
  assert.equal(JSON.parse(await readFile(join(second.targetDir, "manifest.json"), "utf8")).version, "1.1.0");
  assert.equal(JSON.parse(await readFile(join(second.rollbackDir!, "manifest.json"), "utf8")).version, "1.0.0");

  const restored = await rollback(root, "atomic-plugin");
  assert.equal(restored.version, "1.0.0");
  assert.equal(JSON.parse(await readFile(join(first.targetDir, "manifest.json"), "utf8")).version, "1.0.0");
  assert.equal(
    JSON.parse(await readFile(join(`${root}.activations`, "atomic-plugin.json"), "utf8")).version,
    "1.0.0",
  );
});

test("every executable package activation is gated by its declared contracts", async () => {
  const activate = (actions as Record<string, unknown>).activateDownloadedActionPackage as
    | ((pkg: unknown, root: string) => Promise<{ targetDir: string }>)
    | undefined;
  assert.ok(activate);
  if (!activate) return;

  const root = await mkdtemp(join(tmpdir(), "clash-package-contract-gate-"));
  const pkg = {
    id: "gated-plugin",
    manifest: {
      apiVersion: "clash.plugin/v1",
      id: "gated-plugin",
      version: "1.0.0",
      name: "Gated Plugin",
      runtime: { kind: "local", transport: "stdio", entrypoint: "handler.mjs" },
      exports: {
        cards: [],
        functions: [{ id: "project", kind: "provider-projector", handler: "project" }],
      },
      permissions: {},
      contractTests: ["contract-tests/project.json"],
    },
    files: {
      "handler.mjs": Buffer.from([
        'import { createInterface } from "node:readline";',
        'createInterface({ input: process.stdin }).on("line", (line) => {',
        '  const message = JSON.parse(line);',
        '  process.stdout.write(JSON.stringify({ protocol: "clash.plugin.result/v1",',
        '    invocationId: message.invocationId, status: "completed", outputs: [] }) + "\\n");',
        '});',
      ].join("\n")).toString("base64"),
      "contract-tests/project.json": Buffer.from(JSON.stringify({
        apiVersion: "clash.plugin.contract-test/v1",
        id: "project-basic",
        target: { exportId: "project", kind: "provider-projector" },
        input: { values: {}, references: [] },
        expect: {
          status: "completed",
          outputs: [{ slot: "request", kind: "value", value: { impossible: true } }],
        },
      })).toString("base64"),
    },
  };

  await assert.rejects(activate(pkg, root), /result mismatch/);
  await assert.rejects(access(join(root, "gated-plugin")));
});

test("activation refuses to replace executable code without a version bump", async () => {
  const activate = (actions as Record<string, unknown>).activateDownloadedActionPackage as
    | ((pkg: unknown, root: string) => Promise<{ targetDir: string }>)
    | undefined;
  assert.ok(activate);
  if (!activate) return;

  const root = await mkdtemp(join(tmpdir(), "clash-plugin-version-pin-"));
  const makePackage = (handler: string) => ({
    id: "versioned-plugin",
    manifest: {
      apiVersion: "clash.plugin/v1",
      id: "versioned-plugin",
      version: "1.0.0",
      name: "Versioned Plugin",
      runtime: { kind: "local", transport: "stdio", entrypoint: "handler.mjs" },
      exports: { cards: [], functions: [] },
      permissions: {},
    },
    files: { "handler.mjs": Buffer.from(handler).toString("base64") },
  });
  const first = await activate(makePackage("// original\n"), root);

  await assert.rejects(
    activate(makePackage("// changed without bump\n"), root),
    /version 1\.0\.0 is already active.*bump/i,
  );
  assert.equal(await readFile(join(first.targetDir, "handler.mjs"), "utf8"), "// original\n");
});

test("plugin updates surface only permission increases for user confirmation", () => {
  const permissionUpgrade = (actions as Record<string, unknown>).permissionUpgradeForDownloadedPackage as
    | ((pkg: unknown, existingManifest?: unknown) => {
        networkDomains: string[];
        secrets: string[];
        requiresApproval: boolean;
      } | null)
    | undefined;
  assert.ok(permissionUpgrade);
  if (!permissionUpgrade) return;

  const manifest = {
    apiVersion: "clash.plugin/v1",
    id: "permission-plugin",
    version: "2.0.0",
    name: "Permission Plugin",
    runtime: { kind: "local", transport: "stdio", entrypoint: "handler.mjs" },
    exports: { cards: [], functions: [] },
    permissions: {
      network: { domains: ["queue.fal.run", "api.minimax.io"] },
      secrets: ["provider:fal"],
    },
  };
  const pkg = {
    id: "permission-plugin",
    manifest,
    files: { "handler.mjs": Buffer.from("export {};\n").toString("base64") },
  };
  const diff = permissionUpgrade(pkg, {
    ...manifest,
    version: "1.0.0",
    permissions: { network: { domains: ["queue.fal.run"] } },
  });

  assert.deepEqual(diff && {
    networkDomains: diff.networkDomains,
    secrets: diff.secrets,
    requiresApproval: diff.requiresApproval,
  }, {
    networkDomains: ["api.minimax.io"],
    secrets: ["provider:fal"],
    requiresApproval: true,
  });
  assert.equal(permissionUpgrade(pkg, manifest)?.requiresApproval, false);
});

test("agent draft activation runs Bridge contract tests before mutating the active directory", async () => {
  const activateDraft = (actions as Record<string, unknown>).activateExecutablePluginDraft as
    | ((options: {
        pluginDir: string;
        root: string;
        approvePermissionIncrease: () => Promise<boolean>;
      }) => Promise<{ targetDir: string; contractTests: { passed: number } }>)
    | undefined;
  assert.ok(activateDraft);
  if (!activateDraft) return;

  const workspace = await mkdtemp(join(tmpdir(), "clash-agent-draft-"));
  const root = join(workspace, "active");
  const pluginDir = await writeDraftPlugin(workspace, { expectedPrompt: "Wrong result" });

  await assert.rejects(
    activateDraft({
      pluginDir,
      root,
      approvePermissionIncrease: async () => true,
    }),
    /result mismatch/,
  );
  await assert.rejects(access(join(root, "draft-plugin")));
});

test("agent draft activation asks for capability increases and atomically activates an approved draft", async () => {
  const activateDraft = (actions as Record<string, unknown>).activateExecutablePluginDraft as
    | ((options: {
        pluginDir: string;
        root: string;
        approvePermissionIncrease: (diff: { networkDomains: string[] }) => Promise<boolean>;
      }) => Promise<{ targetDir: string; contractTests: { passed: number } }>)
    | undefined;
  assert.ok(activateDraft);
  if (!activateDraft) return;

  const workspace = await mkdtemp(join(tmpdir(), "clash-agent-draft-"));
  const root = join(workspace, "active");
  const pluginDir = await writeDraftPlugin(workspace, {
    permissions: { network: { domains: ["queue.fal.run"] } },
  });
  let requestedDomains: string[] = [];

  await assert.rejects(
    activateDraft({
      pluginDir,
      root,
      approvePermissionIncrease: async (diff) => {
        requestedDomains = diff.networkDomains;
        return false;
      },
    }),
    /not approved/,
  );
  assert.deepEqual(requestedDomains, ["queue.fal.run"]);
  await assert.rejects(access(join(root, "draft-plugin")));

  const activated = await activateDraft({
    pluginDir,
    root,
    approvePermissionIncrease: async () => true,
  });
  assert.equal(activated.contractTests.passed, 1);
  assert.equal(
    JSON.parse(await readFile(join(activated.targetDir, "manifest.json"), "utf8")).version,
    "1.0.0",
  );
});
