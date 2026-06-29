import { afterEach, describe, expect, it, vi } from "vitest";

import { generateModelArkVideo } from "./modelark-video";

describe("ModelArk video service", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("creates and polls a ModelArk video generation task", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "cgt-test" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "cgt-test",
            status: "succeeded",
            output: { video_url: "https://cdn.example/video.mp4" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateModelArkVideo("ark-key", {
      baseUrl: "https://ark.example.com/api/v3",
      prompt: "cinematic product launch",
      modelName: "seedance-2-ref",
      upstreamModel: "dreamina-seedance-2-0-260128",
      referenceImageUrls: ["https://cdn.example/ref.png"],
      duration: 8,
      aspectRatio: "16:9",
      modelParams: { resolution: "720p", generate_audio: true },
      pollIntervalMs: 0,
      maxWaitMs: 1000,
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://ark.example.com/api/v3/contents/generations/tasks",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer ark-key",
          "Content-Type": "application/json",
        }),
      }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toMatchObject({
      model: "dreamina-seedance-2-0-260128",
      content: [
        { type: "text", text: "cinematic product launch" },
        { type: "image_url", image_url: { url: "https://cdn.example/ref.png" } },
      ],
      duration: 8,
      ratio: "16:9",
      resolution: "720p",
      generate_audio: true,
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://ark.example.com/api/v3/contents/generations/tasks/cgt-test",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer ark-key" }),
      }),
    );
    expect(result).toMatchObject({
      url: "https://cdn.example/video.mp4",
      model: "dreamina-seedance-2-0-260128",
      taskId: "cgt-test",
    });
  });
});
