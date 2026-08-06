import { describe, expect, it } from "vitest";

import * as sharedTypes from "./index";

describe("agent-editable executable plugin contract", () => {
  it("defines host-controlled form, dialog, and workspace Action presentations", () => {
    const schema = (sharedTypes as Record<string, unknown>).ExecutableActionCardSchema as
      | { parse(value: unknown): any; safeParse(value: unknown): { success: boolean } }
      | undefined;
    expect(schema).toBeDefined();
    if (!schema) return;
    const base = {
      id: "custom-image",
      name: "Custom Image",
      outputType: "image",
      functionExportId: "generate-image",
    };

    expect(schema.parse(base).presentation).toEqual({ type: "form" });
    expect(schema.parse({
      ...base,
      presentation: { type: "dialog", size: "lg", title: "Configure Custom Image" },
    }).presentation).toEqual({ type: "dialog", size: "lg", title: "Configure Custom Image" });
    expect(schema.parse({
      ...base,
      presentation: { type: "workspace", resourceUri: "ui://acme/custom-image" },
    }).presentation).toEqual({ type: "workspace", resourceUri: "ui://acme/custom-image" });
    expect(schema.safeParse({
      ...base,
      presentation: { type: "workspace", resourceUri: "https://arbitrary.example/app" },
    }).success).toBe(false);
  });

  it("rejects malformed Action Card parameter contracts before activation", () => {
    const schema = (sharedTypes as Record<string, unknown>).ExecutableActionCardSchema as
      | { safeParse(value: unknown): { success: boolean } }
      | undefined;
    expect(schema).toBeDefined();
    if (!schema) return;
    const base = {
      id: "custom-image",
      name: "Custom Image",
      outputType: "image",
      functionExportId: "generate-image",
    };

    expect(schema.safeParse({
      ...base,
      parameters: [
        { id: "quality", label: "Quality", type: "text" },
        { id: "quality", label: "Duplicate", type: "text" },
      ],
    }).success).toBe(false);
    expect(schema.safeParse({
      ...base,
      parameters: [{
        id: "quality",
        label: "Quality",
        type: "select",
        options: [{ label: "High", value: "high" }],
        defaultValue: "draft",
      }],
    }).success).toBe(false);
    expect(schema.safeParse({
      ...base,
      constraints: [{ type: "required", field: "modelParams.undeclared" }],
    }).success).toBe(false);
  });

  it("represents activated plugin Cards with immutable package provenance", () => {
    const schema = (sharedTypes as Record<string, unknown>).ExecutablePluginCardRegistrationSchema as
      | { parse(value: unknown): any }
      | undefined;
    expect(schema).toBeDefined();
    if (!schema) return;

    const registration = schema.parse({
      pluginId: "caption-helper",
      version: "1.2.3",
      schemaHash: `sha256:${"a".repeat(64)}`,
      runtime: { kind: "local", transport: "stdio", entrypoint: "handler.mjs" },
      permissions: {},
      document: {
        apiVersion: "clash.card/v1",
        kind: "action-card",
        spec: {
          id: "caption-helper",
          name: "Caption Helper",
          outputType: "text",
          functionExportId: "caption-helper",
        },
      },
    });

    expect(registration.document.spec.id).toBe("caption-helper");
    expect(() => schema.parse({ ...registration, version: "latest" })).toThrow();
  });

  it("composes activated plugin model Cards over built-ins and binds owning projectors", () => {
    const compose = (sharedTypes as Record<string, unknown>).composeExecutablePluginModelCards as
      | ((base: any[], registrations: any[]) => any[])
      | undefined;
    expect(compose).toBeDefined();
    if (!compose) return;

    const base = sharedTypes.MODEL_CARDS.find((card) => card.id === "minimax-h3")!;
    const registration = {
      pluginId: "agent-media",
      version: "2.0.0",
      schemaHash: `sha256:${"b".repeat(64)}`,
      runtime: { kind: "local", transport: "stdio", entrypoint: "handler.mjs" },
      permissions: {},
      document: {
        apiVersion: "clash.card/v1",
        kind: "model-card",
        spec: {
          ...base,
          name: "Agent-edited H3",
          providerImplementations: [{
            providerId: "fal",
            upstreamId: "fal",
            upstreamModel: "minimax/h3/reference-to-video",
            apiShape: "fal",
            projectorExportId: "fal-h3",
          }],
        },
      },
    };

    const composed = compose([base], [registration]);
    expect(composed).toHaveLength(1);
    expect(composed[0].name).toBe("Agent-edited H3");
    expect(composed[0].providerImplementations[0].projectorPluginId).toBe("agent-media");
    expect(() => compose([base], [
      registration,
      { ...registration, pluginId: "another-plugin" },
    ])).toThrow(/both export model Card minimax-h3/);
  });

  it("parses a local stdio plugin that exports declarative cards and functions", () => {
    const schema = (sharedTypes as Record<string, unknown>).ExecutablePluginManifestSchema as
      | { parse(value: unknown): any; safeParse(value: unknown): { success: boolean } }
      | undefined;
    expect(schema).toBeDefined();
    if (!schema) return;

    const manifest = schema.parse({
      apiVersion: "clash.plugin/v1",
      id: "minimax-fal",
      version: "1.2.0",
      name: "MiniMax on fal",
      runtime: {
        kind: "local",
        transport: "stdio",
        entrypoint: "dist/handler.mjs",
      },
      exports: {
        cards: [
          { id: "minimax-h3", kind: "model-card", path: "cards/minimax-h3.json" },
          { id: "music-generate", kind: "action-card", path: "cards/music-generate.json" },
        ],
        functions: [
          { id: "fal-h3", kind: "provider-projector", handler: "projectFalH3" },
          { id: "music-generate", kind: "action", handler: "generateMusic" },
        ],
      },
      permissions: {
        network: { domains: ["queue.fal.run"] },
        secrets: ["provider:fal"],
        assets: ["read", "write"],
      },
      contractTests: ["contract-tests/h3.json"],
    });

    expect(manifest.runtime).toEqual({
      kind: "local",
      transport: "stdio",
      entrypoint: "dist/handler.mjs",
      args: [],
    });
    expect(manifest.permissions).toMatchObject({
      network: { domains: ["queue.fal.run"] },
      filesystem: { read: [], write: [] },
      externalWrites: false,
    });
    expect(manifest.exports.cards).toHaveLength(2);
    expect(schema.safeParse({ ...manifest, runtime: { ...manifest.runtime, entrypoint: "../escape.mjs" } }).success)
      .toBe(false);
  });

  it("reports every newly requested capability before an agent may activate an update", () => {
    const diffPermissions = (sharedTypes as Record<string, unknown>)
      .diffExecutablePluginPermissions as
      | ((before: unknown, after: unknown) => {
          networkDomains: string[];
          secrets: string[];
          assetCapabilities: string[];
          hostTools: string[];
          filesystem: { read: string[]; write: string[] };
          externalWrites: boolean;
          requiresApproval: boolean;
        })
      | undefined;
    expect(diffPermissions).toBeDefined();
    if (!diffPermissions) return;

    const before = {
      network: { domains: ["queue.fal.run"] },
      secrets: ["provider:minimax"],
      assets: ["read"],
      hostTools: [],
      filesystem: { read: ["workspace/assets"], write: [] },
      externalWrites: false,
    };
    const after = {
      network: { domains: ["queue.fal.run", "api.minimax.io"] },
      secrets: ["provider:minimax", "provider:fal"],
      assets: ["read", "write"],
      hostTools: ["codex.imagegen"],
      filesystem: {
        read: ["workspace/assets", "workspace/references"],
        write: ["workspace/generated"],
      },
      externalWrites: true,
    };

    expect(diffPermissions(before, after)).toEqual({
      networkDomains: ["api.minimax.io"],
      secrets: ["provider:fal"],
      assetCapabilities: ["write"],
      hostTools: ["codex.imagegen"],
      filesystem: {
        read: ["workspace/references"],
        write: ["workspace/generated"],
      },
      externalWrites: true,
      requiresApproval: true,
    });

    expect(diffPermissions(after, before)).toEqual({
      networkDomains: [],
      secrets: [],
      assetCapabilities: [],
      hostTools: [],
      filesystem: { read: [], write: [] },
      externalWrites: false,
      requiresApproval: false,
    });
  });

  it("applies the same broker capability policy in local and hosted kernels", () => {
    const permissionError = (sharedTypes as Record<string, unknown>)
      .executablePluginBrokerPermissionError as
      | ((manifest: unknown, request: unknown) => string | null)
      | undefined;
    expect(permissionError).toBeDefined();
    if (!permissionError) return;

    const manifest = {
      apiVersion: "clash.plugin/v1",
      id: "acme.media",
      version: "1.2.3",
      name: "Acme Media",
      runtime: { kind: "hosted", transport: "http", endpoint: "https://plugin.example.com/run" },
      exports: { cards: [], functions: [{ id: "render", kind: "action", handler: "render" }] },
      permissions: {
        network: { domains: ["api.example.com"] },
        secrets: ["provider:fal"],
        assets: ["read"],
        filesystem: { read: [], write: [] },
        externalWrites: false,
      },
    };
    const baseRequest = {
      protocol: "clash.plugin.broker-request/v1",
      requestId: "request-1",
      invocationId: "invocation-1",
    };

    expect(permissionError(manifest, {
      ...baseRequest,
      operation: { kind: "network.fetch", url: "https://sub.api.example.com/status", method: "GET", headers: {} },
    })).toBeNull();
    expect(permissionError(manifest, {
      ...baseRequest,
      operation: { kind: "network.fetch", url: "https://api.example.com/jobs", method: "POST", headers: {} },
    })).toContain("External writes");
    expect(permissionError(manifest, {
      ...baseRequest,
      operation: { kind: "credential.handle", secretId: "provider:replicate" },
    })).toContain("not declared");
  });

  it("requires an explicit Codex ImageGen host-tool capability", () => {
    const manifest = {
      apiVersion: "clash.plugin/v1",
      id: "codex-imagegen",
      version: "1.0.0",
      name: "Codex ImageGen",
      runtime: { kind: "local", transport: "stdio", entrypoint: "handler.mjs" },
      exports: { cards: [], functions: [{ id: "generate", kind: "action", handler: "generate" }] },
      permissions: {
        hostTools: ["codex.imagegen"],
        assets: ["read", "write"],
      },
    };
    const request = {
      protocol: "clash.plugin.broker-request/v1",
      requestId: "request-1",
      invocationId: "invocation-1",
      operation: {
        kind: "codex.image.generate",
        prompt: "A paper-cut moon",
        aspectRatio: "16:9",
        slot: "image",
        references: [{
          assetId: "reference-1",
          uri: "clash-asset://reference-1",
          kind: "image",
          mediaType: "image/png",
        }],
      },
    };

    expect(sharedTypes.executablePluginBrokerPermissionError(manifest, request)).toBeNull();
    expect(sharedTypes.executablePluginBrokerPermissionError({
      ...manifest,
      permissions: { ...manifest.permissions, hostTools: [] },
    }, request)).toContain("Codex ImageGen");
  });

  it("validates short-lived hosted broker capabilities without embedding plugin inputs", () => {
    const schema = (sharedTypes as Record<string, unknown>)
      .HostedExecutablePluginCapabilitySchema as
      | { parse(value: unknown): any; safeParse(value: unknown): { success: boolean } }
      | undefined;
    expect(schema).toBeDefined();
    if (!schema) return;

    const capability = schema.parse({
      protocol: "clash.plugin.hosted-capability/v1",
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
          schemaHash: `sha256:${"a".repeat(64)}`,
          kind: "action",
        },
        actor: { kind: "user", id: "user-1" },
      },
      permissions: {
        network: { domains: ["api.example.com"] },
        secrets: ["provider:fal"],
        assets: ["read", "write"],
        filesystem: { read: [], write: [] },
        externalWrites: true,
      },
    });

    expect(capability.invocation).not.toHaveProperty("input");
    expect(schema.safeParse({ ...capability, expiresAt: capability.issuedAt - 1 }).success).toBe(false);
  });

  it("pins a Canvas invocation to one exact plugin export and schema", () => {
    const bindingSchema = (sharedTypes as Record<string, unknown>).ExecutablePluginBindingSchema as
      | { parse(value: unknown): any; safeParse(value: unknown): { success: boolean } }
      | undefined;
    expect(bindingSchema).toBeDefined();
    if (!bindingSchema) return;

    const binding = {
      pluginId: "minimax-fal",
      version: "1.2.0",
      exportId: "fal-h3",
      schemaHash: `sha256:${"a".repeat(64)}`,
    };
    expect(bindingSchema.parse(binding)).toEqual(binding);
    expect(bindingSchema.safeParse({ ...binding, version: "^1.2.0" }).success).toBe(false);
    expect(bindingSchema.safeParse({ ...binding, schemaHash: "latest" }).success).toBe(false);
  });

  it("uses one credential-free invocation ABI for local stdio and hosted functions", () => {
    const invocationSchema = (sharedTypes as Record<string, unknown>).ExecutablePluginInvocationSchema as
      | { parse(value: unknown): any; safeParse(value: unknown): { success: boolean } }
      | undefined;
    const resultSchema = (sharedTypes as Record<string, unknown>).ExecutablePluginResultSchema as
      | { parse(value: unknown): any }
      | undefined;
    expect(invocationSchema).toBeDefined();
    expect(resultSchema).toBeDefined();
    if (!invocationSchema || !resultSchema) return;

    const invocation = invocationSchema.parse({
      protocol: "clash.plugin.invoke/v1",
      invocationId: "invocation-1",
      taskId: "task-1",
      projectId: "project-1",
      nodeId: "node-1",
      target: {
        pluginId: "minimax-fal",
        version: "1.2.0",
        exportId: "fal-h3",
        schemaHash: `sha256:${"a".repeat(64)}`,
        kind: "provider-projector",
      },
      input: {
        values: { prompt: "Make the subject turn around", duration: 5 },
        references: [{
          slot: "reference",
          index: 0,
          asset: {
            assetId: "asset-1",
            uri: "clash-asset://asset-1",
            kind: "image",
            mediaType: "image/png",
          },
        }],
      },
      actor: { kind: "agent", id: "agent-session-1" },
    });

    expect(invocation.input.references[0].index).toBe(0);
    expect(JSON.stringify(invocation)).not.toContain("apiKey");
    expect(invocationSchema.safeParse({ ...invocation, input: { values: { bad: () => true } } }).success)
      .toBe(false);

    expect(resultSchema.parse({
      protocol: "clash.plugin.result/v1",
      invocationId: "invocation-1",
      status: "completed",
      outputs: [{
        slot: "video",
        kind: "asset",
        asset: {
          assetId: "asset-2",
          uri: "clash-asset://asset-2",
          kind: "video",
          mediaType: "video/mp4",
        },
      }],
    }).status).toBe("completed");
  });

  it("validates exported model and action Card documents with the product schemas", () => {
    const cardSchema = (sharedTypes as Record<string, unknown>).ExecutablePluginCardDocumentSchema as
      | { parse(value: unknown): any; safeParse(value: unknown): { success: boolean } }
      | undefined;
    expect(cardSchema).toBeDefined();
    if (!cardSchema) return;

    const modelCard = {
      apiVersion: "clash.card/v1",
      kind: "model-card",
      spec: {
        id: "music-3",
        name: "Music 3",
        provider: "minimax",
        kind: "audio",
        task: "music-generation",
        parameters: [{
          id: "duration",
          label: "Duration",
          type: "select",
          options: [{ label: "30 sec", value: 30 }, { label: "60 sec", value: 60 }],
          defaultValue: 30,
        }],
        input: { requiresPrompt: false, promptModalities: ["text"] },
        musicInput: { lyricsTarget: "modelParam", lyricsParam: "lyrics" },
        availableProviders: ["fal"],
        defaultProvider: "fal",
        providerImplementations: [{
          providerId: "fal",
          upstreamId: "fal-ai/minimax/music/v3",
          upstreamModel: "fal-ai/minimax/music/v3",
          apiShape: "fal-minimax-music-v3",
          projectorExportId: "fal-music-3",
        }],
      },
    };
    const parsedModelCard = cardSchema.parse(modelCard);
    expect(parsedModelCard.spec.task).toBe("music-generation");
    expect(parsedModelCard.spec.providerImplementations[0].projectorExportId).toBe("fal-music-3");
    expect(cardSchema.safeParse({
      ...modelCard,
      spec: {
        ...modelCard.spec,
        parameters: [{
          ...modelCard.spec.parameters[0],
          defaultValue: 90,
        }],
      },
    }).success).toBe(false);

    expect(cardSchema.parse({
      apiVersion: "clash.card/v1",
      kind: "action-card",
      spec: {
        id: "remove-background",
        name: "Remove Background",
        outputType: "image",
        functionExportId: "remove-background",
        parameters: [],
        input: { requiresPrompt: false, promptModalities: ["image"] },
      },
    }).spec.functionExportId).toBe("remove-background");
  });

  it("validates Card ids, kinds, and function links across a complete plugin package", () => {
    const validatePackage = (sharedTypes as Record<string, unknown>)
      .validateExecutablePluginPackage as
      | ((manifest: unknown, cards: Record<string, unknown>) => {
          cards: Record<string, { spec: { id: string } }>;
        })
      | undefined;
    expect(validatePackage).toBeDefined();
    if (!validatePackage) return;

    const manifest = {
      apiVersion: "clash.plugin/v1",
      id: "first-party-media",
      version: "1.0.0",
      name: "First-party media",
      runtime: { kind: "local", transport: "stdio", entrypoint: "dist/handler.mjs" },
      exports: {
        cards: [
          { id: "music-3", kind: "model-card", path: "cards/music-3.json" },
          { id: "remove-background", kind: "action-card", path: "cards/remove-background.json" },
        ],
        functions: [
          { id: "fal-music-3", kind: "provider-projector", handler: "projectFalMusic3" },
          { id: "remove-background", kind: "action", handler: "removeBackground" },
        ],
      },
      permissions: {},
    };
    const cards = {
      "cards/music-3.json": {
        apiVersion: "clash.card/v1",
        kind: "model-card",
        spec: {
          id: "music-3",
          name: "Music 3",
          provider: "fal",
          kind: "audio",
          task: "music-generation",
          parameters: [],
          availableProviders: ["fal"],
          defaultProvider: "fal",
          providerImplementations: [{
            providerId: "fal",
            upstreamId: "fal-ai/minimax/music/v3",
            upstreamModel: "fal-ai/minimax/music/v3",
            apiShape: "fal-minimax-music-v3",
            projectorExportId: "fal-music-3",
          }],
        },
      },
      "cards/remove-background.json": {
        apiVersion: "clash.card/v1",
        kind: "action-card",
        spec: {
          id: "remove-background",
          name: "Remove Background",
          outputType: "image",
          functionExportId: "remove-background",
        },
      },
    };

    expect(validatePackage(manifest, cards).cards["cards/music-3.json"].spec.id).toBe("music-3");
    expect(() => validatePackage(manifest, {
      ...cards,
      "cards/remove-background.json": {
        ...cards["cards/remove-background.json"],
        spec: { ...cards["cards/remove-background.json"].spec, id: "wrong-id" },
      },
    })).toThrow(/does not match export id/);
    expect(() => validatePackage({
      ...manifest,
      exports: {
        ...manifest.exports,
        functions: manifest.exports.functions.filter((entry) => entry.id !== "fal-music-3"),
      },
    }, cards)).toThrow(/projector export/);
  });

  it("validates declared contract tests and binds each test to a real function export", () => {
    const validatePackage = (sharedTypes as Record<string, unknown>)
      .validateExecutablePluginPackage as
      | ((
          manifest: unknown,
          cards: Record<string, unknown>,
          contractTests: Record<string, unknown>,
        ) => {
          contractTests: Record<string, { id: string; target: { exportId: string } }>;
        })
      | undefined;
    expect(validatePackage).toBeDefined();
    if (!validatePackage) return;

    const manifest = {
      apiVersion: "clash.plugin/v1",
      id: "contract-plugin",
      version: "1.0.0",
      name: "Contract Plugin",
      runtime: { kind: "local", transport: "stdio", entrypoint: "handler.mjs" },
      exports: {
        cards: [],
        functions: [{ id: "fal-h3", kind: "provider-projector", handler: "projectFalH3" }],
      },
      permissions: {},
      contractTests: ["contract-tests/fal-h3.json"],
    };
    const contractTest = {
      apiVersion: "clash.plugin.contract-test/v1",
      id: "fal-h3-basic",
      target: { exportId: "fal-h3", kind: "provider-projector" },
      input: {
        values: { prompt: "Turn around", duration: 5 },
        references: [],
      },
      brokerFixtures: [],
      expect: {
        status: "completed",
        outputs: [{
          slot: "request",
          kind: "value",
          value: { endpoint: "fal-ai/minimax/hailuo-2.3", input: { prompt: "Turn around" } },
        }],
      },
    };

    const validated = validatePackage(manifest, {}, {
      "contract-tests/fal-h3.json": contractTest,
    });
    expect(validated.contractTests["contract-tests/fal-h3.json"]).toMatchObject({
      id: "fal-h3-basic",
      target: { exportId: "fal-h3" },
    });
    expect(() => validatePackage(manifest, {}, {})).toThrow(/Missing declared contract test/);
    expect(() => validatePackage(manifest, {}, {
      "contract-tests/fal-h3.json": {
        ...contractTest,
        target: { exportId: "fal-h3", kind: "action" },
      },
    })).toThrow(/does not match function export/);
  });

  it("brokers credentials and assets through opaque handles instead of raw secrets", () => {
    const requestSchema = (sharedTypes as Record<string, unknown>).ExecutablePluginBrokerRequestSchema as
      | { parse(value: unknown): any; safeParse(value: unknown): { success: boolean } }
      | undefined;
    const responseSchema = (sharedTypes as Record<string, unknown>).ExecutablePluginBrokerResponseSchema as
      | { parse(value: unknown): any }
      | undefined;
    expect(requestSchema).toBeDefined();
    expect(responseSchema).toBeDefined();
    if (!requestSchema || !responseSchema) return;

    expect(requestSchema.parse({
      protocol: "clash.plugin.broker-request/v1",
      requestId: "request-1",
      invocationId: "invocation-1",
      operation: { kind: "credential.handle", secretId: "provider:fal" },
    }).operation.secretId).toBe("provider:fal");

    expect(requestSchema.safeParse({
      protocol: "clash.plugin.broker-request/v1",
      requestId: "request-2",
      invocationId: "invocation-1",
      operation: {
        kind: "credential.handle",
        secretId: "provider:fal",
        value: "raw-secret-must-not-cross-stdio",
      },
    }).success).toBe(false);

    expect(requestSchema.parse({
      protocol: "clash.plugin.broker-request/v1",
      requestId: "request-write-1",
      invocationId: "invocation-1",
      operation: {
        kind: "asset.write",
        slot: "image",
        assetKind: "image",
        mediaType: "image/png",
        dataBase64: "AQID",
      },
    }).operation.dataBase64).toBe("AQID");
    expect(requestSchema.safeParse({
      protocol: "clash.plugin.broker-request/v1",
      requestId: "request-write-2",
      invocationId: "invocation-1",
      operation: {
        kind: "asset.write",
        slot: "image",
        assetKind: "image",
        sourceHandle: "clash-plugin-output://output-1",
        dataBase64: "AQID",
      },
    }).success).toBe(false);

    expect(responseSchema.parse({
      protocol: "clash.plugin.broker-response/v1",
      requestId: "request-1",
      status: "ok",
      result: { handle: "clash-secret://invocation-1/provider%3Afal" },
    }).result.handle).toMatch(/^clash-secret:\/\//);
  });
});
