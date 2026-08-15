import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import type { ExecutablePluginInvocation } from "@clash/shared-types/executable-plugin";

import {
  assemblePluginModule,
  defineAction,
  defineActionExecutor,
} from "./assemble.js";

async function manifestDir(operations: string[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "clash-action-executor-"));
  await writeFile(
    join(dir, "manifest.json"),
    JSON.stringify({
      id: "clash.test-generator",
      contributes: {
        functions: [{ id: "render", kind: "action", operations }],
      },
    }),
  );
  return dir;
}

const invocation: ExecutablePluginInvocation = {
  protocol: "clash.plugin.invoke/v1",
  invocationId: "invocation-1",
  taskId: "run-1",
  projectId: "project-1",
  target: {
    pluginId: "clash.test-generator",
    version: "1.0.0",
    exportId: "render",
    schemaHash: `sha256:${"a".repeat(64)}`,
    kind: "action",
  },
  input: { values: {}, references: [] },
  assetInputs: [],
  actor: { kind: "user" },
  operation: "submit",
};

describe("async Generator Action executors", () => {
  it("uses one action export for durable submit and poll without changing Plugin ABI", async () => {
    const module = assemblePluginModule({
      manifestDir: await manifestDir(["submit", "poll"]),
      contributes: {
        render: defineActionExecutor({
          async submit() {
            return {
              status: "accepted",
              pollState: { upstreamTaskId: "vendor-1" },
            };
          },
          async poll(received) {
            expect(received.pollState).toEqual({
              upstreamTaskId: "vendor-1",
            });
            return {
              status: "completed",
              outputs: [{ slot: "video", kind: "value", value: "finished" }],
            };
          },
        }),
      },
    });

    await expect(module.invoke(invocation)).resolves.toMatchObject({
      status: "accepted",
      pollState: { upstreamTaskId: "vendor-1" },
    });
    await expect(
      module.invoke({
        ...invocation,
        invocationId: "invocation-2",
        operation: "poll",
        pollState: { upstreamTaskId: "vendor-1" },
      }),
    ).resolves.toMatchObject({
      status: "completed",
      outputs: [{ slot: "video", kind: "value", value: "finished" }],
    });
  });

  it("rejects a legacy run-only Action that declares a durable poll operation", async () => {
    const dir = await manifestDir(["submit", "poll"]);
    expect(() =>
      assemblePluginModule({
        manifestDir: dir,
        contributes: {
          render: defineAction({
            async run() {
              return { status: "completed", outputs: [] };
            },
          }),
        },
      }),
    ).toThrow(/run-only Action.*poll/i);
  });

  it("fails assembly when an async Action declares poll but implements no poll", async () => {
    const dir = await manifestDir(["submit", "poll"]);
    expect(() =>
      assemblePluginModule({
        manifestDir: dir,
        contributes: {
          render: defineActionExecutor({
            async submit() {
              return { status: "completed", outputs: [] };
            },
          }),
        },
      }),
    ).toThrow(/render.*poll/i);
  });
});
