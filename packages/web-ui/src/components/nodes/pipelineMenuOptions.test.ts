import { describe, expect, it } from "vitest";
import { capability, MODEL_CARDS, type ModelCatalogEntry } from "@clash/shared-types";
import { PIPELINE_MENU_OPTIONS } from "./pipelineMenuOptions";

const ENABLED_CATALOG = MODEL_CARDS.map((model) => ({ model })) as ModelCatalogEntry[];

describe("PIPELINE_MENU_OPTIONS", () => {
    it("exposes built-in image, video, audio, and text generation chains", () => {
        expect(PIPELINE_MENU_OPTIONS.map((option) => option.id)).toEqual(
            expect.arrayContaining(["image-gen", "video-gen", "audio-gen", "text-gen"]),
        );
    });

    it("builds audio generation action-badge payloads defaulting to speech, not music", () => {
        const option = PIPELINE_MENU_OPTIONS.find((item) => item.id === "audio-gen");

        expect(option?.nodeType).toBe("action-badge");
        const data = option?.getNodeData(undefined, ENABLED_CATALOG);
        expect(data).toMatchObject({
            label: "Audio Prompt",
            actionType: "audio-gen",
            content: "# Prompt\nEnter your prompt here...",
        });
        // The intent, not a model id: a bare "Audio Prompt" is speech. Selecting
        // by catalog order instead of the product's default picker silently made
        // this music generation when a music card was added above the TTS cards.
        const selected = MODEL_CARDS.find((card) => card.id === data?.modelId);
        expect(selected, `unknown model ${String(data?.modelId)}`).toBeDefined();
        expect(selected!.task).toBe("text-to-speech");
        expect(data?.model).toBe(data?.modelId);
    });

    it("does not offer TTS downstream from an image source", () => {
        const option = PIPELINE_MENU_OPTIONS.find((item) => item.id === "audio-gen");

        expect(option?.isCompatibleWithSource("image", ENABLED_CATALOG)).toBe(false);
        expect(option?.isCompatibleWithSource("text", ENABLED_CATALOG)).toBe(true);
    });

    it("selects a video model by audio-input capability rather than model id", () => {
        const option = PIPELINE_MENU_OPTIONS.find((item) => item.id === "video-gen");

        expect(option?.isCompatibleWithSource("audio", ENABLED_CATALOG)).toBe(true);
        const selectedId = option?.getNodeData("audio", ENABLED_CATALOG).modelId;
        const selected = MODEL_CARDS.find((card) => card.id === selectedId);
        expect(selected).toBeDefined();
        expect(capability(selected!).ref.audio.accepts).toBe(true);
    });

    it("builds text generation action-badge payloads from a real catalog card", () => {
        const option = PIPELINE_MENU_OPTIONS.find((item) => item.id === "text-gen");

        expect(option?.nodeType).toBe("action-badge");
        const data = option?.getNodeData(undefined, ENABLED_CATALOG);
        expect(data).toMatchObject({
            label: "Text Prompt",
            actionType: "text-gen",
            content: "# Prompt\nEnter your prompt here...",
        });
        // Pinning an id here broke on every catalog release without catching a
        // single real defect. What matters is that the menu resolves a text card
        // that actually exists and reports it consistently.
        const selected = MODEL_CARDS.find((card) => card.id === data?.modelId);
        expect(selected, `unknown model ${String(data?.modelId)}`).toBeDefined();
        expect(selected!.kind).toBe("text");
        expect(data?.model).toBe(data?.modelId);
    });

    it("keeps downstream options compatible for text source nodes", () => {
        for (const option of PIPELINE_MENU_OPTIONS) {
            expect(() => option.isCompatibleWithSource("text" as any, ENABLED_CATALOG)).not.toThrow();
        }
        expect(PIPELINE_MENU_OPTIONS.map((option) => option.id)).toEqual(
            expect.arrayContaining(["image-gen", "video-gen", "audio-gen", "text-gen", "video-editor"]),
        );
    });
});
