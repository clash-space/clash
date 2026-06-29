import { afterEach, describe, expect, it, vi } from "vitest";

import { createVideoTask } from "./kling";

describe("Kling video service", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a Kling video task using bearer JWT authentication", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 0,
          data: { task_id: "kling-task", task_status: "submitted" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const taskId = await createVideoTask(
      {
        accessKey: "access-key",
        secretKey: "secret-key",
        apiUrl: "https://api.kling.test/v1/videos/image2video",
      },
      {
        image: "https://cdn.example/frame.png",
        prompt: "gentle camera move",
        duration: 5,
        model: "kling-v3",
      },
    );

    expect(taskId).toBe("kling-task");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.kling.test/v1/videos/image2video",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          model_name: "kling-v3",
          image: "https://cdn.example/frame.png",
          duration: "5",
          prompt: "gentle camera move",
        }),
      }),
    );
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^Bearer .+/);
  });
});
