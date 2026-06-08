import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadSecrets: vi.fn(),
}));

vi.mock("../../services/user-variables", () => ({
  loadSecrets: mocks.loadSecrets,
}));

import { customActionProvider } from "./custom-action";

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

  it("fails before calling the worker when a required action secret is missing", async () => {
    mocks.loadSecrets.mockResolvedValue({});
    const { ctx, fetchMock } = makeCtx();

    await expect(customActionProvider.execute(ctx as any)).rejects.toThrow(
      "Missing required action secret: FAL_API_KEY",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
