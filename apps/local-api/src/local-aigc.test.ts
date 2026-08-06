import { describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";

import { createMockExternalAigcService, localExecutableModelCards } from "./local-aigc";
import { MODEL_CARDS, type ProviderUsageAuditEvent } from "@clash/shared-types";
import {
  createProviderConformanceStubs,
  createProviderTestRecorder,
  createProviderTestReplayFixtures,
  type ProviderTestRecordingEvent,
} from "./provider-test-recorder";

async function createTestPrivateKeyPem(): Promise<string> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
  const body = Buffer.from(pkcs8).toString("base64").match(/.{1,64}/g)?.join("\n") ?? "";
  return `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\n`;
}

describe("local mock AIGC", () => {
  it("does not advertise provider routes that the desktop Local API cannot execute", () => {
    const cards = localExecutableModelCards(MODEL_CARDS);
    const routes = (modelId: string) => cards
      .find((card) => card.id === modelId)
      ?.providerImplementations?.map((route) => route.apiShape);

    expect(routes("kling-3")).toEqual(expect.arrayContaining(["fal", "kie"]));
    expect(routes("kling-3")).not.toContain("kling");
    expect(routes("seedance-2.5-ref")).not.toContain("modelark");
    expect(routes("elevenlabs-tts")).toEqual([]);
  });

  it("routes a custom text model through its mounted compatible provider account", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const service = createMockExternalAigcService({
      providerAccounts: async () => [{
        id: "custom-openai-account",
        providerId: "custom",
        upstreamId: "openai",
        apiShape: "openai-compatible",
        enabled: true,
        configuredCredentials: ["apiKey", "baseUrl"],
        credentials: {
          apiKey: "sk-custom",
          baseUrl: "https://proxy.example/v1",
        },
      }],
      modelCards: async () => [{
        id: "editorial-pro",
        aliases: [],
        name: "Editorial Pro",
        provider: "Custom",
        kind: "text",
        custom: true,
        parameters: [],
        defaultParams: {},
        defaultAspectRatio: "16:9",
        input: {
          requiresPrompt: true,
          inputMode: {},
          promptModalities: ["text"],
        },
        availableProviders: ["custom"],
        defaultProvider: "custom",
        providerImplementations: [{
          providerId: "custom",
          accountId: "custom-openai-account",
          upstreamId: "openai",
          upstreamModel: "editorial/pro-v2",
          apiShape: "openai-compatible",
          requiredCredentials: ["apiKey", "baseUrl"],
        }],
      }],
      fetch: async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        calls.push({ url, init });
        return Response.json({
          model: "editorial/pro-v2",
          choices: [{ message: { content: "Custom provider response" } }],
        });
      },
    });

    const result = await service.generateText({
      taskId: "task-custom-text",
      prompt: "Draft an editorial.",
      model: "editorial-pro",
    });

    expect(result).toEqual({
      text: "Custom provider response",
      provider: "openai-compatible",
      modelEndpoint: "editorial/pro-v2",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://proxy.example/v1/chat/completions");
    expect(calls[0]?.init?.headers).toMatchObject({
      authorization: "Bearer sk-custom",
      "content-type": "application/json",
    });
    expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({
      model: "editorial/pro-v2",
    });
  });

  it("routes local TTS model generation through the installed speech runtime", async () => {
    const calls: unknown[] = [];
    const service = createMockExternalAigcService({
      providerAccounts: async () => [{
        providerId: "local",
        upstreamId: "local",
        enabled: true,
      }],
      localTts: async (input) => {
        calls.push(input);
        return {
          bytes: new TextEncoder().encode("local-wav"),
          contentType: "audio/wav",
          durationMs: 1280,
          transcript: input.prompt,
          provider: "piper",
          modelEndpoint: input.model,
        };
      },
    });

    const result = await service.generateAudio({
      taskId: "task-local-tts",
      prompt: "Clash 本地语音",
      model: "piper-huayan-tts",
      modelParams: { voice_name: "huayan", speed: 1.1 },
    });

    expect(calls).toEqual([{
      taskId: "task-local-tts",
      prompt: "Clash 本地语音",
      model: "zh_CN-huayan-medium",
      modelParams: { voice_name: "huayan", speed: 1.1 },
    }]);
    expect(result).toMatchObject({
      contentType: "audio/wav",
      durationMs: 1280,
      transcript: "Clash 本地语音",
      provider: "piper",
      modelEndpoint: "zh_CN-huayan-medium",
    });
  });

  it("maps GPT Image 2 to the fal-shaped local mock provider", async () => {
    const service = createMockExternalAigcService({ origin: "http://local.test" });

    const result = await service.generateImage({
      taskId: "task-openai-image",
      prompt: "openai image2 local mock",
      model: "gpt-image-2",
      aspectRatio: "1:1",
    });

    expect(result.provider).toBe("fal-mock");
    expect(result.modelEndpoint).toBe("openai/gpt-image-2");
    expect(result.remoteUrl).toContain("http://local.test/fal/media/");
    expect(result.contentType).toBe("image/svg+xml");
    expect(result.width).toBe(1024);
    expect(result.height).toBe(1024);
  });

  it("preserves an exact 2:1 Director panorama ratio in the local fal mock", async () => {
    const service = createMockExternalAigcService({ origin: "http://local.test" });

    const result = await service.generateImage({
      taskId: "task-director-panorama",
      prompt: "Director panorama local mock",
      model: "nano-banana-2",
      aspectRatio: "2:1",
    });

    expect(result.provider).toBe("fal-mock");
    expect(result.width).toBe(1024);
    expect(result.height).toBe(512);
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
      orderedContentParts: [
        { type: "text", text: "Write titles for " },
        { type: "image", url: `data:image/png;base64,${Buffer.from("reference-image").toString("base64")}` },
        { type: "text", text: "." },
      ],
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
        {
          role: "user",
          content: [
            { type: "text", text: "Write titles for " },
            {
              type: "image_url",
              image_url: { url: `data:image/png;base64,${Buffer.from("reference-image").toString("base64")}` },
            },
            { type: "text", text: "." },
          ],
        },
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
      model: "gemini-3.1-flash-image",
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

  it("runs Gemini Omni video through Interactions while preserving text/image order", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const jacket = `data:image/png;base64,${Buffer.from("jacket").toString("base64")}`;
    const mood = `data:image/webp;base64,${Buffer.from("mood").toString("base64")}`;
    const service = createMockExternalAigcService({
      providerAccounts: async () => [{
        id: "google-ai-studio-primary",
        providerId: "official",
        upstreamId: "google-ai-studio",
        region: "global",
        enabled: true,
        configuredCredentials: ["apiKey"],
        credentials: { apiKey: "google-local-key" },
      }],
      fetch: async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        calls.push({ url, init });
        if (url.endsWith("/interactions") && init?.method === "POST") {
          return Response.json({ id: "interactions/omni-local", status: "in_progress" });
        }
        if (url.endsWith("/interactions/omni-local")) {
          return Response.json({
            id: "interactions/omni-local",
            status: "completed",
            steps: [{
              content: [{ type: "video", uri: "https://files.example/omni-local.mp4", mime_type: "video/mp4" }],
            }],
          });
        }
        if (url === "https://files.example/omni-local.mp4") {
          return new Response("omni-video", { headers: { "content-type": "video/mp4" } });
        }
        return new Response("not found", { status: 404 });
      },
    } as never);

    const result = await service.generateVideo({
      taskId: "task-gemini-omni",
      prompt: "Use the jacket and mood references.",
      model: "gemini-omni-flash",
      aspectRatio: "9:16",
      duration: 7,
      orderedContentParts: [
        { type: "text", text: "Use " },
        { type: "image", url: jacket },
        { type: "text", text: " as the jacket reference." },
      ],
      referenceImageUrls: [jacket, mood],
    });

    expect(calls.map((call) => call.url)).toEqual([
      "https://generativelanguage.googleapis.com/v1beta/interactions",
      "https://generativelanguage.googleapis.com/v1beta/interactions/omni-local",
      "https://files.example/omni-local.mp4",
    ]);
    expect(calls[0].init?.headers).toMatchObject({
      "x-goog-api-key": "google-local-key",
    });
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      model: "gemini-omni-flash-preview",
      input: [
        { type: "text", text: "Use " },
        { type: "image", data: Buffer.from("jacket").toString("base64"), mime_type: "image/png" },
        { type: "text", text: " as the jacket reference." },
        { type: "image", data: Buffer.from("mood").toString("base64"), mime_type: "image/webp" },
      ],
      response_format: {
        type: "video",
        aspect_ratio: "9:16",
        duration: "7s",
        delivery: "uri",
      },
      background: true,
      store: true,
      stream: false,
    });
    expect(result).toMatchObject({
      contentType: "video/mp4",
      provider: "google",
      modelEndpoint: "gemini-omni-flash-preview",
      requestId: "interactions/omni-local",
    });
    expect(Buffer.from(result.bytes).toString()).toBe("omni-video");
  });

  it("runs Gemini Omni through Cloudflare Gateway BYOK and remaps Google file downloads", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const gateway = "https://gateway.ai.cloudflare.com/v1/account/gateway/google-ai-studio";
    const service = createMockExternalAigcService({
      googleAiStudioBaseUrl: gateway,
      googleAiStudioGatewayToken: "cloudflare-token",
      fetch: async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        calls.push({ url, init });
        if (url === `${gateway}/v1beta/interactions`) {
          return Response.json({ id: "interactions/gateway-local", status: "in_progress" });
        }
        if (url === `${gateway}/v1beta/interactions/gateway-local`) {
          return Response.json({
            id: "interactions/gateway-local",
            status: "completed",
            steps: [{
              content: [{
                type: "video",
                uri: "https://generativelanguage.googleapis.com/v1beta/files/gateway-video:download?alt=media",
                mime_type: "video/mp4",
              }],
            }],
          });
        }
        if (url === `${gateway}/v1beta/files/gateway-video`) {
          return Response.json({ name: "files/gateway-video", state: "ACTIVE" });
        }
        if (url === `${gateway}/v1beta/files/gateway-video:download?alt=media`) {
          return new Response("gateway-omni-video", { headers: { "content-type": "video/mp4" } });
        }
        return new Response("not found", { status: 404 });
      },
    } as never);

    const result = await service.generateVideo({
      taskId: "task-gemini-gateway",
      prompt: "One red paper boat on calm water.",
      model: "gemini-omni-flash",
      aspectRatio: "16:9",
      duration: 3,
    });

    expect(calls.map((call) => call.url)).toEqual([
      `${gateway}/v1beta/interactions`,
      `${gateway}/v1beta/interactions/gateway-local`,
      `${gateway}/v1beta/files/gateway-video`,
      `${gateway}/v1beta/files/gateway-video:download?alt=media`,
    ]);
    for (const call of calls) {
      expect(call.init?.headers).toMatchObject({
        "cf-aig-authorization": "Bearer cloudflare-token",
        "cf-aig-skip-cache": "true",
      });
      expect((call.init?.headers as Record<string, string>)["x-goog-api-key"]).toBeUndefined();
    }
    expect(Buffer.from(result.bytes).toString()).toBe("gateway-omni-video");
  });

  it("rejects a Cloudflare Gateway token without its Google AI Studio Gateway base URL", async () => {
    const service = createMockExternalAigcService({
      googleAiStudioGatewayToken: "cloudflare-token",
      fetch: async () => {
        throw new Error("invalid Gateway configuration attempted a live fetch");
      },
    } as never);

    await expect(service.generateVideo({
      taskId: "task-gemini-invalid-gateway",
      prompt: "A paper boat.",
      model: "gemini-omni-flash",
      aspectRatio: "16:9",
      duration: 3,
    })).rejects.toThrow(
      "Cloudflare AI Gateway token requires a Cloudflare Google AI Studio Gateway base URL.",
    );
  });

  it("rejects simultaneous Google API key and Cloudflare Gateway token environment credentials", async () => {
    const service = createMockExternalAigcService({
      googleAiStudioApiKey: "google-api-key",
      googleAiStudioBaseUrl: "https://gateway.ai.cloudflare.com/v1/account/gateway/google-ai-studio",
      googleAiStudioGatewayToken: "cloudflare-token",
    } as never);

    await expect(service.generateVideo({
      taskId: "task-gemini-conflicting-gateway",
      prompt: "A paper boat.",
      model: "gemini-omni-flash",
      aspectRatio: "16:9",
      duration: 3,
    })).rejects.toThrow(
      "Choose either Google API key or Cloudflare AI Gateway token for Gemini Omni.",
    );
  });

  it("records and replays ordered Gemini Omni Gateway traffic offline", async () => {
    const gateway = "https://gateway.ai.cloudflare.com/v1/account/gateway/google-ai-studio";
    const gatewayToken = "cloudflare-token-that-must-not-be-recorded";
    const imageData = Buffer.from("ordered-image-reference").toString("base64");
    const videoBytes = new Uint8Array([0, 1, 2, 3, 128, 254, 255]);
    const stub = createProviderConformanceStubs()
      .find((candidate) => candidate.upstreamId === "google-ai-studio" && candidate.modelId === "gemini-omni-flash");
    expect(stub).toBeTruthy();
    const events: ProviderTestRecordingEvent[] = [];
    let requestIndex = 0;
    const recorder = createProviderTestRecorder({
      requestId: () => `gemini-omni-gateway-${++requestIndex}`,
      write: async (event) => {
        events.push(event);
      },
    });
    const upstreamFetch = async (input: string | URL | Request) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url === `${gateway}/v1beta/interactions`) {
          return Response.json({ id: "interactions/recorded-omni", status: "in_progress" });
        }
        if (url === `${gateway}/v1beta/interactions/recorded-omni`) {
          return Response.json({
            id: "interactions/recorded-omni",
            status: "completed",
            steps: [{
              content: [{
                type: "video",
                uri: "https://generativelanguage.googleapis.com/v1beta/files/recorded-video:download?alt=media",
                mime_type: "video/mp4",
              }],
            }],
          });
        }
        if (url === `${gateway}/v1beta/files/recorded-video`) {
          return Response.json({ name: "files/recorded-video", state: "ACTIVE" });
        }
        if (url === `${gateway}/v1beta/files/recorded-video:download?alt=media`) {
          return new Response(videoBytes, { headers: { "content-type": "video/mp4" } });
        }
        return new Response("not found", { status: 404 });
      };
    const input = {
      taskId: "task-gemini-record-replay",
      prompt: "Fallback prompt",
      model: "gemini-omni-flash",
      aspectRatio: "16:9",
      duration: 3,
      orderedContentParts: [
        { type: "text" as const, text: "Begin with the red paper boat. " },
        { type: "image" as const, url: `data:image/png;base64,${imageData}` },
        { type: "text" as const, text: "Then let it drift into moonlight." },
      ],
    };
    const liveService = createMockExternalAigcService({
      googleAiStudioBaseUrl: gateway,
      googleAiStudioGatewayToken: gatewayToken,
      fetch: upstreamFetch,
      providerTraffic: {
        mode: "record",
        recorder: async () => recorder,
      },
    } as never);

    const liveResult = await liveService.generateVideo(input);
    expect(liveResult.bytes).toEqual(videoBytes);
    const creation = events.find((event) => event.type === "request" && event.request.url.endsWith("/interactions"));
    expect(creation).toMatchObject({
      request: {
        headers: {
          "cf-aig-authorization": "[redacted]",
          "cf-aig-skip-cache": "true",
        },
        body: {
          input: [
            { type: "text", text: "Begin with the red paper boat. " },
            { type: "image", data: imageData, mime_type: "image/png" },
            { type: "text", text: "Then let it drift into moonlight." },
          ],
        },
      },
    });
    expect(JSON.stringify(events)).not.toContain(gatewayToken);

    const replayService = createMockExternalAigcService({
      fetch: async () => {
        throw new Error("offline replay attempted a live fetch");
      },
      providerTraffic: {
        mode: "replay",
        fixtures: async () => createProviderTestReplayFixtures(events),
      },
    } as never);
    const replayResult = await replayService.generateVideo(input);

    expect(replayResult.bytes).toEqual(videoBytes);
    expect(replayResult.requestId).toBe("interactions/recorded-omni");
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

  it("uses provider account Google Cloud Agent Platform credentials for text models", async () => {
    const privateKey = await createTestPrivateKeyPem();
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const service = createMockExternalAigcService({
      providerAccounts: async () => [
        {
          providerId: "official",
          upstreamId: "google-agent-platform",
          region: "global",
          enabled: true,
          configuredCredentials: ["vertexCredentials"],
          credentials: {
            vertexCredentials: JSON.stringify({
              project_id: "vertex-project",
              client_email: "svc@vertex-project.iam.gserviceaccount.com",
              private_key: privateKey,
            }),
          },
        },
      ],
      fetch: async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        calls.push({ url, init });
        if (url === "https://oauth2.googleapis.com/token") {
          return Response.json({ access_token: "vertex-access-token", expires_in: 3600 });
        }
        if (url === "https://aiplatform.googleapis.com/v1/projects/vertex-project/locations/global/publishers/google/models/gemini-3-flash-preview:generateContent") {
          return Response.json({
            candidates: [
              {
                content: {
                  parts: [{ text: "vertex text result" }],
                },
              },
            ],
          });
        }
        return new Response("not found", { status: 404 });
      },
    } as never);

    const result = await service.generateText({
      taskId: "task-google-agent-platform-text",
      prompt: "Transcribe this audio verbatim.",
      model: "gemini-3-flash",
      modelParams: { system_prompt: "Be exact" },
      orderedContentParts: [
        { type: "text", text: "Use " },
        { type: "image", url: `data:image/png;base64,${Buffer.from("image-bytes").toString("base64")}` },
        { type: "text", text: " then transcribe " },
        { type: "audio", url: `data:audio/webm;base64,${Buffer.from("voice-bytes").toString("base64")}` },
      ],
    });

    expect(result).toEqual({
      text: "vertex text result",
      provider: "google-agent-platform",
      modelEndpoint: "gemini-3-flash-preview",
    });
    expect(calls[0].url).toBe("https://oauth2.googleapis.com/token");
    expect(String(calls[0].init?.body)).toContain("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer");
    expect(String(calls[0].init?.body)).toContain("assertion=");
    expect(calls[1].init?.headers).toMatchObject({
      authorization: "Bearer vertex-access-token",
      "content-type": "application/json",
    });
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({
      contents: [{
        role: "user",
        parts: [
          { text: "Use " },
          {
            inlineData: {
              mimeType: "image/png",
              data: Buffer.from("image-bytes").toString("base64"),
            },
          },
          { text: " then transcribe " },
          {
            inlineData: {
              mimeType: "audio/webm",
              data: Buffer.from("voice-bytes").toString("base64"),
            },
          },
        ],
      }],
      systemInstruction: { parts: [{ text: "Be exact" }] },
    });
  });

  it("uses provider account Google Cloud Agent Platform credentials for image models", async () => {
    const privateKey = await createTestPrivateKeyPem();
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const service = createMockExternalAigcService({
      providerAccounts: async () => [
        {
          providerId: "official",
          upstreamId: "google-agent-platform",
          region: "global",
          enabled: true,
          configuredCredentials: ["vertexCredentials"],
          credentials: {
            vertexCredentials: JSON.stringify({
              project_id: "vertex-project",
              client_email: "svc@vertex-project.iam.gserviceaccount.com",
              private_key: privateKey,
            }),
          },
        },
      ],
      fetch: async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        calls.push({ url, init });
        if (url === "https://oauth2.googleapis.com/token") {
          return Response.json({ access_token: "vertex-access-token", expires_in: 3600 });
        }
        if (url === "https://aiplatform.googleapis.com/v1/projects/vertex-project/locations/global/publishers/google/models/gemini-3.1-flash-image:generateContent") {
          return Response.json({
            candidates: [
              {
                content: {
                  parts: [
                    { text: "image preface" },
                    {
                      inlineData: {
                        mimeType: "image/png",
                        data: Buffer.from("vertex-google-image").toString("base64"),
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
      taskId: "task-google-agent-platform-image",
      prompt: "draw a routing map",
      model: "nano-banana-2",
      aspectRatio: "16:9",
    });

    expect(result.provider).toBe("google-agent-platform");
    expect(result.modelEndpoint).toBe("gemini-3.1-flash-image");
    expect(Buffer.from(result.bytes).toString("utf8")).toBe("vertex-google-image");
    expect(result.contentType).toBe("image/png");
    expect(calls[1].init?.headers).toMatchObject({
      authorization: "Bearer vertex-access-token",
      "content-type": "application/json",
    });
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({
      contents: [{ role: "user", parts: [{ text: "draw a routing map" }] }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: { aspectRatio: "16:9" },
      },
    });
  });

  it("uses provider account Google Cloud Agent Platform credentials for text-to-video models", async () => {
    const privateKey = await createTestPrivateKeyPem();
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const operationName = "projects/vertex-project/locations/global/publishers/google/models/veo-3.1-fast-generate-001/operations/op-1";
    const service = createMockExternalAigcService({
      providerAccounts: async () => [
        {
          providerId: "official",
          upstreamId: "google-agent-platform",
          region: "global",
          enabled: true,
          configuredCredentials: ["vertexCredentials"],
          credentials: {
            vertexCredentials: JSON.stringify({
              project_id: "vertex-project",
              client_email: "svc@vertex-project.iam.gserviceaccount.com",
              private_key: privateKey,
            }),
          },
        },
      ],
      fetch: async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        calls.push({ url, init });
        if (url === "https://oauth2.googleapis.com/token") {
          return Response.json({ access_token: "vertex-access-token", expires_in: 3600 });
        }
        if (url === "https://aiplatform.googleapis.com/v1/projects/vertex-project/locations/global/publishers/google/models/veo-3.1-fast-generate-001:predictLongRunning") {
          return Response.json({ name: operationName });
        }
        if (url === "https://aiplatform.googleapis.com/v1/projects/vertex-project/locations/global/publishers/google/models/veo-3.1-fast-generate-001:fetchPredictOperation") {
          return Response.json({
            name: operationName,
            done: true,
            response: {
              videos: [
                {
                  bytesBase64Encoded: Buffer.from("vertex-google-video").toString("base64"),
                  mimeType: "video/mp4",
                },
              ],
            },
          });
        }
        return new Response("not found", { status: 404 });
      },
    } as never);

    const result = await service.generateVideo({
      taskId: "task-google-agent-platform-video",
      prompt: "a tiny router interface recording",
      model: "veo-3.1-fast",
      aspectRatio: "16:9",
      duration: 4,
    });

    expect(result.provider).toBe("google-agent-platform");
    expect(result.modelEndpoint).toBe("veo-3.1-fast-generate-001");
    expect(result.requestId).toBe(operationName);
    expect(Buffer.from(result.bytes).toString("utf8")).toBe("vertex-google-video");
    expect(result.contentType).toBe("video/mp4");
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({
      instances: [{ prompt: "a tiny router interface recording" }],
      parameters: {
        aspectRatio: "16:9",
        durationSeconds: 4,
        personGeneration: "allow_adult",
        sampleCount: 1,
      },
    });
    expect(JSON.parse(String(calls[2].init?.body))).toEqual({ operationName });
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

  it("renders Seedance inline references with the fal token dialect", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const service = createMockExternalAigcService({
      providerAccounts: async () => [{ providerId: "fal", upstreamId: "fal", enabled: true, configuredCredentials: ["apiKey"], credentials: { apiKey: "fal-local-key" } }],
      fetch: async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        calls.push({ url, init });
        if (url === "https://queue.fal.run/bytedance/seedance-2.0/reference-to-video") return Response.json({ request_id: "fal-ref-1" });
        if (url.endsWith("/requests/fal-ref-1/status")) return Response.json({ status: "COMPLETED" });
        if (url.endsWith("/requests/fal-ref-1")) return Response.json({ video: { url: "https://fal-cdn.test/ref.mp4" } });
        if (url === "https://fal-cdn.test/ref.mp4") return new Response("fal-ref-video", { headers: { "content-type": "video/mp4" } });
        return new Response("not found", { status: 404 });
      },
    } as never);

    await service.generateVideo({
      taskId: "task-fal-ref",
      prompt: "fallback labels",
      model: "seedance-2-ref",
      referenceImageUrls: ["https://media.test/a.png", "https://media.test/b.png"],
      referenceAudioUrls: ["https://media.test/a.mp3"],
      orderedContentParts: [
        { type: "text", text: "Use " },
        { type: "image", url: "https://media.test/b.png" },
        { type: "text", text: " with " },
        { type: "audio", url: "https://media.test/a.mp3" },
      ],
    });

    expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({
      prompt: "Use @Image2 with @Audio1",
      image_urls: ["https://media.test/a.png", "https://media.test/b.png"],
      audio_urls: ["https://media.test/a.mp3"],
    });
  });

  it("projects MiniMax H3 all-purpose references to the selected local fal route", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const service = createMockExternalAigcService({
      providerAccounts: async () => [{
        providerId: "fal",
        upstreamId: "fal",
        apiShape: "fal",
        enabled: true,
        configuredCredentials: ["apiKey"],
        credentials: { apiKey: "fal-local-key" },
      }],
      fetch: async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        calls.push({ url, init });
        if (url === "https://queue.fal.run/minimax/h3/reference-to-video") return Response.json({ request_id: "fal-h3-ref-1" });
        if (url.endsWith("/requests/fal-h3-ref-1/status")) return Response.json({ status: "COMPLETED" });
        if (url.endsWith("/requests/fal-h3-ref-1")) return Response.json({ video: { url: "https://fal-cdn.test/h3-ref.mp4", duration: 8 } });
        if (url === "https://fal-cdn.test/h3-ref.mp4") return new Response("fal-h3-ref-video", { headers: { "content-type": "video/mp4" } });
        return new Response("not found", { status: 404 });
      },
    } as never);

    const result = await service.generateVideo({
      taskId: "task-fal-h3-ref",
      prompt: "Use the character and motion",
      model: "minimax-h3",
      aspectRatio: "adaptive",
      duration: 8,
      referenceImageUrls: ["https://media.test/character.png"],
      referenceVideoUrls: ["https://media.test/motion.mp4"],
      referenceAudioUrls: ["https://media.test/voice.mp3"],
      orderedContentParts: [
        { type: "text", text: "Use " },
        { type: "image", url: "https://media.test/character.png" },
        { type: "text", text: " and " },
        { type: "video", url: "https://media.test/motion.mp4" },
      ],
      modelParams: { resolution: "2K" },
    });

    expect(result).toMatchObject({ provider: "fal", modelEndpoint: "minimax/h3/reference-to-video" });
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      prompt: "Use Image 1 and Video 1",
      aspect_ratio: "adaptive",
      duration: 8,
      resolution: "2K",
      reference_image_urls: ["https://media.test/character.png"],
      reference_video_urls: ["https://media.test/motion.mp4"],
      reference_audio_urls: ["https://media.test/voice.mp3"],
    });
  });

  it("delegates a linked fal projector through the executable-plugin ABI without exposing raw asset URLs", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const projectorCalls: unknown[] = [];
    const binding = {
      pluginId: "clash-first-party-media",
      version: "0.1.0",
      exportId: "fal-h3",
      schemaHash: `sha256:${"a".repeat(64)}`,
    } as const;
    const service = createMockExternalAigcService({
      providerAccounts: async () => [{
        providerId: "fal",
        upstreamId: "fal",
        apiShape: "fal",
        enabled: true,
        configuredCredentials: ["apiKey"],
        credentials: { apiKey: "fal-local-key" },
      }],
      providerPluginProjector: async (request) => {
        projectorCalls.push(request);
        const imageReference = request.input.references.find((reference) => reference.slot === "image");
        expect(imageReference && "asset" in imageReference ? imageReference.asset.uri : null)
          .toMatch(/^clash-asset:\/\//);
        expect(JSON.stringify(request)).not.toContain("https://media.test/character.png");
        return {
          binding,
          projection: {
            endpoint: "minimax/h3/reference-to-video",
            input: {
              projected_by_plugin: true,
              reference_image_urls: [imageReference && "asset" in imageReference
                ? imageReference.asset.uri
                : "missing"],
            },
          },
        };
      },
      fetch: async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        calls.push({ url, init });
        if (url === "https://queue.fal.run/minimax/h3/reference-to-video") return Response.json({ request_id: "plugin-h3-1" });
        if (url.endsWith("/requests/plugin-h3-1/status")) return Response.json({ status: "COMPLETED" });
        if (url.endsWith("/requests/plugin-h3-1")) return Response.json({ video: { url: "https://fal-cdn.test/plugin-h3.mp4" } });
        if (url === "https://fal-cdn.test/plugin-h3.mp4") return new Response("plugin-h3-video", { headers: { "content-type": "video/mp4" } });
        return new Response("not found", { status: 404 });
      },
    });

    const result = await service.generateVideo({
      taskId: "task-plugin-h3",
      projectId: "project-plugin-h3",
      nodeId: "node-plugin-h3",
      prompt: "Use the character",
      model: "minimax-h3",
      duration: 8,
      referenceImageUrls: ["https://media.test/character.png"],
      modelParams: { resolution: "2K" },
    });

    expect(projectorCalls).toHaveLength(1);
    expect(projectorCalls[0]).toMatchObject({
      pluginId: "clash-first-party-media",
      exportId: "fal-h3",
      kind: "video",
      taskId: "task-plugin-h3",
      projectId: "project-plugin-h3",
      nodeId: "node-plugin-h3",
      input: { values: { prompt: "Use the character", resolution: "2K", duration: 8 } },
    });
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      projected_by_plugin: true,
      reference_image_urls: ["https://media.test/character.png"],
    });
    expect(result.pluginBinding).toEqual(binding);
  });

  it("uses fal H3 text transport when the all-purpose Card has no references", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const service = createMockExternalAigcService({
      providerAccounts: async () => [{ providerId: "fal", upstreamId: "fal", apiShape: "fal", enabled: true, configuredCredentials: ["apiKey"], credentials: { apiKey: "fal-local-key" } }],
      fetch: async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        calls.push({ url, init });
        if (url === "https://queue.fal.run/minimax/h3/text-to-video") return Response.json({ request_id: "fal-h3-text-1" });
        if (url.endsWith("/requests/fal-h3-text-1/status")) return Response.json({ status: "COMPLETED" });
        if (url.endsWith("/requests/fal-h3-text-1")) return Response.json({ video: { url: "https://fal-cdn.test/h3-text.mp4" } });
        if (url === "https://fal-cdn.test/h3-text.mp4") return new Response("fal-h3-text-video", { headers: { "content-type": "video/mp4" } });
        return new Response("not found", { status: 404 });
      },
    } as never);

    await service.generateVideo({
      taskId: "task-fal-h3-text",
      prompt: "a paper city wakes up",
      model: "minimax-h3",
      aspectRatio: "16:9",
      duration: 6,
      modelParams: { resolution: "768P" },
    });

    expect(calls[0]?.url).toBe("https://queue.fal.run/minimax/h3/text-to-video");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      prompt: "a paper city wakes up",
      aspect_ratio: "16:9",
      duration: 6,
      resolution: "768P",
    });
  });

  it("rejects fal H3 Auto ratio without an all-purpose reference", async () => {
    const service = createMockExternalAigcService({
      providerAccounts: async () => [{ providerId: "fal", upstreamId: "fal", apiShape: "fal", enabled: true, configuredCredentials: ["apiKey"], credentials: { apiKey: "fal-local-key" } }],
      fetch: async () => {
        throw new Error("fal must not be called");
      },
    } as never);

    await expect(service.generateVideo({
      taskId: "task-fal-h3-auto-without-ref",
      prompt: "a paper city wakes up",
      model: "minimax-h3",
      aspectRatio: "adaptive",
      duration: 6,
      modelParams: { resolution: "768P" },
    })).rejects.toThrow(/auto.*reference/i);
  });

  it("projects the MiniMax H3 start/end Card to fal image fields", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const service = createMockExternalAigcService({
      providerAccounts: async () => [{ providerId: "fal", upstreamId: "fal", apiShape: "fal", enabled: true, configuredCredentials: ["apiKey"], credentials: { apiKey: "fal-local-key" } }],
      fetch: async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        calls.push({ url, init });
        if (url === "https://queue.fal.run/minimax/h3/image-to-video") return Response.json({ request_id: "fal-h3-frames-1" });
        if (url.endsWith("/requests/fal-h3-frames-1/status")) return Response.json({ status: "COMPLETED" });
        if (url.endsWith("/requests/fal-h3-frames-1")) return Response.json({ video: { url: "https://fal-cdn.test/h3-frames.mp4" } });
        if (url === "https://fal-cdn.test/h3-frames.mp4") return new Response("fal-h3-frames-video", { headers: { "content-type": "video/mp4" } });
        return new Response("not found", { status: 404 });
      },
    } as never);

    await service.generateVideo({
      taskId: "task-fal-h3-frames",
      prompt: "transition between frames",
      model: "minimax-h3-startend",
      startFrameUrl: "https://media.test/start.png",
      endFrameUrl: "https://media.test/end.png",
      duration: 7,
      aspectRatio: "9:16",
      modelParams: { resolution: "2K" },
    });

    expect(calls[0]?.url).toBe("https://queue.fal.run/minimax/h3/image-to-video");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      prompt: "transition between frames",
      duration: 7,
      resolution: "2K",
      image_url: "https://media.test/start.png",
      end_image_url: "https://media.test/end.png",
    });
  });

  it("projects Kling 3 start/end frames and string duration to fal", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const service = createMockExternalAigcService({
      providerAccounts: async () => [{ providerId: "fal", upstreamId: "fal", apiShape: "fal", enabled: true, configuredCredentials: ["apiKey"], credentials: { apiKey: "fal-local-key" } }],
      fetch: async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        calls.push({ url, init });
        if (url === "https://queue.fal.run/fal-ai/kling-video/v3/pro/image-to-video") return Response.json({ request_id: "fal-kling-3-1" });
        if (url.endsWith("/requests/fal-kling-3-1/status")) return Response.json({ status: "COMPLETED" });
        if (url.endsWith("/requests/fal-kling-3-1")) return Response.json({ video: { url: "https://fal-cdn.test/kling-3.mp4" } });
        if (url === "https://fal-cdn.test/kling-3.mp4") return new Response("fal-kling-video", { headers: { "content-type": "video/mp4" } });
        return new Response("not found", { status: 404 });
      },
    } as never);

    await service.generateVideo({
      taskId: "task-fal-kling-3",
      prompt: "transition between frames",
      model: "kling-3",
      startFrameUrl: "https://media.test/start.png",
      endFrameUrl: "https://media.test/end.png",
      duration: 10,
      modelParams: { generate_audio: true },
    });

    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      prompt: "transition between frames",
      duration: "10",
      generate_audio: true,
      start_image_url: "https://media.test/start.png",
      end_image_url: "https://media.test/end.png",
    });
  });

  it("stages and forwards Seedance references on the Dreamina CLI stdio route", async () => {
    const calls: string[][] = [];
    const dreaminaRun = async (args: string[]) => {
      calls.push(args);
      if (args[0] === "query_result") {
        const outputDir = args.find((arg) => arg.startsWith("--download_dir="))?.slice("--download_dir=".length);
        if (!outputDir) throw new Error("missing output dir");
        await writeFile(`${outputDir}/result.mp4`, "dreamina-video");
        return { stdout: JSON.stringify({ gen_status: "success" }), stderr: "" };
      }
      return { stdout: JSON.stringify({ submit_id: "dreamina-ref-1" }), stderr: "" };
    };
    const service = createMockExternalAigcService({
      providerAccounts: async () => [{
        providerId: "jimeng",
        upstreamId: "jimeng",
        enabled: true,
        availableOAuth: ["dreamina"],
      }],
      dreaminaRun,
      fetch: async () => new Response("reference", { headers: { "content-type": "image/png" } }),
    } as never);

    const result = await service.generateVideo({
      taskId: "task-dreamina-ref",
      prompt: "Use the reference",
      model: "seedance-2-ref",
      modelParams: { resolution: "720p" },
      referenceImageUrls: ["https://media.test/image.png"],
    });

    expect(result.provider).toBe("dreamina-cli");
    expect(calls[0]?.[0]).toBe("multimodal2video");
    expect(calls[0]).toEqual(expect.arrayContaining([
      expect.stringMatching(/^--image=.*\.png$/),
      "--video_resolution=720p",
    ]));
  });

  it("submits an exact 2:1 custom size to GPT Image 2 on fal", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const service = createMockExternalAigcService({
      providerAccounts: async () => [
        {
          providerId: "official",
          upstreamId: "openai",
          region: "global",
          enabled: true,
          configuredCredentials: ["apiKey"],
          credentials: { apiKey: "openai-local-key" },
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
        if (url === "https://queue.fal.run/openai/gpt-image-2") {
          return Response.json({ request_id: "fal-gpt-image-2-panorama" });
        }
        if (url === "https://queue.fal.run/openai/gpt-image-2/requests/fal-gpt-image-2-panorama/status") {
          return Response.json({ status: "COMPLETED" });
        }
        if (url === "https://queue.fal.run/openai/gpt-image-2/requests/fal-gpt-image-2-panorama") {
          return Response.json({
            images: [{
              url: "https://fal-cdn.test/director-panorama.webp",
              width: 2048,
              height: 1024,
            }],
          });
        }
        if (url === "https://fal-cdn.test/director-panorama.webp") {
          return new Response("real-fal-gpt-image-2", { headers: { "content-type": "image/webp" } });
        }
        return new Response("not found", { status: 404 });
      },
    } as never);

    const result = await service.generateImage({
      taskId: "task-director-panorama",
      prompt: "A seamless equirectangular studio panorama",
      model: "gpt-image-2",
      aspectRatio: "2:1",
      modelParams: {
        width: 2048,
        height: 1024,
        quality: "high",
        output_format: "webp",
        count: 1,
        provider_id: "fal",
        require_real_provider: true,
      },
    });

    expect(result.provider).toBe("fal");
    expect(result.modelEndpoint).toBe("openai/gpt-image-2");
    expect(result.width).toBe(2048);
    expect(result.height).toBe(1024);
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      prompt: "A seamless equirectangular studio panorama",
      image_size: { width: 2048, height: 1024 },
      quality: "high",
      num_images: 1,
      output_format: "webp",
    });
  });

  it("rejects a Director panorama instead of silently using mock media", async () => {
    const service = createMockExternalAigcService({
      providerAccounts: async () => [],
    });

    await expect(service.generateImage({
      taskId: "task-director-panorama-no-provider",
      prompt: "Director panorama",
      model: "gpt-image-2",
      aspectRatio: "2:1",
      modelParams: {
        width: 2048,
        height: 1024,
        require_real_provider: true,
      },
    })).rejects.toThrow("requires a configured real provider");
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

    await expect(service.generateImage({
      taskId: "task-weighted-fal-image",
      prompt: "weighted image route",
      model: "nano-banana-2",
      aspectRatio: "1:1",
    })).rejects.toThrow("requires a configured real provider");

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

  it("uses a Pika API Club account for a supported image model", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const usageEvents: Array<Record<string, unknown>> = [];
    const service = createMockExternalAigcService({
      providerAccounts: async () => [{
        providerId: "pika",
        upstreamId: "pika",
        enabled: true,
        configuredCredentials: ["apiKey"],
        credentials: { apiKey: "pk_live_local" },
        weight: 100,
      }],
      providerUsageAudit: async (event: ProviderUsageAuditEvent) => { usageEvents.push(event); },
      fetch: async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        calls.push({ url, init });
        if (url === "https://api.dev.pika.art/v1/media/google/gemini-3.1-flash-image/text-to-image") {
          return Response.json({ id: "pika-image-1", status: "queued" });
        }
        if (url === "https://api.dev.pika.art/v1/media/jobs/pika-image-1") {
          return Response.json({ id: "pika-image-1", status: "completed" });
        }
        if (url === "https://api.dev.pika.art/v1/media/jobs/pika-image-1/content") {
          return Response.json({ url: "https://pika-cdn.test/image.png" });
        }
        if (url === "https://pika-cdn.test/image.png") {
          return new Response("real-pika-image", { headers: { "content-type": "image/png" } });
        }
        return new Response("not found", { status: 404 });
      },
    } as never);

    const result = await service.generateImage({
      taskId: "task-pika-real",
      prompt: "paper cut garden",
      model: "nano-banana-2",
      aspectRatio: "3:4",
      modelParams: { resolution: "2K", count: 1 },
    });

    expect(result).toMatchObject({
      provider: "pika",
      modelEndpoint: "google/gemini-3.1-flash-image/text-to-image",
      requestId: "pika-image-1",
      remoteUrl: "https://pika-cdn.test/image.png",
      contentType: "image/png",
    });
    expect(Buffer.from(result.bytes).toString("utf8")).toBe("real-pika-image");
    const submitCall = calls.find((call) => call.url.includes("/v1/media/google/"));
    expect(submitCall).toMatchObject({
      url: "https://api.dev.pika.art/v1/media/google/gemini-3.1-flash-image/text-to-image",
      init: {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "task-pika-real",
          "x-api-key": "pk_live_local",
        },
      },
    });
    expect(JSON.parse(String(submitCall?.init?.body))).toEqual({
      prompt: "paper cut garden",
      num_images: 1,
      aspect_ratio: "3:4",
      output_format: "png",
      resolution: "2K",
    });
    expect(usageEvents).toEqual([
      expect.objectContaining({
        id: "task-pika-real:pika:pika-image-1:submitted",
        status: "submitted",
        providerRequestId: "pika-image-1",
        modelId: "nano-banana-2",
      }),
      expect.objectContaining({
        id: "task-pika-real:pika:pika-image-1:completed",
        status: "completed",
        providerRequestId: "pika-image-1",
      }),
    ]);
    expect(JSON.stringify(usageEvents)).not.toContain("paper cut garden");
  });

  it("runs current Pika flagship chat models with X-API-Key auth", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const service = createMockExternalAigcService({
      providerAccounts: async () => [{
        providerId: "pika",
        upstreamId: "pika",
        enabled: true,
        configuredCredentials: ["apiKey"],
        credentials: { apiKey: "pk_live_chat" },
      }],
      fetch: async (input: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(input), init });
        return Response.json({ id: "chat-1", choices: [{ message: { content: "2026 flagship" } }] });
      },
    } as never);
    await expect(service.generateText({
      taskId: "task-pika-chat",
      prompt: "hello",
      model: "gpt-5.6-sol",
    })).resolves.toMatchObject({ text: "2026 flagship", provider: "pika", modelEndpoint: "openai/gpt-5.6-sol" });
    expect(calls[0]).toMatchObject({
      url: "https://api.dev.pika.art/v1/chat/completions",
      init: { headers: expect.objectContaining({ "x-api-key": "pk_live_chat" }) },
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

  it("maps Seedance references separately for KIE and Replicate", async () => {
    const cases = [
      {
        providerId: "kie",
        upstreamId: "kie",
        apiKey: "kie-key",
        createUrl: "https://api.kie.ai/api/v1/jobs/createTask",
        expectedFields: {
          reference_image_urls: ["https://media.test/image.png"],
          reference_video_urls: ["https://media.test/video.mp4"],
          reference_audio_urls: ["https://media.test/audio.mp3"],
        },
      },
      {
        providerId: "replicate",
        upstreamId: "replicate",
        apiKey: "replicate-key",
        createUrl: "https://api.replicate.com/v1/models/bytedance/seedance-2.0/predictions",
        expectedFields: {
          reference_images: ["https://media.test/image.png"],
          reference_videos: ["https://media.test/video.mp4"],
          reference_audios: ["https://media.test/audio.mp3"],
        },
      },
    ] as const;

    for (const testCase of cases) {
      const calls: Array<{ url: string; init?: RequestInit }> = [];
      const service = createMockExternalAigcService({
        providerAccounts: async () => [{
          providerId: testCase.providerId,
          upstreamId: testCase.upstreamId,
          enabled: true,
          configuredCredentials: ["apiKey"],
          credentials: { apiKey: testCase.apiKey },
        }],
        fetch: async (input: string | URL | Request, init?: RequestInit) => {
          const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
          calls.push({ url, init });
          if (url === testCase.createUrl) {
            return testCase.providerId === "kie"
              ? Response.json({ code: 200, data: { taskId: "seedance-task" } })
              : Response.json({ id: "seedance-task", status: "succeeded", output: ["https://media.test/output.mp4"] });
          }
          if (url === "https://api.kie.ai/api/v1/jobs/recordInfo?taskId=seedance-task") {
            return Response.json({ code: 200, data: { state: "success", resultUrls: ["https://media.test/output.mp4"] } });
          }
          if (url === "https://media.test/output.mp4") {
            return new Response("seedance-video", { headers: { "content-type": "video/mp4" } });
          }
          return new Response("not found", { status: 404 });
        },
      } as never);

      await service.generateVideo({
        taskId: `task-${testCase.providerId}-seedance`,
        prompt: "fallback",
        model: "seedance-2-ref",
        referenceImageUrls: ["https://media.test/image.png"],
        referenceVideoUrls: ["https://media.test/video.mp4"],
        referenceAudioUrls: ["https://media.test/audio.mp3"],
        orderedContentParts: [
          { type: "text", text: "Use " },
          { type: "image", url: "https://media.test/image.png" },
          { type: "text", text: " and " },
          { type: "audio", url: "https://media.test/audio.mp3" },
        ],
      });

      const createBody = JSON.parse(String(calls.find((call) => call.url === testCase.createUrl)?.init?.body));
      expect(createBody.input).toMatchObject({
        prompt: "Use [Image1] and [Audio1]",
        ...testCase.expectedFields,
      });
    }
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

  it("runs Suno through its selected provider account without an audio fallback", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const service = createMockExternalAigcService({
      providerAccounts: async () => [{
        id: "suno-primary",
        providerId: "suno",
        upstreamId: "suno",
        apiShape: "suno",
        enabled: true,
        configuredCredentials: ["apiKey", "callbackUrl"],
        credentials: {
          apiKey: "suno-local-key",
          callbackUrl: "https://api.clash.test/api/v1/provider-callbacks/suno",
        },
      }],
      modelCards: async () => [{
        id: "suno-v5.5",
        aliases: [],
        name: "Suno V5.5",
        provider: "Suno API",
        kind: "audio",
        parameters: [],
        defaultParams: {},
        defaultAspectRatio: "1:1",
        input: { requiresPrompt: true, inputMode: {}, promptModalities: ["text"] },
        availableProviders: ["suno"],
        defaultProvider: "suno",
        providerImplementations: [{
          providerId: "suno",
          upstreamId: "suno",
          upstreamModel: "V5_5",
          apiShape: "suno",
          priority: 8,
          requiredCredentials: ["apiKey", "callbackUrl"],
        }],
      }],
      fetch: async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        calls.push({ url, init });
        if (url === "https://api.sunoapi.org/api/v1/generate") {
          return Response.json({ code: 200, msg: "success", data: { taskId: "suno-local-1" } });
        }
        if (url === "https://api.sunoapi.org/api/v1/generate/record-info?taskId=suno-local-1") {
          return Response.json({
            code: 200,
            msg: "success",
            data: {
              taskId: "suno-local-1",
              status: "SUCCESS",
              response: {
                sunoData: [{
                  audioUrl: "https://suno-cdn.test/song.mp3",
                  duration: 128.25,
                }],
              },
            },
          });
        }
        if (url === "https://suno-cdn.test/song.mp3") {
          return new Response("real-suno-audio", { headers: { "content-type": "audio/mpeg" } });
        }
        return new Response("not found", { status: 404 });
      },
    } as never);

    const result = await service.generateAudio({
      taskId: "task-suno-local",
      prompt: "dreamy synth pop",
      model: "suno-v5.5",
    });

    expect(result.provider).toBe("suno");
    expect(result.modelEndpoint).toBe("V5_5");
    expect(result.requestId).toBe("suno-local-1");
    expect(result.durationMs).toBe(128250);
    expect(Buffer.from(result.bytes).toString("utf8")).toBe("real-suno-audio");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      customMode: false,
      instrumental: false,
      model: "V5_5",
      callBackUrl: "https://api.clash.test/api/v1/provider-callbacks/suno",
      prompt: "dreamy synth pop",
    });
  });

  it("runs MiniMax Music 3 through its selected provider account", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const service = createMockExternalAigcService({
      providerAccounts: async () => [{
        id: "minimax-primary",
        providerId: "minimax",
        upstreamId: "minimax",
        enabled: true,
        configuredCredentials: ["apiKey"],
        credentials: { apiKey: "mini-key" },
      }],
      fetch: async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        calls.push({ url, init });
        return Response.json({
          data: { audio: "494433", status: 2 },
          base_resp: { status_code: 0, status_msg: "success" },
        });
      },
    });

    const result = await service.generateAudio({
      taskId: "task-minimax-music",
      prompt: "cinematic synthwave with a rising chorus",
      model: "minimax-music-3",
      modelParams: { lyrics_optimizer: true, is_instrumental: false },
    });

    expect(calls[0]?.url).toBe("https://api.minimax.io/v1/music_generation");
    expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({
      model: "music-3.0",
      prompt: "cinematic synthwave with a rising chorus",
      lyrics_optimizer: true,
      is_instrumental: false,
    });
    expect(result).toMatchObject({
      contentType: "audio/mpeg",
      provider: "minimax",
      modelEndpoint: "music-3.0",
    });
    expect(Buffer.from(result.bytes).toString("hex")).toBe("494433");
  });

  it("runs MiniMax Music 3 through its selected fal provider account", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const service = createMockExternalAigcService({
      providerAccounts: async () => [{
        id: "fal-primary",
        providerId: "fal",
        upstreamId: "fal",
        apiShape: "fal",
        enabled: true,
        configuredCredentials: ["apiKey"],
        credentials: { apiKey: "fal-local-key" },
      }],
      fetch: async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        calls.push({ url, init });
        if (url === "https://queue.fal.run/fal-ai/minimax-music/v3") return Response.json({ request_id: "fal-music-3-1" });
        if (url.endsWith("/requests/fal-music-3-1/status")) return Response.json({ status: "COMPLETED" });
        if (url.endsWith("/requests/fal-music-3-1")) return Response.json({ audio: { url: "https://fal-cdn.test/music-3.mp3", duration: 91 } });
        if (url === "https://fal-cdn.test/music-3.mp3") return new Response("fal-music-3-audio", { headers: { "content-type": "audio/mpeg" } });
        return new Response("not found", { status: 404 });
      },
    } as never);

    const result = await service.generateAudio({
      taskId: "task-fal-music-3",
      prompt: "cinematic synthwave with a rising chorus",
      model: "minimax-music-3",
      modelParams: {
        lyrics: "[Verse]\nNeon over water",
        lyrics_optimizer: true,
        is_instrumental: false,
        sample_rate: 44100,
        bitrate: 256000,
        format: "mp3",
      },
    });

    expect(result).toMatchObject({
      provider: "fal",
      modelEndpoint: "fal-ai/minimax-music/v3",
      durationMs: 91000,
    });
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      prompt: "cinematic synthwave with a rising chorus",
      lyrics: "[Verse]\nNeon over water",
      lyrics_optimizer: true,
      is_instrumental: false,
      audio_setting: {
        sample_rate: 44100,
        bitrate: 256000,
        format: "mp3",
      },
    });
  });

  it("runs MiniMax H3 through its V2 task API and downloads the result", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const service = createMockExternalAigcService({
      providerAccounts: async () => [{
        id: "minimax-primary",
        providerId: "minimax",
        upstreamId: "minimax",
        enabled: true,
        configuredCredentials: ["apiKey"],
        credentials: { apiKey: "mini-key" },
      }],
      fetch: async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        calls.push({ url, init });
        if (url.endsWith("/v2/video_generation")) return Response.json({ task_id: "h3-local-task" });
        if (url.includes("/v2/query/video_generation/")) {
          return Response.json({
            task: {
              id: "h3-local-task",
              status: "succeeded",
              content: { url: "https://cdn.minimax.io/h3-local.mp4" },
              duration: 6,
            },
          });
        }
        return new Response("h3-video", { headers: { "content-type": "video/mp4" } });
      },
    });

    const result = await service.generateVideo({
      taskId: "task-minimax-h3",
      prompt: "a paper boat crosses a rain puddle",
      model: "minimax-h3",
      aspectRatio: "16:9",
      duration: 6,
      modelParams: { resolution: "2K" },
    });

    expect(calls[0]?.url).toBe("https://api.minimax.io/v2/video_generation");
    expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({
      model: "MiniMax-H3",
      content: [{ type: "text", text: "a paper boat crosses a rain puddle" }],
      resolution: "2K",
      duration: 6,
      ratio: "16:9",
    });
    expect(calls[1]?.url).toBe("https://api.minimax.io/v2/query/video_generation/h3-local-task");
    expect(calls[2]?.url).toBe("https://cdn.minimax.io/h3-local.mp4");
    expect(result).toMatchObject({
      contentType: "video/mp4",
      durationMs: 6000,
      provider: "minimax",
      modelEndpoint: "MiniMax-H3",
      requestId: "h3-local-task",
    });
  });

  it("keeps desktop H3 text and reference parts in their authored order", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const service = createMockExternalAigcService({
      providerAccounts: async () => [{
        id: "minimax-primary",
        providerId: "minimax",
        upstreamId: "minimax",
        enabled: true,
        configuredCredentials: ["apiKey"],
        credentials: { apiKey: "mini-key" },
      }],
      fetch: async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        calls.push({ url, init });
        if (url.endsWith("/v2/video_generation")) return Response.json({ task_id: "h3-ordered-local" });
        if (url.includes("/v2/query/video_generation/")) {
          return Response.json({
            task: {
              id: "h3-ordered-local",
              status: "succeeded",
              content: { url: "https://cdn.minimax.io/h3-ordered-local.mp4" },
            },
          });
        }
        return new Response("h3-video", { headers: { "content-type": "video/mp4" } });
      },
    });

    await service.generateVideo({
      taskId: "task-minimax-h3-ordered",
      prompt: "Use the subject, then follow the motion.",
      model: "minimax-h3-ref",
      orderedContentParts: [
        { type: "text", text: "Use " },
        { type: "image", url: "https://media.clash.test/subject.png" },
        { type: "text", text: ", then follow " },
        { type: "video", url: "https://media.clash.test/motion.mp4" },
        { type: "text", text: "." },
      ],
    } as never);

    expect(JSON.parse(String(calls[0]?.init?.body)).content).toEqual([
      { type: "text", text: "Use " },
      {
        type: "image_url",
        image_url: { url: "https://media.clash.test/subject.png" },
        role: "reference_image",
      },
      { type: "text", text: ", then follow " },
      {
        type: "video_url",
        video_url: { url: "https://media.clash.test/motion.mp4" },
        role: "reference_video",
      },
      { type: "text", text: "." },
    ]);
  });

  it("maps desktop H3 start/end inputs to first_frame and last_frame roles", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const service = createMockExternalAigcService({
      providerAccounts: async () => [{
        id: "minimax-primary",
        providerId: "minimax",
        upstreamId: "minimax",
        enabled: true,
        configuredCredentials: ["apiKey"],
        credentials: { apiKey: "mini-key" },
      }],
      fetch: async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        calls.push({ url, init });
        if (url.endsWith("/v2/video_generation")) return Response.json({ task_id: "h3-startend-local" });
        if (url.includes("/v2/query/video_generation/")) {
          return Response.json({
            task: {
              id: "h3-startend-local",
              status: "succeeded",
              content: { url: "https://cdn.minimax.io/h3-startend-local.mp4" },
            },
          });
        }
        return new Response("h3-video", { headers: { "content-type": "video/mp4" } });
      },
    });

    await service.generateVideo({
      taskId: "task-minimax-h3-startend",
      prompt: "transition between frames",
      model: "minimax-h3",
      startFrameUrl: "https://media.clash.test/start.png",
      endFrameUrl: "https://media.clash.test/end.png",
      modelParams: { duration: 7, resolution: "768P" },
    } as never);

    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      model: "MiniMax-H3",
      content: [
        { type: "text", text: "transition between frames" },
        { type: "image_url", image_url: { url: "https://media.clash.test/start.png" }, role: "first_frame" },
        { type: "image_url", image_url: { url: "https://media.clash.test/end.png" }, role: "last_frame" },
      ],
      resolution: "768P",
      duration: 7,
      ratio: "adaptive",
    });
  });

  it("inlines loopback H3 references so MiniMax can read desktop-local assets", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const service = createMockExternalAigcService({
      providerAccounts: async () => [{
        id: "minimax-primary",
        providerId: "minimax",
        upstreamId: "minimax",
        enabled: true,
        configuredCredentials: ["apiKey"],
        credentials: { apiKey: "mini-key" },
      }],
      fetch: async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        calls.push({ url, init });
        if (url === "http://127.0.0.1:49321/assets/ref.png") {
          return new Response("image-bytes", { headers: { "content-type": "image/png" } });
        }
        if (url.endsWith("/v2/video_generation")) return Response.json({ task_id: "h3-ref-task" });
        if (url.includes("/v2/query/video_generation/")) {
          return Response.json({
            task: {
              id: "h3-ref-task",
              status: "succeeded",
              content: { url: "https://cdn.minimax.io/h3-ref.mp4" },
            },
          });
        }
        return new Response("h3-video", { headers: { "content-type": "video/mp4" } });
      },
    });

    await service.generateVideo({
      taskId: "task-minimax-h3-ref",
      prompt: "animate this subject",
      model: "minimax-h3",
      referenceImageUrls: ["http://127.0.0.1:49321/assets/ref.png"],
    });

    expect(calls.map((call) => call.url)).toEqual([
      "http://127.0.0.1:49321/assets/ref.png",
      "https://api.minimax.io/v2/video_generation",
      "https://api.minimax.io/v2/query/video_generation/h3-ref-task",
      "https://cdn.minimax.io/h3-ref.mp4",
    ]);
    const body = JSON.parse(String(calls[1]?.init?.body));
    expect(body.content[1]).toEqual({
      type: "image_url",
      image_url: {
        url: `data:image/png;base64,${Buffer.from("image-bytes").toString("base64")}`,
      },
      role: "reference_image",
    });
  });

  it("switches the single Seedream fal card to its edit endpoint when images are attached", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const service = createMockExternalAigcService({
      providerAccounts: async () => [{
        id: "fal-primary",
        providerId: "fal",
        upstreamId: "fal",
        apiShape: "fal",
        enabled: true,
        configuredCredentials: ["apiKey"],
        credentials: { apiKey: "fal-local-key" },
      }],
      modelCards: async () => [{
        id: "seedream-4.5",
        aliases: [],
        name: "Seedream 4.5",
        provider: "ByteDance",
        kind: "image",
        parameters: [{
          id: "image_size",
          label: "Image Size",
          type: "select",
          options: [{ label: "4K Auto", value: "auto_4K" }],
          defaultValue: "auto_4K",
        }],
        defaultParams: { image_size: "auto_4K" },
        defaultAspectRatio: "1:1",
        input: {
          requiresPrompt: true,
          inputMode: { images: { max: 10 } },
          promptModalities: ["text", "image"],
        },
        availableProviders: ["fal"],
        defaultProvider: "fal",
        providerImplementations: [{
          providerId: "fal",
          upstreamId: "fal",
          upstreamModel: "fal-ai/bytedance/seedream/v4.5/text-to-image",
          apiShape: "fal",
          priority: 20,
          requiredCredentials: ["apiKey"],
        }],
      }],
      fetch: async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        calls.push({ url, init });
        if (url === "https://queue.fal.run/fal-ai/bytedance/seedream/v4.5/edit") {
          return Response.json({ request_id: "seedream-edit-1" });
        }
        if (url.endsWith("/requests/seedream-edit-1/status")) {
          return Response.json({ status: "COMPLETED" });
        }
        if (url.endsWith("/requests/seedream-edit-1")) {
          return Response.json({ images: [{ url: "https://fal-cdn.test/seedream.png" }] });
        }
        if (url === "https://fal-cdn.test/seedream.png") {
          return new Response("seedream-edit", { headers: { "content-type": "image/png" } });
        }
        return new Response("not found", { status: 404 });
      },
    } as never);

    const result = await service.generateImage({
      taskId: "task-seedream-edit",
      prompt: "change the coat",
      model: "seedream-4.5",
      referenceImageUrls: ["http://127.0.0.1:4312/assets/projects/p/source.png"],
      modelParams: { image_size: "auto_4K" },
    });

    expect(result.modelEndpoint).toBe("fal-ai/bytedance/seedream/v4.5/edit");
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({
      prompt: "change the coat",
      image_size: "auto_4K",
      image_urls: ["http://127.0.0.1:4312/assets/projects/p/source.png"],
    });
  });

  it("runs FLUX 3 video through the official BFL API", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const service = createMockExternalAigcService({
      providerAccounts: async () => [{
        providerId: "official",
        upstreamId: "bfl",
        apiShape: "bfl",
        region: "global",
        enabled: true,
        configuredCredentials: ["apiKey"],
        credentials: { apiKey: "bfl-local-key" },
      }],
      fetch: async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        calls.push({ url, init });
        if (url === "https://api.bfl.ai/v1/flux-3-video") {
          return Response.json({ id: "bfl-flux3-1", polling_url: "https://api.bfl.ai/v1/get_result?id=bfl-flux3-1" });
        }
        if (url === "https://api.bfl.ai/v1/get_result?id=bfl-flux3-1") {
          return Response.json({ status: "Ready", result: { sample: "https://bfl-cdn.test/flux3.mp4" } });
        }
        if (url === "https://bfl-cdn.test/flux3.mp4") {
          return new Response("official-flux3-video", { headers: { "content-type": "video/mp4" } });
        }
        return new Response("not found", { status: 404 });
      },
    } as never);

    const result = await service.generateVideo({
      taskId: "task-bfl-flux3",
      prompt: "a fox runs through morning mist",
      model: "flux-3-video",
      duration: 8,
      aspectRatio: "16:9",
      modelParams: { resolution: "1080p", generate_audio: true, safety_tolerance: 2 },
    });

    expect(result.provider).toBe("bfl");
    expect(result.requestId).toBe("bfl-flux3-1");
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({
      mode: "t2v",
      duration: 8,
      resolution: "fhd",
      generate_audio: true,
    });
  });

  it("projects FLUX 3 ordered keyframes to the fal endpoint", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const service = createMockExternalAigcService({
      providerAccounts: async () => [{
        providerId: "fal",
        upstreamId: "fal",
        apiShape: "fal",
        enabled: true,
        configuredCredentials: ["apiKey"],
        credentials: { apiKey: "fal-local-key" },
      }],
      fetch: async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        calls.push({ url, init });
        if (url === "https://queue.fal.run/blackforestlabs/flux-3/keyframes-to-video") return Response.json({ request_id: "fal-flux3-1" });
        if (url.endsWith("/requests/fal-flux3-1/status")) return Response.json({ status: "COMPLETED" });
        if (url.endsWith("/requests/fal-flux3-1")) return Response.json({ video: { url: "https://fal-cdn.test/flux3.mp4" } });
        if (url === "https://fal-cdn.test/flux3.mp4") return new Response("fal-flux3-video", { headers: { "content-type": "video/mp4" } });
        return new Response("not found", { status: 404 });
      },
    } as never);

    await service.generateVideo({
      taskId: "task-fal-flux3",
      prompt: "connect the product beats",
      model: "flux-3-video-keyframes",
      duration: 10,
      referenceImageUrls: ["https://media.test/a.png", "https://media.test/b.png", "https://media.test/c.png"],
      modelParams: {
        resolution: "720p",
        generate_audio: true,
        safety_tolerance: 2,
        keyframe_frame_indices: "[0,72,240]",
      },
    });

    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({
      keyframes: [
        { image_url: "https://media.test/a.png", frame_index: 0 },
        { image_url: "https://media.test/b.png", frame_index: 72 },
        { image_url: "https://media.test/c.png", frame_index: 240 },
      ],
    });
  });
});
