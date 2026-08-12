import { describe, expect, it } from "vitest";

import * as sharedTypes from "./index.js";
import {
  ExecutablePluginBrokerOperationSchema,
  ExecutablePluginCardRegistrationSchema,
  ExecutablePluginManifestSchema,
  ExecutablePluginModelBindingRegistrationSchema,
  ExecutablePluginProviderRegistrationSchema,
} from "./executable-plugin.js";

const runtime = {
  kind: "local" as const,
  transport: "stdio" as const,
  entrypoint: "dist/stdio.mjs",
};

const contributes = {
  cards: [],
  providers: [],
  modelBindings: [],
  functions: [{ id: "generate", kind: "action" as const }],
  hostTools: ["codex.imagegen" as const],
};

describe("executable plugin contributions contract", () => {
  it("accepts contributes and rejects the removed exports and permissions fields", () => {
    const input = {
      apiVersion: "clash.plugin/v1",
      id: "acme.media",
      version: "1.0.0",
      name: "Acme Media",
      runtime,
      contributes,
    };

    expect(ExecutablePluginManifestSchema.parse(input).contributes).toEqual({
      ...contributes,
      functions: [{ ...contributes.functions[0], operations: ["submit"] }],
      hostTools: ["codex.imagegen"],
    });
    expect(ExecutablePluginManifestSchema.safeParse({
      ...input,
      contributes: undefined,
      exports: contributes,
    }).success).toBe(false);
    expect(ExecutablePluginManifestSchema.safeParse({ ...input, permissions: {} }).success)
      .toBe(false);
  });

  it.each([
    ["cards", { id: "image", kind: "model-card", path: "cards/image.json", legacy: true }],
    ["providers", { id: "acme", kind: "provider", path: "providers/acme.json", legacy: true }],
    ["modelBindings", {
      id: "acme-image",
      kind: "model-provider-binding",
      path: "bindings/acme-image.json",
      legacy: true,
    }],
    ["functions", { id: "generate", kind: "action", handler: "generateImage" }],
  ] as const)("rejects unknown fields inside contributes.%s entries", (key, entry) => {
    expect(ExecutablePluginManifestSchema.safeParse({
      apiVersion: "clash.plugin/v1",
      id: "acme.media",
      version: "1.0.0",
      name: "Acme Media",
      runtime,
      contributes: { [key]: [entry] },
    }).success).toBe(false);
  });

  it("keeps permissions out of activated artifact registrations", () => {
    const provenance = {
      pluginId: "acme.media",
      version: "1.0.0",
      schemaHash: `sha256:${"a".repeat(64)}`,
      runtime,
    };
    const registrations = [
      [ExecutablePluginCardRegistrationSchema, {
        ...provenance,
        document: {
          apiVersion: "clash.card/v1",
          kind: "action-card",
          spec: {
            id: "generate",
            name: "Generate",
            outputType: "image",
            functionExportId: "generate",
          },
        },
      }],
      [ExecutablePluginProviderRegistrationSchema, {
        ...provenance,
        document: {
          apiVersion: "clash.provider/v1",
          kind: "provider",
          spec: {
            id: "acme",
            name: "Acme",
            upstreamId: "acme",
            apiShape: "acme",
            executorExportId: "execute",
            auth: {
              methods: [{
                id: "api-key",
                label: "API key",
                form: [{ kind: "field", key: "apiKey", label: "API key", secret: true }],
              }],
            },
          },
        },
      }],
      [ExecutablePluginModelBindingRegistrationSchema, {
        ...provenance,
        document: {
          apiVersion: "clash.binding/v1",
          kind: "model-provider-binding",
          spec: {
            id: "acme-image",
            modelId: "gpt-image-2",
            providerId: "acme",
            upstreamId: "acme",
            upstreamModel: "image-v1",
            apiShape: "acme",
          },
        },
      }],
    ] as const;

    for (const [schema, registration] of registrations) {
      const parsed = schema.safeParse(registration);
      expect(parsed.success, parsed.success ? "" : parsed.error.message).toBe(true);
      expect(schema.safeParse({ ...registration, permissions: {} }).success).toBe(false);
    }
  });

  it("does not export the removed hosted capability contract", () => {
    expect(sharedTypes).not.toHaveProperty("HostedExecutablePluginCapabilitySchema");
  });

  it("limits dependency operations to SDK store, asset, and declared host-tool shapes", () => {
    for (const operation of [
      { kind: "store.get", key: "apiKey" },
      { kind: "store.put", key: "apiKey", value: "secret", secret: true },
      { kind: "asset.read", asset: {
        assetId: "asset-1",
        uri: "clash-asset://asset-1",
        kind: "image",
      } },
      { kind: "asset.write", slot: "image", assetKind: "image", dataBase64: "AA==" },
      { kind: "asset.upload-slot", slot: "image", assetKind: "image", byteLength: 1 },
      { kind: "codex.image.generate", prompt: "A moon", aspectRatio: "1:1", slot: "image" },
    ]) {
      expect(ExecutablePluginBrokerOperationSchema.safeParse(operation).success).toBe(true);
    }

    expect(ExecutablePluginBrokerOperationSchema.safeParse({
      kind: "credential.handle",
      secretId: "provider:acme",
    }).success).toBe(false);
    expect(ExecutablePluginBrokerOperationSchema.safeParse({
      kind: "network.fetch",
      url: "https://api.example.test",
      credentialHandle: "clash-secret://secret",
    }).success).toBe(false);
  });

  it("removes the obsolete permission schema and diff from the public package", () => {
    expect(sharedTypes).not.toHaveProperty("ExecutablePluginPermissionsSchema");
    expect(sharedTypes).not.toHaveProperty("diffExecutablePluginPermissions");
  });
});
