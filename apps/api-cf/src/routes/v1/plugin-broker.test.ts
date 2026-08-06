import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import type { Env } from "../../config";
import { signHostedExecutablePluginCapability } from "../../services/hosted-plugin-capabilities";
import { pluginBrokerRoutes } from "./plugin-broker";

function app() {
  const instance = new Hono<{ Bindings: Env }>();
  instance.route("/api/v1/plugin-broker", pluginBrokerRoutes);
  return instance;
}

async function token() {
  const now = Math.floor(Date.now() / 1000);
  return signHostedExecutablePluginCapability({
    protocol: "clash.plugin.hosted-capability/v1",
    capabilityId: "capability-1",
    issuedAt: now,
    expiresAt: now + 900,
    endpoint: "https://plugin.example.com/run",
    ownerUserId: "user-1",
    invocation: {
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
      actor: { kind: "user", id: "user-1" },
    },
    permissions: {
      network: { domains: [] },
      secrets: ["provider:fal"],
      assets: [],
      filesystem: { read: [], write: [] },
      externalWrites: false,
    },
  }, "capability-key");
}

describe("POST /api/v1/plugin-broker", () => {
  it("requires a signed invocation capability", async () => {
    const response = await app().request("/api/v1/plugin-broker", { method: "POST" }, {} as Env);
    expect(response.status).toBe(401);
  });

  it("returns an opaque credential handle and persists a secret-free audit row", async () => {
    const run = vi.fn().mockResolvedValue({});
    const bind = vi.fn().mockReturnValue({ run });
    const prepare = vi.fn().mockReturnValue({ bind });
    const env = {
      PLUGIN_CAPABILITY_KEY: "capability-key",
      DB: { prepare } as unknown as D1Database,
    } as Env;
    const response = await app().request("/api/v1/plugin-broker", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-clash-plugin-capability": await token(),
      },
      body: JSON.stringify({
        protocol: "clash.plugin.broker-request/v1",
        requestId: "request-1",
        invocationId: "invocation-1",
        operation: { kind: "credential.handle", secretId: "provider:fal" },
      }),
    }, env);

    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body).toMatchObject({
      protocol: "clash.plugin.broker-response/v1",
      requestId: "request-1",
      status: "ok",
      result: { providerId: "fal", secretId: "provider:fal" },
    });
    expect(body.result.handle).toMatch(/^clash-secret:\/\//);
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO plugin_broker_audit"));
    expect(JSON.stringify(bind.mock.calls)).not.toContain("capability-key");
  });
});
