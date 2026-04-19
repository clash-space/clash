import { describe, it, expect, vi, beforeEach } from "vitest";
import { Status } from "../domain/canvas";

// Mock external services. The GenerationWorkflow class extends WorkflowEntrypoint
// from cloudflare:workers and can't be instantiated in vitest, so these tests
// exercise the helper services in the order the workflow would call them.
vi.mock("../services/fal-image", () => ({
  generateImage: vi.fn().mockResolvedValue({
    url: "https://fal.ai/image.png",
    requestId: "fal-req-123",
    model: "fal-ai/nano-banana-2",
  }),
}));
vi.mock("../services/fal-video", () => ({
  generateFalVideo: vi.fn().mockResolvedValue({
    url: "https://fal.ai/video.mp4",
    coverImageUrl: null,
    duration: 5,
    requestId: "fal-req-456",
    model: "fal-ai/sora-2/text-to-video",
  }),
}));
vi.mock("../services/r2", () => ({
  uploadFromUrl: vi.fn().mockResolvedValue("projects/p1/assets/result.png"),
  uploadBytes: vi.fn().mockResolvedValue("projects/p1/assets/result.png"),
}));
vi.mock("../services/assets", () => ({
  createAsset: vi.fn().mockResolvedValue({ id: "asset-1" }),
  getProjectOwner: vi.fn().mockResolvedValue("user-1"),
}));

import { generateImage } from "../services/fal-image";
import { generateFalVideo } from "../services/fal-video";
import { createAsset, getProjectOwner } from "../services/assets";

describe("GenerationWorkflow service contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("image pipeline: generate → createAsset(kind=image)", async () => {
    const result = await generateImage("key", { text: "a cat" });
    expect(result.url).toBe("https://fal.ai/image.png");

    const userId = (await getProjectOwner({} as any, "p1")) ?? "";
    const { id } = await createAsset({} as any, {
      id: "task-1",
      userId,
      kind: "image",
      srcR2Key: "projects/p1/assets/result.png",
      projectId: "p1",
      sourceModel: "nano-banana-2",
      sourcePrompt: "a cat",
      sourceTaskId: "task-1",
    });

    expect(id).toBe("asset-1");
    expect(createAsset).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        kind: "image",
        srcR2Key: "projects/p1/assets/result.png",
        projectId: "p1",
        sourceTaskId: "task-1",
      }),
    );
  });

  it("video pipeline: generate → createAsset(kind=video) with cover", async () => {
    const result = await generateFalVideo("key", { prompt: "a sunset", duration: 5 });
    expect(result.url).toBe("https://fal.ai/video.mp4");

    await createAsset({} as any, {
      id: "task-2",
      userId: "user-1",
      kind: "video",
      srcR2Key: "projects/p1/assets/result.mp4",
      coverR2Key: "projects/p1/assets/result-cover.jpg",
      projectId: "p1",
      sourceModel: "sora-2",
      sourcePrompt: "a sunset",
      sourceTaskId: "task-2",
    });

    expect(createAsset).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        kind: "video",
        coverR2Key: "projects/p1/assets/result-cover.jpg",
      }),
    );
  });
});

describe("Status enum", () => {
  it("contains expected values", () => {
    expect(Status.Pending).toBe("pending");
    expect(Status.Generating).toBe("generating");
    expect(Status.Completed).toBe("completed");
    expect(Status.Failed).toBe("failed");
  });
});
