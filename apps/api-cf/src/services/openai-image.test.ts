import { afterEach, describe, expect, it, vi } from "vitest";

import { generateOpenAIImage } from "./openai-image";

describe("OpenAI image service", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls GPT Image 2 generation and decodes base64 output bytes", async () => {
    const pngBytes = new Uint8Array([137, 80, 78, 71]);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ b64_json: Buffer.from(pngBytes).toString("base64") }],
          output_format: "png",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateOpenAIImage({
      apiKey: "sk-test",
      prompt: "a precise product mock",
      modelName: "gpt-image-2",
      modelParams: {
        size: "1024x1024",
        quality: "high",
        output_format: "png",
      },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/images/generations",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer sk-test",
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          model: "gpt-image-2",
          prompt: "a precise product mock",
          size: "1024x1024",
          quality: "high",
          output_format: "png",
          n: 1,
        }),
      }),
    );
    expect(result.data).toEqual(pngBytes);
    expect(result.mediaType).toBe("image/png");
    expect(result.model).toBe("gpt-image-2");
  });
});
