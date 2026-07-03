import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  createProviderTestRecordingFetch,
  createProviderTestReplayFetch,
  createProviderTestReplayFixtures,
  createProviderConformanceStubs,
  createProviderTestRecorder,
  providerTestRecordingEventToJsonl,
  readJsonlProviderTestRecording,
} from "./provider-test-recorder.js";

describe("provider test recorder", () => {
  it("prepares provider/model conformance stubs across model shapes", () => {
    const stubs = createProviderConformanceStubs({ includeMock: true });

    expect(stubs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "mock:mock::mock-image-model",
        providerId: "mock",
        upstreamId: "mock",
        modelId: "mock-image-model",
        shape: "image",
        apiShape: "fal",
        input: {
          shape: "image",
          model: "mock-image-model",
          prompt: "Provider conformance test for Mock Image Model",
          aspectRatio: "16:9",
        },
      }),
      expect.objectContaining({
        id: "mock:mock::mock-text-model",
        providerId: "mock",
        upstreamId: "mock",
        modelId: "mock-text-model",
        shape: "text",
        apiShape: "openai-compatible",
        input: {
          shape: "text",
          model: "mock-text-model",
          prompt: "Provider conformance test for Mock Text Model",
        },
      }),
    ]));
    expect([...new Set(stubs.map((stub) => stub.shape))]).toEqual(expect.arrayContaining(["asr", "image", "video", "audio", "text"]));
  });

  it("records request, response, and callback payloads with every field preserved", async () => {
    const events: unknown[] = [];
    const recorder = createProviderTestRecorder({
      write: async (event) => {
        events.push(event);
      },
    });
    const stub = createProviderConformanceStubs({ includeMock: true })
      .find((candidate) => candidate.id === "mock:mock::mock-image-model");

    expect(stub).toBeTruthy();
    const requestId = await recorder.recordRequest({
      stub: stub!,
      url: "https://provider.example/v1/images",
      method: "POST",
      headers: {
        authorization: "Bearer real-key",
        "content-type": "application/json",
      },
      body: {
        prompt: "Provider conformance test for Mock Image Model",
        apiKey: "real-key",
        nested: { secret: "value", ordinary: "kept" },
      },
    });
    await recorder.recordResponse({
      requestId,
      status: 200,
      headers: { "content-type": "application/json", "x-request-id": "provider-request-1" },
      body: {
        images: [{ url: "https://provider.example/result.png", width: 1024, height: 576 }],
        providerRawField: { anything: true },
      },
    });
    await recorder.recordCallback({
      requestId,
      url: "https://callback.example/provider",
      method: "POST",
      headers: { "x-provider-signature": "abc123" },
      body: {
        status: "completed",
        task_id: "task-1",
        output: { url: "https://provider.example/result.png" },
      },
    });

    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({
      type: "request",
      requestId,
      stub,
      request: {
        url: "https://provider.example/v1/images",
        method: "POST",
        headers: {
          authorization: "[redacted]",
          "content-type": "application/json",
        },
        body: {
          prompt: "Provider conformance test for Mock Image Model",
          apiKey: "[redacted]",
          nested: { secret: "[redacted]", ordinary: "kept" },
        },
      },
    });
    expect(events[1]).toMatchObject({
      type: "response",
      requestId,
      response: {
        status: 200,
        headers: { "content-type": "application/json", "x-request-id": "provider-request-1" },
        body: {
          images: [{ url: "https://provider.example/result.png", width: 1024, height: 576 }],
          providerRawField: { anything: true },
        },
      },
    });
    expect(events[2]).toMatchObject({
      type: "callback",
      requestId,
      callback: {
        url: "https://callback.example/provider",
        method: "POST",
        headers: { "x-provider-signature": "abc123" },
        body: {
          status: "completed",
          task_id: "task-1",
          output: { url: "https://provider.example/result.png" },
        },
      },
    });
    expect(providerTestRecordingEventToJsonl(events[0])).toContain('"type":"request"');
  });

  it("wraps live provider fetches with request and response recording", async () => {
    const events: unknown[] = [];
    const stub = createProviderConformanceStubs({ includeMock: true })
      .find((candidate) => candidate.providerId === "official" && candidate.upstreamId === "openai" && candidate.shape === "image");
    expect(stub).toBeTruthy();
    const recorder = createProviderTestRecorder({
      requestId: () => "provider-test-live-openai-image",
      write: async (event) => {
        events.push(event);
      },
    });
    const fetchImpl = createProviderTestRecordingFetch({
      fetch: async () => Response.json({
        id: "img_123",
        data: [{ b64_json: Buffer.from("provider-image").toString("base64") }],
        provider_extra: { kept: true },
      }, {
        headers: { "x-provider-request-id": "upstream-123" },
      }),
      recorder,
      stub: stub!,
    });

    const response = await fetchImpl("https://api.openai.test/v1/images/generations", {
      method: "POST",
      headers: {
        authorization: "Bearer real-key",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-image-2",
        prompt: "record me",
      }),
    });

    expect(await response.json()).toMatchObject({ id: "img_123" });
    expect(events).toEqual([
      expect.objectContaining({
        type: "request",
        requestId: "provider-test-live-openai-image",
        stub: stub!,
        request: {
          url: "https://api.openai.test/v1/images/generations",
          method: "POST",
          headers: {
            authorization: "[redacted]",
            "content-type": "application/json",
          },
          body: {
            model: "gpt-image-2",
            prompt: "record me",
          },
        },
      }),
      expect.objectContaining({
        type: "response",
        requestId: "provider-test-live-openai-image",
        response: {
          status: 200,
          headers: expect.objectContaining({
            "content-type": "application/json",
            "x-provider-request-id": "upstream-123",
          }),
          body: {
            id: "img_123",
            data: [{ b64_json: Buffer.from("provider-image").toString("base64") }],
            provider_extra: { kept: true },
          },
        },
      }),
    ]);
  });

  it("loads JSONL recordings into replay fixtures keyed by provider/model request", async () => {
    const dir = await mkdtemp(join(tmpdir(), "provider-test-recorder-"));
    const filePath = join(dir, "recording.jsonl");
    const stub = createProviderConformanceStubs({ includeMock: true })
      .find((candidate) => candidate.providerId === "mock" && candidate.shape === "video");
    expect(stub).toBeTruthy();
    const events = [
      {
        schemaVersion: 1,
        type: "request",
        timestamp: "2026-07-03T00:00:00.000Z",
        requestId: "provider-test-video",
        stub: stub!,
        request: {
          url: "https://provider.example/video",
          method: "POST",
          headers: { "content-type": "application/json" },
          body: {
            input: stub!.input,
            extraProviderField: { keep: "everything" },
          },
        },
      },
      {
        schemaVersion: 1,
        type: "callback",
        timestamp: "2026-07-03T00:00:01.000Z",
        requestId: "provider-test-video",
        callback: {
          url: "https://callback.example/provider-test-video",
          method: "POST",
          headers: { "x-provider-event": "completed" },
          body: {
            status: "processing",
            progress: 0.5,
          },
        },
      },
      {
        schemaVersion: 1,
        type: "response",
        timestamp: "2026-07-03T00:00:02.000Z",
        requestId: "provider-test-video",
        response: {
          status: 200,
          headers: { "content-type": "application/json" },
          body: {
            id: "upstream-video-1",
            video: { url: "https://provider.example/result.mp4" },
          },
        },
      },
    ];

    try {
      await writeFile(filePath, events.map(providerTestRecordingEventToJsonl).join(""), "utf8");

      const loadedEvents = await readJsonlProviderTestRecording(filePath);
      const fixtures = createProviderTestReplayFixtures(loadedEvents);

      expect(fixtures).toEqual([
        {
          schemaVersion: 1,
          requestId: "provider-test-video",
          stub: stub!,
          request: events[0].request,
          response: events[2].response,
          callbacks: [events[1].callback],
        },
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("replays recorded provider fixtures through a fetch-compatible stub", async () => {
    const stub = createProviderConformanceStubs({ includeMock: true })
      .find((candidate) => candidate.providerId === "official" && candidate.upstreamId === "openai" && candidate.shape === "image");
    expect(stub).toBeTruthy();
    const replayFetch = createProviderTestReplayFetch([
      {
        schemaVersion: 1,
        requestId: "provider-test-replay-openai-image",
        stub: stub!,
        request: {
          url: "https://api.openai.test/v1/images/generations",
          method: "POST",
          headers: {
            authorization: "[redacted]",
            "content-type": "application/json",
          },
          body: {
            model: "gpt-image-2",
            prompt: "Replay this image",
          },
        },
        response: {
          status: 200,
          headers: { "content-type": "application/json", "x-provider-request-id": "replay-1" },
          body: {
            id: "img_replay_1",
            data: [{ b64_json: Buffer.from("replayed-image").toString("base64") }],
          },
        },
        callbacks: [],
      },
    ]);

    const response = await replayFetch("https://api.openai.test/v1/images/generations", {
      method: "POST",
      headers: {
        authorization: "Bearer different-real-key",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-image-2",
        prompt: "Replay this image",
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-provider-request-id")).toBe("replay-1");
    expect(await response.json()).toEqual({
      id: "img_replay_1",
      data: [{ b64_json: Buffer.from("replayed-image").toString("base64") }],
    });
    await expect(replayFetch("https://api.openai.test/v1/images/generations", {
      method: "POST",
      body: JSON.stringify({ model: "gpt-image-2", prompt: "Replay this image" }),
    })).rejects.toThrow(/No provider test replay fixture/);
  });
});
