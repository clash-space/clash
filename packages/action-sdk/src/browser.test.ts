import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

import type { ExecutablePluginInvocation } from "@clash/shared-types/executable-plugin";

import {
  assemblePluginModule,
  defineAction,
  invokePluginModule,
  type PluginExecutionRealm,
} from "./browser.js";

const invocation: ExecutablePluginInvocation = {
  protocol: "clash.plugin.invoke/v1",
  invocationId: "invocation-1",
  taskId: "run-1",
  projectId: "project-1",
  target: {
    pluginId: "clash.asset-edit",
    version: "1.0.0",
    exportId: "image-editor",
    schemaHash: `sha256:${"a".repeat(64)}`,
    kind: "action",
  },
  operation: "submit",
  input: { values: { rotation: 90 }, references: [] },
  assetInputs: [],
  actor: { kind: "user" },
};

describe("browser-safe PluginModule", () => {
  it("exposes the browser entry to CommonJS-based development loaders", () => {
    const require = createRequire(import.meta.url);

    expect(require.resolve("@clash/action-sdk/browser")).toMatch(
      /action-sdk[/\\]dist[/\\]browser\.js$/u,
    );
  });

  it("runs one action implementation unchanged in local, cloud, and client realms", async () => {
    const module = assemblePluginModule({
      functions: [{ id: "image-editor", kind: "action" }],
      contributes: {
        "image-editor": defineAction({
          async run(received) {
            return {
              status: "completed",
              outputs: [
                {
                  slot: "output",
                  kind: "value",
                  value: received.input.values,
                },
              ],
            };
          },
        }),
      },
    });

    for (const realm of [
      "local",
      "cloud",
      "client",
    ] satisfies PluginExecutionRealm[]) {
      const result = await invokePluginModule({
        realm,
        module,
        invocation: {
          ...invocation,
          invocationId: `${realm}-invocation`,
        },
      });
      expect(result).toMatchObject({
        invocationId: `${realm}-invocation`,
        status: "completed",
        outputs: [{ slot: "output", value: { rotation: 90 } }],
      });
    }
  });
});
