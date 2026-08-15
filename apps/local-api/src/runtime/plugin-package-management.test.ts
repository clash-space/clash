import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it } from "vitest";

import {
  activateOrUpdateHostExecutablePluginPackage,
  listHostExecutablePluginPackages,
  readHostExecutablePluginPackage,
  removeHostExecutablePluginPackage,
  rollbackHostExecutablePluginPackage,
  validateHostExecutablePluginPackageContracts,
  type HostExecutablePluginPackage,
} from "./plugin-package.js";

function encoded(value: unknown): string {
  return Buffer.from(`${JSON.stringify(value)}\n`).toString("base64");
}

function actionPackage(
  version: string,
  prefix = "",
): HostExecutablePluginPackage {
  const id = "test.package-manager";
  const cardPath = `cards/${id}.json`;
  const contractPath = `contract-tests/${id}.json`;
  const entrypoint = "handler.mjs";
  return {
    id,
    manifest: {
      apiVersion: "clash.plugin/v1",
      id,
      version,
      name: "Package Manager Fixture",
      runtime: {
        kind: "local",
        transport: "stdio",
        language: "node",
        entrypoint,
      },
      contributes: {
        cards: [{ id, kind: "action-card", path: cardPath }],
        functions: [{ id, kind: "action" }],
      },
      contractTests: [contractPath],
    },
    files: {
      [entrypoint]: Buffer.from(
        [
          'import { createInterface } from "node:readline";',
          'createInterface({ input: process.stdin }).on("line", (line) => {',
          "  const frame = JSON.parse(line);",
          "  process.stdout.write(JSON.stringify({",
          '    protocol: "clash.plugin.result/v1",',
          "    invocationId: frame.invocationId,",
          '    status: "completed",',
          `    outputs: [{ slot: "result", kind: "value", value: { text: ${JSON.stringify(prefix)} + frame.input.values.prompt } }],`,
          '  }) + "\\n");',
          "});",
        ].join("\n"),
      ).toString("base64"),
      [cardPath]: encoded({
        apiVersion: "clash.card/v1",
        kind: "action-card",
        spec: {
          id,
          name: "Package Manager Fixture",
          parameters: [],
          outputType: "text",
          input: {
            requiresPrompt: true,
            inputMode: {},
            promptModalities: ["text"],
          },
          functionExportId: id,
        },
      }),
      [contractPath]: encoded({
        apiVersion: "clash.plugin.contract-test/v1",
        id: `${id}-basic`,
        target: { exportId: id, kind: "action" },
        input: { values: { prompt: "hello" }, references: [] },
        expect: {
          status: "completed",
          outputs: [
            {
              slot: "result",
              kind: "value",
              value: { text: `${prefix}hello` },
            },
          ],
        },
      }),
    },
  };
}

function generatorPackage(version = "1.0.0"): HostExecutablePluginPackage {
  const pkg = actionPackage(version);
  const manifest = pkg.manifest as {
    contributes: {
      cards: unknown[];
      functions: unknown[];
      generators?: unknown[];
    };
  };
  manifest.contributes.generators = [
    {
      id: "test-generator",
      kind: "generator",
      path: "generators/test-generator.json",
    },
  ];
  pkg.files["generators/test-generator.json"] = encoded({
    apiVersion: "clash.generator/v1",
    kind: "generator",
    spec: {
      definitionId: "test-generator",
      stateSchema: { type: "object" },
      editPolicy: "advance-head",
      persistentInputs: [],
      actions: [
        {
          id: "render",
          executorExportId: "test.package-manager",
          parametersSchema: { type: "object" },
          invocationInputs: [],
          outputs: [
            {
              slot: "media",
              assetType: { kind: "media", mediaKind: "image" },
              cardinality: { minItems: 1, maxItems: 1 },
            },
          ],
        },
      ],
    },
  });
  return pkg;
}

it("validates a declared Generator artifact before activation", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "clash-generator-package-"));
  const validation = await validateHostExecutablePluginPackageContracts(
    generatorPackage(),
    join(workspace, "actions"),
  );

  expect(validation).toMatchObject({
    id: "test.package-manager",
    version: "1.0.0",
    generatorDefinitions: [
      {
        pluginId: "test.package-manager",
        definitionId: "test-generator",
        version: "1.0.0",
        actions: [
          {
            id: "render",
            executorExportId: "test.package-manager",
          },
        ],
      },
    ],
  });
  expect(validation.generatorDefinitions?.[0]).not.toHaveProperty("runtime");
  expect(validation.generatorDefinitions?.[0]).not.toHaveProperty("realm");
});

it("reads an activated package with its pinned Generator definitions", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "clash-generator-read-"));
  const actionsRoot = join(workspace, "actions");
  const pkg = generatorPackage();
  await activateOrUpdateHostExecutablePluginPackage(pkg, actionsRoot);

  const checkedOut = (await readHostExecutablePluginPackage(
    actionsRoot,
    pkg.id,
  )) as Awaited<ReturnType<typeof readHostExecutablePluginPackage>> & {
    generatorDefinitions?: Array<Record<string, unknown>>;
  };
  expect(checkedOut.generatorDefinitions).toMatchObject([
    {
      pluginId: "test.package-manager",
      definitionId: "test-generator",
      version: "1.0.0",
    },
  ]);
  expect(checkedOut.generatorDefinitions?.[0]).not.toHaveProperty("runtime");
  expect(checkedOut.generatorDefinitions?.[0]).not.toHaveProperty("realm");
});

it("owns plugin validation, activation, checkout, rollback, listing, and removal", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "clash-plugin-manager-"));
  const actionsRoot = join(workspace, "actions");
  const v1 = actionPackage("1.0.0");
  const validation = await validateHostExecutablePluginPackageContracts(
    v1,
    actionsRoot,
  );
  expect(validation.contractTests?.passed).toBe(1);

  const first = await activateOrUpdateHostExecutablePluginPackage(
    v1,
    actionsRoot,
  );
  expect(first.version).toBe("1.0.0");
  expect(
    (await readHostExecutablePluginPackage(actionsRoot, v1.id)).version,
  ).toBe("1.0.0");
  expect(await listHostExecutablePluginPackages(actionsRoot)).toMatchObject([
    { id: v1.id, version: "1.0.0", drifted: false },
  ]);

  const second = await activateOrUpdateHostExecutablePluginPackage(
    actionPackage("2.0.0", "v2:"),
    actionsRoot,
  );
  expect(second.rollbackDir).toBeTruthy();
  expect(
    (await rollbackHostExecutablePluginPackage(actionsRoot, v1.id)).version,
  ).toBe("1.0.0");

  const removed = await removeHostExecutablePluginPackage(actionsRoot, v1.id);
  expect(removed).toMatchObject({ id: v1.id, removed: true });
  expect(await listHostExecutablePluginPackages(actionsRoot)).toEqual([]);
});
