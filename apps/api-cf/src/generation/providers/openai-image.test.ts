import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getVariable: vi.fn(),
  generateOpenAIImage: vi.fn(),
}));

vi.mock("../../services/user-variables", () => ({
  getVariable: mocks.getVariable,
}));

vi.mock("../../services/openai-image", () => ({
  generateOpenAIImage: mocks.generateOpenAIImage,
}));

import { openaiImageProvider } from "./openai-image";

function makeCtx() {
  const uploadBytes = vi.fn().mockResolvedValue("projects/p1/uploads/task-1.png");
  const probe = vi.fn().mockResolvedValue({ metadata: { width: 1024, height: 1024 } });
  const createAsset = vi.fn().mockResolvedValue("asset-1");
  const notifyCompleted = vi.fn();

  return {
    params: {
      taskId: "task-1",
      nodeId: "node-1",
      projectId: "project-1",
      type: "image_gen",
      actorType: "user",
      actorUserId: "user-1",
      prompt: "render a product hero",
      modelName: "gpt-image-2",
      modelParams: { quality: "high" },
    },
    env: {
      DB: {} as D1Database,
      ACTION_SECRET_KEY: "secret-key",
      OPENAI_API_KEY: "env-openai-key",
      CF_AIG_TOKEN: "gateway-token",
      CF_AIG_OPENAI_URL: "https://gateway.example/openai",
    },
    tag: { taskId: "task-1", nodeId: "node-1" },
    step: async (_name: string, optsOrFn: unknown, maybeFn?: () => Promise<unknown>) => {
      const fn = typeof optsOrFn === "function" ? optsOrFn : maybeFn;
      if (!fn) throw new Error("missing step fn");
      return fn();
    },
    uploadBytes,
    probe,
    createAsset,
    notifyCompleted,
  };
}

describe("openaiImageProvider", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("loads OPENAI_API_KEY from user variables before falling back to env", async () => {
    mocks.getVariable.mockResolvedValue("user-openai-key");
    mocks.generateOpenAIImage.mockResolvedValue({
      data: new Uint8Array([1, 2, 3]),
      mediaType: "image/png",
      model: "gpt-image-2",
    });
    const ctx = makeCtx();

    await openaiImageProvider.execute(ctx as never);

    expect(mocks.getVariable).toHaveBeenCalledWith(
      ctx.env.DB,
      "user-1",
      "OPENAI_API_KEY",
      "secret-key",
    );
    expect(mocks.generateOpenAIImage).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "user-openai-key",
        baseUrl: "https://gateway.example/openai",
        modelName: "gpt-image-2",
      }),
    );
    expect(ctx.notifyCompleted).toHaveBeenCalledWith({ assetId: "asset-1" });
  });
});
