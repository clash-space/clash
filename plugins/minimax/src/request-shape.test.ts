import { afterEach, describe, expect, it, vi } from "vitest";

import { minimaxAdapter } from "./minimax-adapter.js";

interface FetchCall {
  url: string;
  init: RequestInit;
}

async function multipartFile(call: FetchCall): Promise<{
  purpose: string;
  filename: string;
  contentType: string;
  bytes: Buffer;
}> {
  expect(call.init.body).toBeInstanceOf(FormData);
  const form = call.init.body as FormData;
  const file = form.get("file");
  if (!(file instanceof Blob)) throw new Error("multipart request has no file Blob");
  return {
    purpose: String(form.get("purpose")),
    filename: String((file as Blob & { name?: string }).name ?? ""),
    contentType: file.type,
    bytes: Buffer.from(await file.arrayBuffer()),
  };
}

function response(body: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () => JSON.stringify(body),
  };
}

function invocation(values: Record<string, unknown>) {
  return {
    invocationId: "i-1",
    input: {
      values: {
        ...values,
      },
      references: [],
    },
  } as never;
}

function runtimeFetch(fetch: unknown): Record<string, never> {
  vi.stubGlobal("fetch", fetch);
  return {
    store: {
      get: async (key: string) =>
        ({ apiKey: "mm-key", service: "international" })[key],
      put: async () => undefined,
      remove: async () => undefined,
    },
  } as never;
}

afterEach(() => vi.unstubAllGlobals());

describe("MiniMax request projection", () => {
  it("projects MiniMax-M3 onto the synchronous OpenAI-compatible endpoint", async () => {
    let url = "";
    let body: Record<string, unknown> = {};
    const result = await minimaxAdapter.submit(invocation({
      kind: "text",
      modelId: "minimax-m3",
      upstreamModel: "MiniMax-M3",
      prompt: "Explain the fixture.",
      modelParams: { system_prompt: "Answer in one sentence." },
    }), runtimeFetch(async (input: string, init: { body: string }) => {
        url = input;
        body = JSON.parse(init.body) as Record<string, unknown>;
        return response({
          base_resp: { status_code: 0 },
          choices: [{ message: { content: "A synthetic MiniMax M3 answer." } }],
        });
      }));

    expect(url).toBe("https://api.minimax.io/v1/chat/completions");
    expect(body).toEqual({
      model: "MiniMax-M3",
      messages: [
        { role: "system", content: "Answer in one sentence." },
        { role: "user", content: "Explain the fixture." },
      ],
      stream: false,
    });
    expect(result).toEqual({
      status: "completed",
      outputs: [{ slot: "text", kind: "value", value: "A synthetic MiniMax M3 answer." }],
    });
  });

  it("surfaces a MiniMax-M3 base_resp refusal even when HTTP succeeded", async () => {
    await expect(minimaxAdapter.submit(invocation({
      kind: "text",
      modelId: "minimax-m3",
      upstreamModel: "MiniMax-M3",
      prompt: "Explain the fixture.",
    }), runtimeFetch(async () => response({
        base_resp: { status_code: 1004, status_msg: "login failed" },
      })))).rejects.toThrow("MiniMax text request failed: login failed");
  });

  it("rejects a MiniMax-M3 response without non-empty message content", async () => {
    for (const body of [
      { base_resp: { status_code: 0 }, choices: [] },
      { base_resp: { status_code: 0 }, choices: [{ message: { content: "   " } }] },
    ]) {
      await expect(minimaxAdapter.submit(invocation({
        kind: "text",
        modelId: "minimax-m3",
        upstreamModel: "MiniMax-M3",
        prompt: "Explain the fixture.",
      }), runtimeFetch(async () => response(body)))).rejects.toThrow(/choices\[0\]\.message\.content/i);
    }
  });

  it("projects the TTS card input without account metadata", async () => {
    let url = "";
    let body: Record<string, unknown> = {};
    const result = await minimaxAdapter.submit(invocation({
      kind: "audio",
      modelId: "minimax-tts",
      upstreamModel: "speech-02-hd",
      prompt: "hello",
      modelParams: { voice_id: "female-warm", speed: 1.2, pitch: 2 },
    }), runtimeFetch(async (input: string, init: { body: string }) => {
        url = input;
        body = JSON.parse(init.body) as Record<string, unknown>;
        return response({ base_resp: { status_code: 0 }, data: { audio: "00" } });
      }));

    expect(result.status).toBe("completed");
    expect(url).toBe("https://api.minimax.io/v1/t2a_v2");
    expect(body).toMatchObject({
      model: "speech-02-hd",
      text: "hello",
      voice_setting: {
        voice_id: "English_Graceful_Lady",
        speed: 1.2,
        vol: 1,
        pitch: 2,
      },
    });
    expect(body).not.toHaveProperty("credentials");
    expect(body).not.toHaveProperty("accountId");
  });

  it.each([
    ["female-warm", "English_Graceful_Lady"],
    ["female-energetic", "English_radiant_girl"],
    ["male-calm", "English_Insightful_Speaker"],
    ["male-storyteller", "English_expressive_narrator"],
    ["custom-cloned-voice", "custom-cloned-voice"],
  ])("maps the product voice %s to MiniMax voice %s", async (voice, expected) => {
    let body: Record<string, unknown> = {};
    await minimaxAdapter.submit(invocation({
      kind: "audio",
      modelId: "minimax-tts",
      upstreamModel: "speech-02-hd",
      prompt: "hello",
      modelParams: { voice_id: voice },
    }), runtimeFetch(async (_input: string, init: { body: string }) => {
        body = JSON.parse(init.body) as Record<string, unknown>;
        return response({ base_resp: { status_code: 0 }, data: { audio: "00" } });
      }));

    expect(body).toMatchObject({ voice_setting: { voice_id: expected } });
  });

  it("selects the music endpoint from the model identity", async () => {
    let url = "";
    let body: Record<string, unknown> = {};
    await minimaxAdapter.submit(invocation({
      kind: "audio",
      modelId: "minimax-music-3",
      upstreamModel: "music-3.0",
      prompt: "quiet piano",
      modelParams: { lyrics: "moonlight", is_instrumental: false },
    }), runtimeFetch(async (input: string, init: { body: string }) => {
        url = input;
        body = JSON.parse(init.body) as Record<string, unknown>;
        return response({ base_resp: { status_code: 0 }, data: { audio: "00" } });
      }));

    expect(url).toBe("https://api.minimax.io/v1/music_generation");
    expect(body).toMatchObject({
      model: "music-3.0",
      prompt: "quiet piano",
      lyrics: "moonlight",
      output_format: "hex",
    });
  });

  it("uploads every ordered H3 reference and emits only mm_file URLs in authored order", async () => {
    const calls: FetchCall[] = [];
    let upload = 0;
    const fetch = async (input: string | URL | Request, init: RequestInit = {}) => {
      const url = String(input);
      calls.push({ url, init });
      const path = new URL(url).pathname;
      if (path === "/v1/files/upload") {
        upload += 1;
        return response({
          base_resp: { status_code: 0 },
          file: { file_id: upload === 1 ? 101 : "102" },
        });
      }
      return response({ task_id: `task-${upload}` });
    };

    await minimaxAdapter.submit(invocation({
      kind: "video",
      modelId: "minimax-h3",
      upstreamModel: "MiniMax-H3",
      prompt: "Keep the subject aligned with the beat.",
      orderedContentParts: [
        { type: "text", text: "Keep " },
        { type: "image", url: "data:image/png;base64,AP8B" },
        { type: "text", text: " aligned with " },
        { type: "audio", url: "data:audio/mpeg;base64,SUQzAP8=" },
        { type: "text", text: "the beat." },
      ],
      aspectRatio: "16:9",
      modelParams: { resolution: "2K", duration: 6 },
    }), runtimeFetch(fetch));

    expect(calls).toHaveLength(3);
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      "/v1/files/upload",
      "/v1/files/upload",
      "/v2/video_generation",
    ]);

    const image = await multipartFile(calls[0]!);
    expect(image).toMatchObject({ purpose: "video_generation_input", contentType: "image/png" });
    expect(image.filename).toMatch(/\.png$/);
    expect(image.bytes).toEqual(Buffer.from([0, 255, 1]));

    const audio = await multipartFile(calls[1]!);
    expect(audio).toMatchObject({ purpose: "video_generation_input", contentType: "audio/mpeg" });
    expect(audio.filename).toMatch(/\.mp3$/);
    expect(audio.bytes).toEqual(Buffer.from([0x49, 0x44, 0x33, 0, 255]));

    expect(JSON.parse(String(calls[2]!.init.body))).toMatchObject({
      model: "MiniMax-H3",
      duration: 6,
      content: [
        { type: "text", text: "Keep the subject aligned with the beat." },
        { type: "image_url", image_url: { url: "mm_file://101" }, role: "reference_image" },
        { type: "audio_url", audio_url: { url: "mm_file://102" }, role: "reference_audio" },
      ],
    });
  });

  it("downloads a public H3 reference without a credential before uploading it", async () => {
    const calls: FetchCall[] = [];
    const fetch = async (input: string | URL | Request, init: RequestInit = {}) => {
      const url = String(input);
      calls.push({ url, init });
      if (url === "https://assets.example.test/portrait") {
        return new Response(Uint8Array.from([255, 216, 255, 217]), {
          headers: { "content-type": "image/jpeg" },
        });
      }
      if (new URL(url).pathname === "/v1/files/upload") {
        return response({ file: { file_id: "public-image" }, base_resp: { status_code: 0 } });
      }
      return response({ task_id: "public-task" });
    };

    await minimaxAdapter.submit(invocation({
      kind: "video",
      modelId: "minimax-h3",
      upstreamModel: "MiniMax-H3",
      prompt: "Animate the portrait.",
      referenceImageUrls: ["https://assets.example.test/portrait"],
    }), runtimeFetch(fetch));

    expect(calls.map((call) => call.url)).toEqual([
      "https://assets.example.test/portrait",
      "https://api.minimax.io/v1/files/upload",
      "https://api.minimax.io/v2/video_generation",
    ]);
    expect(new Headers(calls[0]!.init.headers).has("authorization")).toBe(false);
    expect(new Headers(calls[1]!.init.headers).get("authorization")).toBe("Bearer mm-key");
    expect(await multipartFile(calls[1]!)).toMatchObject({
      contentType: "image/jpeg",
      bytes: Buffer.from([255, 216, 255, 217]),
    });
    expect(JSON.parse(String(calls[2]!.init.body)).content).toEqual([
      { type: "text", text: "Animate the portrait." },
      { type: "image_url", image_url: { url: "mm_file://public-image" }, role: "reference_image" },
    ]);
  });

  it("uploads first and last frames before submitting H3 interpolation", async () => {
    const calls: FetchCall[] = [];
    let upload = 0;
    const fetch = async (input: string | URL | Request, init: RequestInit = {}) => {
      const url = String(input);
      calls.push({ url, init });
      if (new URL(url).pathname === "/v1/files/upload") {
        upload += 1;
        return response({ file: { file_id: `frame-${upload}` }, base_resp: { status_code: 0 } });
      }
      return response({ task_id: "frame-task" });
    };

    await minimaxAdapter.submit(invocation({
      kind: "video",
      modelId: "minimax-h3-startend",
      upstreamModel: "MiniMax-H3",
      prompt: "interpolate",
      startFrameUrl: "data:image/png;base64,AA==",
      endFrameUrl: "data:image/png;base64,AQ==",
      modelParams: { resolution: "768P" },
    }), runtimeFetch(fetch));

    const generation = calls.find((call) => new URL(call.url).pathname === "/v2/video_generation");
    expect(JSON.parse(String(generation?.init.body))).toMatchObject({
      ratio: "adaptive",
      resolution: "768P",
      content: [
        { type: "text", text: "interpolate" },
        { image_url: { url: "mm_file://frame-1" }, role: "first_frame" },
        { image_url: { url: "mm_file://frame-2" }, role: "last_frame" },
      ],
    });
  });

  it("hands a completed H3 URL to the host asset upload channel", async () => {
    const pollInvocation = invocation({
        kind: "video",
        modelId: "minimax-h3",
        upstreamModel: "MiniMax-H3",
      }) as unknown as Record<string, unknown>;
    const result = await minimaxAdapter.poll!({
      ...pollInvocation,
      operation: "poll",
      pollState: { taskId: "task-9" },
    } as never, runtimeFetch(async () => response({
        base_resp: { status_code: 0 },
        task: {
          task_id: "task-9",
          status: "Success",
          content: { url: "https://cdn.example.test/task-9.mp4" },
        },
      })));

    expect(result).toEqual({
      status: "completed",
      media: {
        media: {
          url: "https://cdn.example.test/task-9.mp4",
          mediaType: "video/mp4",
        },
      },
    });
  });

  it("keeps an accepted H3 task resumable after a poll transport failure", async () => {
    const pollInvocation = invocation({
      kind: "video",
      modelId: "minimax-h3",
      upstreamModel: "MiniMax-H3",
    }) as unknown as Record<string, unknown>;
    const fetchFailure = Object.assign(new TypeError("fetch failed"), {
      cause: { code: "ECONNRESET" },
    });

    await expect(minimaxAdapter.poll!({
      ...pollInvocation,
      operation: "poll",
      pollState: { taskId: "paid-task-9" },
    } as never, runtimeFetch(async () => { throw fetchFailure; }))).resolves.toEqual({
      status: "accepted",
      pollState: { taskId: "paid-task-9" },
      retryAfterMs: 5_000,
    });
  });

  it("does not retry H3 poll HTTP or provider terminal failures", async () => {
    const pollInvocation = invocation({
      kind: "video",
      modelId: "minimax-h3",
      upstreamModel: "MiniMax-H3",
    }) as unknown as Record<string, unknown>;
    const input = {
      ...pollInvocation,
      operation: "poll",
      pollState: { taskId: "paid-task-terminal" },
    } as never;

    await expect(minimaxAdapter.poll!(input, runtimeFetch(async () => ({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        text: async () => JSON.stringify({ error: { message: "upstream unavailable" } }),
      })))).rejects.toThrow("MiniMax video status failed: upstream unavailable");

    await expect(minimaxAdapter.poll!(input, runtimeFetch(async () => response({
        task: { status: "failed", error: { message: "content policy" } },
      })))).rejects.toThrow("MiniMax video generation failed: content policy");
  });
});
