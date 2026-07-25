import { describe, expect, it } from "vitest";

import { generationConnectionAcceptsSource } from "./generationConnectionCompatibility";

describe("generationConnectionAcceptsSource", () => {
    it("rejects image references for a text-only TTS model", () => {
        expect(generationConnectionAcceptsSource({
            sourceType: "image",
            targetData: { modelId: "gemini-3.1-flash-tts" },
        })).toBe(false);
    });

    it("accepts modalities declared by the selected model", () => {
        expect(generationConnectionAcceptsSource({
            sourceType: "text",
            targetData: { modelId: "gemini-3.1-flash-tts" },
        })).toBe(true);
        expect(generationConnectionAcceptsSource({
            sourceType: "image",
            targetData: { modelId: "nano-banana-2" },
        })).toBe(true);
    });

    it("adapts a Director Stage packet to video or keyframe-image models", () => {
        expect(generationConnectionAcceptsSource({
            sourceType: "director-stage",
            targetData: { modelId: "seedance-2-ref" },
        })).toBe(true);
        expect(generationConnectionAcceptsSource({
            sourceType: "director-stage",
            targetData: { modelId: "seedance-2-startend" },
        })).toBe(true);
        expect(generationConnectionAcceptsSource({
            sourceType: "director-stage",
            targetData: { modelId: "gemini-3.1-flash-tts" },
        })).toBe(false);
    });
});
