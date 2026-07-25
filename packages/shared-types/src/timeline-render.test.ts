import { describe, expect, it } from "vitest";
import { LoroDoc } from "loro-crdt";
import { Canvas } from "./canvas-ops";
import * as workspace from "./project-workspace";
import * as timelineRender from "./timeline-render";

const timelineState = {
  compositionWidth: 1920,
  compositionHeight: 1080,
  fps: 30,
  durationInFrames: 60,
  tracks: [
    {
      id: "video-track",
      items: [{ id: "clip-1", type: "video", from: 0, durationInFrames: 60, assetId: "asset-1" }],
    },
  ],
};

describe("Timeline render requests", () => {
  it("creates a backend-only render request for a Project-owned Timeline", () => {
    const doc = new LoroDoc();
    (workspace as any).createProjectTimeline(doc, {
      id: "timeline-project",
      name: "Project Cut",
      state: timelineState,
    });

    expect((timelineRender as any).requestTimelineRender).toBeTypeOf("function");
    const result = (timelineRender as any).requestTimelineRender(doc, {
      timelineId: "timeline-project",
      actorUserId: "user-1",
      generateId: () => "render-project-1",
    });

    expect(result).toMatchObject({
      ok: true,
      renderNodeId: "render-project-1",
      target: { kind: "project-assets" },
    });
    expect(doc.getMap("nodes").get("render-project-1")).toMatchObject({
      canvasId: (timelineRender as any).PROJECT_ASSET_RENDER_CANVAS_ID,
      type: "video",
      data: {
        status: "pending",
        actorType: "user",
        actorUserId: "user-1",
        sourceTimelineId: "timeline-project",
        renderTarget: { kind: "project-assets" },
        timelineDsl: { durationInFrames: 60 },
      },
    });
    expect((workspace as any).listProjectCanvases(doc)).toEqual([]);
  });

  it("places the pending render video on a Canvas-owned Timeline's parent Canvas", () => {
    const doc = new LoroDoc();
    (workspace as any).createProjectCanvas(doc, { id: "shots", name: "Shots" });
    (workspace as any).createProjectTimeline(doc, {
      id: "timeline-canvas",
      name: "Canvas Cut",
      state: timelineState,
    });
    (workspace as any).attachTimelineToCanvas(doc, {
      timelineId: "timeline-canvas",
      canvasId: "shots",
      actionNodeId: "timeline-action",
      position: { x: 20, y: 40 },
    });

    const result = (timelineRender as any).requestTimelineRender(doc, {
      timelineId: "timeline-canvas",
      actorUserId: "user-1",
      generateId: () => "render-canvas-1",
    });

    expect(result).toMatchObject({
      ok: true,
      renderNodeId: "render-canvas-1",
      target: { kind: "canvas", canvasId: "shots", actionNodeId: "timeline-action" },
    });
    expect(new Canvas(doc, () => {}, "shots").readNode("render-canvas-1")).toMatchObject({
      type: "video",
      upstream: [{ nodeId: "timeline-action" }],
      data: {
        status: "pending",
        actorUserId: "user-1",
        sourceTimelineId: "timeline-canvas",
        renderTarget: { kind: "canvas", canvasId: "shots", actionNodeId: "timeline-action" },
      },
    });
  });
});
