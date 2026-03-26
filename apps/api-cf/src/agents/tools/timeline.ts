import { z } from "zod";
import { tool as _tool } from "ai";

const tool = _tool as any;

/**
 * Create timeline editing tools.
 */
export function createTimelineTools(
  sendMessage: (msg: Record<string, unknown>) => void
) {
  const timelineEditor = tool({
    description:
      "Automated video editor tool. Provide an action (e.g., add_clip, set_duration, render) and params.",
    parameters: z.object({
      action: z.string().describe("Timeline action, e.g. add_clip, set_duration, render"),
      params: z.record(z.unknown()).describe("Action parameters"),
    }),
    execute: async (args: any) => {
      const { action, params } = args;
      try {
        sendMessage({ type: "timeline_edit", action, params });
        return `Timeline action '${action}' executed successfully`;
      } catch (e) {
        return `Error in timeline editor: ${e}`;
      }
    },
  });

  return { timeline_editor: timelineEditor };
}
