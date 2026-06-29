import { describe, it, expect, vi } from "vitest";
import { createTimelineTools } from "./timeline";

describe("Timeline tools", () => {
  it("sends timeline_edit message with action and params", async () => {
    const sendMessage = vi.fn();
    const tools = createTimelineTools(sendMessage);

    const result = await tools.timeline_editor.execute!(
      { action: "add_clip", params: { nodeId: "n1", start: 0, duration: 5 } },
      { toolCallId: "1", messages: [] }
    );

    expect(result).toBe("Timeline action 'add_clip' executed successfully");
    expect(sendMessage).toHaveBeenCalledWith({
      type: "timeline_edit",
      action: "add_clip",
      params: { nodeId: "n1", start: 0, duration: 5 },
    });
  });

  it("handles render action", async () => {
    const sendMessage = vi.fn();
    const tools = createTimelineTools(sendMessage);

    const result = await tools.timeline_editor.execute!(
      { action: "render", params: { format: "mp4", quality: "high" } },
      { toolCallId: "1", messages: [] }
    );

    expect(result).toContain("render");
    expect(result).toContain("successfully");
  });

  it("handles set_duration action", async () => {
    const sendMessage = vi.fn();
    const tools = createTimelineTools(sendMessage);

    const result = await tools.timeline_editor.execute!(
      { action: "set_duration", params: { clipId: "c1", duration: 10 } },
      { toolCallId: "1", messages: [] }
    );

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(result).toContain("set_duration");
  });

  it("applies semantic timeline commands when a timeline state adapter is provided", async () => {
    const sendMessage = vi.fn();
    const updateTimelineDsl = vi.fn();
    const tools = createTimelineTools(sendMessage, {
      getTimelineDsl: () => ({
        tracks: [{ id: "main", name: "Main", role: "primary-video", items: [] }],
        compositionWidth: 1920,
        compositionHeight: 1080,
        fps: 30,
        durationInFrames: 0,
      }),
      updateTimelineDsl,
    });

    const result = await tools.timeline_editor.execute!(
      {
        action: "add_clip",
        params: {
          trackId: "main",
          sourceNodeId: "node-a",
          assetId: "asset-a",
          itemType: "video",
          from: 0,
          durationInFrames: 60,
        },
      },
      { toolCallId: "1", messages: [] }
    );

    expect(result).toContain("applied");
    expect(updateTimelineDsl).toHaveBeenCalledWith(expect.objectContaining({
      durationInFrames: 60,
      tracks: [
        expect.objectContaining({
          items: [expect.objectContaining({ sourceNodeId: "node-a", durationInFrames: 60 })],
        }),
      ],
    }));
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("returns semantic validation errors instead of claiming success", async () => {
    const tools = createTimelineTools(vi.fn(), {
      getTimelineDsl: () => ({
        tracks: [{ id: "music", name: "Music", role: "music", items: [] }],
        compositionWidth: 1920,
        compositionHeight: 1080,
        fps: 30,
        durationInFrames: 0,
      }),
      updateTimelineDsl: vi.fn(),
    });

    const result = await tools.timeline_editor.execute!(
      {
        action: "add_clip",
        params: {
          trackId: "music",
          sourceNodeId: "node-a",
          itemType: "video",
          from: 0,
          durationInFrames: 60,
        },
      },
      { toolCallId: "1", messages: [] }
    );

    expect(result).toContain("track.role_item_mismatch");
  });
});
