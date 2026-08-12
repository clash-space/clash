import { describe, expect, it, vi } from "vitest";

import { defineHostedExecutablePlugin } from "./index";

describe("defineHostedExecutablePlugin", () => {
  it("adapts an HTTP function with host dependencies injected directly", async () => {
    const get = vi.fn(async () => "fal");
    const worker = defineHostedExecutablePlugin({
      render: async (invocation, context) => {
        expect(context).not.toHaveProperty("broker");
        const credential = await context.store.get("provider");
        return [{
          slot: "content",
          kind: "value",
          value: `${invocation.input.values.prompt}:${credential}`,
        }];
      },
    }, { context: { store: { get, put: vi.fn(), remove: vi.fn() } } as never });
    const response = await worker.fetch(new Request("https://plugin.example.com/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        protocol: "clash.plugin.invoke/v1",
        invocationId: "invocation-1",
        taskId: "task-1",
        projectId: "project-1",
        target: {
          pluginId: "acme.media",
          version: "1.2.3",
          exportId: "render",
          schemaHash: `sha256:${"a".repeat(64)}`,
          kind: "action",
        },
        input: { values: { prompt: "hello" }, references: [] },
        actor: { kind: "user", id: "user-1" },
      }),
    }));

    await expect(response.json()).resolves.toEqual({
      protocol: "clash.plugin.result/v1",
      invocationId: "invocation-1",
      status: "completed",
      outputs: [{ slot: "content", kind: "value", value: "hello:fal" }],
    });
    expect(get).toHaveBeenCalledWith("provider");
  });
});
