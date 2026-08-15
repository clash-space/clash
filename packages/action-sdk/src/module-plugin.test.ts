import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import type { ExecutablePluginInvocation } from "@clash/shared-types/executable-plugin";
import { describe, expect, it } from "vitest";

import {
  assemblePluginModule,
  createExecutorContext,
  defineExecutor,
  servePluginStdio,
} from "./index.js";

function manifestDir(functions: unknown[]): string {
  const dir = mkdtempSync(join(tmpdir(), "module-plugin-"));
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify({
      apiVersion: "clash.plugin/v1",
      id: "test.module",
      version: "0.1.0",
      name: "Module test",
      runtime: {
        kind: "local",
        transport: "stdio",
        entrypoint: "dist/stdio.mjs",
        args: [],
      },
      contributes: { functions },
    }),
  );
  return dir;
}

const invocation: ExecutablePluginInvocation = {
  protocol: "clash.plugin.invoke/v1",
  invocationId: "invocation-1",
  taskId: "task-1",
  projectId: "project-1",
  target: {
    pluginId: "test.module",
    version: "0.1.0",
    exportId: "read-account",
    schemaHash: `sha256:${"0".repeat(64)}`,
    kind: "provider-executor",
  },
  operation: "submit",
  input: { values: {}, references: [] },
  assetInputs: [],
  actor: { kind: "system", id: "test" },
};

describe("plugin module", () => {
  it("invokes with Host-scoped context without exposing a transport lifecycle", async () => {
    const module = assemblePluginModule({
      manifestDir: manifestDir([
        { id: "read-account", kind: "provider-executor" },
      ]),
      contributes: {
        "read-account": defineExecutor({
          submit: async (_input, context) => {
            const token = await context.store.get("accessToken");
            if (!token) throw new Error("Host-scoped token was not available.");
            return {
              status: "completed",
              outputs: [
                {
                  slot: "account",
                  kind: "value",
                  value: { token },
                },
              ],
            };
          },
        }),
      },
    });

    const result = await module.invoke(invocation, {
      store: {
        get: async (key) =>
          key === "accessToken" ? "host-scoped-token" : undefined,
        put: async () => undefined,
        remove: async () => undefined,
      },
    });

    expect("start" in module).toBe(false);
    expect(result).toEqual({
      protocol: "clash.plugin.result/v1",
      invocationId: "invocation-1",
      status: "completed",
      outputs: [
        {
          slot: "account",
          kind: "value",
          value: { token: "host-scoped-token" },
        },
      ],
    });
  });

  it("serves the module result unchanged over stdio", async () => {
    const module = assemblePluginModule({
      manifestDir: manifestDir([
        { id: "read-account", kind: "provider-executor" },
      ]),
      contributes: {
        "read-account": defineExecutor({
          submit: async () => ({
            status: "completed",
            outputs: [
              {
                slot: "answer",
                kind: "value",
                value: { source: "one-module" },
              },
            ],
          }),
        }),
      },
    });
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const written: string[] = [];
    stdout.on("data", (chunk: Buffer) => written.push(chunk.toString("utf8")));

    const served = servePluginStdio(module, { stdin, stdout });
    stdin.end(`${JSON.stringify(invocation)}\n`);
    await served.done;

    expect(JSON.parse(written.join(""))).toEqual({
      protocol: "clash.plugin.result/v1",
      invocationId: "invocation-1",
      status: "completed",
      outputs: [
        {
          slot: "answer",
          kind: "value",
          value: { source: "one-module" },
        },
      ],
    });
  });

  it("builds missing capabilities from the invocation-scoped Host request", async () => {
    const context = createExecutorContext({}, async (operation) => {
      if (operation.kind === "store.get" && operation.key === "accessToken") {
        return { value: "token-for-this-invocation" };
      }
      throw new Error(`Unexpected Host operation: ${operation.kind}`);
    });

    await expect(context.store.get("accessToken")).resolves.toBe(
      "token-for-this-invocation",
    );
  });
});
