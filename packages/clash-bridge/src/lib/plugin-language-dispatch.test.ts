import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { runExecutablePluginContractTests } from "./actions-loader";

/**
 * The manifest declares the interpreter; the extension no longer chooses it.
 *
 * Before this, the loader read the entrypoint extension and dispatched on it, so
 * "how is this launched" was a filename convention. These tests pin the separation:
 * the whitelist still guards what the sandbox can launch, while `language` decides
 * which interpreter receives it.
 *
 * The proof is a deliberate mismatch. A `.mjs` entrypoint declared as `python` must
 * be handed to Python -- if the extension were still in charge, Node would run it
 * and the test would pass for the wrong reason.
 */
async function pluginWith(
  runtime: Record<string, unknown>,
  body: string,
  entrypointName: string,
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "clash-lang-dispatch-"));
  await mkdir(join(root, "contract-tests"), { recursive: true });
  await writeFile(join(root, entrypointName), body, "utf8");
  await writeFile(
    join(root, "manifest.json"),
    JSON.stringify({
      apiVersion: "clash.plugin/v1",
      id: "lang-probe",
      version: "1.0.0",
      name: "Language Probe",
      runtime,
      exports: {
        cards: [{ id: "lang-probe", kind: "action-card", path: "cards/lang-probe.json" }],
        functions: [{ id: "lang-probe", kind: "action", handler: "run" }],
      },
      permissions: {},
      contractTests: ["contract-tests/lang-probe.json"],
    }),
    "utf8",
  );
  await mkdir(join(root, "cards"), { recursive: true });
  await writeFile(
    join(root, "cards", "lang-probe.json"),
    JSON.stringify({
      apiVersion: "clash.card/v1",
      kind: "action-card",
      spec: {
        id: "lang-probe",
        name: "Language Probe",
        parameters: [],
        outputType: "text",
        input: { requiresPrompt: true, inputMode: {}, promptModalities: ["text"] },
        functionExportId: "lang-probe",
      },
    }),
    "utf8",
  );
  await writeFile(
    join(root, "contract-tests", "lang-probe.json"),
    JSON.stringify({
      apiVersion: "clash.plugin.contract-test/v1",
      id: "lang-probe-basic",
      target: { exportId: "lang-probe", kind: "action" },
      input: { values: { prompt: "which interpreter" }, references: [] },
      expect: {
        status: "completed",
        outputs: [{ slot: "result", kind: "value", value: { text: "python" } }],
      },
    }),
    "utf8",
  );
  return root;
}

// A Python program that answers with its own language, saved under a .mjs name so
// only the declaration can route it correctly.
const PYTHON_BODY = [
  "import json, sys",
  "for line in sys.stdin:",
  "    line = line.strip()",
  "    if not line:",
  "        continue",
  "    invocation = json.loads(line)",
  "    if invocation.get('protocol') != 'clash.plugin.invoke/v1':",
  "        continue",
  "    sys.stdout.write(json.dumps({",
  "        'protocol': 'clash.plugin.result/v1',",
  "        'invocationId': invocation['invocationId'],",
  "        'status': 'completed',",
  "        'outputs': [{'slot': 'result', 'kind': 'value', 'value': {'text': 'python'}}],",
  "    }) + '\\n')",
  "    sys.stdout.flush()",
].join("\n");

describe("declared interpreter dispatch", () => {
  it("routes by declaration, not by entrypoint extension", async () => {
    const root = await pluginWith(
      {
        kind: "local",
        transport: "stdio",
        language: "python",
        entrypoint: "stdio.mjs",
      },
      PYTHON_BODY,
      "stdio.mjs",
    );

    const run = await runExecutablePluginContractTests(root);
    expect(
      run.tests.map((test) => test.status),
      "a .mjs entrypoint declared as python must reach Python",
    ).toEqual(["passed"]);
  });

  it("still refuses an entrypoint shape the sandbox cannot launch", async () => {
    const root = await pluginWith(
      {
        kind: "local",
        transport: "stdio",
        language: "python",
        entrypoint: "stdio.txt",
      },
      PYTHON_BODY,
      "stdio.txt",
    );
    await expect(runExecutablePluginContractTests(root)).rejects.toThrow(/\.js, \.mjs or \.py/);
  });
});
