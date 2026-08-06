import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it } from "vitest";

import { ensureBundledFirstPartyMediaPlugin } from "./bundled-plugins";
import * as bundledPlugins from "./bundled-plugins";

it("seeds the first-party plugin once, then leaves the installed copy agent-editable", async () => {
  const root = await mkdtemp(join(tmpdir(), "clash-bundled-plugin-"));
  const source = join(root, "source");
  const actionsRoot = join(root, "actions");
  await mkdir(join(source, "dist"), { recursive: true });
  await mkdir(join(source, "contract-tests"), { recursive: true });
  const manifest = {
    apiVersion: "clash.plugin/v1",
    id: "clash-first-party-media",
    version: "0.1.0",
    name: "First Party Media",
    runtime: { kind: "local", transport: "stdio", entrypoint: "dist/stdio.mjs" },
    exports: {
      cards: [],
      functions: [{ id: "fal-h3", kind: "provider-projector", handler: "projectFalH3" }],
    },
    permissions: {},
    contractTests: ["contract-tests/fal-h3.json"],
  };
  await writeFile(join(source, "manifest.json"), JSON.stringify(manifest));
  await writeFile(join(source, "dist", "stdio.mjs"), [
    'import { createInterface } from "node:readline";',
    'createInterface({ input: process.stdin }).on("line", (line) => {',
    '  const message = JSON.parse(line);',
    '  process.stdout.write(JSON.stringify({ protocol: "clash.plugin.result/v1",',
    '    invocationId: message.invocationId, status: "completed", outputs: [] }) + "\\n");',
    '});',
  ].join("\n"));
  await writeFile(join(source, "contract-tests", "fal-h3.json"), JSON.stringify({
    apiVersion: "clash.plugin.contract-test/v1",
    id: "fal-h3-basic",
    target: { exportId: "fal-h3", kind: "provider-projector" },
    input: { values: {}, references: [] },
    expect: { status: "completed", outputs: [] },
  }));

  await expect(ensureBundledFirstPartyMediaPlugin({
    actionsRoot,
    manifestPath: join(source, "manifest.json"),
    entrypointPath: join(source, "dist", "stdio.mjs"),
  })).resolves.toMatchObject({ installed: true });
  const installedEntrypoint = join(actionsRoot, "clash-first-party-media", "dist", "stdio.mjs");
  expect(await readFile(
    join(actionsRoot, "clash-first-party-media", "contract-tests", "fal-h3.json"),
    "utf8",
  )).toContain("fal-h3-basic");

  await writeFile(installedEntrypoint, "// edited by agent\n");
  await expect(ensureBundledFirstPartyMediaPlugin({
    actionsRoot,
    manifestPath: join(source, "manifest.json"),
    entrypointPath: join(source, "dist", "stdio.mjs"),
  })).resolves.toMatchObject({ installed: false });
  expect(await readFile(installedEntrypoint, "utf8")).toBe("// edited by agent\n");
});

it("installs and recoverably uninstalls Codex ImageGen from the local marketplace", async () => {
  const createMarketplace = (bundledPlugins as Record<string, unknown>)
    .createCodexImagegenMarketplace as
    | ((options: Record<string, unknown>) => any)
    | undefined;
  expect(createMarketplace).toBeTypeOf("function");
  if (!createMarketplace) return;

  const root = await mkdtemp(join(tmpdir(), "clash-codex-imagegen-marketplace-"));
  const source = join(root, "source");
  const actionsRoot = join(root, "actions");
  await mkdir(join(source, "dist"), { recursive: true });
  await mkdir(join(source, "cards"), { recursive: true });
  await mkdir(join(source, "contract-tests"), { recursive: true });
  await writeFile(join(source, "manifest.json"), JSON.stringify({
    apiVersion: "clash.plugin/v1",
    id: "clash-codex-imagegen",
    version: "0.1.0",
    name: "Codex ImageGen",
    runtime: { kind: "local", transport: "stdio", entrypoint: "dist/stdio.mjs" },
    exports: {
      cards: [{ id: "codex-imagegen", kind: "action-card", path: "cards/codex-imagegen.json" }],
      functions: [{ id: "generate-image", kind: "action", handler: "generateImage" }],
    },
    permissions: { assets: ["read", "write"], hostTools: ["codex.imagegen"] },
    contractTests: ["contract-tests/generate-image.json"],
  }));
  await writeFile(join(source, "cards", "codex-imagegen.json"), JSON.stringify({
    apiVersion: "clash.card/v1",
    kind: "action-card",
    spec: {
      id: "codex-imagegen",
      name: "Codex ImageGen",
      outputType: "image",
      functionExportId: "generate-image",
    },
  }));
  await writeFile(join(source, "dist", "stdio.mjs"), [
    'import { createInterface } from "node:readline";',
    'createInterface({ input: process.stdin }).on("line", (line) => {',
    '  const message = JSON.parse(line);',
    '  process.stdout.write(JSON.stringify({ protocol: "clash.plugin.result/v1",',
    '    invocationId: message.invocationId, status: "failed",',
    '    error: { code: "contract-placeholder", message: "placeholder", retryable: false } }) + "\\n");',
    '});',
  ].join("\n"));
  await writeFile(join(source, "contract-tests", "generate-image.json"), JSON.stringify({
    apiVersion: "clash.plugin.contract-test/v1",
    id: "codex-imagegen-basic",
    target: { exportId: "generate-image", kind: "action" },
    input: { values: { prompt: "test" }, references: [] },
    expect: {
      status: "failed",
      error: {
        code: "contract-placeholder",
        message: "placeholder",
        retryable: false,
      },
    },
  }));

  const marketplace = createMarketplace({
    actionsRoot,
    manifestPath: join(source, "manifest.json"),
    entrypointPath: join(source, "dist", "stdio.mjs"),
  });
  expect(marketplace.actions).toEqual([
    expect.objectContaining({
      id: "codex-imagegen",
      packageId: "clash-codex-imagegen",
    }),
  ]);
  await expect(marketplace.install("clash-codex-imagegen")).resolves.toMatchObject({
    actionId: "codex-imagegen",
    installed: true,
  });
  await expect(marketplace.listInstalled()).resolves.toEqual([
    expect.objectContaining({ actionId: "codex-imagegen", runtime: "local" }),
  ]);
  await marketplace.uninstall("codex-imagegen");
  await expect(marketplace.listInstalled()).resolves.toEqual([]);
  expect((await readFile(
    join(actionsRoot, ".trash", "clash-codex-imagegen", "manifest.json"),
    "utf8",
  ))).toContain("clash-codex-imagegen");
});
