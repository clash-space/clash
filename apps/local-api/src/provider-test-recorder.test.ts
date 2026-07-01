import { describe, expect, it } from "vitest";

import {
  createProviderConformanceStubs,
  createProviderTestRecorder,
  providerTestRecordingEventToJsonl,
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
    expect([...new Set(stubs.map((stub) => stub.shape))]).toEqual(expect.arrayContaining(["image", "video", "audio", "text"]));
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
});
