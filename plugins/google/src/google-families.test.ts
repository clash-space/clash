import { afterEach, describe, expect, it, vi } from "vitest";

import { googleAdapter } from "./google-adapter.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

type CapturedRequest = {
  url: string;
  method?: string;
  body: Record<string, unknown>;
};

function invocation(
  values: Record<string, unknown>,
  options: { operation?: "submit" | "poll"; pollState?: unknown } = {},
) {
  return {
    invocationId: "invocation-1",
    operation: options.operation ?? "submit",
    ...(options.pollState === undefined
      ? {}
      : { pollState: options.pollState }),
    input: {
      values: {
        ...values,
      },
      references: [],
    },
  } as never;
}

function context(
  responseBody: unknown,
  captured: CapturedRequest[],
  stored: Record<string, string> = {
    accessToken: "test-access-token",
    projectId: "test-project",
    region: "us-central1",
    service: "agent-platform",
  },
) {
  vi.stubGlobal(
    "fetch",
    async (url: string, init: { method?: string; body?: string } = {}) => {
      captured.push({
        url,
        method: init.method,
        body: JSON.parse(init.body ?? "{}") as Record<string, unknown>,
      });
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => JSON.stringify(responseBody),
      };
    },
  );
  return {
    store: {
      get: async (key: string) => stored[key],
      put: async () => undefined,
      remove: async () => undefined,
    },
  } as never;
}

describe("Google API families", () => {
  it("reads image resolution from the model parameter envelope used by the backend", async () => {
    const requests: CapturedRequest[] = [];
    await googleAdapter.submit(
      invocation({
        modelId: "nano-banana-2",
        upstreamModel: "gemini-3.1-flash-image",
        kind: "image",
        prompt: "A red circle.",
        aspectRatio: "1:1",
        modelParams: { resolution: "1K" },
      }),
      context(
        {
          candidates: [
            {
              content: {
                parts: [
                  { inlineData: { mimeType: "image/png", data: "AAE=" } },
                ],
              },
            },
          ],
        },
        requests,
      ),
    );

    expect(requests[0]?.body).toMatchObject({
      generationConfig: {
        imageConfig: { aspectRatio: "1:1", imageSize: "1K" },
      },
    });
  });

  it("uses generateContent AUDIO and the selected voice for TTS", async () => {
    const requests: CapturedRequest[] = [];
    const result = await googleAdapter.submit(
      invocation({
        modelId: "gemini-3.1-flash-tts",
        upstreamModel: "gemini-3.1-flash-tts-preview",
        kind: "audio",
        prompt: "Read this sentence.",
        modelParams: { voice_name: "Kore" },
      }),
      context(
        {
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      mimeType: "audio/L16;rate=24000",
                      data: "AAE=",
                    },
                  },
                ],
              },
            },
          ],
        },
        requests,
      ),
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toMatch(
      /gemini-3\.1-flash-tts-preview:generateContent$/,
    );
    expect(requests[0]?.body).toMatchObject({
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
        },
      },
    });
    expect(result).toEqual({
      status: "completed",
      media: { media: { base64: "AAE=", mediaType: "audio/L16;rate=24000" } },
    });
  });

  it("sends inline audio to generateContent and returns text for ASR", async () => {
    const requests: CapturedRequest[] = [];
    const result = await googleAdapter.submit(
      invocation({
        modelId: "gemini-3.5-flash",
        upstreamModel: "gemini-3.5-flash",
        kind: "text",
        prompt: "Transcribe this audio exactly.",
        orderedContentParts: [
          { type: "text", text: "Transcribe this audio exactly." },
          { type: "audio", url: "data:audio/wav;base64,UklGRg==" },
        ],
      }),
      context(
        {
          candidates: [
            { content: { parts: [{ text: "hello from the recording" }] } },
          ],
        },
        requests,
      ),
    );

    expect(requests[0]?.body).toMatchObject({
      contents: [
        {
          role: "user",
          parts: [
            { text: "Transcribe this audio exactly." },
            { inlineData: { mimeType: "audio/wav", data: "UklGRg==" } },
          ],
        },
      ],
      generationConfig: { responseModalities: ["TEXT"] },
    });
    expect(result).toEqual({
      status: "completed",
      outputs: [
        { slot: "text", kind: "value", value: "hello from the recording" },
      ],
    });
  });

  it("submits Veo text/reference work through predictLongRunning", async () => {
    const requests: CapturedRequest[] = [];
    const result = await googleAdapter.submit(
      invocation({
        modelId: "veo-3.1-fast",
        upstreamModel: "veo-3.1-fast-generate-001",
        kind: "video",
        prompt: "A paper kite rises above a quiet beach.",
        aspectRatio: "16:9",
        duration: 4,
        modelParams: { generate_audio: true },
        referenceImageUrls: ["data:image/png;base64,iVBORw0KGgo="],
      }),
      context(
        {
          name: "projects/test-project/locations/us-central1/operations/operation-1",
        },
        requests,
      ),
    );

    expect(requests[0]?.url).toMatch(
      /veo-3\.1-fast-generate-001:predictLongRunning$/,
    );
    expect(requests[0]?.body).toMatchObject({
      instances: [
        {
          prompt: "A paper kite rises above a quiet beach.",
          referenceImages: [
            {
              image: {
                bytesBase64Encoded: "iVBORw0KGgo=",
                mimeType: "image/png",
              },
              referenceType: "asset",
            },
          ],
        },
      ],
      parameters: {
        aspectRatio: "16:9",
        durationSeconds: 4,
        generateAudio: true,
        sampleCount: 1,
      },
    });
    expect(result).toEqual({
      status: "accepted",
      pollState: {
        family: "veo",
        model: "veo-3.1-fast-generate-001",
        operationName:
          "projects/test-project/locations/us-central1/operations/operation-1",
      },
    });
  });

  it("preserves Veo first and last frames as distinct fields", async () => {
    const requests: CapturedRequest[] = [];
    await googleAdapter.submit(
      invocation({
        modelId: "veo-3.1-startend",
        upstreamModel: "veo-3.1-generate-001",
        kind: "video",
        prompt: "Move gently from dawn to dusk.",
        startFrameUrl: "data:image/png;base64,c3RhcnQ=",
        endFrameUrl: "data:image/jpeg;base64,ZW5k",
      }),
      context({ name: "operation-2" }, requests),
    );

    expect(requests[0]?.body).toMatchObject({
      instances: [
        {
          image: { bytesBase64Encoded: "c3RhcnQ=", mimeType: "image/png" },
          lastFrame: { bytesBase64Encoded: "ZW5k", mimeType: "image/jpeg" },
        },
      ],
    });
  });

  it("polls Veo with fetchPredictOperation and returns generated bytes", async () => {
    const requests: CapturedRequest[] = [];
    const result = await googleAdapter.poll!(
      invocation(
        {
          upstreamModel: "veo-3.1-generate-001",
        },
        {
          operation: "poll",
          pollState: {
            family: "veo",
            model: "veo-3.1-generate-001",
            operationName:
              "projects/test-project/locations/us-central1/operations/operation-3",
          },
        },
      ),
      context(
        {
          done: true,
          response: {
            videos: [
              { bytesBase64Encoded: "AAAAIGZ0eXA=", mimeType: "video/mp4" },
            ],
          },
        },
        requests,
      ),
    );

    expect(requests[0]?.url).toMatch(
      /veo-3\.1-generate-001:fetchPredictOperation$/,
    );
    expect(requests[0]?.body).toEqual({
      operationName:
        "projects/test-project/locations/us-central1/operations/operation-3",
    });
    expect(result).toEqual({
      status: "completed",
      media: { media: { base64: "AAAAIGZ0eXA=", mediaType: "video/mp4" } },
    });
  });

  it("uses the Interactions API for Gemini Omni instead of generateContent", async () => {
    const requests: CapturedRequest[] = [];
    const result = await googleAdapter.submit(
      invocation({
        modelId: "gemini-omni-flash",
        upstreamModel: "gemini-omni-flash-preview",
        apiShape: "google-ai-studio-interactions",
        kind: "video",
        prompt: "A small origami bird takes flight with soft wing sounds.",
        aspectRatio: "16:9",
        duration: 5,
      }),
      context(
        {
          id: "interaction-7",
          status: "in_progress",
        },
        requests,
      ),
    );

    expect(requests[0]?.url).toMatch(
      /\/v1beta1\/projects\/test-project\/locations\/us-central1\/interactions$/,
    );
    expect(requests[0]?.body).toMatchObject({
      model: "gemini-omni-flash-preview",
      input: "A small origami bird takes flight with soft wing sounds.",
      response_format: {
        type: "video",
        aspect_ratio: "16:9",
        duration: "5s",
      },
      background: true,
      store: true,
      stream: false,
    });
    expect(
      (
        requests[0]?.body as {
          response_format?: Record<string, unknown>;
        }
      ).response_format,
    ).not.toHaveProperty("delivery");
    expect(result).toEqual({
      status: "accepted",
      pollState: { family: "interaction", interactionId: "interaction-7" },
    });
  });

  it("addresses Gemini Omni on AI Studio when the account uses an API key", async () => {
    const requests: CapturedRequest[] = [];
    await googleAdapter.submit(
      invocation({
        modelId: "gemini-omni-flash",
        upstreamModel: "gemini-omni-flash-preview",
        kind: "video",
        prompt: "A paper bird takes flight.",
      }),
      context(
        { id: "interaction-ai-studio", status: "in_progress" },
        requests,
        { apiKey: "test-api-key", service: "ai-studio" },
      ),
    );

    expect(requests[0]?.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/interactions",
    );
  });

  it("polls a completed Gemini Omni interaction for its video", async () => {
    const requests: CapturedRequest[] = [];
    const result = await googleAdapter.poll!(
      invocation(
        {},
        {
          operation: "poll",
          pollState: { family: "interaction", interactionId: "interaction-7" },
        },
      ),
      context(
        {
          id: "interaction-7",
          status: "completed",
          outputs: [
            { type: "video", data: "AAAAIGZ0eXA=", mime_type: "video/mp4" },
          ],
        },
        requests,
      ),
    );

    expect(requests[0]?.method).toBe("GET");
    expect(requests[0]?.url).toMatch(/\/interactions\/interaction-7$/);
    expect(result).toEqual({
      status: "completed",
      media: { media: { base64: "AAAAIGZ0eXA=", mediaType: "video/mp4" } },
    });
  });
});
