import { describe, expect, it } from "vitest";
import { MODEL_CARDS, validateModelCardConfiguration } from "@clash/shared-types";

/**
 * A duration the Card does not declare must not be forwarded.
 *
 * Speech models take a voice and a script; the clip's length follows from the text, so
 * they declare no `duration` parameter. The generation path used to attach
 * `input.duration` unconditionally, and the validator then rejected the whole request
 * with "duration is not declared by this Model Card." — a real text-to-speech
 * generation failed before any provider call was made.
 */
describe("duration is only sent to Cards that declare it", () => {
  const speech = MODEL_CARDS.find((card) => card.id === "minimax-speech-2.8-hd")!;
  const video = MODEL_CARDS.find((card) => card.id === "minimax-h3")!;

  it("speech Cards declare no duration", () => {
    expect(speech.parameters.some((parameter) => parameter.id === "duration")).toBe(false);
    expect(speech.defaultParams.duration).toBeUndefined();
  });

  it("rejects a duration on a speech Card", () => {
    const error = validateModelCardConfiguration(speech, {
      prompt: "The lighthouse held the last of the light.",
      modelParams: { duration: 5 },
    }, { rejectUnknownParameters: true });
    expect(error).toMatch(/duration is not declared/i);
  });

  it("accepts a speech request without one", () => {
    const error = validateModelCardConfiguration(speech, {
      prompt: "The lighthouse held the last of the light.",
      modelParams: { voice_id: "English_Graceful_Lady" },
    }, { rejectUnknownParameters: true });
    expect(error).toBeNull();
  });

  it("still accepts a duration on a video Card that declares one", () => {
    expect(video.parameters.some((parameter) => parameter.id === "duration")).toBe(true);
    const error = validateModelCardConfiguration(video, {
      prompt: "a slow dolly across a lit workshop",
      modelParams: { duration: 5, aspect_ratio: "adaptive", resolution: "2K" },
    }, { rejectUnknownParameters: true });
    expect(error).toBeNull();
  });
});
