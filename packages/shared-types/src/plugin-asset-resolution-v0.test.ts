import { describe, expect, it } from "vitest";

import * as executablePluginContract from "./executable-plugin.js";
import {
  ExecutablePluginAssetHandleSchema,
  ExecutablePluginBrokerOperationSchema,
  ExecutablePluginBrokerResolvedReferenceSchema,
  ExecutablePluginInvocationSchema,
  ExecutablePluginManifestSchema,
} from "./executable-plugin.js";
import { ModelProviderImplementationSchema } from "./models.js";

describe("v0 Provider Asset delivery contract", () => {
  it("keeps a Clash Asset handle free of Host projections", () => {
    expect(() =>
      ExecutablePluginAssetHandleSchema.parse({
        assetId: "asset-1",
        uri: "clash-asset://asset-1",
        kind: "image",
        url: "http://127.0.0.1:8789/assets/asset-1",
        reach: "private",
      }),
    ).toThrow();
  });

  it("preserves declarative delivery support on a Provider binding", () => {
    const binding = ModelProviderImplementationSchema.parse({
      providerId: "volcengine",
      upstreamId: "volcengine",
      upstreamModel: "doubao-seedance-2-5-260628",
      apiShape: "modelark",
      assetInputs: [
        {
          match: { kinds: ["image"], slots: ["image", "startFrame"] },
          representations: ["provider-url", "bytes"],
          mediaTypes: ["image/jpeg", "image/png"],
        },
      ],
    });

    expect(binding.assetInputs).toEqual([
      {
        match: { kinds: ["image"], slots: ["image", "startFrame"] },
        representations: ["provider-url", "bytes"],
        mediaTypes: ["image/jpeg", "image/png"],
      },
    ]);
  });

  it("declares an execution-realm URL without claiming Provider reachability", () => {
    const binding = ModelProviderImplementationSchema.parse({
      providerId: "local-remotion",
      upstreamId: "local-remotion",
      upstreamModel: "timeline-render",
      apiShape: "local-remotion",
      assetInputs: [
        {
          match: { kinds: ["image", "video", "audio"] },
          representations: ["executor-url"],
        },
      ],
    });

    expect(binding.assetInputs).toEqual([
      {
        match: { kinds: ["image", "video", "audio"] },
        representations: ["executor-url"],
      },
    ]);
  });

  it("resolves the full typed reference rather than an Asset handle alone", () => {
    const operation = ExecutablePluginBrokerOperationSchema.parse({
      kind: "asset.resolve",
      reference: {
        slot: "startFrame",
        index: 0,
        asset: {
          assetId: "asset-1",
          uri: "clash-asset://asset-1",
          kind: "image",
          mediaType: "image/png",
        },
      },
    });

    expect(operation.kind).toBe("asset.resolve");
  });

  it("pins the selected binding's delivery declaration on the invocation", () => {
    const invocation = ExecutablePluginInvocationSchema.parse({
      protocol: "clash.plugin.invoke/v1",
      invocationId: "invocation-1",
      taskId: "task-1",
      projectId: "project-1",
      target: {
        pluginId: "clash.volcengine",
        version: "0.1.0",
        exportId: "volcengine-execute",
        schemaHash: `sha256:${"a".repeat(64)}`,
        kind: "provider-executor",
      },
      input: { values: {}, references: [] },
      assetInputs: [
        {
          match: { kinds: ["image"], slots: ["startFrame"] },
          representations: ["provider-url"],
        },
      ],
      actor: { kind: "system" },
    });

    expect(invocation.assetInputs).toEqual([
      {
        match: { kinds: ["image"], slots: ["startFrame"] },
        representations: ["provider-url"],
      },
    ]);
  });

  it("uses a provider-url discriminant instead of url plus reach", () => {
    const contract = executablePluginContract as unknown as Record<
      string,
      { parse(input: unknown): unknown } | undefined
    >;
    const schema = contract.ExecutablePluginBrokerResolvedReferenceSchema;

    expect(schema).toBeDefined();
    expect(
      schema?.parse({
        form: "provider-url",
        providerUrl: "https://objects.example.test/reference.png?sig=1",
        expiresAt: "2026-08-13T12:00:00.000Z",
        kind: "image",
        mediaType: "image/png",
      }),
    ).toEqual({
      form: "provider-url",
      providerUrl: "https://objects.example.test/reference.png?sig=1",
      expiresAt: "2026-08-13T12:00:00.000Z",
      kind: "image",
      mediaType: "image/png",
    });
  });

  it("keeps an executor URL ephemeral in the broker result", () => {
    const resolved = ExecutablePluginBrokerResolvedReferenceSchema.parse({
      form: "executor-url",
      executorUrl: "http://127.0.0.1:49321/assets/capabilities/exact-resource",
      expiresAt: "2026-08-15T12:00:00.000Z",
      kind: "video",
      mediaType: "video/mp4",
    });

    expect(resolved).toEqual({
      form: "executor-url",
      executorUrl: "http://127.0.0.1:49321/assets/capabilities/exact-resource",
      expiresAt: "2026-08-15T12:00:00.000Z",
      kind: "video",
      mediaType: "video/mp4",
    });
    expect(resolved).not.toHaveProperty("path");
    expect(resolved).not.toHaveProperty("storageKey");
  });

  it("lets an Action declare the Asset delivery its executor accepts", () => {
    const manifest = ExecutablePluginManifestSchema.parse({
      apiVersion: "clash.plugin/v1",
      id: "clash.remotion",
      version: "0.1.0",
      name: "Remotion",
      runtime: {
        kind: "local",
        transport: "stdio",
        entrypoint: "dist/index.mjs",
      },
      contributes: {
        functions: [
          {
            id: "render-timeline",
            kind: "action",
            assetInputs: [
              {
                match: { kinds: ["image", "video", "audio"] },
                representations: ["executor-url"],
              },
            ],
          },
        ],
      },
    });

    expect(manifest.contributes.functions[0]).toMatchObject({
      id: "render-timeline",
      kind: "action",
      assetInputs: [
        {
          match: { kinds: ["image", "video", "audio"] },
          representations: ["executor-url"],
        },
      ],
    });
  });

  it("does not attach Asset delivery to a pure Provider projector", () => {
    const parsed = ExecutablePluginManifestSchema.safeParse({
      apiVersion: "clash.plugin/v1",
      id: "test.projector",
      version: "0.1.0",
      name: "Projector",
      runtime: {
        kind: "local",
        transport: "stdio",
        entrypoint: "dist/index.mjs",
      },
      contributes: {
        functions: [
          {
            id: "project",
            kind: "provider-projector",
            assetInputs: [
              {
                match: { kinds: ["image"] },
                representations: ["executor-url"],
              },
            ],
          },
        ],
      },
    });

    expect(parsed.success).toBe(false);
  });

  it("does not expose Host storage as a plugin manifest dependency", () => {
    expect(() =>
      ExecutablePluginManifestSchema.parse({
        apiVersion: "clash.plugin/v1",
        id: "test.provider",
        version: "0.1.0",
        name: "Test Provider",
        runtime: {
          kind: "local",
          transport: "stdio",
          entrypoint: "index.mjs",
        },
        contributes: {
          functions: [
            {
              id: "execute",
              kind: "provider-executor",
              requires: ["public-asset-storage"],
            },
          ],
        },
      }),
    ).toThrow();
  });
});
