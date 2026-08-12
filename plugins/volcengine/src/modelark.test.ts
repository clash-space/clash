import { afterEach, describe, expect, it, vi } from "vitest";

import {
  VOLCENGINE_DEFAULT_BASE_URL,
  buildModelArkRequest,
  modelArkPoll,
  modelArkSubmit,
  volcengineAdapter,
} from "./modelark.js";
import { volcengineSpeechAdapter } from "./speech.js";

function response(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("Volcengine ModelArk request translation", () => {
  it("maps Seedance 2.0 auto controls without sending 2.5-only fields", () => {
    expect(
      buildModelArkRequest({
        modelId: "seedance-2-ref",
        upstreamModel: "doubao-seedance-2-0-260128",
        prompt: "Use @图像1 and @音频1",
        aspectRatio: "auto",
        duration: "auto",
        referenceImageUrls: ["https://media.test/image.png"],
        referenceAudioUrls: ["https://media.test/audio.mp3"],
        modelParams: {
          resolution: "4k",
          generate_audio: true,
          output_format: "mov",
        },
      }),
    ).toEqual({
      model: "doubao-seedance-2-0-260128",
      content: [
        { type: "text", text: "Use @图像1 and @音频1" },
        {
          type: "image_url",
          image_url: { url: "https://media.test/image.png" },
          role: "reference_image",
        },
        {
          type: "audio_url",
          audio_url: { url: "https://media.test/audio.mp3" },
          role: "reference_audio",
        },
      ],
      duration: -1,
      ratio: "adaptive",
      resolution: "4k",
      generate_audio: true,
    });
  });

  it("does not impose Seedance 2.5 edit constraints on Seedance 2.0", () => {
    expect(
      buildModelArkRequest({
        modelId: "seedance-2-ref",
        upstreamModel: "doubao-seedance-2-0-260128",
        prompt: "Replace the subject in @视频1",
        aspectRatio: "16:9",
        duration: 8,
        referenceVideoUrls: ["https://media.test/source.mp4"],
        modelParams: { edit_mode: true, resolution: "720p" },
      }),
    ).toMatchObject({
      duration: 8,
      ratio: "16:9",
    });
    expect(
      buildModelArkRequest({
        modelId: "seedance-2-ref",
        upstreamModel: "doubao-seedance-2-0-260128",
        prompt: "Replace the subject in @视频1",
        referenceVideoUrls: ["https://media.test/source.mp4"],
        modelParams: { edit_mode: true },
      }),
    ).not.toHaveProperty("omni_reference_task_type");
  });

  it("turns the Seedance 2.5 edit switch into the documented edit task", () => {
    expect(
      buildModelArkRequest({
        modelId: "seedance-2.5-ref",
        upstreamModel: "doubao-seedance-2-5-260628",
        prompt: "Replace the subject in @视频1",
        aspectRatio: "21:9",
        duration: 12,
        referenceVideoUrls: ["https://media.test/source.mp4"],
        modelParams: {
          edit_mode: true,
          resolution: "720p",
          output_format: "mov",
        },
      }),
    ).toMatchObject({
      omni_reference_task_type: "edit",
      duration: -1,
      ratio: "adaptive",
      output_format: "mp4",
    });
  });

  it("uses explicit 2.5 reference and extension task types", () => {
    expect(
      buildModelArkRequest({
        modelId: "seedance-2.5-ref",
        upstreamModel: "doubao-seedance-2-5-260628",
        prompt: "Follow @视频1 camera motion",
        aspectRatio: "21:9",
        duration: 20,
        referenceVideoUrls: ["https://media.test/reference.mp4"],
      }),
    ).toMatchObject({
      omni_reference_task_type: "reference",
      duration: 20,
      ratio: "21:9",
      output_format: "mp4",
    });
    expect(
      buildModelArkRequest({
        modelId: "seedance-2.5-extend",
        upstreamModel: "doubao-seedance-2-5-260628",
        prompt: "向后延长 @视频1",
        duration: 10,
        referenceVideoUrls: ["https://media.test/source.mp4"],
      }),
    ).toMatchObject({
      omni_reference_task_type: "extend",
      duration: 10,
      ratio: "adaptive",
      output_format: "mp4",
    });
  });

  it("marks Seedance 2.5 first and last frames and fixes their ratio to adaptive", () => {
    expect(
      buildModelArkRequest({
        modelId: "seedance-2.5-startend",
        upstreamModel: "doubao-seedance-2-5-260628",
        prompt: "Move from dawn to night",
        aspectRatio: "16:9",
        startFrameUrl: "https://media.test/first.png",
        endFrameUrl: "https://media.test/last.png",
      }),
    ).toMatchObject({
      content: [
        { type: "text", text: "Move from dawn to night" },
        {
          type: "image_url",
          image_url: { url: "https://media.test/first.png" },
          role: "first_frame",
        },
        {
          type: "image_url",
          image_url: { url: "https://media.test/last.png" },
          role: "last_frame",
        },
      ],
      ratio: "adaptive",
      output_format: "mp4",
    });
  });

  it("rejects an edit switch without the video the operation edits", () => {
    expect(() =>
      buildModelArkRequest({
        modelId: "seedance-2.5-ref",
        upstreamModel: "doubao-seedance-2-5-260628",
        prompt: "Replace the subject",
        modelParams: { edit_mode: true },
      }),
    ).toThrow(/edit.*reference video/i);
  });

  it("keeps video extension on the card's video-only input contract", () => {
    expect(() =>
      buildModelArkRequest({
        modelId: "seedance-2.5-extend",
        upstreamModel: "doubao-seedance-2-5-260628",
        prompt: "向后延长",
        referenceImageUrls: ["https://media.test/image.png"],
      }),
    ).toThrow(/extension.*reference video/i);
    expect(() =>
      buildModelArkRequest({
        modelId: "seedance-2.5-extend",
        upstreamModel: "doubao-seedance-2-5-260628",
        prompt: "向后延长 @视频1",
        referenceVideoUrls: ["https://media.test/video.mp4"],
        referenceAudioUrls: ["https://media.test/audio.mp3"],
      }),
    ).toThrow(/extension.*only.*video/i);
  });

  it("requires the first frame of a first/last-frame request", () => {
    expect(() =>
      buildModelArkRequest({
        modelId: "seedance-2.5-startend",
        upstreamModel: "doubao-seedance-2-5-260628",
        prompt: "Move toward the ending",
        endFrameUrl: "https://media.test/last.png",
      }),
    ).toThrow(/first frame/i);
  });

  it("rejects Seedance 2.0 audio-only input at the provider boundary", () => {
    expect(() =>
      buildModelArkRequest({
        modelId: "seedance-2-ref",
        upstreamModel: "doubao-seedance-2-0-260128",
        prompt: "Follow @音频1",
        referenceAudioUrls: ["https://media.test/audio.mp3"],
      }),
    ).toThrow(/audio.*image or video/i);
  });
});

describe("Volcengine ModelArk lifecycle", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("submits once to an override URL and returns durable poll state", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetch = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(input), init });
        return response({ id: "cgt-123" });
      },
    );
    const body = {
      model: "doubao-seedance-2-5-260628",
      content: [{ type: "text", text: "hello" }],
    };

    await expect(
      modelArkSubmit({
        apiKey: "ark-key",
        baseUrl: "https://ark.example/api/v3/",
        body,
        fetch: fetch as typeof globalThis.fetch,
      }),
    ).resolves.toEqual({
      status: "accepted",
      pollState: { taskId: "cgt-123" },
    });
    expect(calls).toEqual([
      {
        url: "https://ark.example/api/v3/contents/generations/tasks",
        init: {
          method: "POST",
          headers: {
            authorization: "Bearer ark-key",
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        },
      },
    ]);
  });

  it("polls once and returns the documented content.video_url", async () => {
    const calls: string[] = [];
    const fetch = vi.fn(async (input: string | URL | Request) => {
      calls.push(String(input));
      return response({
        id: "cgt-123",
        status: "succeeded",
        content: { video_url: "https://media.test/result.mp4" },
      });
    });

    await expect(
      modelArkPoll({
        apiKey: "ark-key",
        state: { taskId: "cgt-123" },
        fetch: fetch as typeof globalThis.fetch,
      }),
    ).resolves.toEqual({
      status: "completed",
      media: {
        media: { url: "https://media.test/result.mp4", mediaType: "video/mp4" },
      },
    });
    expect(calls).toEqual([
      `${VOLCENGINE_DEFAULT_BASE_URL}/contents/generations/tasks/cgt-123`,
    ]);
  });

  it("reads the selected account from Host-scoped store state", async () => {
    const fetch = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        response({ id: "cgt-account" }),
    );
    vi.stubGlobal("fetch", fetch);
    const store = new Map([
      ["apiKey", "account-key"],
      ["baseUrl", "https://overseas-gateway.test/api/v3"],
    ]);

    await expect(
      volcengineAdapter.submit(
        {
          input: {
            values: {
              kind: "video",
              modelId: "seedance-2.5-ref",
              upstreamModel: "doubao-seedance-2-5-260628",
              prompt: "hello",
            },
            references: [],
          },
        } as never,
        {
          store: { get: async (key: string) => store.get(key) },
        } as never,
      ),
    ).resolves.toEqual({
      status: "accepted",
      pollState: { taskId: "cgt-account" },
    });
    expect(fetch.mock.calls[0]?.[0]).toBe(
      "https://overseas-gateway.test/api/v3/contents/generations/tasks",
    );
  });
});

describe("Volcengine Seed Audio lifecycle", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("submits the published synchronous speech request and keeps the durable Base64 result", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const audio = Buffer.from("generated audio").toString("base64");
    const reference = Buffer.from("reference audio").toString("base64");
    const fetch = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(input), init });
        return response({
          duration: 3.5,
          original_duration: 3.5,
          audio,
          url: "https://media.test/expires-in-two-hours.mp3",
        });
      },
    );
    vi.stubGlobal("fetch", fetch);
    const store = new Map([
      ["apiKey", "speech-key"],
      ["baseUrl", "https://speech-gateway.test/api/v3/"],
    ]);

    await expect(
      volcengineSpeechAdapter.submit(
        {
          input: {
            values: {
              kind: "audio",
              modelId: "seed-audio-1",
              upstreamModel: "seed-audio-1.0",
              prompt: "Read @音频1, then add rain",
              referenceAudioUrls: [
                "https://media.test/reference.wav",
                `data:audio/mpeg;base64,${reference}`,
              ],
              modelParams: {
                speed: 1.25,
                volume: 0.75,
                pitch: 3,
                sample_rate: 24000,
                format: "mp3",
              },
            },
            references: [],
          },
        } as never,
        {
          store: { get: async (key: string) => store.get(key) },
        } as never,
      ),
    ).resolves.toEqual({
      status: "completed",
      media: {
        media: {
          url: `data:audio/mpeg;base64,${audio}`,
          mediaType: "audio/mpeg",
        },
      },
    });
    expect(calls).toEqual([
      {
        url: "https://speech-gateway.test/api/v3/tts/create",
        init: {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": "speech-key",
          },
          body: JSON.stringify({
            model: "seed-audio-1.0",
            text_prompt: "Read @音频1, then add rain",
            references: [
              { audio_url: "https://media.test/reference.wav" },
              { audio_data: reference },
            ],
            audio_config: {
              format: "mp3",
              sample_rate: 24000,
              speech_rate: 25,
              loudness_rate: -25,
              pitch_rate: 3,
            },
          }),
        },
      },
    ]);
  });

  it("rejects the image and audio reference combination the speech API forbids", async () => {
    const store = new Map([["apiKey", "speech-key"]]);

    await expect(
      volcengineSpeechAdapter.submit(
        {
          input: {
            values: {
              kind: "audio",
              modelId: "seed-audio-1",
              upstreamModel: "seed-audio-1.0",
              prompt: "Read this",
              referenceImageUrls: ["https://media.test/voice.png"],
              referenceAudioUrls: ["https://media.test/voice.mp3"],
            },
            references: [],
          },
        } as never,
        {
          store: { get: async (key: string) => store.get(key) },
        } as never,
      ),
    ).rejects.toThrow(/image and audio references cannot be mixed/i);
  });

  it("keeps the documented temporary URL when the response omits inline audio", async () => {
    const fetch = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        response({
          duration: 4.2,
          original_duration: 4.2,
          url: "https://media.test/generated.wav",
        }),
    );
    vi.stubGlobal("fetch", fetch);
    const store = new Map([["apiKey", "speech-key"]]);

    await expect(
      volcengineSpeechAdapter.submit(
        {
          input: {
            values: {
              kind: "audio",
              modelId: "seed-audio-1",
              upstreamModel: "seed-audio-1.0",
              prompt: "A short sound effect",
              modelParams: { format: "wav" },
            },
            references: [],
          },
        } as never,
        {
          store: { get: async (key: string) => store.get(key) },
        } as never,
      ),
    ).resolves.toEqual({
      status: "completed",
      media: {
        media: {
          url: "https://media.test/generated.wav",
          mediaType: "audio/wav",
        },
      },
    });
    expect(fetch.mock.calls[0]?.[0]).toBe(
      "https://openspeech.bytedance.com/api/v3/tts/create",
    );
  });

  it("sends a configured voice id as the API's speaker reference", async () => {
    const calls: Array<{ init?: RequestInit }> = [];
    const fetch = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) => {
        calls.push({ init });
        return response({ url: "https://media.test/generated.wav" });
      },
    );
    vi.stubGlobal("fetch", fetch);
    const store = new Map([["apiKey", "speech-key"]]);

    await volcengineSpeechAdapter.submit(
      {
        input: {
          values: {
            kind: "audio",
            modelId: "seed-audio-1",
            upstreamModel: "seed-audio-1.0",
            prompt: "Read this line",
            modelParams: { voice_id: "speaker-123", format: "wav" },
          },
          references: [],
        },
      } as never,
      {
        store: { get: async (key: string) => store.get(key) },
      } as never,
    );

    expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({
      references: [{ speaker: "speaker-123" }],
    });
  });
});
