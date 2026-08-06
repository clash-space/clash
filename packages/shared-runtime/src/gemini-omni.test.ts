import { describe, expect, it, vi } from "vitest";

import {
  createGeminiOmniInteraction,
  downloadGeminiOmniVideo,
  extractGeminiOmniVideo,
  getGeminiOmniInteraction,
} from "./gemini-omni.js";

describe("Gemini Omni Interactions transport", () => {
  it("uses Cloudflare AI Gateway BYOK with the provider API prefix and native authentication", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(Response.json({
      id: "interactions/gateway-1",
      status: "in_progress",
    }));

    await createGeminiOmniInteraction({
      gatewayToken: "cloudflare-token",
      baseUrl: "https://gateway.ai.cloudflare.com/v1/account/gateway/google-ai-studio/",
      model: "gemini-omni-flash-preview",
      input: [{ type: "text", text: "A paper boat." }],
      aspectRatio: "16:9",
      duration: 3,
      fetch: fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://gateway.ai.cloudflare.com/v1/account/gateway/google-ai-studio/v1beta/interactions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "cf-aig-authorization": "Bearer cloudflare-token",
          "cf-aig-skip-cache": "true",
          "content-type": "application/json",
        }),
      }),
    );
    const headers = fetchImpl.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBeUndefined();
    expect(JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body))).toMatchObject({
      input: "A paper boat.",
    });
  });

  it("rejects incomplete or ambiguous Cloudflare Gateway authentication", async () => {
    const common = {
      model: "gemini-omni-flash-preview",
      input: [{ type: "text" as const, text: "A paper boat." }],
      aspectRatio: "16:9" as const,
      duration: 3,
      fetch: vi.fn(),
    };

    await expect(createGeminiOmniInteraction({
      ...common,
      gatewayToken: "cloudflare-token",
    })).rejects.toThrow("Cloudflare AI Gateway token requires a Cloudflare Google AI Studio Gateway base URL");
    await expect(createGeminiOmniInteraction({
      ...common,
      apiKey: "google-key",
      gatewayToken: "cloudflare-token",
      baseUrl: "https://gateway.ai.cloudflare.com/v1/account/gateway/google-ai-studio",
    })).rejects.toThrow("Choose either Google API key or Cloudflare AI Gateway token");
  });

  it("preserves authored text/image order in a background video interaction", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "interactions/omni-1",
      status: "in_progress",
    }), { status: 200, headers: { "content-type": "application/json" } }));

    await expect(createGeminiOmniInteraction({
      apiKey: "gemini-key",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/",
      model: "gemini-omni-flash-preview",
      input: [
        { type: "text", text: "Use " },
        { type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
        { type: "text", text: " as the jacket reference" },
      ],
      aspectRatio: "9:16",
      duration: 7,
      fetch: fetchImpl,
    })).resolves.toEqual(expect.objectContaining({ id: "interactions/omni-1" }));

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/interactions",
      expect.objectContaining({
        method: "POST",
        headers: {
          "x-goog-api-key": "gemini-key",
          "content-type": "application/json",
        },
      }),
    );
    expect(JSON.parse(fetchImpl.mock.calls[0]![1]!.body as string)).toEqual({
      model: "gemini-omni-flash-preview",
      input: [
        { type: "text", text: "Use " },
        { type: "image", data: "aW1hZ2U=", mime_type: "image/png" },
        { type: "text", text: " as the jacket reference" },
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
  });

  it("gets a stored interaction and extracts URI or inline video output", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "interactions/omni-1",
      status: "completed",
      steps: [{
        content: [
          { type: "text", text: "done" },
          { type: "video", uri: "https://files.example/video-1", mime_type: "video/mp4" },
        ],
      }],
    }), { status: 200 }));

    const interaction = await getGeminiOmniInteraction({
      apiKey: "gemini-key",
      interactionId: "interactions/omni-1",
      fetch: fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/interactions/omni-1",
      expect.objectContaining({ method: "GET" }),
    );
    expect(extractGeminiOmniVideo(interaction)).toEqual({
      uri: "https://files.example/video-1",
      mimeType: "video/mp4",
    });
    expect(extractGeminiOmniVideo({
      status: "completed",
      steps: [{ content: [{ type: "video", data: "dmlkZW8=", mime_type: "video/mp4" }] }],
    })).toEqual({ data: "dmlkZW8=", mimeType: "video/mp4" });
  });

  it("surfaces structured API errors", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { message: "model unavailable" },
    }), { status: 400 }));

    await expect(createGeminiOmniInteraction({
      apiKey: "bad-key",
      model: "gemini-omni-flash-preview",
      input: [{ type: "text", text: "hello" }],
      aspectRatio: "16:9",
      duration: 5,
      fetch: fetchImpl,
    })).rejects.toThrow("model unavailable");
  });

  it("polls Google Files until ACTIVE before downloading URI-delivered video", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(Response.json({ name: "files/video-1", state: "PROCESSING" }))
      .mockResolvedValueOnce(Response.json({ name: "files/video-1", state: "ACTIVE" }))
      .mockResolvedValueOnce(new Response("video-bytes", { headers: { "content-type": "video/mp4" } }));

    const result = await downloadGeminiOmniVideo({
      apiKey: "gemini-key",
      uri: "https://generativelanguage.googleapis.com/v1beta/files/video-1:download?alt=media",
      pollIntervalMs: 0,
      fetch: fetchImpl,
    });

    expect(fetchImpl.mock.calls.map((call) => call[0])).toEqual([
      "https://generativelanguage.googleapis.com/v1beta/files/video-1",
      "https://generativelanguage.googleapis.com/v1beta/files/video-1",
      "https://generativelanguage.googleapis.com/v1beta/files/video-1:download?alt=media",
    ]);
    expect(new TextDecoder().decode(result.bytes)).toBe("video-bytes");
  });

  it("remaps Google file URIs through the authenticated Cloudflare gateway", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(Response.json({ name: "files/video-2", state: "ACTIVE" }))
      .mockResolvedValueOnce(new Response("gateway-video", {
        headers: { "content-type": "video/mp4" },
      }));

    const result = await downloadGeminiOmniVideo({
      gatewayToken: "cloudflare-token",
      baseUrl: "https://gateway.ai.cloudflare.com/v1/account/gateway/google-ai-studio",
      uri: "https://generativelanguage.googleapis.com/v1beta/files/video-2:download?alt=media",
      pollIntervalMs: 0,
      fetch: fetchImpl,
    });

    expect(fetchImpl.mock.calls.map((call) => call[0])).toEqual([
      "https://gateway.ai.cloudflare.com/v1/account/gateway/google-ai-studio/v1beta/files/video-2",
      "https://gateway.ai.cloudflare.com/v1/account/gateway/google-ai-studio/v1beta/files/video-2:download?alt=media",
    ]);
    for (const [, init] of fetchImpl.mock.calls) {
      expect(init?.headers).toMatchObject({
        "cf-aig-authorization": "Bearer cloudflare-token",
        "cf-aig-skip-cache": "true",
      });
      expect((init?.headers as Record<string, string>)["x-goog-api-key"]).toBeUndefined();
    }
    expect(new TextDecoder().decode(result.bytes)).toBe("gateway-video");
  });
});
