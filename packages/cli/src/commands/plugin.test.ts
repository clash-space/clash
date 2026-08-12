import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  activateDownloadedActionPackage,
  checkoutExecutablePluginDraft,
  customActionSecretHint,
  pluginCommand,
  rollbackDownloadedActionPackage,
  scaffoldExecutablePluginDraft,
  tryInstallLocalMarketplaceAction,
  validateDownloadedActionPackage,
} from "./plugin";

function executablePackage(version = "1.0.0") {
  return {
    id: "test.plugin",
    manifest: {
      apiVersion: "clash.plugin/v1",
      id: "test.plugin",
      version,
      name: "Test Plugin",
      runtime: {
        kind: "local",
        transport: "stdio",
        language: "node",
        entrypoint: "handler.mjs",
      },
      contributes: { cards: [], functions: [] },
      contractTests: [],
    },
    files: {
      "handler.mjs": Buffer.from("export {};\n").toString("base64"),
    },
  };
}

test("custom action hints describe the supported credential surfaces", () => {
  assert.match(customActionSecretHint("local"), /local runtime environment/);
  assert.match(customActionSecretHint("worker"), /hosted\/remote Settings/);
});

test("plugin CLI exposes draft and lifecycle commands", () => {
  const commandNames = pluginCommand.commands.map((command) => command.name());
  for (const name of [
    "create",
    "checkout",
    "validate",
    "activate",
    "rollback",
  ]) {
    assert.ok(commandNames.includes(name), `missing plugin ${name}`);
  }
});

test("registry install can fall back to the local marketplace endpoint", async () => {
  const calls: string[] = [];
  const result = await tryInstallLocalMarketplaceAction({
    packageId: "clash.codex-imagegen",
    serverUrl: "http://127.0.0.1:49321",
    apiKey: "local-token",
    request: async (input) => {
      calls.push(String(input));
      return new Response(
        JSON.stringify({
          actionId: "codex-imagegen",
          packageId: "clash.codex-imagegen",
          installed: true,
          targetDir: "/tmp/actions/clash.codex-imagegen",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });
  assert.equal(
    calls[0],
    "http://127.0.0.1:49321/api/marketplace/actions/clash.codex-imagegen/install",
  );
  assert.equal(result?.installed, true);
});

test("downloaded executable packages are validated before reaching the host", () => {
  const validated = validateDownloadedActionPackage(executablePackage());
  assert.equal(validated.format, "executable-plugin");
  assert.equal(validated.id, "test.plugin");
  assert.throws(
    () =>
      validateDownloadedActionPackage({ ...executablePackage(), files: {} }),
    /entrypoint .* is missing/i,
  );
});

test("plugin lifecycle is a local-api client and never writes daemon storage", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({
      url,
      method,
      ...(typeof init?.body === "string"
        ? { body: JSON.parse(init.body) }
        : {}),
    });
    if (url.endsWith("/api/v1/local/plugins/test.plugin/package")) {
      return Response.json({ ...executablePackage(), version: "1.0.0" });
    }
    if (url.endsWith("/rollback")) {
      return Response.json({
        targetDir: "/host/actions/test.plugin",
        version: "0.9.0",
      });
    }
    return Response.json({
      id: "test.plugin",
      version: "1.0.0",
      targetDir: "/host/actions/test.plugin",
      contractTests: { passed: 0 },
    });
  };
  process.env.CLASH_API_URL = "http://127.0.0.1:49321";
  try {
    const activated =
      await activateDownloadedActionPackage(executablePackage());
    assert.equal(activated.targetDir, "/host/actions/test.plugin");

    const workspace = await mkdtemp(join(tmpdir(), "clash-plugin-client-"));
    const checkout = await checkoutExecutablePluginDraft({
      id: "test.plugin",
      pluginDir: join(workspace, "draft"),
    });
    assert.equal(checkout.version, "1.0.0");
    assert.equal(
      JSON.parse(
        await readFile(join(checkout.pluginDir, "manifest.json"), "utf8"),
      ).id,
      "test.plugin",
    );
    await rollbackDownloadedActionPackage("test.plugin");

    assert.deepEqual(
      calls.map(({ url, method }) => [new URL(url).pathname, method]),
      [
        ["/api/v1/local/plugins/activate", "POST"],
        ["/api/v1/local/plugins/test.plugin/package", "GET"],
        ["/api/v1/local/plugins/test.plugin/rollback", "POST"],
      ],
    );
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.CLASH_API_URL;
  }
});

test("plugin scaffold asks local-api to validate the generated package", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      id: "test.caption-helper",
      version: "0.1.0",
      contractTests: { passed: 1 },
    });
  process.env.CLASH_API_URL = "http://127.0.0.1:49321";
  try {
    const workspace = await mkdtemp(join(tmpdir(), "clash-plugin-scaffold-"));
    const created = await scaffoldExecutablePluginDraft({
      pluginDir: join(workspace, "caption-helper"),
      id: "test.caption-helper",
      kind: "action",
    });
    assert.equal(created.contractTests.passed, 1);
    const manifest = JSON.parse(
      await readFile(created.manifestPath, "utf8"),
    ) as Record<string, unknown>;
    assert.ok(manifest.contributes);
    assert.equal("exports" in manifest, false);
    assert.equal("permissions" in manifest, false);
    const guidance = await readFile(
      join(created.pluginDir, "AGENTS.md"),
      "utf8",
    );
    assert.match(guidance, /contributes/);
    assert.match(guidance, /context\.store/);
    assert.doesNotMatch(
      guidance,
      /permissions|network\.fetch|credential\.handle/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.CLASH_API_URL;
  }
});
