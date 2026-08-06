import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadSecrets: vi.fn(),
}));

vi.mock("../../services/user-variables", () => ({
  loadSecrets: mocks.loadSecrets,
}));

import { customActionProvider } from "./custom-action";
import { verifyHostedExecutablePluginCapability } from "../../services/hosted-plugin-capabilities";

function makeCtx(overrides: Record<string, unknown> = {}) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({ type: "text", content: "done", description: "ok" }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );
  vi.stubGlobal("fetch", fetchMock);

  const notifyCompleted = vi.fn();
  const ctx = {
    params: {
      taskId: "task-1",
      nodeId: "node-1",
      projectId: "project-1",
      type: "custom_action",
      customActionId: "fal-render",
      workerUrl: "https://action.example.com",
      prompt: "render a city",
      customActionParams: { size: "1024x1024" },
      customActionModel: { provider: "fal", id: "fal-ai/flux-pro" },
      customActionSecrets: [
        {
          id: "FAL_API_KEY",
          label: "fal.ai API key",
          required: true,
        },
      ],
      actorType: "user",
      actorUserId: "user-1",
      ...overrides,
    },
    env: {
      DB: {} as D1Database,
      ACTION_SECRET_KEY: "encrypt-secret",
      PLUGIN_CAPABILITY_KEY: "plugin-capability-secret",
      WORKER_PUBLIC_URL: "https://api.example.com",
    },
    tag: { taskId: "task-1", nodeId: "node-1" },
    step: async (_name: string, optsOrFn: unknown, maybeFn?: () => Promise<unknown>) => {
      const fn = typeof optsOrFn === "function" ? optsOrFn : maybeFn;
      if (!fn) throw new Error("missing step fn");
      return fn();
    },
    notifyCompleted,
    uploadFromUrl: vi.fn(),
    probe: vi.fn(),
    createAsset: vi.fn(),
  };

  return { ctx, fetchMock, notifyCompleted };
}

describe("customActionProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("loads declared action secrets and sends model metadata to worker actions", async () => {
    mocks.loadSecrets.mockResolvedValue({ FAL_API_KEY: "fal-key" });
    const { ctx, fetchMock, notifyCompleted } = makeCtx();

    await customActionProvider.execute(ctx as any);

    expect(mocks.loadSecrets).toHaveBeenCalledWith(
      ctx.env.DB,
      "user-1",
      ["FAL_API_KEY"],
      "encrypt-secret",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      actionId: "fal-render",
      model: { provider: "fal", id: "fal-ai/flux-pro" },
      secrets: { FAL_API_KEY: "fal-key" },
    });
    expect(notifyCompleted).toHaveBeenCalledWith({
      content: "done",
      description: "ok",
    });
  });

  it("sends bound executable plugins the shared invocation ABI without loading or exposing secrets", async () => {
    const pluginBinding = {
      pluginId: "acme.media",
      version: "1.2.3",
      exportId: "render",
      schemaHash: `sha256:${"a".repeat(64)}`,
    };
    const { ctx, fetchMock, notifyCompleted } = makeCtx({
      pluginBinding,
      pluginPermissions: {
        network: { domains: ["queue.fal.run"] },
        secrets: ["provider:fal"],
        assets: ["read", "write"],
        filesystem: { read: [], write: [] },
        externalWrites: true,
      },
      pluginReferences: [
        {
          slot: "image",
          index: 0,
          asset: {
            assetId: "asset-image-1",
            uri: "clash-asset://asset-image-1",
            kind: "image",
            mediaType: "image/png",
          },
        },
      ],
    });
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          protocol: "clash.plugin.result/v1",
          invocationId: "task-1",
          status: "completed",
          outputs: [{ slot: "content", kind: "value", value: "plugin done" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    await customActionProvider.execute(ctx as any);

    expect(mocks.loadSecrets).not.toHaveBeenCalled();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get("x-clash-plugin-broker")).toBe("https://api.example.com/api/v1/plugin-broker");
    const capabilityToken = headers.get("x-clash-plugin-capability");
    expect(capabilityToken).toBeTruthy();
    const capability = await verifyHostedExecutablePluginCapability(
      capabilityToken!,
      "plugin-capability-secret",
    );
    expect(capability).toMatchObject({
      endpoint: "https://action.example.com",
      ownerUserId: "user-1",
      invocation: {
        invocationId: "task-1",
        target: { ...pluginBinding, kind: "action" },
      },
      permissions: {
        network: { domains: ["queue.fal.run"] },
        secrets: ["provider:fal"],
        assets: ["read", "write"],
        externalWrites: true,
      },
    });
    expect(JSON.parse(init.body as string)).toEqual({
      protocol: "clash.plugin.invoke/v1",
      invocationId: "task-1",
      taskId: "task-1",
      projectId: "project-1",
      nodeId: "node-1",
      target: { ...pluginBinding, kind: "action" },
      input: {
        values: {
          prompt: "render a city",
          size: "1024x1024",
        },
        references: [
          {
            slot: "image",
            index: 0,
            asset: {
              assetId: "asset-image-1",
              uri: "clash-asset://asset-image-1",
              kind: "image",
              mediaType: "image/png",
            },
          },
        ],
      },
      actor: { kind: "user", id: "user-1" },
    });
    expect(JSON.stringify(JSON.parse(init.body as string))).not.toContain("fal-key");
    expect(notifyCompleted).toHaveBeenCalledWith({ content: "plugin done" });
  });

  it("fails before calling the worker when a required action secret is missing", async () => {
    mocks.loadSecrets.mockResolvedValue({});
    const { ctx, fetchMock } = makeCtx();

    await expect(customActionProvider.execute(ctx as any)).rejects.toThrow(
      "Missing required action secret: FAL_API_KEY",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
