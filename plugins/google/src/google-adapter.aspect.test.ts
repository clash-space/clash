import { afterEach, describe, expect, it, vi } from "vitest";

import { googleAdapter } from "./google-adapter";

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * The ratio arrives as the catalogue wrote it, and this adapter decides what Google is told.
 *
 * The host used to build the vendor's field itself, which is how it came to send
 * `responseFormat.image.aspectRatio` — a field Agent Platform rejects while naming the proto path
 * rather than the correct name. The value was right all along; only the envelope was wrong, and the
 * envelope is precisely the part that differs per vendor.
 *
 * `adaptive` and `auto` appear in the catalogue and are not ratios — they mean "you decide". Google
 * has no spelling for that, so the field is omitted rather than sent as a shape nobody asked for.
 */
function captured(
  values: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    vi.stubGlobal("fetch", async (_url: string, init?: { body?: string }) => {
      resolve(JSON.parse(init?.body ?? "{}") as Record<string, unknown>);
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () =>
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    { inlineData: { mimeType: "image/png", data: "AA==" } },
                  ],
                },
              },
            ],
          }),
      };
    });
    void googleAdapter
      .submit(
        {
          invocationId: "i",
          operation: "submit",
          input: { values, references: [] },
        } as never,
        {
          store: {
            get: async () => "k",
            put: async () => {},
            remove: async () => {},
          },
          endpoint: "https://aiplatform.googleapis.com",
        } as never,
      )
      .catch(() => undefined);
  });
}

describe("google adapter aspect ratio", () => {
  it("puts the ratio in imageConfig, which is the field that exists", async () => {
    const body = await captured({
      model: "gemini-3.1-flash-image",
      aspectRatio: "16:9",
    });
    const config = body.generationConfig as {
      imageConfig?: { aspectRatio?: string };
    };
    expect(config?.imageConfig?.aspectRatio).toBe("16:9");
  });

  it("omits the field for adaptive, rather than inventing a shape", async () => {
    const body = await captured({
      model: "gemini-3.1-flash-image",
      aspectRatio: "adaptive",
    });
    const config = body.generationConfig as {
      imageConfig?: { aspectRatio?: string };
    };
    expect(config?.imageConfig?.aspectRatio).toBeUndefined();
  });

  it("sends a role, which Agent Platform requires and the Developer API defaults", async () => {
    const body = await captured({
      model: "gemini-3.1-flash-image",
      aspectRatio: "1:1",
    });
    expect((body.contents as { role?: string }[])[0]?.role).toBe("user");
  });
});

/**
 * `custom` is not a shape, it is permission to state one.
 *
 * The catalogue's ratio menu holds three kinds of value and they behave differently: a named ratio
 * is passed through, `auto`/`adaptive` mean the model decides and the field is omitted, and `custom`
 * means the caller supplies the two numbers. Treating `custom` as a literal would send the word
 * "custom" to Google, which rejects it while naming a proto enum — a message that explains nothing
 * to whoever picked it.
 *
 * Whether the vendor accepts the resulting shape is the vendor's answer to give. An arbitrary ratio
 * is sent as asked and refused if unsupported; it is not quietly rounded to something in the menu.
 */
describe("custom ratios", () => {
  it("uses the supplied numbers, which arrive without any marker word", async () => {
    const body = await captured({
      model: "gemini-3.1-flash-image",
      aspectRatioWidth: 7,
      aspectRatioHeight: 3,
    });
    const config = body.generationConfig as {
      imageConfig?: { aspectRatio?: string };
    };
    expect(config?.imageConfig?.aspectRatio).toBe("7:3");
  });

  it("reduces the supplied numbers, so 1920x1080 is 16:9", async () => {
    const body = await captured({
      model: "gemini-3.1-flash-image",
      aspectRatioWidth: 1920,
      aspectRatioHeight: 1080,
    });
    const config = body.generationConfig as {
      imageConfig?: { aspectRatio?: string };
    };
    expect(config?.imageConfig?.aspectRatio).toBe("16:9");
  });

  it("never sends the word custom", async () => {
    const body = await captured({
      model: "gemini-3.1-flash-image",
      aspectRatio: "custom",
    });
    const config = body.generationConfig as {
      imageConfig?: { aspectRatio?: string };
    };
    expect(config?.imageConfig?.aspectRatio).not.toBe("custom");
  });
});
