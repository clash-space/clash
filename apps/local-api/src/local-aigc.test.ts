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

  it("uses the desktop OPENAI_API_KEY for GPT Image instead of the mock route", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const service = createMockExternalAigcService({
      variables: async () => ({ OPENAI_API_KEY: "sk-local-openai" }),
      fetch: async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        calls.push({ url, init });
        return new Response(JSON.stringify({
          data: [{ b64_json: Buffer.from("real-openai-png").toString("base64") }],
        }), { headers: { "content-type": "application/json" } });
      },
    } as never);

    const result = await service.generateImage({
      taskId: "task-openai-real",
      prompt: "real openai image",
      model: "gpt-image-2",
      aspectRatio: "1:1",
    });

    expect(result.provider).toBe("openai");
    expect(result.modelEndpoint).toBe("gpt-image-2");
    expect(Buffer.from(result.bytes).toString("utf8")).toBe("real-openai-png");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.openai.com/v1/images/generations");
    expect(calls[0].init?.headers).toMatchObject({
      authorization: "Bearer sk-local-openai",
      "content-type": "application/json",
    });
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({
      model: "gpt-image-2",
      prompt: "real openai image",
    });
  });

  it("uses the desktop FAL_API_KEY for fal-routed video models", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const service = createMockExternalAigcService({
      variables: async () => ({ FAL_API_KEY: "fal-local-key" }),
      fetch: async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        calls.push({ url, init });
        if (url === "https://queue.fal.run/bytedance/seedance-2.0/text-to-video") {
          return Response.json({ request_id: "fal-real-1" });
        }
        if (url === "https://queue.fal.run/bytedance/seedance-2.0/text-to-video/requests/fal-real-1/status") {
          return Response.json({ status: "COMPLETED" });
        }
        if (url === "https://queue.fal.run/bytedance/seedance-2.0/text-to-video/requests/fal-real-1") {
          return Response.json({
            prompt: "real fal video",
            video: {
              url: "https://fal-cdn.test/video.mp4",
              width: 1280,
              height: 720,
              duration: 6,
            },
          });
        }
        if (url === "https://fal-cdn.test/video.mp4") {
          return new Response("real-fal-mp4", { headers: { "content-type": "video/mp4" } });
        }
        return new Response("not found", { status: 404 });
      },
    } as never);

    const result = await service.generateVideo({
      taskId: "task-fal-real",
      prompt: "real fal video",
      model: "seedance-2-text",
      aspectRatio: "16:9",
      duration: 6,
      modelParams: { resolution: "720p", generate_audio: true },
    });

    expect(result.provider).toBe("fal");
    expect(result.modelEndpoint).toBe("bytedance/seedance-2.0/text-to-video");
    expect(result.requestId).toBe("fal-real-1");
    expect(result.remoteUrl).toBe("https://fal-cdn.test/video.mp4");
    expect(result.width).toBe(1280);
    expect(result.height).toBe(720);
    expect(result.durationMs).toBe(6000);
    expect(Buffer.from(result.bytes).toString("utf8")).toBe("real-fal-mp4");
    expect(calls[0].init?.headers).toMatchObject({
      authorization: "Key fal-local-key",
      "content-type": "application/json",
    });
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({
      prompt: "real fal video",
      aspect_ratio: "16:9",
      duration: 6,
      resolution: "720p",
      generate_audio: true,
    });
  });
});
