import { describe, expect, it } from "vitest";

import {
  signHostedCredentialCapability,
  signHostedExecutablePluginCapability,
  verifyHostedCredentialCapability,
  verifyHostedExecutablePluginCapability,
} from "./hosted-plugin-capabilities";

const capability = {
  protocol: "clash.plugin.hosted-capability/v1" as const,
  capabilityId: "capability-1",
  issuedAt: 1_785_840_000,
  expiresAt: 1_785_840_900,
  endpoint: "https://plugin.example.com/run",
  ownerUserId: "user-1",
  invocation: {
    invocationId: "invocation-1",
    taskId: "task-1",
    projectId: "project-1",
    nodeId: "node-1",
    target: {
      pluginId: "acme.media",
      version: "1.2.3",
      exportId: "render",
      schemaHash: `sha256:${"a".repeat(64)}` as const,
      kind: "action" as const,
    },
    actor: { kind: "user" as const, id: "user-1" },
  },
  permissions: {
    network: { domains: ["api.example.com"] },
    secrets: ["provider:fal"],
    assets: ["read" as const],
    hostTools: [],
    filesystem: { read: [], write: [] },
    externalWrites: false,
  },
};

describe("hosted executable-plugin capabilities", () => {
  it("round-trips a signed capability and rejects tampering or expiry", async () => {
    const token = await signHostedExecutablePluginCapability(capability, "signing-key");
    await expect(verifyHostedExecutablePluginCapability(token, "signing-key", {
      nowSeconds: capability.issuedAt + 30,
    })).resolves.toEqual(capability);

    const [payload, signature] = token.split(".");
    const tampered = `${payload.slice(0, -1)}${payload.endsWith("a") ? "b" : "a"}.${signature}`;
    await expect(verifyHostedExecutablePluginCapability(tampered, "signing-key", {
      nowSeconds: capability.issuedAt + 30,
    })).rejects.toThrow("signature");
    await expect(verifyHostedExecutablePluginCapability(token, "signing-key", {
      nowSeconds: capability.expiresAt,
    })).rejects.toThrow("expired");
  });

  it("binds opaque credential handles to one invocation and parent capability", async () => {
    const token = await signHostedCredentialCapability({
      protocol: "clash.plugin.credential-capability/v1",
      capabilityId: "credential-1",
      parentCapabilityId: "capability-1",
      invocationId: "invocation-1",
      pluginId: "acme.media",
      secretId: "provider:fal",
      issuedAt: capability.issuedAt,
      expiresAt: capability.expiresAt,
    }, "signing-key");
    expect(token).toMatch(/^clash-secret:\/\//);
    await expect(verifyHostedCredentialCapability(token, "signing-key", {
      nowSeconds: capability.issuedAt + 1,
    })).resolves.toMatchObject({
      parentCapabilityId: "capability-1",
      invocationId: "invocation-1",
      secretId: "provider:fal",
    });
  });
});
