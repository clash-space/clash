import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  timelineDslCanonicalJson,
  timelineDslFromYaml,
  type ResolvedTimelineDsl,
} from "@clash/shared-types";
import {
  hashProjectionContent,
  resolveProjectionFilePathInsideCwd,
} from "./projection-cas";

export type ParseTimelineApplyResult =
  | { ok: true; dsl: ResolvedTimelineDsl; sources: string[] }
  | { ok: false; error: string };

export type TimelineRevisionStatus = "draft-file" | "applied";

export type ProjectTimelineRevisionRef = {
  timelineId: string;
  revisionId: string;
  timelineHash: string;
};

export type TimelineSourceProvenance = {
  sourceTimelineId: string;
  sourceTimelinePath: string;
  sourceTimelineHash: string;
  sourceTimelineRevisionId: string;
  sourceTimelineRevisionStatus: TimelineRevisionStatus;
};

export type TimelineProjectionCasApply = {
  target: "timeline";
  mutation: "projection-only";
  applyCommand: "clash timeline apply";
  filePath: string;
  timelineIdPlaceholder: "<timeline-id>";
  requiredRuntimeArgs: string[];
  pullCommand: "clash timeline pull";
  pullArgs: string[];
  applyArgs: string[];
};

export function resolveTimelineFilePath(options: {
  cwd: string;
  file?: string;
  timeline?: string;
}): string {
  const filePath = options.file
    ? options.file
    : join(options.cwd, "timelines", `${timelineFileSlug(options.timeline ?? "main")}.timeline.yaml`);
  return resolveProjectionFilePathInsideCwd({
    filePath,
    cwd: options.cwd,
  });
}

export function timelineProjectionCasApply(options: {
  cwd: string;
  filePath: string;
  timeline?: string;
}): { casApply: TimelineProjectionCasApply } {
  const timeline = options.timeline ?? "main";
  const targetFilePath = resolveTimelineFilePath({ cwd: options.cwd, timeline });
  const projectionPath = toProjectPath(options.cwd, options.filePath);
  const targetProjectPath = toProjectPath(options.cwd, targetFilePath);
  return {
    casApply: {
      target: "timeline",
      mutation: "projection-only",
      applyCommand: "clash timeline apply",
      filePath: projectionPath,
      timelineIdPlaceholder: "<timeline-id>",
      requiredRuntimeArgs: ["--timeline <timeline-id>"],
      pullCommand: "clash timeline pull",
      pullArgs: ["--timeline", "<timeline-id>", "--file", targetProjectPath],
      applyArgs: ["--timeline", "<timeline-id>", "--file", projectionPath],
    },
  };
}

export function parseTimelineFileForApply(raw: string): ParseTimelineApplyResult {
  const result = timelineDslFromYaml(raw);
  if (!result.ok) return result;
  return {
    ok: true,
    dsl: result.dsl,
    sources: sourceNodeIdsFromResolved(result.dsl),
  };
}

export function timelineHash(dsl: ResolvedTimelineDsl): string {
  return hashProjectionContent(timelineDslCanonicalJson(normalizeTimelineDslForYaml(dsl)));
}

export function createTimelineSourceProvenance(options: {
  cwd: string;
  filePath: string;
  dsl: ResolvedTimelineDsl;
  timelineRevision?: ProjectTimelineRevisionRef | null;
}): TimelineSourceProvenance {
  const cwd = resolve(options.cwd);
  const absolutePath = isAbsolute(options.filePath) ? resolve(options.filePath) : resolve(cwd, options.filePath);
  if (!isInsideOrEqual(cwd, absolutePath)) {
    throw new Error("Timeline provenance path must stay inside the current project cwd");
  }
  const sourceTimelinePath = toProjectPath(cwd, absolutePath);
  const sourceTimelineHash = timelineHash(options.dsl);
  if (options.timelineRevision) {
    if (options.timelineRevision.timelineHash !== sourceTimelineHash) {
      throw new Error(
        "Timeline projection does not match Project Timeline revision. Run `clash timeline pull` or apply the edited projection first.",
      );
    }
    return {
      sourceTimelineId: options.timelineRevision.timelineId,
      sourceTimelinePath,
      sourceTimelineHash,
      sourceTimelineRevisionId: options.timelineRevision.revisionId,
      sourceTimelineRevisionStatus: "applied",
    };
  }
  return {
    sourceTimelineId: `timeline:${sourceTimelinePath}`,
    sourceTimelinePath,
    sourceTimelineHash,
    sourceTimelineRevisionId: `draft-${sourceTimelineHash}`,
    sourceTimelineRevisionStatus: "draft-file",
  };
}

export function normalizeTimelineDslForYaml(raw: unknown): ResolvedTimelineDsl {
  const skeleton: ResolvedTimelineDsl = {
    tracks: [],
    compositionWidth: 1920,
    compositionHeight: 1080,
    fps: 30,
    durationInFrames: 300,
  };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return skeleton;
  const input = raw as Record<string, unknown>;
  const tracks = Array.isArray(input.tracks) ? input.tracks : [];
  return {
    tracks: tracks.map((track, index) => normalizeTrackForYaml(track, index)),
    compositionWidth: typeof input.compositionWidth === "number" ? input.compositionWidth : skeleton.compositionWidth,
    compositionHeight: typeof input.compositionHeight === "number" ? input.compositionHeight : skeleton.compositionHeight,
    fps: typeof input.fps === "number" ? input.fps : skeleton.fps,
    durationInFrames: typeof input.durationInFrames === "number" ? input.durationInFrames : skeleton.durationInFrames,
  };
}

export function sourceNodeIdsFromResolved(dsl: ResolvedTimelineDsl): string[] {
  const seen = new Set<string>();
  for (const track of dsl.tracks) {
    for (const item of track.items) {
      const sourceNodeId = (item as Record<string, unknown>).sourceNodeId;
      if (typeof sourceNodeId === "string" && sourceNodeId.length > 0) {
        seen.add(sourceNodeId);
      }
    }
  }
  return Array.from(seen);
}

function timelineFileSlug(raw: string): string {
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "main";
}

function toProjectPath(cwd: string, absolutePath: string): string {
  return relative(cwd, absolutePath).split(sep).join("/");
}

function isInsideOrEqual(parent: string, child: string): boolean {
  const relativePath = relative(parent, child);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function normalizeTrackForYaml(raw: unknown, index: number): ResolvedTimelineDsl["tracks"][number] {
  const track = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const items = Array.isArray(track.items) ? track.items : [];
  const id = typeof track.id === "string" && track.id.length > 0 ? track.id : `track-${index}`;
  const name = typeof track.name === "string" ? track.name : undefined;
  const role = typeof track.role === "string" && track.role.length > 0 ? track.role : undefined;
  return {
    id,
    ...(name !== undefined ? { name } : {}),
    ...(role !== undefined ? { role } : {}),
    ...(track.hidden === true ? { hidden: true } : {}),
    ...(track.locked === true ? { locked: true } : {}),
    items: items
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .map((item, itemIndex) => normalizeItemForYaml(item, id, itemIndex)),
  };
}

function normalizeItemForYaml(
  item: Record<string, unknown>,
  trackId: string,
  itemIndex: number,
): ResolvedTimelineDsl["tracks"][number]["items"][number] {
  const from =
    typeof item.from === "number"
      ? item.from
      : typeof item.start_at === "number"
        ? item.start_at
        : typeof item.start === "number"
          ? item.start
          : 0;
  const durationInFrames =
    typeof item.durationInFrames === "number"
      ? item.durationInFrames
      : typeof item.duration_in_frames === "number"
        ? item.duration_in_frames
        : typeof item.end === "number" && typeof item.start === "number"
          ? Math.max(0, item.end - item.start)
          : 0;
  const drop = new Set(["from", "durationInFrames", "start", "end", "start_at", "duration_in_frames", "trackId", "id", "type"]);
  const passthrough: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(item)) {
    if (drop.has(key) || value === undefined) continue;
    passthrough[key] = value;
  }
  return {
    id: typeof item.id === "string" && item.id.length > 0 ? item.id : `item-${timelineFileSlug(trackId)}-${itemIndex}`,
    type: typeof item.type === "string" && item.type.length > 0 ? item.type : "image",
    from,
    durationInFrames,
    ...passthrough,
  };
}
