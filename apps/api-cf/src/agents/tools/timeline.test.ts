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
});
