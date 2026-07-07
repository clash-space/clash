import { describe, expect, it } from "vitest";
import { actionIsCheckpointLocked } from "./actionCheckpoint";

describe("action checkpoint lock", () => {
    it("does not lock a previously run action when no materialized downstream exists", () => {
        expect(actionIsCheckpointLocked({
            nodeId: "action-1",
            nodes: [{ id: "action-1", type: "action-badge", data: { hasRun: true, actionType: "image-gen" } }],
            edges: [],
        })).toBe(false);
    });

    it("does not lock actions whose downstream outputs are still draft placeholders", () => {
        expect(actionIsCheckpointLocked({
            nodeId: "action-1",
            nodes: [
                { id: "action-1", type: "action-badge", data: { hasRun: true, actionType: "image-gen" } },
                { id: "draft-1", type: "image", data: { status: "idle" } },
            ],
            edges: [{ source: "action-1", target: "draft-1" }],
        })).toBe(false);
    });

    it("locks actions while downstream outputs are pending or completed", () => {
        expect(actionIsCheckpointLocked({
            nodeId: "action-1",
            nodes: [
                { id: "action-1", type: "action-badge", data: { actionType: "image-gen" } },
                { id: "pending-1", type: "image", data: { status: "pending" } },
            ],
            edges: [{ source: "action-1", target: "pending-1" }],
        })).toBe(true);

        expect(actionIsCheckpointLocked({
            nodeId: "action-1",
            nodes: [
                { id: "action-1", type: "action-badge", data: { actionType: "image-gen" } },
                { id: "output-1", type: "image", data: { status: "completed", assetId: "asset-1" } },
            ],
            edges: [{ source: "action-1", target: "output-1" }],
        })).toBe(true);
    });

    it("does not lock through downstream action drafts until they materialize output", () => {
        expect(actionIsCheckpointLocked({
            nodeId: "action-1",
            nodes: [
                { id: "action-1", type: "action-badge", data: { actionType: "image-gen" } },
                { id: "action-2", type: "action-badge", data: { actionType: "video-gen" } },
            ],
            edges: [{ source: "action-1", target: "action-2" }],
        })).toBe(false);

        expect(actionIsCheckpointLocked({
            nodeId: "action-1",
            nodes: [
                { id: "action-1", type: "action-badge", data: { actionType: "image-gen" } },
                { id: "action-2", type: "action-badge", data: { actionType: "video-gen" } },
                { id: "output-2", type: "video", data: { status: "completed", assetId: "asset-2" } },
            ],
            edges: [
                { source: "action-1", target: "action-2" },
                { source: "action-2", target: "output-2" },
            ],
        })).toBe(true);
    });
});
