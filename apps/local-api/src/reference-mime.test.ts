import { describe, expect, it } from "vitest";
import { MODEL_CARDS } from "@clash/shared-types";

import { normalizeProviderReferenceMediaType } from "./local-aigc";

/**
 * A reference's media type must derive an extension the upstream accepts.
 *
 * MiniMax turns the mime in a data URL into a filename extension and checks that against
 * its own allow-list. `audio/mpeg` becomes `.mpeg`, which is not on it, so an MP3 was
 * rejected — after the video task had been submitted and queued, so the failure cost a
 * real generation:
 *
 *   code=2013, msg=content[2].audio_url: invalid param:
 *   audio format ".mpeg" not allowed
 *
 * The Card still accepts `audio/mpeg`, because that is MP3's registered type and the model
 * does read MP3. The official H3 adapter now uploads those bytes with an `.mp3` filename, so
 * neither the Card nor the route has to rewrite the product-level media type.
 */
describe("reference media types derive an allowed extension", () => {
  const h3 = MODEL_CARDS.find((card) => card.id === "minimax-h3")!;
  const audio = h3.input.inputMode.audios!.constraints!;

  it("accepts both spellings of MP3 and of WAV", () => {
    expect(audio.mimeTypes).toContain("audio/mpeg");
    expect(audio.mimeTypes).toContain("audio/wav");
    expect(audio.fileExtensions).toEqual(["wav", "mp3"]);
  });

  it("keeps provider-neutral MIME types unchanged before route adaptation", () => {
    expect(normalizeProviderReferenceMediaType("audio/mpeg")).toBe("audio/mpeg");
    expect(normalizeProviderReferenceMediaType("audio/x-wav")).toBe("audio/x-wav");
  });

  it("leaves a mime that already derives an allowed extension alone", () => {
    expect(normalizeProviderReferenceMediaType("audio/wav")).toBe("audio/wav");
    expect(normalizeProviderReferenceMediaType("video/mp4")).toBe("video/mp4");
  });
});
