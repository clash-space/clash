import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it } from "vitest";

import { ensureBundledPlugin } from "./bundled-plugins";

/**
 * A projector answers over real stdio, from a real installed copy.
 *
 * This used to install `clash.media` and run its `fal-h3` projector. That plugin is gone: the fal
 * chain was dead -- its five projector routes in models.ts had no executor at all -- and the live
 * Providers are clash.google, clash.minimax and the third-party hrhrng.hub, none of which exports a
 * projector. The half of the old test that asserted a fal request body went with the projector it
 * described.
 *
 * What is kept is the half nothing else covers: bytes on a pipe. `provider-plugin-projector.test.ts`
 * drives the same host contract against `vi.fn` stubs, so it passes whether or not a plugin can be
 * installed, started, or understood -- it would not have noticed a process that never answered.
 *
 * The old version reached that through ActionsHost and the IPC server. Both are currently
 * unloadable in this suite for an unrelated reason: the previous external host package resolved to
 * built dist, Vite left it external, and Node then followed this package's alias into
 * `shared-types/src/index.ts`, whose extensionless relative imports it cannot resolve. It reports
 * `ERR_MODULE_NOT_FOUND` for `timeline-field-annotations`, a file that is present and 36 KB.
 * `plugin-action-runtime.e2e.test.ts` covers the host and IPC layers and is blocked by that same
 * bug, so this asserts the wire format directly and stays honest about what it proves.
 *
 * The fixture is written here rather than shipped, because a projector that exists only to be tested
 * should not be installed on a user's machine. It is plain ESM with no SDK import: the subject is
 * the frame, and a bundle step between the assertion and the bytes would hide a mismatch in exactly
 * the field being checked.
 */
const PROJECTOR_PLUGIN_ID = "test.projector-runtime";

const ENTRYPOINT = [
  'import { createInterface } from "node:readline";',
  '',
  'const lines = createInterface({ input: process.stdin });',
  'for await (const line of lines) {',
  '  if (!line.trim()) continue;',
  '  const frame = JSON.parse(line);',
  '  process.stdout.write(JSON.stringify({',
  '    protocol: "clash.plugin.result/v1",',
  '    invocationId: frame.invocationId,',
  '    status: "completed",',
  '    outputs: [{',
  '      slot: "projection",',
  '      kind: "value",',
  '      value: {',
  '        endpoint: "fixture/echo",',
  '        input: { prompt: frame.input.values.prompt },',
  '      },',
  '    }],',
  '  }) + "\\n");',
  '}',
].join("\n");

async function writeProjectorPlugin(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "clash-projector-fixture-"));
  await mkdir(join(dir, "dist"), { recursive: true });
  await mkdir(join(dir, "contract-tests"), { recursive: true });
  await writeFile(join(dir, "dist", "stdio.mjs"), ENTRYPOINT);
  await writeFile(join(dir, "contract-tests", "project.json"), JSON.stringify({
    apiVersion: "clash.plugin.contract-test/v1",
    id: "projector-echoes-its-prompt",
    target: { exportId: "echo-project", kind: "provider-projector" },
    input: { values: { prompt: "contract" }, references: [] },
    expect: {
      status: "completed",
      outputs: [{
        slot: "projection",
        kind: "value",
        value: { endpoint: "fixture/echo", input: { prompt: "contract" } },
      }],
    },
  }));
  await writeFile(join(dir, "manifest.json"), JSON.stringify({
    apiVersion: "clash.plugin/v1",
    id: PROJECTOR_PLUGIN_ID,
    version: "0.1.0",
    name: "Projector runtime fixture",
    runtime: { kind: "local", transport: "stdio", entrypoint: "dist/stdio.mjs", args: [] },
    contributes: { functions: [{ id: "echo-project", kind: "provider-projector" }] },
    contractTests: ["contract-tests/project.json"],
  }));
  return dir;
}

function askPlugin(entrypoint: string, frame: unknown): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entrypoint], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
      const line = out.split("\n").find((candidate) => candidate.trim());
      if (!line) return;
      child.kill();
      try {
        resolve(JSON.parse(line) as Record<string, unknown>);
      } catch (error) {
        reject(error);
      }
    });
    // Named rather than swallowed: a plugin that dies on load used to surface only as a timeout,
    // which says nothing about the syntax error that caused it.
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.on("exit", (code) => {
      if (!out.trim()) reject(new Error(`Plugin exited (${code}) without answering. stderr: ${stderr}`));
    });
    child.stdin.write(`${JSON.stringify(frame)}\n`);
  });
}

it("runs a projector from its installed copy over the stdio ABI", async () => {
  const clashHome = await mkdtemp(join(tmpdir(), "clash-provider-plugin-runtime-"));
  const actionsRoot = join(clashHome, "actions");
  const pluginSource = await writeProjectorPlugin();

  // Through the real installer, which runs the plugin's contract tests as part of seeding. A copy
  // placed by hand would skip the check that the thing about to be spawned actually answers.
  const installed = await ensureBundledPlugin({
    id: PROJECTOR_PLUGIN_ID,
    actionsRoot,
    manifestPath: join(pluginSource, "manifest.json"),
    entrypointPath: join(pluginSource, "dist", "stdio.mjs"),
  });
  expect(installed.installed).toBe(true);

  const answer = await askPlugin(join(installed.targetDir, "dist", "stdio.mjs"), {
    protocol: "clash.plugin.invoke/v1",
    invocationId: "i-runtime-projection",
    taskId: "task-runtime-projection",
    projectId: "project-runtime-projection",
    nodeId: "node-runtime-projection",
    target: {
      pluginId: PROJECTOR_PLUGIN_ID,
      version: "0.1.0",
      schemaHash: `sha256:${"a".repeat(64)}`,
      exportId: "echo-project",
      kind: "provider-projector",
    },
    input: { values: { prompt: "Use Image 1" }, references: [] },
    actor: { kind: "system", id: "local-aigc" },
  });

  // The protocol tag is what the host dispatches on. A frame without it falls through every branch
  // and is dropped in silence, which surfaced once as an unrelated contract timeout minutes later.
  expect(answer.protocol).toBe("clash.plugin.result/v1");
  expect(answer.invocationId).toBe("i-runtime-projection");
  expect(answer.status).toBe("completed");
  expect(answer.outputs).toEqual([{
    slot: "projection",
    kind: "value",
    value: { endpoint: "fixture/echo", input: { prompt: "Use Image 1" } },
  }]);
});
