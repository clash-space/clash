import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { MODEL_CARDS } from "@clash/shared-types";

import { referenceDataUrlMimeType } from "./local-aigc";

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
    expect(referenceDataUrlMimeType("audio/mpeg")).toBe("audio/mpeg");
    expect(referenceDataUrlMimeType("audio/x-wav")).toBe("audio/x-wav");
  });

  it("leaves a mime that already derives an allowed extension alone", () => {
    expect(referenceDataUrlMimeType("audio/wav")).toBe("audio/wav");
    expect(referenceDataUrlMimeType("video/mp4")).toBe("video/mp4");
  });
});

describe("generated audio defaults to a format its own models can consume", () => {
  it("keeps speech and music on different defaults for a stated reason", () => {
    const source = readFileSync(join(__dirname, "local-aigc.ts"), "utf8");
    // Speech clips are short and are routinely fed back in as references, so they default
    // to WAV, whose media type derives an extension every upstream accepts. Music is the
    // finished artefact and stays compressed.
    expect(source).toContain('|| (isMusic ? "mp3" : "wav")');
  });
});
