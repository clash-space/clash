import { describe, expect, it, vi } from "vitest";

import { defineHostedExecutablePlugin } from "./index";

describe("defineHostedExecutablePlugin", () => {
  it("adapts an HTTP function to the shared invocation ABI and capability broker", async () => {
    const brokerFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      return Response.json({
        protocol: "clash.plugin.broker-response/v1",
        requestId: request.requestId,
        status: "ok",
        result: { handle: "clash-secret://opaque", providerId: "fal" },
      });
    });
    const worker = defineHostedExecutablePlugin({
      render: async (invocation, context) => {
        const credential = await context.broker({
          kind: "credential.handle",
          secretId: "provider:fal",
        });
        return [{
          slot: "content",
          kind: "value",
          value: `${invocation.input.values.prompt}:${(credential as any).providerId}`,
        }];
      },
    }, { fetch: brokerFetch as typeof fetch });
    const response = await worker.fetch(new Request("https://plugin.example.com/run", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-clash-plugin-broker": "https://api.example.com/api/v1/plugin-broker",
        "x-clash-plugin-capability": "signed-capability",
      },
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
    expect(brokerFetch).toHaveBeenCalledWith(
      "https://api.example.com/api/v1/plugin-broker",
      expect.objectContaining({ method: "POST" }),
    );
    const [, init] = brokerFetch.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("x-clash-plugin-capability")).toBe("signed-capability");
  });
});
