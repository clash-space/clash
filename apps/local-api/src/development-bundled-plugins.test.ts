import { existsSync } from "node:fs";
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { expect, it, vi } from "vitest";

import { prepareDevelopmentBundledPlugins } from "./development-bundled-plugins.js";

async function writeDevelopmentPluginFixture(
  root: string,
  workspaceDir: string,
  id: string,
  options: { resources?: string[] } = {},
): Promise<void> {
  const pluginRoot = join(root, "plugins", workspaceDir);
  await mkdir(join(pluginRoot, "src"), { recursive: true });
  await writeFile(
    join(pluginRoot, "manifest.json"),
    JSON.stringify({
      apiVersion: "clash.plugin/v1",
      id,
      version: "0.1.0",
      name: id,
      runtime: {
        kind: "local",
        transport: "stdio",
        entrypoint: "dist/stdio.mjs",
        ...(options.resources ? { resources: options.resources } : {}),
      },
      contributes: { functions: [] },
    }),
  );
  await writeFile(
    join(pluginRoot, "src", "stdio.ts"),
    "export const plugin = { contributes: [], invoke() {} };\n",
  );
}

it("rebuilds a selected first-party immutable module payload without creating an actions install", async () => {
  const root = await mkdtemp(join(tmpdir(), "clash-development-modules-"));
  const actionsRoot = join(root, "profile", "actions");
  await writeDevelopmentPluginFixture(root, "google", "clash.google");
  const buildPlugin = vi.fn(
    async (plugin: {
      id: string;
      pluginRoot: string;
      entrypointPath: string;
    }) => {
      expect(plugin).toMatchObject({
        id: "clash.google",
        pluginRoot: join(root, "plugins", "google"),
        entrypointPath: join(root, "plugins", "google", "dist", "stdio.mjs"),
      });
      await mkdir(join(plugin.pluginRoot, "dist"), { recursive: true });
      await writeFile(
        plugin.entrypointPath,
        "export const plugin = Object.freeze({ contributes: [], invoke() {} });\n",
      );
    },
  );

  await expect(
    prepareDevelopmentBundledPlugins({
      actionsRoot,
      root,
      pluginIds: ["clash.google"],
      buildPlugin,
    }),
  ).resolves.toEqual({ rebuilt: ["clash.google"] });

  expect(buildPlugin).toHaveBeenCalledOnce();
  expect(existsSync(actionsRoot)).toBe(false);
  await expect(
    readFile(join(root, "plugins", "google", "dist", "stdio.mjs"), "utf8"),
  ).resolves.toContain("export const plugin");
});

it("does not overwrite or trust an actions-directory shadow while rebuilding development payloads", async () => {
  const root = await mkdtemp(join(tmpdir(), "clash-development-shadow-"));
  const actionsRoot = join(root, "profile", "actions");
  const shadowManifest = join(actionsRoot, "clash.fal", "manifest.json");
  await writeDevelopmentPluginFixture(root, "fal", "clash.fal");
  await mkdir(join(actionsRoot, "clash.fal"), { recursive: true });
  await writeFile(shadowManifest, "untrusted shadow\n");

  await prepareDevelopmentBundledPlugins({
    actionsRoot,
    root,
    pluginIds: ["clash.fal"],
    buildPlugin: async ({ pluginRoot, entrypointPath }) => {
      await mkdir(join(pluginRoot, "dist"), { recursive: true });
      await writeFile(entrypointPath, "export const plugin = {};\n");
    },
  });

  await expect(readFile(shadowManifest, "utf8")).resolves.toBe(
    "untrusted shadow\n",
  );
});

it("fails before startup when the development build does not produce the declared module payload", async () => {
  const root = await mkdtemp(join(tmpdir(), "clash-development-missing-"));
  await writeDevelopmentPluginFixture(root, "pika", "clash.pika");

  await expect(
    prepareDevelopmentBundledPlugins({
      actionsRoot: join(root, "profile", "actions"),
      root,
      pluginIds: ["clash.pika"],
      buildPlugin: async () => undefined,
    }),
  ).rejects.toThrow(/clash\.pika.*dist\/stdio\.mjs/);
});

it("fails before startup when a package build omits a declared runtime resource", async () => {
  const root = await mkdtemp(join(tmpdir(), "clash-development-resource-"));
  await writeDevelopmentPluginFixture(root, "remotion", "clash.remotion", {
    resources: ["dist/browser-bundle"],
  });

  await expect(
    prepareDevelopmentBundledPlugins({
      actionsRoot: join(root, "profile", "actions"),
      root,
      pluginIds: ["clash.remotion"],
      buildPlugin: async ({ pluginRoot, entrypointPath }) => {
        await mkdir(join(pluginRoot, "dist"), { recursive: true });
        await writeFile(entrypointPath, "export const plugin = {};\n");
      },
    }),
  ).rejects.toThrow(/clash\.remotion.*dist\/browser-bundle/);
});

it("uses each plugin package build so generic post-build resources are produced", async () => {
  const root = await mkdtemp(
    join(tmpdir(), "clash-development-package-build-"),
  );
  const pluginRoot = join(root, "plugins", "remotion");
  await writeDevelopmentPluginFixture(root, "remotion", "clash.remotion", {
    resources: ["dist/browser-bundle"],
  });
  await mkdir(join(pluginRoot, "scripts"), { recursive: true });
  await writeFile(
    join(pluginRoot, "package.json"),
    JSON.stringify({
      name: "fixture-remotion-build",
      private: true,
      type: "module",
      scripts: { build: "node scripts/build.mjs" },
    }),
  );
  await writeFile(
    join(pluginRoot, "scripts", "build.mjs"),
    [
      'import { mkdir, writeFile } from "node:fs/promises";',
      'await mkdir("dist/browser-bundle", { recursive: true });',
      'await writeFile("dist/stdio.mjs", "export const plugin = {};\\n");',
      'await writeFile("dist/browser-bundle/index.html", "<!doctype html>");',
    ].join("\n"),
  );

  await expect(
    prepareDevelopmentBundledPlugins({
      actionsRoot: join(root, "profile", "actions"),
      root,
      pluginIds: ["clash.remotion"],
    }),
  ).resolves.toEqual({ rebuilt: ["clash.remotion"] });
  await expect(
    readFile(join(pluginRoot, "dist", "browser-bundle", "index.html"), "utf8"),
  ).resolves.toBe("<!doctype html>");
});

it("runs a JavaScript package manager and its nested node script with the verified daemon Node", async () => {
  const root = await mkdtemp(join(tmpdir(), "clash-development-node-runtime-"));
  const pluginRoot = join(root, "plugins", "google");
  const runtimeBin = join(root, "verified-runtime", "bin");
  const verifiedNodePath = join(
    runtimeBin,
    process.platform === "win32" ? "node.exe" : "node",
  );
  const packageManagerPath = join(root, "fixture-package-manager.mjs");
  const runtimeRecordPath = join(root, "runtime-record.ndjson");
  await writeDevelopmentPluginFixture(root, "google", "clash.google");
  await mkdir(join(pluginRoot, "scripts"), { recursive: true });
  await mkdir(runtimeBin, { recursive: true });
  await link(process.execPath, verifiedNodePath);
  await writeFile(
    packageManagerPath,
    [
      'import { appendFileSync, realpathSync } from "node:fs";',
      'import { spawnSync } from "node:child_process";',
      'if (process.argv[2] !== "run" || process.argv[3] !== "build") process.exit(64);',
      'appendFileSync(process.env.CLASH_TEST_RUNTIME_RECORD, JSON.stringify({ stage: "package-manager", execPath: realpathSync(process.execPath) }) + "\\n");',
      'const child = spawnSync("node", ["scripts/build.mjs"], { env: process.env, stdio: "inherit" });',
      "process.exit(child.status ?? 1);",
    ].join("\n"),
  );
  await writeFile(
    join(pluginRoot, "scripts", "build.mjs"),
    [
      'import { appendFile, mkdir, realpath, writeFile } from "node:fs/promises";',
      'await appendFile(process.env.CLASH_TEST_RUNTIME_RECORD, JSON.stringify({ stage: "build-script", execPath: await realpath(process.execPath) }) + "\\n");',
      'await mkdir("dist", { recursive: true });',
      'await writeFile("dist/stdio.mjs", "export const plugin = {};\\n");',
    ].join("\n"),
  );

  vi.stubEnv("npm_execpath", packageManagerPath);
  vi.stubEnv("CLASH_NODE_EXEC_PATH", verifiedNodePath);
  vi.stubEnv("CLASH_TEST_RUNTIME_RECORD", runtimeRecordPath);
  vi.stubEnv("PATH", process.env.PATH ?? "");
  try {
    await expect(
      prepareDevelopmentBundledPlugins({
        actionsRoot: join(root, "profile", "actions"),
        root,
        pluginIds: ["clash.google"],
      }),
    ).resolves.toEqual({ rebuilt: ["clash.google"] });

    const verifiedRuntime = await realpath(verifiedNodePath);
    const records = (await readFile(runtimeRecordPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(records).toEqual([
      { stage: "package-manager", execPath: verifiedRuntime },
      { stage: "build-script", execPath: verifiedRuntime },
    ]);
    expect(process.env.PATH?.split(delimiter)).not.toContain(runtimeBin);
  } finally {
    vi.unstubAllEnvs();
  }
});
