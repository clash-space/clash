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

    it("requires a Director media output instead of connecting the Stage producer", () => {
        expect(generationConnectionAcceptsSource({
            sourceType: "director-stage",
            targetData: { modelId: "seedance-2-ref" },
        })).toBe(false);
        expect(generationConnectionAcceptsSource({
            sourceType: "director-stage",
            targetData: { modelId: "seedance-2-startend" },
        })).toBe(false);
        expect(generationConnectionAcceptsSource({
            sourceType: "director-stage",
            targetData: { modelId: "gemini-3.1-flash-tts" },
        })).toBe(false);
    });
});
