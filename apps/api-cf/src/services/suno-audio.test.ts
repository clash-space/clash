import { describe, expect, it, vi } from "vitest";

import { generateSunoAudio } from "./suno-audio";

describe("Suno API audio service", () => {
  it("submits V5.5 and polls the returned task without switching providers", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({
        code: 200,
        msg: "success",
        data: { taskId: "suno-task-1" },
      }))
      .mockResolvedValueOnce(Response.json({
        code: 200,
        msg: "success",
        data: { taskId: "suno-task-1", status: "PENDING" },
      }))
      .mockResolvedValueOnce(Response.json({
        code: 200,
        msg: "success",
        data: {
          taskId: "suno-task-1",
          status: "SUCCESS",
          response: {
            sunoData: [{
              audioUrl: "https://cdn.sunoapi.org/song.mp3",
              duration: 186.5,
              title: "Night Train",
            }],
          },
        },
      }));

    const result = await generateSunoAudio({
      apiKey: "suno-key",
      prompt: "a nocturnal synth-pop song",
      model: "V5_5",
      callbackUrl: "https://api.clash.test/api/v1/provider-callbacks/suno",
      fetch: fetchMock,
      wait: async () => {},
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.sunoapi.org/api/v1/generate",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer suno-key" }),
        body: JSON.stringify({
          customMode: false,
          instrumental: false,
          model: "V5_5",
          callBackUrl: "https://api.clash.test/api/v1/provider-callbacks/suno",
          prompt: "a nocturnal synth-pop song",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.sunoapi.org/api/v1/generate/record-info?taskId=suno-task-1",
      expect.objectContaining({ method: "GET" }),
    );
    expect(result).toEqual({
      url: "https://cdn.sunoapi.org/song.mp3",
      taskId: "suno-task-1",
      model: "V5_5",
      durationMs: 186500,
      title: "Night Train",
    });
  });

  it("surfaces terminal Suno failures instead of using another audio model", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({
        code: 200,
        msg: "success",
        data: { taskId: "suno-task-failed" },
      }))
      .mockResolvedValueOnce(Response.json({
        code: 200,
        msg: "success",
        data: {
          taskId: "suno-task-failed",
          status: "GENERATE_AUDIO_FAILED",
          errorMessage: "provider rejected generation",
        },
      }));

    await expect(generateSunoAudio({
      apiKey: "suno-key",
      prompt: "do not fall back",
      model: "V5_5",
      callbackUrl: "https://api.clash.test/api/v1/provider-callbacks/suno",
      fetch: fetchMock,
      wait: async () => {},
    })).rejects.toThrow("provider rejected generation");
  });
});
