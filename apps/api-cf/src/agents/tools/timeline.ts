import { z } from "zod";
import { tool } from "ai";
import type { LoroDoc } from "loro-crdt";
import {
  Canvas,
  type BroadcastFn,
  type ResolvedTimelineDsl,
  timelineDslToYaml,
  timelineDslFromYaml,
  timelineDslHash,
} from "@clash/shared-types";

/**
 * Timeline editing tools (server-side, soft-lock guarded).
 *
 * Two surfaces co-exist:
 *
 *   1. timeline_editor — replace the whole timelineDsl in one shot. Useful
 *      for fresh assemblies / large rewrites. Validates via the loose Zod
 *      schema below; doesn't go through YAML.
 *
 *   2. read_timeline / edit_timeline / write_timeline — edit timelineDsl
 *      as a YAML "file". This is the agent-friendly surface: cheap diffs,
 *      relative `from` expressions ("prev", "clip-A+30"), staleness guard.
 *      Underlying storage remains the same Loro doc; YAML is a pure
 *      projection (see packages/shared-types/src/timeline-yaml.ts).
 *
 * Both surfaces honor the same soft edit-lock: while a real-user client has
 * the editor open on this node (presence.editingNodeId === node_id), agent
 * writes are refused with an instructive message.
 */

const timelineDslSchema = z
  .object({
    tracks: z
      .array(z.object({}).passthrough())
      .describe("Tracks array. Each track has { id, name, items: Item[], ... }"),
    compositionWidth: z.number().int().positive().optional(),
    compositionHeight: z.number().int().positive().optional(),
    fps: z.number().positive().optional(),
    durationInFrames: z.number().int().nonnegative().optional(),
  })
  .passthrough();

const lockedRefusal = (nodeId: string) =>
  `User is currently editing node ${nodeId} in the video editor. ` +
  `Timeline writes are blocked while the editor is open to avoid clobbering ` +
  `in-flight changes. Tell the user what you would like to do and wait for ` +
  `them to close the editor before retrying.`;

const readDslOrError = (
  doc: LoroDoc,
  broadcast: BroadcastFn,
  nodeId: string,
): { ok: true; dsl: ResolvedTimelineDsl; canvas: Canvas } | { ok: false; message: string } => {
  const canvas = new Canvas(doc, broadcast);
  const node = canvas.readNode(nodeId);
  if (!node) return { ok: false, message: `Node ${nodeId} not found in the canvas.` };
  const dsl = (node.data as { timelineDsl?: unknown } | undefined)?.timelineDsl;
  if (!dsl) {
    return {
      ok: false,
      message: `Node ${nodeId} has no timelineDsl yet. Initialize one with timeline_editor or write_timeline first.`,
    };
  }
  return { ok: true, dsl: dsl as ResolvedTimelineDsl, canvas };
};

export function createTimelineTools(
  doc: LoroDoc,
  broadcast: BroadcastFn,
  isNodeLocked: (nodeId: string) => boolean,
) {
  // ── timeline_editor: full-replace via JSON object ──────────────────
  const updateTimeline = tool({
    description:
      "Replace the timelineDsl on a video editor canvas node in one shot. " +
      "Use for fresh assemblies. For surgical edits prefer edit_timeline.",
    inputSchema: z.object({
      node_id: z.string().describe("ID of the video editor canvas node to update."),
      timeline_dsl: timelineDslSchema.describe(
        "Full timelineDsl to install on node.data.timelineDsl (replaces any existing).",
      ),
    }),
    execute: async ({ node_id, timeline_dsl }) => {
      if (isNodeLocked(node_id)) return lockedRefusal(node_id);
      const canvas = new Canvas(doc, broadcast);
      const node = canvas.readNode(node_id);
      if (!node) return `Node ${node_id} not found in the canvas.`;
      const ok = canvas.updateNode(node_id, { timelineDsl: timeline_dsl });
      if (!ok) return `Failed to update node ${node_id} (updateNode returned false).`;
      const trackCount = Array.isArray(timeline_dsl.tracks) ? timeline_dsl.tracks.length : 0;
      const itemCount = Array.isArray(timeline_dsl.tracks)
        ? timeline_dsl.tracks.reduce(
            (sum, t) => sum + (Array.isArray((t as { items?: unknown[] }).items) ? ((t as { items: unknown[] }).items).length : 0),
            0,
          )
        : 0;
      return `Timeline updated on node ${node_id}: ${trackCount} track(s), ${itemCount} item(s).`;
    },
  });

  // ── read_timeline: returns YAML + a stable hash ────────────────────
  const readTimeline = tool({
    description:
      "Read a video editor node's timelineDsl as a YAML document. The returned " +
      "string starts with a `# Hash: <hex>` line; pass that hash back as " +
      "read_hash on edit_timeline to detect concurrent changes.",
    inputSchema: z.object({
      node_id: z.string().describe("ID of the video editor canvas node."),
    }),
    execute: async ({ node_id }) => {
      const r = readDslOrError(doc, broadcast, node_id);
      if (!r.ok) return r.message;
      const yaml = timelineDslToYaml(r.dsl);
      const hash = await timelineDslHash(r.dsl);
      return `# Hash: ${hash}\n${yaml}`;
    },
  });

  // ── edit_timeline: surgical string replacement on the YAML ─────────
  const editTimeline = tool({
    description:
      "Apply a unique string replacement to a node's timelineDsl YAML. The " +
      "old_str must appear exactly once in the current YAML. Pass the read_hash " +
      "from your most recent read_timeline call — if the timeline changed in " +
      "the meantime the edit is rejected and you must re-read.",
    inputSchema: z.object({
      node_id: z.string(),
      read_hash: z
        .string()
        .describe("Hash from the read_timeline `# Hash:` line. Stale hash → edit refused."),
      old_str: z.string().describe("Exact substring to replace; must be unique in the YAML."),
      new_str: z.string().describe("Replacement text."),
    }),
    execute: async ({ node_id, read_hash, old_str, new_str }) => {
      if (isNodeLocked(node_id)) return lockedRefusal(node_id);
      const r = readDslOrError(doc, broadcast, node_id);
      if (!r.ok) return r.message;

      const currentHash = await timelineDslHash(r.dsl);
      if (currentHash !== read_hash) {
        return (
          `Stale read: timeline hash is ${currentHash}, you passed ${read_hash}. ` +
          `Re-read with read_timeline and retry the edit.`
        );
      }

      const yaml = timelineDslToYaml(r.dsl);
      const firstIdx = yaml.indexOf(old_str);
      if (firstIdx === -1) {
        return `old_str not found in YAML. Re-read and provide a substring that appears verbatim.`;
      }
      if (yaml.indexOf(old_str, firstIdx + 1) !== -1) {
        return (
          `old_str matches multiple places in YAML — ambiguous edit refused. ` +
          `Include surrounding lines (e.g. the parent item's id) to make it unique.`
        );
      }
      const newYaml = yaml.slice(0, firstIdx) + new_str + yaml.slice(firstIdx + old_str.length);
      const parsed = timelineDslFromYaml(newYaml);
      if (!parsed.ok) {
        return `Edited YAML failed to parse: ${parsed.error}. The current state was not modified.`;
      }
      const ok = r.canvas.updateNode(node_id, { timelineDsl: parsed.dsl });
      if (!ok) return `updateNode failed.`;
      const newHash = await timelineDslHash(parsed.dsl);
      return `Timeline updated. New hash: ${newHash}`;
    },
  });

  // ── write_timeline: replace whole DSL via fresh YAML ───────────────
  const writeTimeline = tool({
    description:
      "Replace a node's timelineDsl by parsing a fresh YAML document. " +
      "Use for major rewrites; prefer edit_timeline for surgical changes.",
    inputSchema: z.object({
      node_id: z.string(),
      yaml: z.string().describe("Full YAML document for the new timelineDsl."),
    }),
    execute: async ({ node_id, yaml }) => {
      if (isNodeLocked(node_id)) return lockedRefusal(node_id);
      const parsed = timelineDslFromYaml(yaml);
      if (!parsed.ok) return `Parse error: ${parsed.error}`;
      const canvas = new Canvas(doc, broadcast);
      const node = canvas.readNode(node_id);
      if (!node) return `Node ${node_id} not found.`;
      const ok = canvas.updateNode(node_id, { timelineDsl: parsed.dsl });
      if (!ok) return `updateNode failed.`;
      const newHash = await timelineDslHash(parsed.dsl);
      return `Timeline replaced. New hash: ${newHash}.`;
    },
  });

  return {
    timeline_editor: updateTimeline,
    read_timeline: readTimeline,
    edit_timeline: editTimeline,
    write_timeline: writeTimeline,
  };
}
