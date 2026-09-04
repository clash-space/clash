import { describe, expect, it } from "vitest";

import { appendRemotionComponentToTimelineState } from "./remotionComponentTimeline";

describe("appendRemotionComponentToTimelineState", () => {
  it("adds a live composition item that references the fixed Canvas node id", () => {
    const next = appendRemotionComponentToTimelineState(
      {
        tracks: [],
        compositionWidth: 720,
        compositionHeight: 1280,
        fps: 30,
        durationInFrames: 180,
      },
      {
        nodeId: "remotion-greeting",
        componentId: "Greeting",
        label: "Greeting character",
        durationInFrames: 120,
      },
    );

    expect(next.tracks).toHaveLength(1);
    expect(next.tracks[0]).toMatchObject({
      role: "overlay",
      category: "visual",
    });
    expect(next.tracks[0]?.items).toEqual([
      expect.objectContaining({
        type: "composition",
        runtime: "remotion",
        compositionKind: "custom",
        compositionId: "Greeting",
        sourceNodeId: "remotion-greeting",
        sourcePath: "components/remotion-greeting.tsx",
        from: 0,
        durationInFrames: 120,
      }),
    ]);
  });

  it("keeps the reference stable and does not snapshot source code", () => {
    const next = appendRemotionComponentToTimelineState(
      { tracks: [] },
      {
        nodeId: "fixed-node-id",
        componentId: "LiveCard",
        label: "Live card",
        durationInFrames: 90,
      },
    );

    const item = next.tracks[0]?.items[0] as Record<string, unknown>;
    expect(item.sourceNodeId).toBe("fixed-node-id");
    expect(item).not.toHaveProperty("componentSource");
    expect(item).not.toHaveProperty("renderedAssetPath");
    expect(item).not.toHaveProperty("revisionId");
  });

  it("reuses an existing visual overlay track", () => {
    const next = appendRemotionComponentToTimelineState(
      {
        tracks: [{
          id: "visual-overlays",
          name: "Overlays",
          role: "overlay",
          category: "visual",
          items: [],
        }],
      },
      {
        nodeId: "fixed-node-id",
        componentId: "LiveCard",
        label: "Live card",
        durationInFrames: 90,
      },
    );

    expect(next.tracks).toHaveLength(1);
    expect(next.tracks[0]).toMatchObject({
      id: "visual-overlays",
      category: "visual",
      role: "overlay",
      items: [expect.objectContaining({ type: "composition" })],
    });
  });

  it("does not duplicate a component that is already connected", () => {
    const state = {
      tracks: [{
        id: "visual-overlays",
        name: "Overlays",
        role: "overlay" as const,
        category: "visual" as const,
        items: [{
          id: "remotion-fixed-node-id",
          type: "composition" as const,
          compositionKind: "custom" as const,
          runtime: "remotion" as const,
          compositionId: "LiveCard",
          sourceNodeId: "fixed-node-id",
          sourcePath: "components/fixed-node-id.tsx",
          from: 24,
          durationInFrames: 90,
        }],
      }],
    };

    const next = appendRemotionComponentToTimelineState(state, {
      nodeId: "fixed-node-id",
      componentId: "LiveCard",
      label: "Live card",
      durationInFrames: 90,
    });

    expect(next).toBe(state);
    expect(next.tracks[0]?.items).toHaveLength(1);
    expect(next.tracks[0]?.items[0]?.from).toBe(24);
  });

  it("derives the Timeline update from a Remotion-to-Editor connection", async () => {
    const module = await import("./remotionComponentTimeline");
    const derive = (module as Record<string, unknown>)
      .deriveRemotionComponentConnectionUpdate as
      | ((input: Record<string, unknown>) => {
          timelineId: string;
          state: Record<string, unknown> & { tracks: Array<{ items: Array<Record<string, unknown>> }> };
        } | null)
      | undefined;

    expect(derive).toBeTypeOf("function");
    if (!derive) return;

    const update = derive({
      sourceId: "remotion-card",
      targetId: "timeline-action",
      nodes: [
        {
          id: "remotion-card",
          type: "remotion-component",
          data: {
            label: "Live card",
            componentId: "LiveCard",
            durationInFrames: 90,
          },
        },
        {
          id: "timeline-action",
          type: "video-editor",
          data: { timelineId: "timeline-main" },
        },
      ],
      timelines: [{ id: "timeline-main", state: { tracks: [] } }],
    });

    expect(update).toMatchObject({
      timelineId: "timeline-main",
      state: {
        tracks: [{
          items: [{
            runtime: "remotion",
            sourceNodeId: "remotion-card",
          }],
        }],
      },
    });
  });
});
