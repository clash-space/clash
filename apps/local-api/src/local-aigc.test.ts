import { describe, expect, it } from "vitest";

import { createMockExternalAigcService } from "./local-aigc";

describe("local mock AIGC", () => {
  it("maps GPT Image 2 to the fal-shaped local mock provider", async () => {
    const service = createMockExternalAigcService({ origin: "http://local.test" });

    const result = await service.generateImage({
      taskId: "task-openai-image",
      prompt: "openai image2 local mock",
      model: "gpt-image-2",
      aspectRatio: "1:1",
    });

    expect(result.provider).toBe("fal-mock");
    expect(result.modelEndpoint).toBe("fal-ai/nano-banana-2");
    expect(result.remoteUrl).toContain("http://local.test/fal/media/");
    expect(result.contentType).toBe("image/svg+xml");
    expect(result.width).toBe(1024);
    expect(result.height).toBe(1024);
  });

  it("keeps fal queue/media shape while resolving model codes through shared routing", async () => {
    const service = createMockExternalAigcService({ origin: "http://local.test" });

    const result = await service.generateVideo({
      taskId: "task-seedance",
      prompt: "seedance mock fal shape",
      model: "seedance-2-ref",
      aspectRatio: "9:16",
      duration: 6,
    });

    expect(result.provider).toBe("fal-mock");
    expect(result.modelEndpoint).toBe("bytedance/seedance-2.0/reference-to-video");
    expect(result.remoteUrl).toContain("http://local.test/fal/media/");
    expect(result.contentType).toBe("video/mp4");
    expect(result.width).toBe(720);
    expect(result.height).toBe(1280);
    expect(result.durationMs).toBe(6000);
    expect(result.transcript).toBe("seedance mock fal shape");
  }, 45_000);
});
