import { describe, expect, it } from "vitest";

import { buildMiniMaxH3Content } from "./minimax-h3";

/**
 * H3 rejects some combinations of frames and references, and the content builder is where that has
 * to be caught.
 *
 * These rules lived inline in two hosts: apps/local-api/src/local-aigc.ts and
 * apps/api-cf/src/services/minimax-video.ts, each with its own copy. The local one is being deleted
 * now that MiniMax runs as a plugin executor, and the executor receives an already-built body — it
 * has no inputs to check. Left alone, the local host would lose the rules and the Worker would keep
 * a private copy of them.
 *
 * This function is the one place that turns those inputs into H3's content array, and both hosts
 * call it before they POST. A rule about which fields may appear together in that array belongs
 * with the code that assembles it.
 */
describe("MiniMax H3 content invariants", () => {
  const prompt = "a cat";

  it("refuses an end frame with no start frame", () => {
    // H3 interpolates between first_frame and last_frame. A last_frame alone leaves it interpolating
    // from nothing, and the API bills the attempt before rejecting it.
    expect(() => buildMiniMaxH3Content({
      prompt,
      endFrame: "https://example.test/end.png",
    })).toThrow(/end frame requires a start frame/i);
  });

  it("refuses start frames mixed with omni references", () => {
    // Frame interpolation and reference-guided generation are different H3 modes. Sending both makes
    // the request ambiguous, and the builder would emit first_frame beside reference_image roles.
    for (const conflicting of [
      { referenceImages: ["https://example.test/ref.png"] },
      { referenceVideos: ["https://example.test/ref.mp4"] },
      { referenceAudios: ["https://example.test/ref.mp3"] },
    ]) {
      expect(() => buildMiniMaxH3Content({
        prompt,
        startFrame: "https://example.test/start.png",
        ...conflicting,
      }), JSON.stringify(conflicting)).toThrow(/cannot be mixed with omni references/i);
    }
  });

  it("refuses a start frame alongside ordered media parts", () => {
    // Without this the ordered parts are silently dropped: the builder's first branch only reads
    // them when there is no start frame, so the user's references vanish from a request that still
    // succeeds and still costs money.
    expect(() => buildMiniMaxH3Content({
      prompt,
      startFrame: "https://example.test/start.png",
      orderedContentParts: [
        { type: "text", text: prompt },
        { type: "image", url: "https://example.test/ordered.png" },
      ],
    })).toThrow(/cannot be mixed with omni references/i);
  });

  it("allows ordered text alongside a start frame", () => {
    // Text is not an omni reference. Rejecting it would break the ordinary start/end request, whose
    // prompt arrives as a text part.
    expect(() => buildMiniMaxH3Content({
      prompt,
      startFrame: "https://example.test/start.png",
      orderedContentParts: [{ type: "text", text: prompt }],
    })).not.toThrow();
  });

  it("still builds every combination H3 accepts", () => {
    // The guards must not narrow the valid surface. Each of these is a documented H3 mode.
    expect(buildMiniMaxH3Content({ prompt })).toHaveLength(1);
    expect(buildMiniMaxH3Content({
      prompt,
      startFrame: "https://example.test/start.png",
    })).toHaveLength(2);
    expect(buildMiniMaxH3Content({
      prompt,
      startFrame: "https://example.test/start.png",
      endFrame: "https://example.test/end.png",
    })).toHaveLength(3);
    expect(buildMiniMaxH3Content({
      prompt,
      referenceImages: ["https://example.test/a.png"],
      referenceAudios: ["https://example.test/a.mp3"],
    })).toHaveLength(3);
  });

  it("keeps the ordered-parts path intact when no start frame is present", () => {
    const content = buildMiniMaxH3Content({
      prompt: "Keep the subject aligned with the beat.",
      orderedContentParts: [
        { type: "text", text: "Keep " },
        { type: "image", url: "https://example.test/subject.png" },
        { type: "text", text: " aligned with " },
        { type: "audio", url: "https://example.test/beat.wav" },
        { type: "text", text: "." },
      ],
    });
    expect(content).toEqual([
      { type: "text", text: "Keep the subject aligned with the beat." },
      {
        type: "image_url",
        image_url: { url: "https://example.test/subject.png" },
        role: "reference_image",
      },
      {
        type: "audio_url",
        audio_url: { url: "https://example.test/beat.wav" },
        role: "reference_audio",
      },
    ]);
  });
});
