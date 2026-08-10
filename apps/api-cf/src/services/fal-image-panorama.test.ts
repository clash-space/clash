import { beforeEach, describe, expect, it, vi } from "vitest";

const { subscribe } = vi.hoisted(() => ({ subscribe: vi.fn() }));

vi.mock("@fal-ai/client", () => ({
  fal: {
    config: vi.fn(),
    subscribe,
  },
}));

import { generateImage } from "./fal-image";
import { MODEL_CARDS } from "@clash/shared-types";

/**
 * A Director Stage panorama is equirectangular: 360 degrees of longitude across
 * 180 degrees of latitude, mapped linearly. That geometry forces an exact 2:1
 * frame, and the client enforces it -- `normalizeDirectorPanorama` throws
 * `RangeError: Director panorama must be exact 2:1` rather than stretch a frame
 * whose meridians would then point the wrong way.
 *
 * So the generation request has to actually reach fal as a 2:1 image. These tests
 * send exactly what ProjectEditor sends for a panorama.
 */
describe("fal gpt-image-2 panorama sizing", () => {
  // Built the way ProjectEditor builds it: the card's defaults, then the panorama
  // overrides. Reading the defaults from the card keeps this from drifting into a
  // snapshot of whatever the card happened to contain when the test was written.
  const panoramaParams = {
    ...(MODEL_CARDS.find(card => card.id === "gpt-image-2")?.defaultParams ?? {}),
    aspect_ratio: "2:1",
    resolution: "2k",
    quality: "high",
    output_format: "webp",
    count: 1,
    provider_id: "fal",
    require_real_provider: true,
  };

  beforeEach(() => {
    subscribe.mockReset();
    subscribe.mockResolvedValue({
      requestId: "request-1",
      data: { images: [{ url: "https://fal.media/result.webp" }] },
    });
  });

  function lastInput(): Record<string, unknown> {
    const call = subscribe.mock.calls.at(-1);
    return (call?.[1] as { input: Record<string, unknown> }).input;
  }

  it("requests a 2:1 frame for the panorama aspect ratio", async () => {
    await generateImage("fal-key", {
      text: "a wide desert basin at dusk",
      modelName: "gpt-image-2",
      aspectRatio: "2:1",
      modelParams: panoramaParams,
    });
    // The committed size table resolves 2:1 at the 2K tier to 2880x1440. The exact
    // pixel count is the table's business; what matters here is that a 2:1 frame
    // actually reaches fal, because the client rejects anything else.
    const size = lastInput().image_size as { width: number; height: number };
    expect(typeof size, `expected explicit dimensions, got ${JSON.stringify(size)}`).toBe("object");
    expect(size.width).toBe(size.height * 2);
  });

  it("maps a bare 2:1 aspect ratio to a 2:1 size", async () => {
    await generateImage("fal-key", {
      text: "a wide desert basin at dusk",
      modelName: "gpt-image-2",
      aspectRatio: "2:1",
      modelParams: { quality: "high" },
    });
    const size = lastInput().image_size;
    // A named fal preset cannot express 2:1, and treating a string as "0x0" would
    // make this assertion vacuously true, so require explicit dimensions.
    expect(typeof size, `2:1 needs explicit dimensions, got ${JSON.stringify(size)}`).toBe(
      "object",
    );
    const { width, height } = size as { width: number; height: number };
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
    expect(width).toBe(height * 2);
  });
});
