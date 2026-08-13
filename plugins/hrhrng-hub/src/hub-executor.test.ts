import { describe, expect, it, vi } from "vitest";

import {
  HILO_MODEL_ROUTES,
  collectReferences,
  createHubRequest,
  pollHubModel,
  readPollState,
  submitHubModel,
  type HubReferences,
  type HubStep,
} from "./hub-executor";
import { hubAdapter } from "./hub-adapter";
import type {
  ExecutorContext,
  ResolvedReference,
} from "./executor-contract";
import type { ExecutablePluginReference } from "@clash/shared-types/executable-plugin";

/**
 * What this suite drives, and why it changed shape.
 *
 * These cases cover the split submit/poll executor contract:
 *
 *   - account configuration is a store read the host scopes to this invocation;
 *   - the request uses ordinary `fetch`;
 *   - submit and poll are two invocations the host sequences, not one loop the plugin runs.
 *
 * The vendor knowledge is untouched, which is the point: every assertion about a request body below
 * is the one that was there before. Only the harness that produces the body is new.
 */
const EXPECTED_UPSTREAM_MODELS = [
  "nano_banana_2_flash",
  "nano_banana_2",
  "doubao-seedream-5-0-pro-260628",
  "doubao-seedream-4-5-251128",
  "gpt-image-2",
  "midjourney-8.1",
  "midjourney-7",
  "midjourney-niji7",
  "kling-image-o1",
  "kling-v3-omni",
  "MiniMax-H3",
  "seedance2.0",
  "seedance2.0-fast",
  "seedance2.0-mini",
  "veo-3.1-fast-generate-001",
  "veo-3.1-generate-001",
  "kling-video-o1",
  "kling-v3-omni",
  "kling-avatar",
  "kling-motion-control",
  "jimeng_motion_control",
  "speech-2.8-hd",
  "seed-audio-1.0",
  "music-3.0",
  "elevenlabs-music-v2",
  "music-cover",
] as const;

const DATA_IMAGE = `data:image/png;base64,${Buffer.from("image").toString("base64")}`;
const DATA_IMAGE_2 = `data:image/jpeg;base64,${Buffer.from("image-2").toString("base64")}`;
const DATA_VIDEO = `data:video/mp4;base64,${Buffer.from("video").toString("base64")}`;
const DATA_AUDIO = `data:audio/wav;base64,${Buffer.from("audio").toString("base64")}`;

/** One outgoing call, in the shape the assertions below read. */
interface Call {
  url: string;
  method: string;
  body: unknown;
  headers: Record<string, string>;
}

const fixtureReferenceUrls = new Map<string, string>();

function invocationFor(
  values: Record<string, unknown>,
  extras: { operation?: "submit" | "poll"; pollState?: unknown } = {},
) {
  const fixtureValues = { ...values };
  const references: ExecutablePluginReference[] = [];
  const add = (
    slot: "image" | "video" | "audio" | "startFrame" | "endFrame",
    kind: "image" | "video" | "audio",
    urls: unknown,
  ) => {
    const values = Array.isArray(urls)
      ? urls
      : typeof urls === "string"
        ? [urls]
        : [];
    for (const [index, url] of values.entries()) {
      if (typeof url !== "string" || !url) continue;
      const assetId = `fixture-${slot}-${index}`;
      fixtureReferenceUrls.set(assetId, url);
      references.push({
        slot,
        index,
        asset: {
          assetId,
          uri: `clash-asset://${assetId}`,
          kind,
        },
      });
    }
  };
  add("image", "image", fixtureValues.referenceImageUrls);
  add("video", "video", fixtureValues.referenceVideoUrls);
  add("audio", "audio", fixtureValues.referenceAudioUrls);
  add("startFrame", "image", fixtureValues.startFrameUrl);
  add("endFrame", "image", fixtureValues.endFrameUrl);
  for (const key of [
    "referenceImageUrls",
    "referenceVideoUrls",
    "referenceAudioUrls",
    "startFrameUrl",
    "endFrameUrl",
  ]) {
    delete fixtureValues[key];
  }
  return {
    protocol: "clash.plugin.invoke/v1" as const,
    invocationId: "invocation-test",
    taskId: "task-test",
    projectId: "project-test",
    operation: extras.operation ?? "submit",
    target: {
      pluginId: "hrhrng.hub",
      version: "1.3.1",
      exportId: "hilo-hub-execute",
      schemaHash: `sha256:${"a".repeat(64)}`,
      kind: "provider-executor" as const,
    },
    input: { values: fixtureValues as never, references },
    ...(extras.pollState ? { pollState: extras.pollState } : {}),
    actor: { kind: "system" as const, id: "local-aigc" },
  } as never;
}

async function resolveFixtureReference(
  input: unknown,
): Promise<ResolvedReference> {
  const reference = input as Extract<ExecutablePluginReference, { asset: unknown }>;
  const url = fixtureReferenceUrls.get(reference.asset.assetId);
  if (!url) throw new Error(`Fixture Asset ${reference.asset.assetId} has no media.`);
  const inline = /^data:([^;,]+);base64,(.*)$/s.exec(url);
  if (inline) {
    return {
      form: "bytes",
      bytes: Uint8Array.from(Buffer.from(inline[2] ?? "", "base64")),
      mediaType: inline[1] ?? "application/octet-stream",
      kind: reference.asset.kind,
    };
  }
  return {
    form: "provider-url",
    providerUrl: url,
    expiresAt: "2026-08-13T12:00:00.000Z",
    kind: reference.asset.kind,
    ...(reference.asset.mediaType
      ? { mediaType: reference.asset.mediaType }
      : {}),
  };
}

/**
 * A fetch that records what it was asked to send and answers from a script.
 *
 * `responder` receives the parsed request and returns the JSON body Hub would answer with; throwing
 * from it is how a transport failure is simulated, because that is how `fetch` reports one.
 */
function recordingFetch(responder: (call: Call, index: number) => unknown) {
  const calls: Call[] = [];
  const impl = (async (input: string | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      headers: (init?.headers ?? {}) as Record<string, string>,
    };
    calls.push(call);
    const answered = responder(call, calls.length - 1);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(answered ?? {}),
    };
  }) as unknown as typeof globalThis.fetch;
  return { calls, impl };
}

/** The default script: uploads answer with an address, submits answer with a task id. */
function defaultResponder(call: Call, index: number): unknown {
  const url = new URL(call.url);
  if (url.pathname === "/api/v1/files/upload") {
    const prefix = String((call.body as Record<string, unknown>).file_prefix);
    return { url: `https://uploads.test/${prefix}-${index + 1}` };
  }
  if (call.method === "POST") {
    if (url.pathname.includes("/kling/"))
      return { code: 0, data: { task_id: "contract-task" } };
    if (url.pathname.includes("/jimeng/"))
      return { code: 10000, data: { task_id: "contract-task" } };
    return { task_id: "contract-task", status: "pending" };
  }
  return {
    status: "success",
    data: { task_status: "succeed", video_url: "https://cdn.test/r.mp4" },
  };
}

/**
 * Submit once and hand back what went over the wire.
 *
 * The upload indices in the assertions are one-based over *all* calls, which is what the previous
 * harness counted too: a family that uploads an image then a video sees `image-1` and `video-2`.
 */
async function executeContract(
  values: Record<string, unknown>,
): Promise<Call[]> {
  const { calls, impl } = recordingFetch(defaultResponder);
  const invocation = invocationFor(values);
  const references = await collectReferences(
    invocation,
    resolveFixtureReference,
  );
  await submitHubModel(
    invocation,
    createHubRequest(impl, "test-token", "submit"),
    references,
  );
  return calls;
}

const uploadCalls = (calls: Call[]) =>
  calls.filter((call) => new URL(call.url).pathname === "/api/v1/files/upload");

function submitCall(calls: Call[]): Call {
  const call = calls.find(
    (candidate) =>
      candidate.method === "POST" &&
      new URL(candidate.url).pathname !== "/api/v1/files/upload",
  );
  expect(call, "missing submit call").toBeDefined();
  return call!;
}

const NO_REFERENCES: HubReferences = { images: [], videos: [], audios: [] };

describe("Hilo Hub provider executor", () => {
  it("declares an executable route for every overseas catalog model", () => {
    const routed = HILO_MODEL_ROUTES.map((route) => route.upstreamModel);
    for (const model of EXPECTED_UPSTREAM_MODELS) {
      expect(routed, `missing Hilo route for ${model}`).toContain(model);
    }
    expect(HILO_MODEL_ROUTES.length).toBe(EXPECTED_UPSTREAM_MODELS.length);
  });

  it("submits a MiniMax H3 task, then resolves its file on a later poll", async () => {
    // Two invocations, not one loop. The plugin hands back what identifies the task and stops; the
    // host is the only party that still remembers it after a restart, so it owns the waiting.
    const submitFetch = recordingFetch(() => ({
      task_id: "h3-task-1",
      status: "queueing",
    }));
    const submitted = await submitHubModel(
      invocationFor({
        modelId: "minimax-h3",
        upstreamModel: "MiniMax-H3",
        prompt: "A lighthouse in a storm",
        duration: 5,
        aspectRatio: "16:9",
        modelParams: { resolution: "2K", generate_audio: true },
      }),
      createHubRequest(submitFetch.impl, "test-token", "submit"),
      NO_REFERENCES,
    );

    expect(submitted).toEqual({
      status: "accepted",
      pollState: { taskId: "h3-task-1", upstreamModel: "MiniMax-H3" },
    });
    const submit = submitCall(submitFetch.calls);
    const submitUrl = new URL(submit.url);
    expect(submitUrl.pathname).toBe("/api/v1/video/minimax-v3/generate");
    expect(Object.fromEntries(submitUrl.searchParams)).toEqual({
      version_code: "2.0.11",
    });
    expect(submit.body).toEqual({
      model: "MiniMax-H3",
      prompt: "A lighthouse in a storm",
      duration: 5,
      ratio: "16:9",
      resolution: "2K",
      generate_audio: true,
    });
    // Both headers, because Hub reads either depending on the endpoint.
    expect(submit.headers.authorization).toBe("Bearer test-token");
    expect(submit.headers.token).toBe("test-token");

    const pollFetch = recordingFetch((call) =>
      new URL(call.url).pathname.includes("/files/")
        ? { file: { download_url: "https://cdn.minimax.io/h3.mp4" } }
        : { task_id: "h3-task-1", status: "success", file_id: "file-1" },
    );
    const taskPolled = await pollHubModel(
      invocationFor(
        {},
        {
          operation: "poll",
          pollState: { taskId: "h3-task-1", upstreamModel: "MiniMax-H3" },
        },
      ),
      createHubRequest(pollFetch.impl, "test-token", "poll"),
    );
    expect(taskPolled).toEqual({
      status: "accepted",
      pollState: {
        taskId: "h3-task-1",
        upstreamModel: "MiniMax-H3",
        fileId: "file-1",
      },
    });
    expect(pollFetch.calls).toHaveLength(1);

    const polled = await pollHubModel(
      invocationFor(
        {},
        {
          operation: "poll",
          pollState: taskPolled.status === "accepted"
            ? taskPolled.pollState
            : undefined,
        },
      ),
      createHubRequest(pollFetch.impl, "test-token", "poll"),
    );

    // Named media rather than a hand-built asset: the plugin knows the address Hub published and
    // what kind of media it is. The assetId, the uri and who can reach it are the host's to decide.
    expect(polled).toEqual({
      status: "completed",
      media: {
        media: {
          url: "https://cdn.minimax.io/h3.mp4",
          mediaType: "video/mp4",
          kind: "video",
        },
      },
    });
    expect(
      pollFetch.calls.filter((call) =>
        new URL(call.url).pathname.includes("/tasks/"),
      ),
    ).toHaveLength(1);
    expect(
      pollFetch.calls.filter((call) =>
        new URL(call.url).pathname.includes("/files/"),
      ),
    ).toHaveLength(1);
  });

  it("rejects a file phase for a model whose route has no file endpoint", () => {
    expect(() =>
      readPollState(
        invocationFor(
          {},
          {
            operation: "poll",
            pollState: {
              taskId: "image-task",
              upstreamModel: "nano_banana_2",
              fileId: "forged-file",
            },
          },
        ),
      ),
    ).toThrow(/does not support file poll state/);
  });

  it("uploads H3 byte and public-URL references before submit, preserving MP3 semantics", async () => {
    const { calls, impl } = recordingFetch((call, index) => {
      const url = new URL(call.url);
      if (url.pathname === "/api/v1/files/upload") {
        const body = call.body as Record<string, unknown>;
        const extension = String(body.file_data).startsWith("data:audio/mp3;")
          ? ".mp3"
          : ".png";
        return {
          url: `https://uploads.test/reference-${index + 1}${extension}`,
        };
      }
      return { task_id: "h3-upload-task", status: "pending" };
    });
    const mediaFetch = vi.fn(
      async () =>
        new Response(Buffer.from("MP3DATA"), {
          headers: { "content-type": "audio/mpeg" },
        }),
    );
    const invocation = invocationFor({
      modelId: "minimax-h3",
      upstreamModel: "MiniMax-H3",
      prompt: "Follow the image and voice reference",
      referenceImageUrls: [DATA_IMAGE],
      referenceAudioUrls: ["https://cdn.example.test/voice.mp3"],
    });

    await submitHubModel(
      invocation,
      createHubRequest(impl, "test-token", "submit"),
      await collectReferences(invocation, resolveFixtureReference),
      { fetch: mediaFetch as typeof globalThis.fetch },
    );

    expect(mediaFetch).toHaveBeenCalledWith(
      "https://cdn.example.test/voice.mp3",
    );
    expect(uploadCalls(calls).map((call) => call.body)).toEqual([
      { file_data: DATA_IMAGE, file_prefix: "image" },
      {
        file_data: `data:audio/mp3;base64,${Buffer.from("MP3DATA").toString("base64")}`,
        file_prefix: "audio",
      },
    ]);
    expect(submitCall(calls).body).toMatchObject({
      reference_images: ["https://uploads.test/reference-1.png"],
      reference_audios: ["https://uploads.test/reference-2.mp3"],
    });
    expect(JSON.stringify(submitCall(calls).body)).not.toContain("data:");
  });

  it("encodes Veo start/end frames with the Vertex request contract", async () => {
    const calls = await executeContract({
      modelId: "veo-3.1-fast-startend",
      upstreamModel: "veo-3.1-fast-generate-001",
      prompt: "A paper boat crosses a puddle",
      duration: 8,
      aspectRatio: "16:9",
      startFrameUrl: DATA_IMAGE,
      endFrameUrl: DATA_IMAGE_2,
      modelParams: { resolution: "1080p" },
    });

    expect(uploadCalls(calls).length).toBe(0);
    const submit = submitCall(calls);
    const url = new URL(submit.url);
    expect(url.pathname).toBe("/api/v1/video/veo3/generate");
    expect(url.searchParams.get("model")).toBe("veo-3.1-fast-generate-001");
    expect(submit.body).toEqual({
      instances: [
        {
          prompt: "A paper boat crosses a puddle",
          image: {
            bytes_base64_encoded: Buffer.from("image").toString("base64"),
            mime_type: "image/png",
          },
          last_frame: {
            bytes_base64_encoded: Buffer.from("image-2").toString("base64"),
            mime_type: "image/jpeg",
          },
        },
      ],
      parameters: {
        duration_seconds: 8,
        aspect_ratio: "16:9",
        resolution: "1080p",
        generate_audio: true,
        person_generation: "allow_all",
      },
    });
  });

  it("uploads Seedance multimodal references and sends its exact request fields", async () => {
    const calls = await executeContract({
      modelId: "seedance-2-ref",
      upstreamModel: "seedance2.0",
      prompt: "The character performs the referenced action",
      duration: 8,
      aspectRatio: "16:9",
      referenceImageUrls: [DATA_IMAGE],
      referenceVideoUrls: [DATA_VIDEO],
      referenceAudioUrls: [DATA_AUDIO],
      modelParams: {
        resolution: "720p",
        generate_audio: false,
        reference_video_durations_ms: [3000],
      },
    });

    expect(uploadCalls(calls).map((call) => call.body)).toEqual([
      { file_data: DATA_IMAGE, file_prefix: "image" },
      { file_data: DATA_VIDEO, file_prefix: "video" },
      { file_data: DATA_AUDIO, file_prefix: "audio" },
    ]);
    const submit = submitCall(calls);
    expect(new URL(submit.url).pathname).toBe(
      "/api/v1/video/seedance/generate",
    );
    expect(submit.body).toEqual({
      model: "seedance2.0",
      prompt: "The character performs the referenced action",
      ratio: "16:9",
      duration: 8,
      generate_audio: false,
      resolution: "720p",
      reference_images: ["https://uploads.test/image-1"],
      reference_videos: ["https://uploads.test/video-2"],
      reference_video_durations_ms: [3000],
      reference_audios: ["https://uploads.test/audio-3"],
    });
  });

  it("downloads and uploads a public Seedance reference instead of forwarding its URL", async () => {
    const { calls, impl } = recordingFetch(defaultResponder);
    const mediaFetch = vi.fn(
      async () =>
        new Response(Buffer.from("REMOTE-VIDEO"), {
          headers: { "content-type": "video/mp4" },
        }),
    );
    const invocation = invocationFor({
      modelId: "seedance-2-ref",
      upstreamModel: "seedance2.0",
      prompt: "Follow both references",
      referenceImageUrls: [DATA_IMAGE],
      referenceVideoUrls: ["https://cdn.example.test/reference.mp4"],
    });

    await submitHubModel(
      invocation,
      createHubRequest(impl, "test-token", "submit"),
      await collectReferences(invocation, resolveFixtureReference),
      { fetch: mediaFetch as typeof globalThis.fetch },
    );

    expect(mediaFetch).toHaveBeenCalledWith(
      "https://cdn.example.test/reference.mp4",
    );
    expect(uploadCalls(calls).map((call) => call.body)).toEqual([
      { file_data: DATA_IMAGE, file_prefix: "image" },
      {
        file_data: `data:video/mp4;base64,${Buffer.from("REMOTE-VIDEO").toString("base64")}`,
        file_prefix: "video",
      },
    ]);
    expect(submitCall(calls).body).toMatchObject({
      reference_images: ["https://uploads.test/image-1"],
      reference_videos: ["https://uploads.test/video-2"],
    });
    expect(JSON.stringify(submitCall(calls).body)).not.toContain(
      "cdn.example.test",
    );
  });

  it("uses Kling Omni endpoints and structured reference lists", async () => {
    const calls = await executeContract({
      modelId: "kling-video-o3",
      upstreamModel: "kling-v3-omni",
      prompt: "Track the dancer from a low angle",
      duration: 10,
      aspectRatio: "9:16",
      referenceImageUrls: [DATA_IMAGE],
      referenceVideoUrls: [DATA_VIDEO],
      modelParams: { generate_audio: true, multi_shot: true },
    });

    expect(uploadCalls(calls).map((call) => call.body)).toEqual([
      { file_data: DATA_IMAGE, file_prefix: "image" },
      { file_data: DATA_VIDEO, file_prefix: "video" },
    ]);
    const submit = submitCall(calls);
    expect(new URL(submit.url).pathname).toBe(
      "/api/v1/video/kling-omni/generate",
    );
    expect(submit.body).toEqual({
      model_name: "kling-v3-omni",
      prompt: "Track the dancer from a low angle",
      mode: "pro",
      aspect_ratio: "9:16",
      duration: "10",
      sound: "on",
      multi_shot: true,
      shot_type: "intelligence",
      image_list: [{ image_url: "https://uploads.test/image-1" }],
      video_list: [{ video_url: "https://uploads.test/video-2" }],
    });
  });

  it("uploads Kling avatar media into image and sound_file", async () => {
    const calls = await executeContract({
      modelId: "kling-avatar",
      upstreamModel: "kling-avatar",
      prompt: "",
      referenceImageUrls: [DATA_IMAGE],
      referenceAudioUrls: [DATA_AUDIO],
      modelParams: {},
    });

    expect(uploadCalls(calls).map((call) => call.body)).toEqual([
      { file_data: DATA_IMAGE, file_prefix: "image" },
      { file_data: DATA_AUDIO, file_prefix: "audio" },
    ]);
    const submit = submitCall(calls);
    expect(new URL(submit.url).pathname).toBe("/api/v1/video/kling/avatar");
    expect(submit.body).toEqual({
      image: "https://uploads.test/image-1",
      sound_file: "https://uploads.test/audio-2",
      prompt: "",
      mode: "std",
    });
  });

  it("uploads Kling motion-control media into image_url and video_url", async () => {
    const calls = await executeContract({
      modelId: "kling-motion-control",
      upstreamModel: "kling-motion-control",
      prompt: "Preserve the costume",
      referenceImageUrls: [DATA_IMAGE],
      referenceVideoUrls: [DATA_VIDEO],
      modelParams: {},
    });

    const submit = submitCall(calls);
    expect(new URL(submit.url).pathname).toBe(
      "/api/v1/video/kling/motion-control",
    );
    expect(submit.body).toEqual({
      mode: "std",
      image_url: "https://uploads.test/image-1",
      video_url: "https://uploads.test/video-2",
      keep_original_sound: "yes",
      character_orientation: "video",
      prompt: "Preserve the costume",
    });
  });

  it("uses Jimeng's image_urls plus video_url request contract", async () => {
    const calls = await executeContract({
      modelId: "jimeng-motion-control-2",
      upstreamModel: "jimeng_motion_control",
      prompt: "This prompt is intentionally not part of Jimeng's payload",
      referenceImageUrls: [DATA_IMAGE],
      referenceVideoUrls: [DATA_VIDEO],
      modelParams: {},
    });

    const submit = submitCall(calls);
    expect(new URL(submit.url).pathname).toBe("/api/v1/video/jimeng/generate");
    expect(submit.body).toEqual({
      image_urls: ["https://uploads.test/image-1"],
      video_url: "https://uploads.test/video-2",
    });
  });

  it("maps every supported MiniMax TTS option without invented fields", async () => {
    const calls = await executeContract({
      modelId: "minimax-speech-2.8-hd",
      upstreamModel: "speech-2.8-hd",
      prompt: "Welcome aboard",
      modelParams: {
        voice_id: "English_Graceful_Lady",
        speed: 1.1,
        emotion: "happy",
        vol: 1.5,
        pitch: -1,
        pronunciation_dict: JSON.stringify({ tone: ["Clash/klaesh"] }),
        voice_modify: JSON.stringify({ pitch: 2 }),
      },
    });

    const submit = submitCall(calls);
    expect(new URL(submit.url).pathname).toBe("/api/v2/audio/tts");
    expect(submit.body).toEqual({
      model: "speech-2.8-hd",
      text: "Welcome aboard",
      voice_id: "English_Graceful_Lady",
      speed: 1.1,
      subtitle_enable: true,
      emotion: "happy",
      vol: 1.5,
      pitch: -1,
      pronunciation_dict: { tone: ["Clash/klaesh"] },
      voice_modify: { pitch: 2 },
    });
  });

  it("uploads SeedAudio references and maps multiplier controls to rates", async () => {
    const calls = await executeContract({
      modelId: "seed-audio-1",
      upstreamModel: "seed-audio-1.0",
      prompt: "Read this line",
      referenceAudioUrls: [DATA_AUDIO],
      modelParams: {
        speed: 1.25,
        volume: 0.75,
        pitch: 3,
        sample_rate: 24000,
        format: "wav",
      },
    });

    expect(uploadCalls(calls).map((call) => call.body)).toEqual([
      { file_data: DATA_AUDIO, file_prefix: "audio" },
    ]);
    const submit = submitCall(calls);
    expect(new URL(submit.url).pathname).toBe("/api/v2/audio/seedaudio/tts");
    expect(submit.body).toEqual({
      model: "seed-audio-1.0",
      text_prompt: "Read this line",
      references: [{ audio_url: "https://uploads.test/audio-1" }],
      speech_rate: 25,
      loudness_rate: -25,
      pitch_rate: 3,
      sample_rate: 24000,
      format: "wav",
    });
  });

  it("does not force an ElevenLabs instrumental flag when it is disabled", async () => {
    const calls = await executeContract({
      modelId: "elevenlabs-music-v2",
      upstreamModel: "elevenlabs-music-v2",
      prompt: "A hopeful orchestral pop song",
      duration: 90,
      modelParams: { is_instrumental: false },
    });

    const submit = submitCall(calls);
    expect(new URL(submit.url).pathname).toBe("/api/v2/audio/music/elevenlabs");
    expect(submit.body).toEqual({
      prompt: "A hopeful orchestral pop song",
      model_id: "music_v2",
      music_length_ms: 90000,
    });
  });

  it("uploads Music Cover audio and sends only supported cover fields", async () => {
    const calls = await executeContract({
      modelId: "music-cover",
      upstreamModel: "music-cover",
      prompt: "Dreamy synthwave arrangement",
      referenceAudioUrls: [DATA_AUDIO],
      modelParams: { lyrics: "Neon on the avenue", format: "wav" },
    });

    expect(uploadCalls(calls).map((call) => call.body)).toEqual([
      { file_data: DATA_AUDIO, file_prefix: "audio" },
    ]);
    const submit = submitCall(calls);
    expect(new URL(submit.url).pathname).toBe(
      "/api/v2/audio/music/cover/generate",
    );
    expect(submit.body).toEqual({
      prompt: "Dreamy synthwave arrangement",
      model: "music-cover",
      lyrics: "Neon on the avenue",
      audio_url: "https://uploads.test/audio-1",
    });
  });

  it("sends MiniMax Music lyrics and instrumental mode in the cloud-v2 shape", async () => {
    const calls = await executeContract({
      modelId: "minimax-music-3",
      upstreamModel: "music-3.0",
      prompt: "Bright indie rock",
      modelParams: {
        lyrics: "Wake up to the morning light",
        is_instrumental: false,
      },
    });

    const submit = submitCall(calls);
    expect(new URL(submit.url).pathname).toBe("/api/v2/audio/music/minimax");
    expect(submit.body).toEqual({
      prompt: "Bright indie rock",
      model: "music-3.0",
      is_instrumental: false,
      lyrics: "Wake up to the morning light",
    });
  });

  it("names an audio result by its own media type rather than the route's default", async () => {
    // What replaced "converts audio result duration seconds to Clash duration milliseconds".
    //
    // That case asserted a `durationMs` on a value output. The duration is genuinely not carried
    // any more, and it was not carried by the installed 1.3.1 either: the function that derived it
    // had already lost its last caller and sat dead in the file. Asserting it here would describe a
    // feature nothing implements; what the completed step does state is the address and the type,
    // and an `.mp3` must not be announced as the audio default when the URL says otherwise.
    const { impl } = recordingFetch(() => ({
      status: "success",
      audio_url: "https://cdn.test/x.mp3",
    }));
    const polled = await pollHubModel(
      invocationFor(
        {},
        {
          operation: "poll",
          pollState: { taskId: "duration-task", upstreamModel: "music-3.0" },
        },
      ),
      createHubRequest(impl, "test-token", "poll"),
    );
    expect(polled).toEqual({
      status: "completed",
      media: {
        media: {
          url: "https://cdn.test/x.mp3",
          mediaType: "audio/mp3",
          kind: "audio",
        },
      },
    });
    // `audio/mp3` rather than the registered `audio/mpeg`, which is what the extension table has
    // always said. Left alone: it is the shape Hub media has been stored under all along, and
    // correcting it here would change what the host records for a reason unrelated to this move.
  });

  it("uploads Seedream references and applies the 4.5-only tuning fields", async () => {
    const calls = await executeContract({
      modelId: "seedream-4.5",
      upstreamModel: "doubao-seedream-4-5-251128",
      prompt: "A ceramic fox on a studio backdrop",
      aspectRatio: "4:3",
      referenceImageUrls: [DATA_IMAGE],
      modelParams: { resolution: "2K", seed: 42, guidance_scale: 4.5 },
    });

    expect(uploadCalls(calls).map((call) => call.body)).toEqual([
      { file_data: DATA_IMAGE, file_prefix: "image" },
    ]);
    const submit = submitCall(calls);
    expect(new URL(submit.url).pathname).toBe(
      "/api/v2/image/seedream/generate",
    );
    expect(submit.body).toEqual({
      prompt: "A ceramic fox on a studio backdrop",
      image_paths: ["https://uploads.test/image-1"],
      aspect_ratio: "4:3",
      model: "doubao-seedream-4-5-251128",
      size: "2K",
      seed: 42,
      guidance_scale: 4.5,
    });
  });

  it("keeps Nano Banana reference images inline", async () => {
    const calls = await executeContract({
      modelId: "nano-banana-2",
      upstreamModel: "nano_banana_2_flash",
      prompt: "Replace the background with a forest",
      aspectRatio: "1:1",
      referenceImageUrls: [DATA_IMAGE],
      modelParams: { resolution: "2K" },
    });

    expect(uploadCalls(calls).length).toBe(0);
    expect(submitCall(calls).body).toEqual({
      prompt: "Replace the background with a forest",
      model_name: "nano_banana_2_flash",
      image_paths: [DATA_IMAGE],
      aspect_ratio: "1:1",
      resolution: "2K",
    });
  });

  it("maps GPT Image 2 resolution and aspect ratio to the accepted pixel size", async () => {
    const calls = await executeContract({
      modelId: "gpt-image-2",
      upstreamModel: "gpt-image-2",
      prompt: "A typographic travel poster",
      aspectRatio: "16:9",
      referenceImageUrls: [DATA_IMAGE],
      modelParams: {
        resolution: "2k",
        quality: "high",
        count: 2,
        background: "transparent",
      },
    });

    expect(uploadCalls(calls).length).toBe(0);
    expect(submitCall(calls).body).toEqual({
      prompt: "A typographic travel poster",
      model: "gpt-image-2",
      size: "2560x1440",
      image_paths: [DATA_IMAGE],
      quality: "high",
      n: 2,
      background: "transparent",
    });
  });

  it("uploads Midjourney references and appends version and tuning flags", async () => {
    const calls = await executeContract({
      modelId: "midjourney-niji-7",
      upstreamModel: "midjourney-niji7",
      prompt: "A clockwork city",
      aspectRatio: "16:9",
      referenceImageUrls: [DATA_IMAGE],
      modelParams: { stylize: 250, chaos: 10, weird: 20 },
    });

    const submit = submitCall(calls);
    expect(new URL(submit.url).pathname).toBe(
      "/api/v1/image/midjourney/generate",
    );
    expect(submit.body).toEqual({
      prompt:
        "https://uploads.test/image-1 A clockwork city --ar 16:9 --stylize 250 --chaos 10 --weird 20 --niji 7",
      params: { stylize: 250, chaos: 10, weird: 20 },
    });
  });

  it("uses the Kling Omni image endpoint and image_list field", async () => {
    const calls = await executeContract({
      modelId: "kling-image-o1",
      upstreamModel: "kling-image-o1",
      prompt: "Merge these character designs",
      aspectRatio: "1:1",
      referenceImageUrls: [DATA_IMAGE, DATA_IMAGE_2],
      modelParams: { resolution: "2k" },
    });

    const submit = submitCall(calls);
    expect(new URL(submit.url).pathname).toBe(
      "/api/v1/image/kling-omni/generate",
    );
    expect(submit.body).toEqual({
      prompt: "Merge these character designs",
      model_name: "kling-image-o1",
      // The hilo-kling-image-* binding resolves "2k"; the executor passes it through.
      resolution: "2k",
      aspect_ratio: "1:1",
      image_list: [
        "https://uploads.test/image-1",
        "https://uploads.test/image-2",
      ],
    });
  });

  it("reports the Kling task failure reason instead of the envelope success message", async () => {
    // Captured from hub.minimax.io: the envelope stays message="success" while the task itself
    // fails, so the real reason only lives in data.task_status_msg.
    const { impl } = recordingFetch(() => ({
      message: "success",
      data: {
        task_id: "k-1",
        task_status: "failed",
        task_status_msg:
          'HTTP 400: {"code":1201,"message":"resolution value \'1K\' is invalid"}',
      },
      user_message: "Model generation failed. Please try again.",
    }));

    await expect(
      pollHubModel(
        invocationFor(
          {},
          {
            operation: "poll",
            pollState: { taskId: "k-1", upstreamModel: "kling-image-o1" },
          },
        ),
        createHubRequest(impl, "test-token", "poll"),
      ),
    ).rejects.toThrow(/resolution value '1K' is invalid/);
  });

  it("passes Kling resolution through untouched so the binding owns the vocabulary", async () => {
    // hilo-kling-image-* bindings declare parameterOverrides with 1k/2k values, so the executor
    // must not second-guess whatever the resolved Card sends.
    for (const declared of ["1k", "2k"] as const) {
      const calls = await executeContract({
        modelId: "kling-image-o1",
        upstreamModel: "kling-image-o1",
        prompt: "Merge these character designs",
        aspectRatio: "1:1",
        modelParams: { resolution: declared },
      });
      expect(
        (submitCall(calls).body as Record<string, unknown>).resolution,
      ).toBe(declared);
    }
  });

  it("surfaces a transient poll failure after one status request", async () => {
    let polls = 0;
    const { impl } = recordingFetch(() => {
      polls += 1;
      throw new Error("fetch failed");
    });

    await expect(
      pollHubModel(
        invocationFor(
          {},
          {
            operation: "poll",
            pollState: { taskId: "t-1", upstreamModel: "nano_banana_2" },
          },
        ),
        createHubRequest(impl, "test-token", "poll"),
      ),
    ).rejects.toThrow("fetch failed");
    expect(polls).toBe(1);
  });

  it("classifies a poll HTTP outage without forgetting the accepted task", async () => {
    const fetch = (async () => ({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      text: async () => "upstream unavailable",
    })) as unknown as typeof globalThis.fetch;

    await expect(
      createHubRequest(fetch, "test-token", "poll")(
        "/api/v2/image/nano_banana/tasks/t-1",
        "GET",
      ),
    ).rejects.toMatchObject({
      failure: {
        code: "provider_unavailable",
        retryable: true,
        requestState: "accepted",
        providerCode: "HTTP_503",
      },
    });
  });

  it("never sends adaptive ratio for a pure text-to-video H3 request", async () => {
    // Official MiniMax-H3 spec: for t2va (content is text only) `ratio` is required and cannot be
    // `adaptive`. The Card still defaults to adaptive.
    const textOnly = await executeContract({
      modelId: "minimax-h3",
      upstreamModel: "MiniMax-H3",
      prompt: "A paper boat crosses a puddle",
      duration: 5,
      aspectRatio: "adaptive",
      modelParams: { resolution: "2K" },
    });
    expect((submitCall(textOnly).body as Record<string, unknown>).ratio).toBe(
      "16:9",
    );

    // With references, adaptive is explicitly allowed by the same spec.
    const withRefs = await executeContract({
      modelId: "minimax-h3",
      upstreamModel: "MiniMax-H3",
      prompt: "Match the referenced motion",
      duration: 5,
      aspectRatio: "adaptive",
      referenceImageUrls: [DATA_IMAGE],
      modelParams: { resolution: "2K" },
    });
    expect((submitCall(withRefs).body as Record<string, unknown>).ratio).toBe(
      "adaptive",
    );

    // An explicit concrete ratio must always survive untouched.
    const explicit = await executeContract({
      modelId: "minimax-h3",
      upstreamModel: "MiniMax-H3",
      prompt: "A paper boat crosses a puddle",
      duration: 5,
      aspectRatio: "9:16",
      modelParams: { resolution: "2K" },
    });
    expect((submitCall(explicit).body as Record<string, unknown>).ratio).toBe(
      "9:16",
    );
  });

  it("stops polling on a Kling data.task_status failure", async () => {
    let pollCount = 0;
    const { impl } = recordingFetch(() => {
      pollCount += 1;
      return {
        code: 0,
        data: {
          task_status: "failed",
          task_status_msg: "content policy rejected",
        },
      };
    });

    await expect(
      pollHubModel(
        invocationFor(
          {},
          {
            operation: "poll",
            pollState: {
              taskId: "failed-task",
              upstreamModel: "kling-v3-omni",
            },
          },
        ),
        createHubRequest(impl, "test-token", "poll"),
      ),
    ).rejects.toMatchObject({
      failure: {
        code: "provider_failed",
        message: "content policy rejected",
        retryable: false,
        requestState: "accepted",
        providerCode: "failed",
      },
    });
    // Once. A failed task asked again is a task that will fail again, at the cost of a round trip
    // per attempt for as long as the host keeps asking.
    expect(pollCount).toBe(1);
  });

  it("refuses a status word it does not recognise rather than waiting forever", async () => {
    // The easy fallthrough -- treat anything unknown as still running -- turns a status added
    // upstream next month into an unbounded wait on work that already died, with no symptom except
    // that nothing ever happens.
    const { impl } = recordingFetch(() => ({
      task_id: "t-9",
      status: "quarantined",
    }));
    await expect(
      pollHubModel(
        invocationFor(
          {},
          {
            operation: "poll",
            pollState: { taskId: "t-9", upstreamModel: "nano_banana_2" },
          },
        ),
        createHubRequest(impl, "test-token", "poll"),
      ),
    ).rejects.toThrow(/does not recognise/);
  });
});

describe("Hilo Hub credentials and references", () => {
  function contextWith(
    stored: Record<string, string>,
    extra: Partial<ExecutorContext> = {},
  ) {
    return {
      store: {
        get: async (key: string) => stored[key],
        put: async () => undefined,
        remove: async () => undefined,
      },
      ...extra,
    } as ExecutorContext;
  }

  it("refuses to generate when the account stored no token", async () => {
    // An empty string travels to Hub as "authorization: Bearer " and comes back as an
    // authentication failure naming the token rather than its absence, which sends the reader
    // looking for a revoked credential instead of an unconfigured one.
    await expect(
      hubAdapter.submit(
        invocationFor({
          modelId: "minimax-h3",
          upstreamModel: "MiniMax-H3",
          prompt: "x",
        }),
        contextWith({ accessToken: "" }),
      ),
    ).rejects.toThrow(/no accessToken stored/);
  });

  it("reads the token under the key its own declaration names", async () => {
    const { calls, impl } = recordingFetch(defaultResponder);
    const context = contextWith({ accessToken: "stored-token" });
    expect(context).not.toHaveProperty("fetch");
    vi.stubGlobal("fetch", impl);
    try {
      await hubAdapter.submit(
        invocationFor({
          modelId: "minimax-h3",
          upstreamModel: "MiniMax-H3",
          prompt: "x",
        }),
        context,
      );
      expect(calls[0]?.headers.authorization).toBe("Bearer stored-token");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("checks the route before it reads the token", async () => {
    // An unsupported model is a wiring fault that no credential fixes. Answering it with "no
    // accessToken" sends the reader to the account screen for a problem that is not there.
    await expect(
      hubAdapter.submit(
        invocationFor({ modelId: "nope", upstreamModel: "nope", prompt: "x" }),
        contextWith({}),
      ),
    ).rejects.toThrow(/Unsupported Hilo Hub model: nope/);
  });

  it("checks the poll state before it reads the token", async () => {
    // The same ordering on the other half. A poll whose state lost its task id cannot be answered
    // by any credential, and reporting a missing token for it hides the state that went missing.
    await expect(
      hubAdapter.poll!(
        invocationFor(
          {},
          { operation: "poll", pollState: { upstreamModel: "MiniMax-H3" } },
        ),
        contextWith({}),
      ),
    ).rejects.toThrow(/poll state is missing its task id or model/);
  });

  it("downloads and uploads a public reference before handing it to Hub", async () => {
    const { calls, impl } = recordingFetch(defaultResponder);
    const invocation = {
      ...(invocationFor({
        modelId: "seedream-4.5",
        upstreamModel: "doubao-seedream-4-5-251128",
        prompt: "A ceramic fox",
      }) as Record<string, unknown>),
      input: {
        values: {
          modelId: "seedream-4.5",
          upstreamModel: "doubao-seedream-4-5-251128",
          prompt: "A ceramic fox",
        },
        references: [
          {
            slot: "image",
            index: 0,
            asset: { assetId: "a1", uri: "clash-asset://a1", kind: "image" },
          },
        ],
      },
    } as never;

    const references = await collectReferences(invocation, async () => ({
      form: "provider-url" as const,
      providerUrl: "https://cdn.example.test/fox.png",
      expiresAt: "2026-08-13T12:00:00.000Z",
    }));
    const mediaFetch = vi.fn(
      async () =>
        new Response(Buffer.from("PUBLIC-PNG"), {
          headers: { "content-type": "image/png" },
        }),
    );
    await submitHubModel(invocation, createHubRequest(impl, "t", "submit"), references, {
      fetch: mediaFetch as typeof globalThis.fetch,
    });

    expect(mediaFetch).toHaveBeenCalledWith("https://cdn.example.test/fox.png");
    expect(uploadCalls(calls).map((call) => call.body)).toEqual([
      {
        file_data: `data:image/png;base64,${Buffer.from("PUBLIC-PNG").toString("base64")}`,
        file_prefix: "image",
      },
    ]);
    expect(
      (submitCall(calls).body as Record<string, unknown>).image_paths,
    ).toEqual(["https://uploads.test/image-1"]);
  });

  it("uploads the bytes when only the host can reach the reference", async () => {
    // A private asset's URL answers 403 to the vendor, and the generation then fails for a reason
    // naming Hub rather than the reach. Deciding this used to be the plugin's own `^https?://`
    // test, which is also true of the host's `http://127.0.0.1:<port>/...` asset URLs.
    const { calls, impl } = recordingFetch(defaultResponder);
    const invocation = {
      ...(invocationFor({
        modelId: "seedream-4.5",
        upstreamModel: "doubao-seedream-4-5-251128",
        prompt: "A ceramic fox",
      }) as Record<string, unknown>),
      input: {
        values: {
          modelId: "seedream-4.5",
          upstreamModel: "doubao-seedream-4-5-251128",
          prompt: "A ceramic fox",
        },
        references: [
          {
            slot: "image",
            index: 0,
            asset: { assetId: "a1", uri: "clash-asset://a1", kind: "image" },
          },
        ],
      },
    } as never;

    const references = await collectReferences(invocation, async () => ({
      form: "bytes" as const,
      bytes: Uint8Array.from(Buffer.from("PNGDATA")),
      mediaType: "image/png",
    }));
    await submitHubModel(invocation, createHubRequest(impl, "t", "submit"), references);

    expect(uploadCalls(calls).map((call) => call.body)).toEqual([
      {
        file_data: `data:image/png;base64,${Buffer.from("PNGDATA").toString("base64")}`,
        file_prefix: "image",
      },
    ]);
  });

  it("refuses a text reference in a media slot", async () => {
    // Sending the words to an upload endpoint would store them as a file and generate from a blank
    // image, which looks like a bad model rather than bad wiring.
    const invocation = {
      ...(invocationFor({
        modelId: "minimax-h3",
        upstreamModel: "MiniMax-H3",
        prompt: "x",
      }) as Record<string, unknown>),
      input: {
        values: {
          modelId: "minimax-h3",
          upstreamModel: "MiniMax-H3",
          prompt: "x",
        },
        references: [
          { slot: "image", index: 0, text: { nodeId: "n1", value: "a leaf" } },
        ],
      },
    } as never;

    await expect(
      collectReferences(invocation, async () => ({
        form: "text" as const,
        text: "a leaf",
      })),
    ).rejects.toThrow(/resolved to text, which is not media/);
  });

  it("orders references by index, because the vendor bodies are positional", async () => {
    const invocation = {
      ...(invocationFor({
        modelId: "minimax-h3",
        upstreamModel: "MiniMax-H3",
        prompt: "x",
      }) as Record<string, unknown>),
      input: {
        values: {
          modelId: "minimax-h3",
          upstreamModel: "MiniMax-H3",
          prompt: "x",
        },
        references: [
          {
            slot: "image",
            index: 1,
            asset: { assetId: "second", uri: "clash-asset://b", kind: "image" },
          },
          {
            slot: "image",
            index: 0,
            asset: { assetId: "first", uri: "clash-asset://a", kind: "image" },
          },
        ],
      },
    } as never;

    const references: HubReferences = await collectReferences(
      invocation,
      async (reference) => ({
        form: "provider-url" as const,
        providerUrl: `https://cdn.test/${(reference as { asset: { assetId: string } }).asset.assetId}.png`,
        expiresAt: "2026-08-13T12:00:00.000Z",
      }),
    );
    expect(
      references.images.map((image) => (image.form === "url" ? image.url : "")),
    ).toEqual(["https://cdn.test/first.png", "https://cdn.test/second.png"]);
  });

  it("groups mixed content media by kind while preserving global indexes and duplicate placements", async () => {
    const invocation = {
      ...(invocationFor({
        modelId: "minimax-h3",
        upstreamModel: "MiniMax-H3",
        prompt: "Lead @音频1 then repeat it",
      }) as Record<string, unknown>),
      input: {
        values: {
          modelId: "minimax-h3",
          upstreamModel: "MiniMax-H3",
          prompt: "Lead @音频1 then repeat it",
        },
        references: [
          {
            slot: "content",
            index: 2,
            asset: {
              assetId: "same-audio",
              uri: "clash-asset://same-audio",
              kind: "audio",
            },
          },
          {
            slot: "content",
            index: 0,
            text: { nodeId: "prompt:0", value: "Lead " },
          },
          {
            slot: "content",
            index: 1,
            asset: {
              assetId: "same-audio",
              uri: "clash-asset://same-audio",
              kind: "audio",
            },
          },
        ],
      },
    } as never;

    const resolved = await collectReferences(invocation, async (reference) =>
      "text" in (reference as Record<string, unknown>)
        ? { form: "text" as const, text: "Lead " }
        : {
            form: "provider-url" as const,
            providerUrl: "https://cdn.test/same.mp3",
            expiresAt: "2026-08-13T12:00:00.000Z",
            kind: "audio" as const,
          },
    );

    expect(
      resolved.audios.map((audio) => (audio.form === "url" ? audio.url : "")),
    ).toEqual([
      "https://cdn.test/same.mp3",
      "https://cdn.test/same.mp3",
    ]);
    expect(resolved.images).toEqual([]);
    expect(resolved.videos).toEqual([]);
  });
});
