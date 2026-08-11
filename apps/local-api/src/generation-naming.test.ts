import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(__dirname, "local-aigc.ts"), "utf8");

/**
 * A generation function is named for the wire format it translates, never for a model.
 *
 * The routing table has three axes: provider (whose credential pays), upstreamId (which vendor
 * answers) and apiShape (what format is spoken). A function here translates one apiShape, so that
 * is what it is named after.
 *
 * `generateGeminiOmniVideo` broke the rule and taught the whole codebase the wrong lesson. It reads
 * the google-ai-studio api key and base url — it is the Interactions shape under the ordinary
 * Google AI Studio account — but its name made gemini-omni look like a provider of its own, and it
 * was described that way twice in one session before anyone checked. The same defect in the cloud
 * app had `veoProvider` serving gemini-3.1-pro and nano-banana-2: an object named for a video model
 * running text models.
 *
 * The cost is not cosmetic. The next model on the Interactions shape will not be called gemini-omni,
 * so whoever adds it writes a second function instead of extending this one.
 */
describe("generation functions are named after what they translate", () => {
  it("has no function named after a model", () => {
    // gemini-omni, veo, nano-banana and hailuo are models. None of them is a shape or an upstream.
    expect(source).not.toMatch(/function generate(GeminiOmni|Veo|NanoBanana|Hailuo)/);
  });

  it("names the Interactions shape after the shape", () => {
    expect(source).toMatch(/generateGoogleAiStudioInteractionsVideo/);
  });
});
