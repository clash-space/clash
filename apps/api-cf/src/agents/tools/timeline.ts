import { z } from "zod";
import { tool } from "ai";
import {
  applyTimelineCommand,
  type TimelineCommand,
  type TimelineDsl,
} from "@master-clash/remotion-core/timelineSemantics";

export type TimelineStateAdapter = {
  getTimelineDsl: () => TimelineDsl | null | undefined | Promise<TimelineDsl | null | undefined>;
  updateTimelineDsl: (dsl: TimelineDsl) => void | Promise<void>;
};

function numberParam(params: Record<string, unknown>, key: string): number {
  const value = params[key];
  return typeof value === "number" ? value : Number.NaN;
}

function stringParam(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  return typeof value === "string" ? value : "";
}

function itemTypeParam(params: Record<string, unknown>): "video" | "audio" | "image" | "text" {
  const value = stringParam(params, "itemType") || stringParam(params, "item_type");
  if (value === "audio" || value === "image" || value === "text") return value;
  return "video";
}

function commandFromAction(action: string, params: Record<string, unknown>): TimelineCommand | null {
  if (action === "add_clip") {
    return {
      type: "add_clip",
      trackId: stringParam(params, "trackId") || stringParam(params, "track_id"),
      sourceNodeId: stringParam(params, "sourceNodeId") || stringParam(params, "source_node_id") || stringParam(params, "nodeId") || stringParam(params, "node_id"),
      assetId: stringParam(params, "assetId") || stringParam(params, "asset_id") || undefined,
      itemType: itemTypeParam(params),
      from: numberParam(params, "from"),
      durationInFrames: numberParam(params, "durationInFrames"),
      id: stringParam(params, "id") || undefined,
      text: stringParam(params, "text") || undefined,
    } as TimelineCommand;
  }

  if (action === "trim_clip") {
    return {
      type: "trim_clip",
      trackId: stringParam(params, "trackId") || stringParam(params, "track_id"),
      itemId: stringParam(params, "itemId") || stringParam(params, "item_id") || stringParam(params, "clipId") || stringParam(params, "clip_id"),
      from: numberParam(params, "from"),
      durationInFrames: numberParam(params, "durationInFrames"),
    };
  }

  if (action === "split_clip") {
    return {
      type: "split_clip",
      trackId: stringParam(params, "trackId") || stringParam(params, "track_id"),
      itemId: stringParam(params, "itemId") || stringParam(params, "item_id") || stringParam(params, "clipId") || stringParam(params, "clip_id"),
      splitFrame: numberParam(params, "splitFrame") || numberParam(params, "split_frame"),
    };
  }

  return null;
}

/**
 * Create timeline editing tools.
 */
export function createTimelineTools(
  sendMessage: (msg: Record<string, unknown>) => void,
  adapter?: TimelineStateAdapter,
) {
  const timelineEditor = tool({
    description:
      "Automated video editor tool. Provide an action (e.g., add_clip, set_duration, render) and params.",
    inputSchema: z.object({
      action: z.string().describe("Timeline action, e.g. add_clip, set_duration, render"),
      params: z.record(z.unknown()).describe("Action parameters"),
    }),
    execute: async (args) => {
      const { action, params } = args;
      try {
        const command = commandFromAction(action, params);
        if (adapter && command) {
          const currentDsl = await adapter.getTimelineDsl();
          if (!currentDsl) return "Error in timeline editor: no timelineDsl is available";

          const result = applyTimelineCommand(currentDsl, command);
          if (!result.ok) {
            return `Timeline action '${action}' rejected: ${result.issues
              .map((issue) => `${issue.code} at ${issue.path}: ${issue.message}`)
              .join("; ")}`;
          }

          await adapter.updateTimelineDsl(result.dsl);
          return `Timeline action '${action}' applied successfully`;
        }

        sendMessage({ type: "timeline_edit", action, params });
        return `Timeline action '${action}' executed successfully`;
      } catch (e) {
        return `Error in timeline editor: ${e}`;
      }
    },
  });

  return { timeline_editor: timelineEditor };
}
