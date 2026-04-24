import { describe, expect, it } from "vitest";
import type { Edge, Node as RFNode } from "@xyflow/react";
import { computeAdoption } from "./performAdoption";

function node(id: string, type: string, data: Record<string, unknown>): RFNode {
    return { id, type, position: { x: 0, y: 0 }, data };
}

describe("computeAdoption", () => {
    it("adopts an audio generation action into a pending audio node", () => {
        const action = node("act", "action-badge", {
            content: "Narrate this intro",
            actionType: "audio-gen",
            modelId: "minimax-tts",
            modelParams: { voice_id: "female-warm" },
        });

        const result = computeAdoption({
            actionBadgeNode: action,
            nodes: [action],
            edges: [] as Edge[],
            customActions: [],
        });

        expect(result.ok).toBe(true);
        expect(result.type).toBe("audio");
        expect(result.data).toMatchObject({
            label: "Narrate this intro",
            src: "",
            status: "pending",
            prompt: "Narrate this intro",
            model: "minimax-tts",
            modelId: "minimax-tts",
        });
    });

    it("adopts a text generation action into a pending text node", () => {
        const action = node("act", "action-badge", {
            content: "Write three title options",
            actionType: "text-gen",
            modelId: "gpt-5.4",
            modelParams: {},
        });

        const result = computeAdoption({
            actionBadgeNode: action,
            nodes: [action],
            edges: [] as Edge[],
            customActions: [],
        });

        expect(result.ok).toBe(true);
        expect(result.type).toBe("text");
        expect(result.data).toMatchObject({
            label: "Write three title options",
            content: "",
            status: "pending",
            prompt: "Write three title options",
            model: "gpt-5.4",
            modelId: "gpt-5.4",
        });
    });

    it("uses connected text refs as prompt context when action content is placeholder", () => {
        const action = node("act", "action-badge", {
            content: "# Prompt\nEnter your prompt here...",
            actionType: "image-gen",
            modelId: "nano-banana-2",
            modelParams: { aspect_ratio: "16:9", resolution: "1K", count: 1 },
        });
        const textRef = node("txt", "text", {
            content: "A calm product shot on a sandstone plinth.",
        });

        const result = computeAdoption({
            actionBadgeNode: action,
            nodes: [action, textRef],
            edges: [{ id: "txt-act", source: "txt", target: "act" }] as Edge[],
            customActions: [],
        });

        expect(result.ok).toBe(true);
        expect(result.type).toBe("image");
        expect(result.data?.prompt).toBe("A calm product shot on a sandstone plinth.");
    });
});
