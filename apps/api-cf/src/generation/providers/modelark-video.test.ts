import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  credentialsForProvider: vi.fn(),
  generateModelArkVideo: vi.fn(),
  signedMediaUrl: vi.fn(),
  signedMediaUrls: vi.fn(),
}));

vi.mock("./provider-credentials", () => ({
  credentialsForProvider: mocks.credentialsForProvider,
}));

vi.mock("../../services/modelark-video", () => ({
  generateModelArkVideo: mocks.generateModelArkVideo,
}));

vi.mock("./media-url", () => ({
  signedMediaUrl: mocks.signedMediaUrl,
  signedMediaUrls: mocks.signedMediaUrls,
}));

import { volcengineVideoProvider } from "./modelark-video";

function makeCtx() {
  const uploadFromUrl = vi
    .fn()
    .mockResolvedValueOnce("projects/p1/uploads/task-1.mp4")
    .mockResolvedValueOnce("projects/p1/uploads/task-1-cover.jpg");
  const probe = vi.fn().mockResolvedValue({ metadata: { width: 1280, height: 720 } });
  const createAsset = vi.fn().mockResolvedValue("asset-1");
  const notifyCompleted = vi.fn();

  return {
    params: {
      taskId: "task-1",
      nodeId: "node-1",
      projectId: "project-1",
      type: "video_gen",
      actorType: "user",
      actorUserId: "user-1",
      prompt: "make it move",
      modelName: "seedance-2-ref",
      referenceImageR2Keys: ["ref.png"],
    },
    env: {
      DB: {} as D1Database,
      ACTION_SECRET_KEY: "secret-key",
      R2_PUBLIC_URL: "https://cdn.example",
    },
    tag: { taskId: "task-1", nodeId: "node-1" },
    step: async (_name: string, optsOrFn: unknown, maybeFn?: () => Promise<unknown>) => {
      const fn = typeof optsOrFn === "function" ? optsOrFn : maybeFn;
      if (!fn) throw new Error("missing step fn");
      return fn();
    },
    uploadFromUrl,
    probe,
    createAsset,
    notifyCompleted,
  };
}

describe("volcengineVideoProvider", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("loads semantic ModelArk credentials from provider accounts", async () => {
    mocks.credentialsForProvider.mockResolvedValue({
      apiKey: "ark-provider-key",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    });
    mocks.signedMediaUrl.mockResolvedValue("https://media.example/ref.png");
    mocks.signedMediaUrls.mockResolvedValue([]);
    mocks.generateModelArkVideo.mockResolvedValue({
      url: "https://video.example/out.mp4",
      coverImageUrl: "https://video.example/cover.jpg",
      duration: 5,
      taskId: "ark-task-1",
    });
    const ctx = makeCtx();

    await volcengineVideoProvider.execute(ctx as never);

    expect(mocks.credentialsForProvider).toHaveBeenCalledWith(ctx, "volcengine", ["apiKey"], {
      upstreamId: "volcengine",
    });
    expect(mocks.generateModelArkVideo).toHaveBeenCalledWith(
      "ark-provider-key",
      expect.objectContaining({
        baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
        upstreamModel: "doubao-seedance-2-0-pro",
      }),
    );
    expect(ctx.notifyCompleted).toHaveBeenCalledWith({ assetId: "asset-1" });
  });
});
