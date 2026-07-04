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

  it("uses provider account OpenAI credentials for GPT Image instead of the mock route", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const service = createMockExternalAigcService({
      providerAccounts: async () => [{ providerId: "official", upstreamId: "openai", region: "global", enabled: true, configuredCredentials: ["apiKey"], credentials: { apiKey: "sk-local-openai" } }],
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

  it("uses OpenAI-compatible settings for local text generation", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const service = createMockExternalAigcService({
      providerAccounts: async () => [{ providerId: "official", upstreamId: "openai", region: "global", enabled: true, configuredCredentials: ["apiKey", "baseUrl"], credentials: { apiKey: "sk-local-openai", baseUrl: "https://openai-compatible.test/v1" } }],
      fetch: async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        calls.push({ url, init });
        return Response.json({ choices: [{ message: { content: "openai text result" } }] });
      },
    } as never);

    const result = await service.generateText({
      taskId: "task-openai-text",
      prompt: "write titles",
      model: "openai-compatible-text",
      modelParams: { model_name: "custom/text-model", system_prompt: "Be concise" },
    });

    expect(result).toMatchObject({
      text: "openai text result",
      provider: "openai-compatible",
      modelEndpoint: "custom/text-model",
    });
    expect(calls[0].url).toBe("https://openai-compatible.test/v1/chat/completions");
    expect(calls[0].init?.headers).toMatchObject({
      authorization: "Bearer sk-local-openai",
      "content-type": "application/json",
    });
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({
      model: "custom/text-model",
      messages: [
        { role: "system", content: "Be concise" },
        { role: "user", content: "write titles" },
      ],
    });
  });

  it("uses Anthropic-compatible settings for local text generation", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const service = createMockExternalAigcService({
      providerAccounts: async () => [
        {
          providerId: "official",
          upstreamId: "anthropic",
          region: "global",
          enabled: true,
          configuredCredentials: ["apiKey", "baseUrl"],
          credentials: { apiKey: "sk-ant-local", baseUrl: "https://anthropic-compatible.test" },
        },
      ],
      fetch: async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        calls.push({ url, init });
        return Response.json({ content: [{ type: "text", text: "anthropic text result" }] });
      },
    } as never);

    const result = await service.generateText({
      taskId: "task-anthropic-text",
      prompt: "write titles",
      model: "anthropic-compatible-text",
      modelParams: { model_name: "claude-compatible-custom", system_prompt: "Be concise" },
    });

    expect(result).toMatchObject({
      text: "anthropic text result",
      provider: "anthropic-compatible",
      modelEndpoint: "claude-compatible-custom",
    });
    expect(calls[0].url).toBe("https://anthropic-compatible.test/v1/messages");
    expect(calls[0].init?.headers).toMatchObject({
      "x-api-key": "sk-ant-local",
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    });
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({
      model: "claude-compatible-custom",
      system: "Be concise",
      messages: [{ role: "user", content: "write titles" }],
    });
  });

  it("uses provider account Google AI Studio credentials for image models", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const service = createMockExternalAigcService({
      providerAccounts: async () => [
        {
          providerId: "official",
          upstreamId: "google-ai-studio",
          region: "global",
          enabled: true,
          configuredCredentials: ["apiKey"],
          credentials: { apiKey: "google-local-key" },
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

  it("uses provider account Google AI Studio credentials for TTS models", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const service = createMockExternalAigcService({
      providerAccounts: async () => [
        {
          providerId: "official",
          upstreamId: "google-ai-studio",
          region: "global",
          enabled: true,
          configuredCredentials: ["apiKey"],
          credentials: { apiKey: "google-local-key" },
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

  it("uses provider account fal credentials for fal-routed video models", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const service = createMockExternalAigcService({
      providerAccounts: async () => [{ providerId: "fal", upstreamId: "fal", enabled: true, configuredCredentials: ["apiKey"], credentials: { apiKey: "fal-local-key" } }],
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
      providerAccounts: async () => [
        {
          providerId: "fal",
          enabled: false,
          configuredCredentials: ["apiKey"],
          credentials: { apiKey: "fal-local-key" },
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

  it("uses provider account KIE credentials for KIE-routed image models", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const service = createMockExternalAigcService({
      providerAccounts: async () => [
        {
          providerId: "kie",
          upstreamId: "kie",
          enabled: true,
          configuredCredentials: ["apiKey"],
          credentials: { apiKey: "kie-local-key" },
          weight: 100,
        },
        {
          providerId: "fal",
          upstreamId: "fal",
          enabled: true,
          configuredCredentials: ["apiKey"],
          credentials: { apiKey: "fal-local-key" },
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

  it("uses provider account Replicate credentials for Replicate-routed image models", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const service = createMockExternalAigcService({
      providerAccounts: async () => [
        {
          providerId: "replicate",
          upstreamId: "replicate",
          enabled: true,
          configuredCredentials: ["apiKey"],
          credentials: { apiKey: "r8-local-token" },
          weight: 100,
        },
        {
          providerId: "official",
          upstreamId: "openai",
          enabled: true,
          configuredCredentials: ["apiKey"],
          credentials: { apiKey: "sk-local-openai" },
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

  it("uses the highest-priority matching provider key for the selected route", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const service = createMockExternalAigcService({
      providerAccounts: async () => [
        {
          providerId: "replicate",
          upstreamId: "replicate",
          enabled: true,
          priority: 30,
          configuredCredentials: ["apiKey"],
          credentials: { apiKey: "r8-slow-token" },
          weight: 100,
        },
        {
          providerId: "replicate",
          upstreamId: "replicate",
          enabled: true,
          priority: 1,
          configuredCredentials: ["apiKey"],
          credentials: { apiKey: "r8-fast-token" },
          weight: 100,
        },
        {
          providerId: "official",
          upstreamId: "openai",
          enabled: true,
          configuredCredentials: ["apiKey"],
          credentials: { apiKey: "sk-local-openai" },
        },
      ],
      fetch: async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        calls.push({ url, init });
        if (url === "https://api.replicate.com/v1/models/openai/gpt-image-2/predictions") {
          return Response.json({
            id: "replicate-priority-1",
            status: "starting",
            urls: { get: "https://api.replicate.com/v1/predictions/replicate-priority-1" },
          });
        }
        if (url === "https://api.replicate.com/v1/predictions/replicate-priority-1") {
          return Response.json({
            id: "replicate-priority-1",
            status: "succeeded",
            output: ["https://replicate-cdn.test/priority.webp"],
          });
        }
        if (url === "https://replicate-cdn.test/priority.webp") {
          return new Response("priority-replicate-image", { headers: { "content-type": "image/webp" } });
        }
        return new Response("not found", { status: 404 });
      },
    } as never);

    const result = await service.generateImage({
      taskId: "task-replicate-priority",
      prompt: "priority replicate image",
      model: "gpt-image-2",
      aspectRatio: "1:1",
    });

    expect(result.provider).toBe("replicate");
    expect(result.requestId).toBe("replicate-priority-1");
    expect(Buffer.from(result.bytes).toString("utf8")).toBe("priority-replicate-image");
    expect(calls[0].init?.headers).toMatchObject({
      authorization: "Bearer r8-fast-token",
      "content-type": "application/json",
    });
  });

  it("uses the provider key allowed for the requested model", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const service = createMockExternalAigcService({
      providerAccounts: async () => [
        {
          providerId: "replicate",
          upstreamId: "replicate",
          enabled: true,
          priority: 1,
          supportedModelIds: ["nano-banana-2"],
          configuredCredentials: ["apiKey"],
          credentials: { apiKey: "r8-nano-token" },
          weight: 100,
        },
        {
          providerId: "replicate",
          upstreamId: "replicate",
          enabled: true,
          priority: 20,
          supportedModelIds: ["gpt-image-2"],
          configuredCredentials: ["apiKey"],
          credentials: { apiKey: "r8-gpt-token" },
          weight: 100,
        },
      ],
      fetch: async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        calls.push({ url, init });
        if (url === "https://api.replicate.com/v1/models/openai/gpt-image-2/predictions") {
          return Response.json({
            id: "replicate-model-filter-1",
            status: "starting",
            urls: { get: "https://api.replicate.com/v1/predictions/replicate-model-filter-1" },
          });
        }
        if (url === "https://api.replicate.com/v1/predictions/replicate-model-filter-1") {
          return Response.json({
            id: "replicate-model-filter-1",
            status: "succeeded",
            output: ["https://replicate-cdn.test/model-filter.webp"],
          });
        }
        if (url === "https://replicate-cdn.test/model-filter.webp") {
          return new Response("model-filter-replicate-image", { headers: { "content-type": "image/webp" } });
        }
        return new Response("not found", { status: 404 });
      },
    } as never);

    const result = await service.generateImage({
      taskId: "task-replicate-model-filter",
      prompt: "model filtered replicate image",
      model: "gpt-image-2",
      aspectRatio: "1:1",
    });

    expect(result.provider).toBe("replicate");
    expect(result.requestId).toBe("replicate-model-filter-1");
    expect(Buffer.from(result.bytes).toString("utf8")).toBe("model-filter-replicate-image");
    expect(calls[0].init?.headers).toMatchObject({
      authorization: "Bearer r8-gpt-token",
      "content-type": "application/json",
    });
  });

  it("uses per-model key priority before general provider priority", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const service = createMockExternalAigcService({
      providerAccounts: async () => [
        {
          providerId: "replicate",
          upstreamId: "replicate",
          enabled: true,
          priority: 1,
          modelPriorities: { "gpt-image-2": 20 },
          configuredCredentials: ["apiKey"],
          credentials: { apiKey: "r8-general-token" },
          weight: 100,
        },
        {
          providerId: "replicate",
          upstreamId: "replicate",
          enabled: true,
          priority: 20,
          modelPriorities: { "gpt-image-2": 10 },
          configuredCredentials: ["apiKey"],
          credentials: { apiKey: "r8-gpt-priority-token" },
          weight: 100,
        },
      ],
      fetch: async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        calls.push({ url, init });
        if (url === "https://api.replicate.com/v1/models/openai/gpt-image-2/predictions") {
          return Response.json({
            id: "replicate-model-priority-1",
            status: "starting",
            urls: { get: "https://api.replicate.com/v1/predictions/replicate-model-priority-1" },
          });
        }
        if (url === "https://api.replicate.com/v1/predictions/replicate-model-priority-1") {
          return Response.json({
            id: "replicate-model-priority-1",
            status: "succeeded",
            output: ["https://replicate-cdn.test/model-priority.webp"],
          });
        }
        if (url === "https://replicate-cdn.test/model-priority.webp") {
          return new Response("model-priority-replicate-image", { headers: { "content-type": "image/webp" } });
        }
        return new Response("not found", { status: 404 });
      },
    } as never);

    const result = await service.generateImage({
      taskId: "task-replicate-model-priority",
      prompt: "model priority replicate image",
      model: "gpt-image-2",
      aspectRatio: "1:1",
    });

    expect(result.provider).toBe("replicate");
    expect(result.requestId).toBe("replicate-model-priority-1");
    expect(Buffer.from(result.bytes).toString("utf8")).toBe("model-priority-replicate-image");
    expect(calls[0].init?.headers).toMatchObject({
      authorization: "Bearer r8-gpt-priority-token",
      "content-type": "application/json",
    });
  });
});
