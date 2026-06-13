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

  it("uses the desktop GOOGLE_API_KEY for Google AI Studio image models", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const service = createMockExternalAigcService({
      variables: async () => ({ GOOGLE_API_KEY: "google-local-key" }),
      providerAccounts: async () => [
        {
          providerId: "official",
          upstreamId: "google",
          region: "global",
          enabled: true,
          availableVariables: ["GOOGLE_API_KEY"],
        },
      ],
      fetch: async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        calls.push({ url, init });
        if (url === "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent") {
          return Response.json({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      inlineData: {
                        mimeType: "image/png",
                        data: Buffer.from("real-google-image").toString("base64"),
                      },
                    },
                  ],
                },
              },
            ],
          });
        }
        return new Response("not found", { status: 404 });
      },
    } as never);

    const result = await service.generateImage({
      taskId: "task-google-image",
      prompt: "real google image",
      model: "gemini-flash-image-2",
      aspectRatio: "16:9",
      modelParams: { resolution: "1K" },
    });

    expect(result.provider).toBe("google");
    expect(result.modelEndpoint).toBe("gemini-3.1-flash-image");
    expect(Buffer.from(result.bytes).toString("utf8")).toBe("real-google-image");
    expect(result.contentType).toBe("image/png");
    expect(calls[0].init?.headers).toMatchObject({
      "x-goog-api-key": "google-local-key",
      "content-type": "application/json",
    });
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({
      contents: [{ parts: [{ text: "real google image" }] }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        responseFormat: { image: { aspectRatio: "16:9", imageSize: "1K" } },
      },
    });
  });

  it("uses the desktop GOOGLE_API_KEY for Google AI Studio TTS models", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const service = createMockExternalAigcService({
      variables: async () => ({ GOOGLE_API_KEY: "google-local-key" }),
      providerAccounts: async () => [
        {
          providerId: "official",
          upstreamId: "google",
          region: "global",
          enabled: true,
          availableVariables: ["GOOGLE_API_KEY"],
        },
      ],
      fetch: async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        calls.push({ url, init });
        if (url === "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-tts-preview:generateContent") {
          return Response.json({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      inlineData: {
                        mimeType: "audio/wav",
                        data: Buffer.from("real-google-audio").toString("base64"),
                      },
                    },
                  ],
                },
              },
            ],
          });
        }
        return new Response("not found", { status: 404 });
      },
    } as never);

    const result = await service.generateAudio({
      taskId: "task-google-tts",
      prompt: "Say hello from Google",
      model: "gemini-3.1-flash-tts",
      modelParams: { voice_name: "Kore" },
    });

    expect(result.provider).toBe("google");
    expect(result.modelEndpoint).toBe("gemini-3.1-flash-tts-preview");
    expect(Buffer.from(result.bytes).toString("utf8")).toBe("real-google-audio");
    expect(result.contentType).toBe("audio/wav");
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({
      contents: [{ parts: [{ text: "Say hello from Google" }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: "Kore" },
          },
        },
      },
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

  it("honors configured provider account availability when selecting a local route", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const service = createMockExternalAigcService({
      origin: "http://local.test",
      variables: async () => ({ FAL_API_KEY: "fal-local-key" }),
      providerAccounts: async () => [
        {
          providerId: "fal",
          enabled: false,
          availableVariables: ["FAL_API_KEY"],
        },
      ],
      fetch: async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        calls.push({ url, init });
        if (url === "https://queue.fal.run/fal-ai/nano-banana-2") {
          return Response.json({ request_id: "fal-weighted-image" });
        }
        if (url === "https://queue.fal.run/fal-ai/nano-banana-2/requests/fal-weighted-image/status") {
          return Response.json({ status: "COMPLETED" });
        }
        if (url === "https://queue.fal.run/fal-ai/nano-banana-2/requests/fal-weighted-image") {
          return Response.json({
            images: [{ url: "https://fal-cdn.test/image.png", width: 1024, height: 1024 }],
          });
        }
        if (url === "https://fal-cdn.test/image.png") {
          return new Response("weighted-fal-image", { headers: { "content-type": "image/png" } });
        }
        return new Response("not found", { status: 404 });
      },
    } as never);

    const result = await service.generateImage({
      taskId: "task-weighted-fal-image",
      prompt: "weighted image route",
      model: "nano-banana-2",
      aspectRatio: "1:1",
    });

    expect(result.provider).toBe("fal-mock");
    expect(result.modelEndpoint).toBe("fal-ai/nano-banana-2");
    expect(calls).toEqual([]);
  });

  it("uses the desktop KIE_API_KEY for KIE-routed image models", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const service = createMockExternalAigcService({
      variables: async () => ({ KIE_API_KEY: "kie-local-key", FAL_API_KEY: "fal-local-key" }),
      providerAccounts: async () => [
        {
          providerId: "kie",
          upstreamId: "kie",
          enabled: true,
          availableVariables: ["KIE_API_KEY"],
          weight: 100,
        },
        {
          providerId: "fal",
          upstreamId: "fal",
          enabled: true,
          availableVariables: ["FAL_API_KEY"],
        },
      ],
      fetch: async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        calls.push({ url, init });
        if (url === "https://api.kie.ai/api/v1/jobs/createTask") {
          return Response.json({ code: 200, msg: "success", data: { taskId: "kie-image-1" } });
        }
        if (url === "https://api.kie.ai/api/v1/jobs/recordInfo?taskId=kie-image-1") {
          return Response.json({
            code: 200,
            msg: "success",
            data: {
              taskId: "kie-image-1",
              state: "success",
              response: { resultUrls: ["https://kie-cdn.test/image.png"] },
            },
          });
        }
        if (url === "https://kie-cdn.test/image.png") {
          return new Response("real-kie-image", { headers: { "content-type": "image/png" } });
        }
        return new Response("not found", { status: 404 });
      },
    } as never);

    const result = await service.generateImage({
      taskId: "task-kie-real",
      prompt: "real kie image",
      model: "nano-banana-2",
      aspectRatio: "16:9",
      modelParams: { resolution: "1K", count: 1 },
    });

    expect(result.provider).toBe("kie");
    expect(result.modelEndpoint).toBe("nano-banana-2");
    expect(result.requestId).toBe("kie-image-1");
    expect(result.remoteUrl).toBe("https://kie-cdn.test/image.png");
    expect(Buffer.from(result.bytes).toString("utf8")).toBe("real-kie-image");
    expect(calls[0].init?.headers).toMatchObject({
      authorization: "Bearer kie-local-key",
      "content-type": "application/json",
    });
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({
      model: "nano-banana-2",
      input: {
        prompt: "real kie image",
        aspect_ratio: "16:9",
        resolution: "1K",
        count: 1,
      },
    });
  });

  it("uses the desktop REPLICATE_API_TOKEN for Replicate-routed image models", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const service = createMockExternalAigcService({
      variables: async () => ({ REPLICATE_API_TOKEN: "r8-local-token", OPENAI_API_KEY: "sk-local-openai" }),
      providerAccounts: async () => [
        {
          providerId: "replicate",
          upstreamId: "replicate",
          enabled: true,
          availableVariables: ["REPLICATE_API_TOKEN"],
          weight: 100,
        },
        {
          providerId: "official",
          upstreamId: "openai",
          enabled: true,
          availableVariables: ["OPENAI_API_KEY"],
        },
      ],
      fetch: async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        calls.push({ url, init });
        if (url === "https://api.replicate.com/v1/models/openai/gpt-image-2/predictions") {
          return Response.json({
            id: "replicate-image-1",
            status: "starting",
            urls: { get: "https://api.replicate.com/v1/predictions/replicate-image-1" },
          });
        }
        if (url === "https://api.replicate.com/v1/predictions/replicate-image-1") {
          return Response.json({
            id: "replicate-image-1",
            status: "succeeded",
            output: ["https://replicate-cdn.test/image.webp"],
          });
        }
        if (url === "https://replicate-cdn.test/image.webp") {
          return new Response("real-replicate-image", { headers: { "content-type": "image/webp" } });
        }
        return new Response("not found", { status: 404 });
      },
    } as never);

    const result = await service.generateImage({
      taskId: "task-replicate-real",
      prompt: "real replicate image",
      model: "gpt-image-2",
      aspectRatio: "1:1",
      modelParams: { size: "1024x1024", quality: "high" },
    });

    expect(result.provider).toBe("replicate");
    expect(result.modelEndpoint).toBe("openai/gpt-image-2");
    expect(result.requestId).toBe("replicate-image-1");
    expect(result.remoteUrl).toBe("https://replicate-cdn.test/image.webp");
    expect(Buffer.from(result.bytes).toString("utf8")).toBe("real-replicate-image");
    expect(calls[0].init?.headers).toMatchObject({
      authorization: "Bearer r8-local-token",
      "content-type": "application/json",
    });
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({
      input: {
        prompt: "real replicate image",
        aspect_ratio: "1:1",
        size: "1024x1024",
        quality: "high",
      },
    });
  });
});
