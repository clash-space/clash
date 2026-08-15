import { describe, expect, it } from "vitest";

import * as sharedTypes from "./index.js";

describe("agent-editable executable plugin contract", () => {
  it("keeps native Generator Document outputs typed instead of reusing legacy values", () => {
    const schema = sharedTypes.ExecutablePluginOutputSchema;
    const body = { text: "hello", segments: [] };

    expect(
      schema.parse({
        slot: "transcript",
        kind: "document",
        document: {
          documentKind: "media.transcript",
          schemaVersion: 1,
          body,
        },
      }),
    ).toEqual({
      slot: "transcript",
      kind: "document",
      document: {
        documentKind: "media.transcript",
        schemaVersion: 1,
        body,
      },
    });
    expect(
      schema.safeParse({
        slot: "transcript",
        kind: "document",
        document: { schemaVersion: 1, body },
      }).success,
    ).toBe(false);
  });

  it("pins a plugin Document input to one exact immutable revision", () => {
    const reference = {
      slot: "transcript",
      index: 0,
      document: {
        documentAssetId: "document-1",
        revisionId: "revision-2",
        documentKind: "media.transcript",
        schemaVersion: 1,
      },
    };
    expect(sharedTypes.ExecutablePluginReferenceSchema.parse(reference)).toEqual(
      reference,
    );
    expect(
      sharedTypes.ExecutablePluginBrokerResolvedReferenceSchema.parse({
        form: "document",
        documentKind: "media.transcript",
        schemaVersion: 1,
        body: { text: "frozen words" },
      }),
    ).toEqual({
      form: "document",
      documentKind: "media.transcript",
      schemaVersion: 1,
      body: { text: "frozen words" },
    });
  });

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
      pluginId: "acme.caption-helper",
      version: "1.2.3",
      schemaHash: `sha256:${"a".repeat(64)}`,
      runtime: { kind: "local", transport: "stdio", entrypoint: "handler.mjs" },
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
      pluginId: "acme.agent-media",
      version: "2.0.0",
      schemaHash: `sha256:${"b".repeat(64)}`,
      runtime: { kind: "local", transport: "stdio", entrypoint: "handler.mjs" },
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
    expect(composed[0].providerImplementations[0].projectorPluginId).toBe("acme.agent-media");
    expect(() => compose([base], [
      registration,
      { ...registration, pluginId: "acme.another-plugin" },
    ])).toThrow(/both export model Card minimax-h3/);
  });

  it("parses Provider definitions and external model implementation bindings as independent plugin exports", () => {
    const manifestSchema = (sharedTypes as Record<string, unknown>).ExecutablePluginManifestSchema as
      | { parse(value: unknown): any }
      | undefined;
    const validatePackage = (sharedTypes as Record<string, unknown>).validateExecutablePluginPackage as
      | ((manifest: unknown, cards: Record<string, unknown>, tests: Record<string, unknown>, artifacts: {
        providers: Record<string, unknown>;
        modelBindings: Record<string, unknown>;
      }) => any)
      | undefined;
    expect(manifestSchema).toBeDefined();
    expect(validatePackage).toBeDefined();
    if (!manifestSchema || !validatePackage) return;

    const manifest = manifestSchema.parse({
      apiVersion: "clash.plugin/v1",
      id: "hilo.hub-media",
      version: "1.0.0",
      name: "Hilo Hub Media",
      runtime: { kind: "local", transport: "stdio", entrypoint: "dist/stdio.mjs" },
      contributes: {
        cards: [],
        providers: [{ id: "hilo-hub", kind: "provider", path: "providers/hilo-hub.json" }],
        modelBindings: [{
          id: "hilo-hub-minimax-h3",
          kind: "model-provider-binding",
          path: "bindings/minimax-h3.json",
        }],
        functions: [{ id: "hilo-hub-execute", kind: "provider-executor" }],
      },
    });
    const validated = validatePackage(manifest, {}, {}, {
      providers: {
        "providers/hilo-hub.json": {
          apiVersion: "clash.provider/v1",
          kind: "provider",
          spec: {
            id: "hilo-hub",
            name: "MiniMax Hilo Hub",
            upstreamId: "hilo-hub",
            apiShape: "hilo-hub",
            executorExportId: "hilo-hub-execute",
            auth: {
              methods: [{
                id: "sign-in",
                label: "Sign in to MiniMax Hub",
                form: [{ kind: "button", key: "accessToken", label: "Sign in" }],
                flow: {
                  open: "https://hub.minimax.io/login",
                  callback: { type: "scheme", scheme: "minimax-hub" },
                },
              }],
            },
          },
        },
      },
      modelBindings: {
        "bindings/minimax-h3.json": {
          apiVersion: "clash.binding/v1",
          kind: "model-provider-binding",
          spec: {
            id: "hilo-hub-minimax-h3",
            modelId: "minimax-h3",
            providerId: "hilo-hub",
            upstreamId: "hilo-hub",
            upstreamModel: "MiniMax-H3",
            apiShape: "hilo-hub",
            executorExportId: "hilo-hub-execute",
            requiredOAuth: ["hilo-hub"],
          },
        },
      },
    });

    expect(validated.providers["providers/hilo-hub.json"].spec.id).toBe("hilo-hub");
    expect(validated.modelBindings["bindings/minimax-h3.json"].spec.modelId).toBe("minimax-h3");
  });

  it("no longer parses a declared recipe for reading another app's token store", () => {
    // Reversed. This asserted that a `local-token-import` auth entry parsed, and that path
    // traversal in its `appDataSubdirectory` or `configFile` was rejected -- a recipe naming a
    // path inside another desktop app's encrypted config, which the host then read and decrypted.
    //
    // The recipe is gone with the rest of the auth-type registry. It was a member added for one
    // vendor's installed client, and a union over auth types needs a member per vendor: one signs
    // with an access key and a secret, another wants a console token, and Google accepts several
    // credential forms. Reading another app's store is plugin code now.
    //
    // The traversal guard is not lost, only moved. `importLocalProviderToken` in the local API still
    // resolves every path inside the application data root and throws when one escapes; it takes its
    // recipe from its own type rather than from this schema. What is given up is validating that
    // recipe when a plugin is installed rather than when it runs.
    expect((sharedTypes as Record<string, unknown>).ExecutablePluginProviderAuthSchema)
      .toBeUndefined();

    const provider = (sharedTypes as Record<string, unknown>)
      .ExecutablePluginProviderDefinitionSchema as { safeParse(value: unknown): { success: boolean } };
    expect(provider.safeParse({
      id: "hilo-hub",
      name: "MiniMax Hub",
      upstreamId: "hilo-hub",
      apiShape: "hilo-hub",
      executorExportId: "hilo-hub-execute",
      auth: [{
        type: "local-token-import",
        id: "hilo-hub",
        source: {
          format: "electron-store-aes-256-gcm-v2",
          appDataSubdirectory: "@hilo/MiniMax Hub Global",
          configFile: "hub-config-global.json",
          keyFile: ".token-key",
          tokenPath: ["tokens", "accessToken"],
        },
      }],
    }).success).toBe(false);
  });

  it("resolves provider-first and Card-first installation to the same effective model", () => {
    const compose = (sharedTypes as Record<string, unknown>).composeExecutablePluginModelCards as
      | ((base: any[], cards: any[], bindings: any[]) => any[])
      | undefined;
    expect(compose).toBeDefined();
    if (!compose) return;

    const modelCard = {
      id: "portable-image-model",
      aliases: [],
      name: "Portable Image Model",
      provider: "Portable",
      kind: "image",
      parameters: [],
      defaultParams: {},
      defaultAspectRatio: "1:1",
      input: { requiresPrompt: true, inputMode: {}, promptModalities: ["text"] },
      constraints: [],
    };
    const cardRegistration = {
      pluginId: "acme.portable-card-pack",
      version: "1.0.0",
      schemaHash: `sha256:${"c".repeat(64)}`,
      runtime: { kind: "local", transport: "stdio", entrypoint: "stdio.mjs" },
      document: { apiVersion: "clash.card/v1", kind: "model-card", spec: modelCard },
    };
    const bindingRegistration = {
      pluginId: "hilo.hub-media",
      version: "1.0.0",
      schemaHash: `sha256:${"d".repeat(64)}`,
      runtime: { kind: "local", transport: "stdio", entrypoint: "stdio.mjs" },
      document: {
        apiVersion: "clash.binding/v1",
        kind: "model-provider-binding",
        spec: {
          id: "hilo-hub-portable-image-model",
          modelId: "portable-image-model",
          providerId: "hilo-hub",
          upstreamId: "hilo-hub",
          upstreamModel: "portable-image-v1",
          apiShape: "hilo-hub",
          executorExportId: "hilo-hub-execute",
          requiredOAuth: ["hilo-hub"],
          priority: 10,
        },
      },
    };

    const providerFirst = compose([modelCard], [], [bindingRegistration]);
    const cardFirst = compose([], [cardRegistration], [bindingRegistration]);

    expect(providerFirst).toEqual(cardFirst);
    expect(providerFirst[0]).toMatchObject({
      id: "portable-image-model",
      availableProviders: ["hilo-hub"],
      defaultProvider: "hilo-hub",
      providerImplementations: [{
        providerId: "hilo-hub",
        upstreamId: "hilo-hub",
        upstreamModel: "portable-image-v1",
        apiShape: "hilo-hub",
        executorPluginId: "hilo.hub-media",
        executorExportId: "hilo-hub-execute",
        requiredOAuth: ["hilo-hub"],
      }],
    });
  });

  it("parses a local stdio plugin that exports declarative cards and functions", () => {
    const schema = (sharedTypes as Record<string, unknown>).ExecutablePluginManifestSchema as
      | { parse(value: unknown): any; safeParse(value: unknown): { success: boolean } }
      | undefined;
    expect(schema).toBeDefined();
    if (!schema) return;

    const manifest = schema.parse({
      apiVersion: "clash.plugin/v1",
      id: "acme.minimax-fal",
      version: "1.2.0",
      name: "MiniMax on fal",
      runtime: {
        kind: "local",
        transport: "stdio",
        entrypoint: "dist/handler.mjs",
      },
      contributes: {
        cards: [
          { id: "minimax-h3", kind: "model-card", path: "cards/minimax-h3.json" },
          { id: "music-generate", kind: "action-card", path: "cards/music-generate.json" },
        ],
        functions: [
          { id: "fal-h3", kind: "provider-projector" },
          { id: "music-generate", kind: "action" },
        ],
      },
      contractTests: ["contract-tests/h3.json"],
    });

    expect(manifest.runtime).toEqual({
      kind: "local",
      transport: "stdio",
      entrypoint: "dist/handler.mjs",
      args: [],
    });
    expect(manifest.contributes.cards).toHaveLength(2);
    expect(schema.safeParse({
      ...manifest,
      contributes: {
        ...manifest.contributes,
        functions: [{ id: "fal-h3", kind: "provider-projector", handler: "projectFalH3" }],
      },
    }).success).toBe(false);
    expect(schema.safeParse({ ...manifest, runtime: { ...manifest.runtime, entrypoint: "../escape.mjs" } }).success)
      .toBe(false);
  });

  it("derives injected dependencies from the contributed function kind", () => {
    const dependencyError = (sharedTypes as Record<string, unknown>)
      .executablePluginDependencyError as
      | ((manifest: unknown, request: unknown) => string | null)
      | undefined;
    expect(dependencyError).toBeTypeOf("function");
    if (!dependencyError) return;

    const executor = {
      apiVersion: "clash.plugin/v1",
      id: "acme.media",
      version: "1.2.3",
      name: "Acme Media",
      runtime: { kind: "hosted", transport: "http", endpoint: "https://plugin.example.com/run" },
      contributes: { functions: [{ id: "run", kind: "provider-executor" }] },
    };
    const projector = {
      ...executor,
      contributes: { functions: [{ id: "map", kind: "provider-projector" }] },
    };
    const readAccountState = {
      protocol: "clash.plugin.broker-request/v1",
      requestId: "request-1",
      invocationId: "invocation-1",
      operation: { kind: "store.get", key: "accessToken" },
    };

    expect(dependencyError(executor, readAccountState)).toBeNull();
    expect(dependencyError(projector, readAccountState)).toContain("account state");
  });

  it("requires an explicit Codex ImageGen host-tool capability", () => {
    const manifest = {
      apiVersion: "clash.plugin/v1",
      id: "clash.codex-imagegen",
      version: "1.0.0",
      name: "Codex ImageGen",
      runtime: { kind: "local", transport: "stdio", entrypoint: "handler.mjs" },
      contributes: {
        functions: [{ id: "generate", kind: "action" }],
        hostTools: ["codex.imagegen"],
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

    expect(sharedTypes.executablePluginDependencyError(manifest, request)).toBeNull();
    expect(sharedTypes.executablePluginDependencyError({
      ...manifest,
      contributes: { ...manifest.contributes, hostTools: [] },
    }, request)).toContain("Codex ImageGen");
  });

  it("pins a Canvas invocation to one exact plugin export and schema", () => {
    const bindingSchema = (sharedTypes as Record<string, unknown>).ExecutablePluginBindingSchema as
      | { parse(value: unknown): any; safeParse(value: unknown): { success: boolean } }
      | undefined;
    expect(bindingSchema).toBeDefined();
    if (!bindingSchema) return;

    const binding = {
      pluginId: "acme.minimax-fal",
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
        pluginId: "acme.minimax-fal",
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
    // `musicInput` rather than a `task` of "music-generation". The card declares that it takes
    // lyrics and where they go; the task field only asserted a label for the same fact, and the two
    // could disagree -- `lyria-3-pro` was tagged music-generation while declaring no lyrics input
    // at all, so the UI drew it a lyrics box that went nowhere.
    expect(parsedModelCard.spec.musicInput).toMatchObject({ lyricsParam: "lyrics" });
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
      id: "clash.media",
      version: "1.0.0",
      name: "First-party media",
      runtime: { kind: "local", transport: "stdio", entrypoint: "dist/handler.mjs" },
      contributes: {
        cards: [
          { id: "music-3", kind: "model-card", path: "cards/music-3.json" },
          { id: "remove-background", kind: "action-card", path: "cards/remove-background.json" },
        ],
        functions: [
          { id: "fal-music-3", kind: "provider-projector" },
          { id: "remove-background", kind: "action" },
        ],
      },
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
      contributes: {
        ...manifest.contributes,
        functions: manifest.contributes.functions.filter((entry) => entry.id !== "fal-music-3"),
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
      id: "acme.contract-plugin",
      version: "1.0.0",
      name: "Contract Plugin",
      runtime: { kind: "local", transport: "stdio", entrypoint: "handler.mjs" },
      contributes: {
        cards: [],
        functions: [{ id: "fal-h3", kind: "provider-projector" }],
      },
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

  it("accepts only typed store and asset broker operations", () => {
    const requestSchema = (sharedTypes as Record<string, unknown>).ExecutablePluginBrokerRequestSchema as
      | { parse(value: unknown): any; safeParse(value: unknown): { success: boolean } }
      | undefined;
    expect(requestSchema).toBeDefined();
    if (!requestSchema) return;

    expect(requestSchema.safeParse({
      protocol: "clash.plugin.broker-request/v1",
      requestId: "request-1",
      invocationId: "invocation-1",
      operation: { kind: "credential.handle", secretId: "provider:fal" },
    }).success).toBe(false);

    expect(requestSchema.parse({
      protocol: "clash.plugin.broker-request/v1",
      requestId: "request-2",
      invocationId: "invocation-1",
      operation: { kind: "store.get", key: "accessToken" },
    }).operation.key).toBe("accessToken");
    expect(requestSchema.safeParse({
      protocol: "clash.plugin.broker-request/v1",
      requestId: "request-3",
      invocationId: "invocation-1",
      operation: { kind: "store.get", key: "accessToken", accountId: "forged-account" },
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
  });
});
