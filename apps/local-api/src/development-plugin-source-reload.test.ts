import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { expect, it } from "vitest";

import { ActionsHost } from "./runtime/host/lib/actions-loader.js";
import { activateHostExecutablePluginPackage } from "./runtime/plugin-package.js";

const PLUGIN_ID = "test.development-source";

function source(dependencyUrl: string): string {
  return [
    'import { createInterface } from "node:readline";',
    `import { marker } from ${JSON.stringify(dependencyUrl)};`,
    'createInterface({ input: process.stdin, crlfDelay: Infinity }).on("line", (line) => {',
    "  const invocation = JSON.parse(line);",
    "  process.stdout.write(JSON.stringify({",
    '    protocol: "clash.plugin.result/v1",',
    "    invocationId: invocation.invocationId,",
    '    status: "completed",',
    '    outputs: [{ slot: "projection", kind: "value", value: { marker } }],',
    '  }) + "\\n");',
    "});",
    "",
  ].join("\n");
}

async function invokeMarker(
  host: ActionsHost,
  sequence: number,
): Promise<string | undefined> {
  const binding = host.resolveBinding(
    PLUGIN_ID,
    "project",
    "provider-projector",
  );
  const result = await host.invoke(
    PLUGIN_ID,
    {
      protocol: "clash.plugin.invoke/v1",
      invocationId: `source-reload-${sequence}`,
      taskId: "source-reload-task",
      projectId: "source-reload-project",
      target: { ...binding, kind: "provider-projector" },
      input: { values: {}, references: [] },
      actor: { kind: "system", id: "development-source-test" },
    },
    { timeoutMs: 2_000 },
  );
  const output = result.status === "completed" ? result.outputs[0] : undefined;
  const value = output?.kind === "value" ? output.value : undefined;
  return value && typeof value === "object" && !Array.isArray(value)
    ? String((value as Record<string, unknown>).marker)
    : undefined;
}

it("restarts a plugin when one of its workspace dependency sources changes", async () => {
  const root = await mkdtemp(
    join(tmpdir(), "clash-development-source-reload-"),
  );
  const actionsRoot = join(root, "actions");
  const sourceRoot = join(root, "workspace-source");
  const dependencyRoot = join(root, "workspace-dependency");
  const sourceEntrypoint = join(sourceRoot, "stdio.mjs");
  const dependencyEntrypoint = join(dependencyRoot, "marker.mjs");
  await mkdir(sourceRoot, { recursive: true });
  await mkdir(dependencyRoot, { recursive: true });
  await writeFile(dependencyEntrypoint, 'export const marker = "before";\n');
  await writeFile(
    sourceEntrypoint,
    source(pathToFileURL(dependencyEntrypoint).href),
  );

  const manifest = {
    apiVersion: "clash.plugin/v1",
    id: PLUGIN_ID,
    version: "1.0.0",
    name: "Development source reload fixture",
    runtime: {
      kind: "local",
      transport: "stdio",
      entrypoint: "dist/stdio.mjs",
    },
    contributes: {
      cards: [],
      functions: [{ id: "project", kind: "provider-projector" }],
    },
    contractTests: ["contract-tests/project.json"],
  };
  const launcher = `await import(${JSON.stringify(pathToFileURL(sourceEntrypoint).href)});\n`;
  await activateHostExecutablePluginPackage(
    {
      id: PLUGIN_ID,
      manifest,
      files: {
        "dist/stdio.mjs": Buffer.from(launcher).toString("base64"),
        "contract-tests/project.json": Buffer.from(
          JSON.stringify({
            apiVersion: "clash.plugin.contract-test/v1",
            id: "development-source-before",
            target: { exportId: "project", kind: "provider-projector" },
            input: { values: {}, references: [] },
            expect: {
              status: "completed",
              outputs: [
                {
                  slot: "projection",
                  kind: "value",
                  value: { marker: "before" },
                },
              ],
            },
          }),
        ).toString("base64"),
      },
    },
    actionsRoot,
  );

  const host = new ActionsHost({
    actionsRoot,
    developmentPluginWatchRoots: {
      [PLUGIN_ID]: [sourceRoot, dependencyRoot],
    },
  });
  try {
    await host.start();
    await expect(invokeMarker(host, 0)).resolves.toBe("before");

    // The plugin source itself is untouched. A dependency edit is enough to recycle the child so
    // the fresh process imports the new module value.
    await writeFile(dependencyEntrypoint, 'export const marker = "after";\n');
    const deadline = Date.now() + 10_000;
    let sequence = 1;
    let marker: string | undefined;
    while (Date.now() < deadline && marker !== "after") {
      await new Promise((resolve) => setTimeout(resolve, 100));
      try {
        marker = await invokeMarker(host, sequence++);
      } catch {
        // A request made between SIGTERM and the replacement session sees a short, explicit
        // "not running" interval. Keep probing until the source-backed process is ready.
      }
    }
    expect(marker).toBe("after");
  } finally {
    await host.stopAll();
  }
}, 20_000);
