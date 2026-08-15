import {
  DirectorStageStateSchema,
  TimelineDslSchema,
  type DirectorStageState,
} from "@clash/shared-types";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parse as parseYaml } from "yaml";
import { timelineDslDocumentFromArtifact } from "./timeline-artifact";

import {
  loadSubmission,
  type LoadedArtifact,
  type LoadedSubmission,
} from "./artifacts";
import { ArtifactBenchmarkCaseSchema } from "./schemas";
import type {
  ArtifactBenchmarkCase,
  ArtifactEvaluationReport,
  ArtifactRubric,
  EvaluateSubmissionInput,
  EvaluationCheck,
} from "./types";

type TimelineData = {
  durationInFrames?: number;
  tracks: Array<{
    id: string;
    items: Array<Record<string, unknown> & { id: string; type: string }>;
  }>;
};

type ParsedArtifact<T> =
  { ok: true; value: T; warnings?: string[] } | { ok: false; error: string };

type EvaluationContext = {
  submission: LoadedSubmission;
  artifactById: Map<string, LoadedArtifact>;
  directorCache: Map<string, ParsedArtifact<DirectorStageState>>;
  timelineCache: Map<string, ParsedArtifact<TimelineData>>;
  remotionComponentCache: Map<string, ParsedArtifact<RemotionComponentSource>>;
};

type RemotionComponentSource = {
  source: string;
  bytes: number;
  bodyParts: string[];
};

const execFileAsync = promisify(execFile);

function formatIssues(
  issues: Array<{ path: PropertyKey[]; message: string }>,
): string {
  return issues
    .map(
      (issue) =>
        `${issue.path.length > 0 ? issue.path.join(".") : "artifact"}: ${issue.message}`,
    )
    .join("; ");
}

function parseJson(content: Buffer, label: string): ParsedArtifact<unknown> {
  try {
    return { ok: true, value: JSON.parse(content.toString("utf8")) };
  } catch (error) {
    return {
      ok: false,
      error: `${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function requiredArtifact(
  context: EvaluationContext,
  artifactId: string,
  expectedKind?: LoadedArtifact["descriptor"]["kind"],
  requireContent = false,
): ParsedArtifact<LoadedArtifact> {
  const artifact = context.artifactById.get(artifactId);
  if (!artifact)
    return {
      ok: false,
      error: `Submission does not declare artifact '${artifactId}'`,
    };
  if (expectedKind && artifact.descriptor.kind !== expectedKind) {
    return {
      ok: false,
      error: `Artifact '${artifactId}' must have kind '${expectedKind}', got '${artifact.descriptor.kind}'`,
    };
  }
  if (artifact.error) return { ok: false, error: artifact.error };
  if (requireContent && !artifact.content) {
    return { ok: false, error: `Artifact '${artifactId}' could not be read` };
  }
  return { ok: true, value: artifact };
}

function parseDirector(
  context: EvaluationContext,
  artifactId: string,
): ParsedArtifact<DirectorStageState> {
  const cached = context.directorCache.get(artifactId);
  if (cached) return cached;
  const artifact = requiredArtifact(
    context,
    artifactId,
    "director-stage",
    true,
  );
  if (!artifact.ok) {
    context.directorCache.set(artifactId, artifact);
    return artifact;
  }
  const json = parseJson(
    artifact.value.content!,
    `Director Stage artifact '${artifactId}'`,
  );
  if (!json.ok) {
    context.directorCache.set(artifactId, json);
    return json;
  }
  const parsed = DirectorStageStateSchema.safeParse(
    directorStageArtifactState(json.value),
  );
  let result: ParsedArtifact<DirectorStageState>;
  if (!parsed.success) {
    result = {
      ok: false,
      error: `Invalid Director Stage artifact: ${formatIssues(parsed.error.issues)}`,
    };
  } else {
    const semanticIssues = directorStageSemanticIssues(parsed.data);
    result =
      semanticIssues.length === 0
        ? { ok: true, value: parsed.data }
        : {
            ok: false,
            error: `Invalid Director Stage references: ${semanticIssues.join("; ")}`,
          };
  }
  context.directorCache.set(artifactId, result);
  return result;
}

export function directorStageArtifactState(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length === 1 &&
    record.stage &&
    typeof record.stage === "object" &&
    !Array.isArray(record.stage)
  ) {
    const stage = record.stage as Record<string, unknown>;
    const owner =
      stage.owner &&
      typeof stage.owner === "object" &&
      !Array.isArray(stage.owner)
        ? (stage.owner as Record<string, unknown>)
        : undefined;
    if (
      typeof stage.id === "string" &&
      typeof stage.name === "string" &&
      typeof stage.revisionId === "string" &&
      (owner?.kind === "project" ||
        (owner?.kind === "canvas-action" &&
          typeof owner.canvasId === "string" &&
          typeof owner.actionNodeId === "string")) &&
      stage.state !== undefined
    ) {
      return stage.state;
    }
  }
  return typeof record.id === "string" &&
    typeof record.name === "string" &&
    typeof record.revisionId === "string" &&
    record.state !== undefined
    ? record.state
    : value;
}

function directorStageSemanticIssues(stage: DirectorStageState): string[] {
  const issues: string[] = [];
  const seenIds = new Map<string, string>();
  const registerIds = (items: Array<{ id: string }>, label: string): void => {
    for (const item of items) {
      const prior = seenIds.get(item.id);
      if (prior)
        issues.push(`duplicate id '${item.id}' in ${prior} and ${label}`);
      else seenIds.set(item.id, label);
    }
  };
  registerIds(stage.objects, "objects");
  registerIds(stage.cameras, "cameras");
  registerIds(stage.shots, "shots");
  registerIds(stage.shotSequence ?? [], "shotSequence");
  registerIds(stage.motionAssets ?? [], "motionAssets");
  registerIds(stage.animation?.tracks ?? [], "animation.tracks");
  registerIds(stage.animation?.actionClips ?? [], "animation.actionClips");
  registerIds(stage.animation?.storyBeats ?? [], "animation.storyBeats");
  registerIds(stage.animation?.cameraCues ?? [], "animation.cameraCues");

  const objectIds = new Set(stage.objects.map((object) => object.id));
  const cameraIds = new Set(stage.cameras.map((camera) => camera.id));
  const targetIds = new Set([...objectIds, ...cameraIds]);
  const sequenceShotIds = new Set(
    (stage.shotSequence ?? []).map((shot) => shot.id),
  );
  const actionClipIds = new Set(
    (stage.animation?.actionClips ?? []).map((clip) => clip.id),
  );
  const storyBeatIds = new Set(
    (stage.animation?.storyBeats ?? []).map((beat) => beat.id),
  );
  const motionAssetIds = new Set(
    (stage.motionAssets ?? []).map((asset) => asset.id),
  );

  if (stage.activeCameraId && !cameraIds.has(stage.activeCameraId)) {
    issues.push(`activeCameraId '${stage.activeCameraId}' does not resolve`);
  }
  for (const object of stage.objects) {
    if (object.attachment && !objectIds.has(object.attachment.parentId)) {
      issues.push(
        `object '${object.id}' attachment parent '${object.attachment.parentId}' does not resolve`,
      );
    }
    if (object.attachment?.parentId === object.id) {
      issues.push(`object '${object.id}' cannot attach to itself`);
    }
  }
  const attachmentParents = new Map(
    stage.objects.flatMap((object) =>
      object.attachment
        ? [[object.id, object.attachment.parentId] as const]
        : [],
    ),
  );
  const attachmentState = new Map<string, "visiting" | "visited">();
  const visitAttachment = (objectId: string, chain: string[]): void => {
    if (attachmentState.get(objectId) === "visited") return;
    if (attachmentState.get(objectId) === "visiting") {
      const cycleStart = chain.indexOf(objectId);
      const cycle = [...chain.slice(Math.max(0, cycleStart)), objectId];
      issues.push(`attachment cycle detected: ${cycle.join(" -> ")}`);
      return;
    }
    attachmentState.set(objectId, "visiting");
    const parentId = attachmentParents.get(objectId);
    if (parentId && objectIds.has(parentId))
      visitAttachment(parentId, [...chain, objectId]);
    attachmentState.set(objectId, "visited");
  };
  for (const objectId of attachmentParents.keys())
    visitAttachment(objectId, []);
  for (const camera of stage.cameras) {
    for (const targetId of [
      camera.targetObjectId,
      ...(camera.targetObjectIds ?? []),
    ]) {
      if (targetId && !objectIds.has(targetId)) {
        issues.push(
          `camera '${camera.id}' target '${targetId}' does not resolve`,
        );
      }
    }
  }
  for (const shot of stage.shots) {
    if (!cameraIds.has(shot.cameraId))
      issues.push(
        `shot '${shot.id}' camera '${shot.cameraId}' does not resolve`,
      );
    if (shot.sequenceShotId && !sequenceShotIds.has(shot.sequenceShotId)) {
      issues.push(
        `shot '${shot.id}' sequenceShotId '${shot.sequenceShotId}' does not resolve`,
      );
    }
    if (
      shot.timeSeconds !== undefined &&
      stage.animation &&
      shot.timeSeconds > stage.animation.durationSeconds
    ) {
      issues.push(
        `shot '${shot.id}' time ${shot.timeSeconds}s exceeds stage duration ${stage.animation.durationSeconds}s`,
      );
    }
  }
  const sequence = stage.shotSequence ?? [];
  for (let index = 0; index < sequence.length; index += 1) {
    const shot = sequence[index]!;
    if (!cameraIds.has(shot.cameraId))
      issues.push(
        `sequence shot '${shot.id}' camera '${shot.cameraId}' does not resolve`,
      );
    if (
      stage.animation &&
      shot.startTime + shot.durationSeconds > stage.animation.durationSeconds
    ) {
      issues.push(
        `sequence shot '${shot.id}' exceeds stage duration ${stage.animation.durationSeconds}s`,
      );
    }
    const previous = sequence[index - 1];
    if (
      previous &&
      shot.startTime < previous.startTime + previous.durationSeconds
    ) {
      issues.push(
        `sequence shot '${shot.id}' overlaps or precedes '${previous.id}'`,
      );
    }
    for (const id of shot.actionClipIds ?? []) {
      if (!actionClipIds.has(id))
        issues.push(
          `sequence shot '${shot.id}' action clip '${id}' does not resolve`,
        );
    }
    for (const id of shot.storyBeatIds ?? []) {
      if (!storyBeatIds.has(id))
        issues.push(
          `sequence shot '${shot.id}' story beat '${id}' does not resolve`,
        );
    }
    const subjectIds = [
      shot.composition?.primarySubjectId,
      ...(shot.composition?.secondarySubjectIds ?? []),
      shot.composition?.axis?.fromObjectId,
      shot.composition?.axis?.toObjectId,
    ];
    for (const id of subjectIds) {
      if (id && !objectIds.has(id))
        issues.push(
          `sequence shot '${shot.id}' subject '${id}' does not resolve`,
        );
    }
    if (shot.cameraMove?.rig?.orientation.mode === "target-object") {
      const id = shot.cameraMove.rig.orientation.objectId;
      if (!objectIds.has(id))
        issues.push(
          `sequence shot '${shot.id}' rig target '${id}' does not resolve`,
        );
    }
  }

  if (stage.animation) {
    for (const track of stage.animation.tracks) {
      if (!targetIds.has(track.targetId))
        issues.push(
          `animation track '${track.id}' target '${track.targetId}' does not resolve`,
        );
      const keyframeIds = new Set<string>();
      const keyframeTimes = new Set<number>();
      for (const keyframe of track.keyframes) {
        if (keyframeIds.has(keyframe.id))
          issues.push(
            `animation track '${track.id}' has duplicate keyframe id '${keyframe.id}'`,
          );
        if (keyframeTimes.has(keyframe.time))
          issues.push(
            `animation track '${track.id}' has duplicate keyframe time ${keyframe.time}`,
          );
        if (keyframe.time > stage.animation.durationSeconds) {
          issues.push(
            `animation track '${track.id}' keyframe ${keyframe.time}s exceeds stage duration`,
          );
        }
        keyframeIds.add(keyframe.id);
        keyframeTimes.add(keyframe.time);
      }
    }
    for (const clip of stage.animation.actionClips ?? []) {
      if (!objectIds.has(clip.targetId))
        issues.push(
          `action clip '${clip.id}' target '${clip.targetId}' does not resolve`,
        );
      if (clip.motionAssetId && !motionAssetIds.has(clip.motionAssetId)) {
        issues.push(
          `action clip '${clip.id}' motion asset '${clip.motionAssetId}' does not resolve`,
        );
      }
      if (
        clip.startTime + clip.durationSeconds >
        stage.animation.durationSeconds
      ) {
        issues.push(`action clip '${clip.id}' exceeds stage duration`);
      }
    }
    for (const beat of stage.animation.storyBeats ?? []) {
      for (const id of beat.participantIds) {
        if (!objectIds.has(id))
          issues.push(
            `story beat '${beat.id}' participant '${id}' does not resolve`,
          );
      }
      if (beat.dialogue && !objectIds.has(beat.dialogue.speakerId)) {
        issues.push(
          `story beat '${beat.id}' speaker '${beat.dialogue.speakerId}' does not resolve`,
        );
      }
      if (
        beat.startTime + beat.durationSeconds >
        stage.animation.durationSeconds
      ) {
        issues.push(`story beat '${beat.id}' exceeds stage duration`);
      }
    }
    for (const cue of stage.animation.cameraCues ?? []) {
      if (!cameraIds.has(cue.cameraId))
        issues.push(
          `camera cue '${cue.id}' camera '${cue.cameraId}' does not resolve`,
        );
      if (
        cue.startTime + cue.durationSeconds >
        stage.animation.durationSeconds
      ) {
        issues.push(`camera cue '${cue.id}' exceeds stage duration`);
      }
    }
  }
  return issues;
}

function parseTimeline(
  context: EvaluationContext,
  artifactId: string,
): ParsedArtifact<TimelineData> {
  const cached = context.timelineCache.get(artifactId);
  if (cached) return cached;
  const artifact = requiredArtifact(context, artifactId, "timeline", true);
  if (!artifact.ok) {
    context.timelineCache.set(artifactId, artifact);
    return artifact;
  }

  let raw: unknown;
  try {
    raw = timelineDslDocumentFromArtifact(
      parseYaml(artifact.value.content!.toString("utf8")),
    );
  } catch (error) {
    const result = {
      ok: false as const,
      error: `Timeline artifact is not valid YAML: ${error instanceof Error ? error.message : String(error)}`,
    };
    context.timelineCache.set(artifactId, result);
    return result;
  }

  const parsed = TimelineDslSchema.safeParse(raw);
  if (parsed.success) {
    const result = { ok: true as const, value: parsed.data as TimelineData };
    context.timelineCache.set(artifactId, result);
    return result;
  }

  const result = {
    ok: false as const,
    error: `Invalid Timeline artifact: ${formatIssues(parsed.error.issues)}`,
  };
  context.timelineCache.set(artifactId, result);
  return result;
}

function parseRemotionComponent(
  context: EvaluationContext,
  artifactId: string,
): ParsedArtifact<RemotionComponentSource> {
  const cached = context.remotionComponentCache.get(artifactId);
  if (cached) return cached;
  const artifact = requiredArtifact(
    context,
    artifactId,
    "remotion-component",
    true,
  );
  if (!artifact.ok) {
    context.remotionComponentCache.set(artifactId, artifact);
    return artifact;
  }
  const source = artifact.value.content!.toString("utf8");
  const failures: string[] = [];
  if (!/\bexport\s+default\b/u.test(source)) {
    failures.push("a default React component export is required");
  }
  if (!/\bfrom\s+["']remotion["']/u.test(source)) {
    failures.push(
      "the component must import its animation primitives from remotion",
    );
  }
  const importSpecifiers = [...source.matchAll(/\bfrom\s+["']([^"']+)["']/gu)]
    .map((match) => match[1]!)
    .filter((specifier) => specifier !== "react" && specifier !== "remotion");
  if (importSpecifiers.length > 0) {
    failures.push(
      `unsupported imports: ${[...new Set(importSpecifiers)].join(", ")}`,
    );
  }
  if (/\bimport\s*\(/u.test(source) || /\brequire\s*\(/u.test(source)) {
    failures.push(
      "dynamic import and require are not supported by the inline Remotion runtime",
    );
  }
  const bodyParts = [
    ...source.matchAll(/data-character-part\s*=\s*["']([^"']+)["']/gu),
    ...source.matchAll(
      /<Interactive\.[A-Za-z][A-Za-z0-9]*\b[^>]*\bname\s*=\s*["']([^"']+)["'][^>]*>/gu,
    ),
  ].map((match) => canonicalBodyPartId(match[1]!));
  const result: ParsedArtifact<RemotionComponentSource> =
    failures.length === 0
      ? {
          ok: true,
          value: {
            source,
            bytes: artifact.value.content!.byteLength,
            bodyParts,
          },
        }
      : {
          ok: false,
          error: `Invalid Remotion component artifact: ${failures.join("; ")}`,
        };
  context.remotionComponentCache.set(artifactId, result);
  return result;
}

function checkResult(
  rubric: ArtifactRubric,
  passed: boolean,
  detail: string,
  metrics?: EvaluationCheck["metrics"],
): EvaluationCheck {
  return {
    id: rubric.id,
    type: rubric.type,
    status: passed ? "pass" : "fail",
    required: rubric.required ?? false,
    weight: rubric.weight,
    awardedWeight: passed ? rubric.weight : 0,
    detail,
    ...(metrics ? { metrics } : {}),
  };
}

function evaluateArtifactExists(
  rubric: Extract<ArtifactRubric, { type: "artifact-exists" }>,
  context: EvaluationContext,
): EvaluationCheck {
  const artifact = requiredArtifact(context, rubric.artifactId, rubric.kind);
  if (!artifact.ok) return checkResult(rubric, false, artifact.error);
  const bytes =
    artifact.value.evidence?.bytes ?? artifact.value.content?.byteLength ?? 0;
  const passed = bytes >= (rubric.minBytes ?? 0);
  return checkResult(
    rubric,
    passed,
    passed
      ? `Artifact '${rubric.artifactId}' exists (${bytes} bytes)`
      : `Artifact '${rubric.artifactId}' has ${bytes} bytes; requires at least ${rubric.minBytes}`,
    { bytes },
  );
}

function evaluateArtifactSet(
  rubric: Extract<ArtifactRubric, { type: "artifact-set" }>,
  context: EvaluationContext,
): EvaluationCheck {
  const matching = context.submission.artifacts.filter(
    (artifact) =>
      (!rubric.kind || artifact.descriptor.kind === rubric.kind) &&
      !artifact.error &&
      (artifact.evidence?.bytes ?? 0) >= (rubric.minBytes ?? 0),
  );
  const rejected = context.submission.artifacts.filter(
    (artifact) =>
      (!rubric.kind || artifact.descriptor.kind === rubric.kind) &&
      artifact.error,
  );
  const passed = matching.length >= rubric.minCount;
  const rejectionDetail =
    rejected.length > 0
      ? ` Rejected: ${rejected.map((artifact) => `${artifact.descriptor.id}: ${artifact.error}`).join("; ")}`
      : "";
  return checkResult(
    rubric,
    passed,
    `${matching.length} qualifying artifact(s); requires ${rubric.minCount}.${rejectionDetail}`,
    { count: matching.length, minBytes: rubric.minBytes ?? 0 },
  );
}

function evaluateDirectorStage(
  rubric: Extract<ArtifactRubric, { type: "director-stage" }>,
  context: EvaluationContext,
): EvaluationCheck {
  const parsed = parseDirector(context, rubric.artifactId);
  if (!parsed.ok) return checkResult(rubric, false, parsed.error);

  const stage = parsed.value;
  const tracks = stage.animation?.tracks ?? [];
  const animatedTracks = tracks.filter(
    (track) =>
      track.keyframes.length >= 2 &&
      new Set(track.keyframes.map((keyframe) => JSON.stringify(keyframe.value)))
        .size >= 2,
  ).length;
  const actionClips = stage.animation?.actionClips ?? [];
  const actions = new Set<string>(actionClips.map((clip) => clip.action));
  const mannequins = stage.objects.filter(
    (object) => object.kind === "mannequin",
  ).length;
  const mannequin = mannequins > 0;
  const failures: string[] = [];
  if (stage.objects.length < (rubric.minObjects ?? 0))
    failures.push(`objects ${stage.objects.length}/${rubric.minObjects}`);
  if (stage.cameras.length < (rubric.minCameras ?? 0))
    failures.push(`cameras ${stage.cameras.length}/${rubric.minCameras}`);
  // `minCapturedShots` remains parseable only for sealed Attempt compatibility.
  // Action capture evidence lives in submitted artifacts and trusted readback,
  // never in the mutable source Stage's legacy `shots` collection.
  const sequenceShots = stage.shotSequence?.length ?? 0;
  if (sequenceShots < (rubric.minSequenceShots ?? 0)) {
    failures.push(`sequence shots ${sequenceShots}/${rubric.minSequenceShots}`);
  }
  if (animatedTracks < (rubric.minAnimatedTracks ?? 0))
    failures.push(
      `animated tracks ${animatedTracks}/${rubric.minAnimatedTracks}`,
    );
  if (actionClips.length < (rubric.minActionClips ?? 0))
    failures.push(
      `action clips ${actionClips.length}/${rubric.minActionClips}`,
    );
  if (mannequins < (rubric.minMannequins ?? 0))
    failures.push(`mannequins ${mannequins}/${rubric.minMannequins}`);
  if (rubric.requireMannequin && !mannequin) failures.push("mannequin missing");
  const missingActions = (rubric.requiredActions ?? []).filter(
    (action) => !actions.has(action),
  );
  if (missingActions.length > 0)
    failures.push(`missing actions: ${missingActions.join(", ")}`);

  const metrics = {
    objects: stage.objects.length,
    cameras: stage.cameras.length,
    sequenceShots,
    animatedTracks,
    actionClips: actionClips.length,
    mannequins,
    mannequin,
  };
  return checkResult(
    rubric,
    failures.length === 0,
    failures.length === 0
      ? "Director Stage requirements satisfied"
      : failures.join("; "),
    metrics,
  );
}

function timelineItems(
  timeline: TimelineData,
): TimelineData["tracks"][number]["items"] {
  return timeline.tracks.flatMap((track) =>
    Array.isArray(track.items) ? track.items : [],
  );
}

function evaluateTimeline(
  rubric: Extract<ArtifactRubric, { type: "timeline" }>,
  context: EvaluationContext,
): EvaluationCheck {
  const parsed = parseTimeline(context, rubric.artifactId);
  if (!parsed.ok) return checkResult(rubric, false, parsed.error);
  const items = timelineItems(parsed.value);
  const itemTypes = new Set(items.map((item) => item.type));
  const missingTypes = (rubric.requiredItemTypes ?? []).filter(
    (type) => !itemTypes.has(type),
  );
  const failures: string[] = [];
  if (parsed.value.tracks.length < (rubric.minTracks ?? 0))
    failures.push(`tracks ${parsed.value.tracks.length}/${rubric.minTracks}`);
  if (items.length < (rubric.minItems ?? 0))
    failures.push(`items ${items.length}/${rubric.minItems}`);
  const durationInFrames =
    typeof parsed.value.durationInFrames === "number"
      ? parsed.value.durationInFrames
      : 0;
  if (durationInFrames < (rubric.minDurationInFrames ?? 0)) {
    failures.push(
      `duration ${durationInFrames}/${rubric.minDurationInFrames} frames`,
    );
  }
  if (missingTypes.length > 0)
    failures.push(`missing item types: ${missingTypes.join(", ")}`);
  return checkResult(
    rubric,
    failures.length === 0,
    failures.length === 0
      ? "Timeline requirements satisfied"
      : failures.join("; "),
    {
      tracks: parsed.value.tracks.length,
      items: items.length,
      durationInFrames,
      itemTypes: [...itemTypes].sort(),
    },
  );
}

type MediaProbe = {
  streams?: Array<{
    codec_type?: string;
    width?: number;
    height?: number;
    duration?: string;
  }>;
  format?: { duration?: string };
};

type DecodedVisualFrame = {
  artifactId: string;
  width: number;
  height: number;
  sampleWidth: number;
  sampleHeight: number;
  rgb: Buffer;
};

async function decodeVisualFrame(
  artifactId: string,
  path: string,
): Promise<ParsedArtifact<DecodedVisualFrame>> {
  const ffprobe =
    process.env.CLASH_FFPROBE_PATH ?? process.env.FFPROBE_PATH ?? "ffprobe";
  const ffmpeg =
    process.env.CLASH_FFMPEG_PATH ?? process.env.FFMPEG_PATH ?? "ffmpeg";
  try {
    const probed = await execFileAsync(
      ffprobe,
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height",
        "-of",
        "json",
        path,
      ],
      { encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024 },
    );
    const parsed = JSON.parse(probed.stdout) as MediaProbe;
    const stream = parsed.streams?.find(
      (candidate) =>
        typeof candidate.width === "number" &&
        typeof candidate.height === "number",
    );
    if (!stream?.width || !stream.height) {
      return {
        ok: false,
        error: `Image artifact '${artifactId}' has no decodable dimensions`,
      };
    }
    const sampleWidth = 64;
    const sampleHeight = 64;
    const decoded = await execFileAsync(
      ffmpeg,
      [
        "-v",
        "error",
        "-i",
        path,
        "-frames:v",
        "1",
        "-vf",
        `scale=${sampleWidth}:${sampleHeight}:flags=neighbor`,
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "pipe:1",
      ],
      {
        encoding: "buffer",
        timeout: 30_000,
        maxBuffer: sampleWidth * sampleHeight * 3 + 1024,
      },
    );
    const rgb = Buffer.isBuffer(decoded.stdout)
      ? decoded.stdout
      : Buffer.from(decoded.stdout);
    if (rgb.byteLength !== sampleWidth * sampleHeight * 3) {
      return {
        ok: false,
        error: `Image artifact '${artifactId}' did not decode to one RGB frame`,
      };
    }
    return {
      ok: true,
      value: {
        artifactId,
        width: stream.width,
        height: stream.height,
        sampleWidth,
        sampleHeight,
        rgb,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: `Unable to decode image artifact '${artifactId}': ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function frameMeanAbsoluteDifference(left: Buffer, right: Buffer): number {
  if (left.byteLength !== right.byteLength || left.byteLength === 0) return 1;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference += Math.abs(left[index]! - right[index]!);
  }
  return difference / (left.byteLength * 255);
}

function foregroundEdgeRatio(
  frame: DecodedVisualFrame,
  marginPercent: number,
  backgroundTolerance: number,
): number {
  const { rgb, sampleWidth: width, sampleHeight: height } = frame;
  const pixel = (x: number, y: number): [number, number, number] => {
    const offset = (y * width + x) * 3;
    return [rgb[offset]!, rgb[offset + 1]!, rgb[offset + 2]!];
  };
  const corners = [
    pixel(0, 0),
    pixel(width - 1, 0),
    pixel(0, height - 1),
    pixel(width - 1, height - 1),
  ];
  const background = [0, 1, 2].map(
    (channel) =>
      corners.reduce((sum, color) => sum + color[channel]!, 0) / corners.length,
  );
  const marginX = Math.max(1, Math.round(width * marginPercent));
  const marginY = Math.max(1, Math.round(height * marginPercent));
  let edgePixels = 0;
  let foregroundPixels = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (
        x >= marginX &&
        x < width - marginX &&
        y >= marginY &&
        y < height - marginY
      )
        continue;
      edgePixels += 1;
      const color = pixel(x, y);
      if (
        color.some(
          (value, channel) =>
            Math.abs(value - background[channel]!) > backgroundTolerance,
        )
      ) {
        foregroundPixels += 1;
      }
    }
  }
  return edgePixels > 0 ? foregroundPixels / edgePixels : 0;
}

function foregroundRatio(
  frame: DecodedVisualFrame,
  backgroundTolerance: number,
): number {
  const { rgb, sampleWidth: width, sampleHeight: height } = frame;
  const pixel = (x: number, y: number): [number, number, number] => {
    const offset = (y * width + x) * 3;
    return [rgb[offset]!, rgb[offset + 1]!, rgb[offset + 2]!];
  };
  const corners = [
    pixel(0, 0),
    pixel(width - 1, 0),
    pixel(0, height - 1),
    pixel(width - 1, height - 1),
  ];
  const background = [0, 1, 2].map(
    (channel) =>
      corners.reduce((sum, color) => sum + color[channel]!, 0) / corners.length,
  );
  let foregroundPixels = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const color = pixel(x, y);
      if (
        color.some(
          (value, channel) =>
            Math.abs(value - background[channel]!) > backgroundTolerance,
        )
      ) {
        foregroundPixels += 1;
      }
    }
  }
  return foregroundPixels / (width * height);
}

async function evaluateVisualFrames(
  rubric: Extract<ArtifactRubric, { type: "visual-frames" }>,
  context: EvaluationContext,
): Promise<EvaluationCheck> {
  const decoded: DecodedVisualFrame[] = [];
  const failures: string[] = [];
  for (const artifactId of rubric.artifactIds) {
    const artifact = requiredArtifact(context, artifactId, "image");
    if (!artifact.ok || !artifact.value.absolutePath) {
      failures.push(
        artifact.ok
          ? `Image '${artifactId}' has no safe local path`
          : artifact.error,
      );
      continue;
    }
    const frame = await decodeVisualFrame(
      artifactId,
      artifact.value.absolutePath,
    );
    if (!frame.ok) {
      failures.push(frame.error);
      continue;
    }
    if (
      frame.value.width !== rubric.width ||
      frame.value.height !== rubric.height
    ) {
      failures.push(
        `Image '${artifactId}' dimensions ${frame.value.width}x${frame.value.height}/${rubric.width}x${rubric.height}`,
      );
    }
    decoded.push(frame.value);
  }

  const pairDifferences: number[] = [];
  for (let left = 0; left < decoded.length; left += 1) {
    for (let right = left + 1; right < decoded.length; right += 1) {
      pairDifferences.push(
        frameMeanAbsoluteDifference(decoded[left]!.rgb, decoded[right]!.rgb),
      );
    }
  }
  const distinctPairs = pairDifferences.filter(
    (difference) => difference >= rubric.minMeanAbsoluteDifference,
  ).length;
  if (distinctPairs < rubric.minDistinctPairs) {
    failures.push(
      `distinct frame pairs ${distinctPairs}/${rubric.minDistinctPairs}`,
    );
  }

  const foregroundRatios = rubric.foregroundCoverage
    ? decoded.map((frame) =>
        foregroundRatio(frame, rubric.foregroundCoverage!.backgroundTolerance),
      )
    : [];
  if (rubric.foregroundCoverage) {
    const sparse = decoded.filter(
      (_frame, index) =>
        foregroundRatios[index]! < rubric.foregroundCoverage!.minRatio,
    );
    if (sparse.length > 0) {
      failures.push(
        `foreground coverage below ${rubric.foregroundCoverage.minRatio} in: ${sparse
          .map(
            (frame) =>
              `${frame.artifactId} (${foregroundRatios[decoded.indexOf(frame)]!.toFixed(5)})`,
          )
          .join(", ")}`,
      );
    }
  }

  const edgeRatios = rubric.safeArea
    ? decoded.map((frame) =>
        foregroundEdgeRatio(
          frame,
          rubric.safeArea!.marginPercent,
          rubric.safeArea!.backgroundTolerance,
        ),
      )
    : [];
  if (rubric.safeArea) {
    const clipped = decoded.filter(
      (_frame, index) =>
        edgeRatios[index]! > rubric.safeArea!.maxForegroundEdgeRatio,
    );
    if (clipped.length > 0) {
      failures.push(
        `safe-area edge contains foreground in: ${clipped.map((frame) => frame.artifactId).join(", ")}`,
      );
    }
  }

  return checkResult(
    rubric,
    failures.length === 0,
    failures.length === 0
      ? "Visual frame evidence is decoded, distinct, and safely composed"
      : failures.join("; "),
    {
      decodedFrames: decoded.length,
      distinctPairs,
      pairDifferences: pairDifferences.map((value) => value.toFixed(5)),
      minForegroundRatio:
        foregroundRatios.length > 0 ? Math.min(...foregroundRatios) : 0,
      maxForegroundEdgeRatio:
        edgeRatios.length > 0 ? Math.max(...edgeRatios) : 0,
    },
  );
}

async function evaluateMedia(
  rubric: Extract<ArtifactRubric, { type: "media" }>,
  context: EvaluationContext,
): Promise<EvaluationCheck> {
  const artifact = requiredArtifact(context, rubric.artifactId);
  if (!artifact.ok) return checkResult(rubric, false, artifact.error);
  if (!artifact.value.absolutePath) {
    return checkResult(
      rubric,
      false,
      `Artifact '${rubric.artifactId}' has no safe local path`,
    );
  }

  const ffprobe =
    process.env.CLASH_FFPROBE_PATH ?? process.env.FFPROBE_PATH ?? "ffprobe";
  let probe: MediaProbe;
  try {
    const result = await execFileAsync(
      ffprobe,
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration:stream=codec_type,width,height,duration",
        "-of",
        "json",
        artifact.value.absolutePath,
      ],
      { encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024 },
    );
    probe = JSON.parse(result.stdout) as MediaProbe;
  } catch (error) {
    return checkResult(
      rubric,
      false,
      `Unable to decode media artifact '${rubric.artifactId}' with ffprobe: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const streams = probe.streams ?? [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");
  const durationCandidates = [
    probe.format?.duration,
    ...streams.map((stream) => stream.duration),
  ]
    .map(Number)
    .filter((value) => Number.isFinite(value) && value >= 0);
  const durationSeconds =
    durationCandidates.length > 0 ? Math.max(...durationCandidates) : 0;
  const failures: string[] = [];
  if (rubric.requireVideo && !video) failures.push("video stream missing");
  if (rubric.requireAudio && !audio) failures.push("audio stream missing");
  if (rubric.width !== undefined && video?.width !== rubric.width) {
    failures.push(`width ${video?.width ?? "missing"}/${rubric.width}`);
  }
  if (rubric.height !== undefined && video?.height !== rubric.height) {
    failures.push(`height ${video?.height ?? "missing"}/${rubric.height}`);
  }
  if (
    rubric.minDurationSeconds !== undefined &&
    durationSeconds < rubric.minDurationSeconds
  ) {
    failures.push(
      `duration ${durationSeconds}s is below ${rubric.minDurationSeconds}s`,
    );
  }
  if (
    rubric.maxDurationSeconds !== undefined &&
    durationSeconds > rubric.maxDurationSeconds
  ) {
    failures.push(
      `duration ${durationSeconds}s exceeds ${rubric.maxDurationSeconds}s`,
    );
  }
  return checkResult(
    rubric,
    failures.length === 0,
    failures.length === 0
      ? "Media requirements satisfied"
      : failures.join("; "),
    {
      width: video?.width ?? 0,
      height: video?.height ?? 0,
      durationSeconds,
      video: Boolean(video),
      audio: Boolean(audio),
    },
  );
}

function evaluateMgCharacter(
  rubric: Extract<ArtifactRubric, { type: "mg-character" }>,
  context: EvaluationContext,
): EvaluationCheck {
  const parsed = parseRemotionComponent(context, rubric.artifactId);
  if (!parsed.ok) return checkResult(rubric, false, parsed.error);
  const component = parsed.value;
  const layerIds = new Set(component.bodyParts);
  const missingBodyParts = (rubric.requiredBodyParts ?? []).filter(
    (id) => !layerIds.has(canonicalBodyPartId(id)),
  );
  const missingApis = (rubric.requiredRemotionApis ?? []).filter(
    (api) =>
      !new RegExp(
        `\\b${api.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\b`,
        "u",
      ).test(component.source),
  );
  const failures: string[] = [];
  if (component.bytes < (rubric.minSourceBytes ?? 0)) {
    failures.push(`source bytes ${component.bytes}/${rubric.minSourceBytes}`);
  }
  if (missingBodyParts.length > 0)
    failures.push(`missing body parts: ${missingBodyParts.join(", ")}`);
  if (missingApis.length > 0)
    failures.push(`missing Remotion APIs: ${missingApis.join(", ")}`);
  return checkResult(
    rubric,
    failures.length === 0,
    failures.length === 0
      ? "Remotion MG character source requirements satisfied"
      : failures.join("; "),
    {
      sourceBytes: component.bytes,
      bodyParts: [...layerIds].sort(),
      requiredRemotionApis: rubric.requiredRemotionApis ?? [],
    },
  );
}

function canonicalBodyPartId(value: string): string {
  const tokens = value
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter(Boolean);
  const part = ["arm", "leg", "head", "torso"].find((candidate) =>
    tokens.includes(candidate),
  );
  if (!part) return tokens.join("-");
  if (part === "head" || part === "torso") return part;
  const side = ["left", "right"].find((candidate) =>
    tokens.includes(candidate),
  );
  return side ? `${part}-${side}` : part;
}

function collectStringField(
  items: Array<Record<string, unknown>>,
  fields: string[],
): Set<string> {
  const values = new Set<string>();
  for (const item of items) {
    for (const field of fields) {
      if (typeof item[field] === "string" && item[field])
        values.add(item[field]);
    }
  }
  return values;
}

function evaluateMixedLineage(
  rubric: Extract<ArtifactRubric, { type: "mixed-lineage" }>,
  context: EvaluationContext,
): EvaluationCheck {
  const director = parseDirector(context, rubric.directorArtifactId);
  if (!director.ok) return checkResult(rubric, false, director.error);
  const timeline = parseTimeline(context, rubric.timelineArtifactId);
  if (!timeline.ok) return checkResult(rubric, false, timeline.error);
  const component = parseRemotionComponent(context, rubric.componentArtifactId);
  if (!component.ok) return checkResult(rubric, false, component.error);

  const items = timelineItems(timeline.value);
  const timelineAssetIds = collectStringField(items, [
    "assetId",
    "sourceAssetId",
    "derivedAssetId",
  ]);
  const remotionItems = items.filter(
    (item) =>
      item.type === "composition" &&
      item.runtime === "remotion" &&
      typeof item.sourceNodeId === "string" &&
      item.sourceNodeId.length > 0,
  );
  const componentLinked = remotionItems.length > 0;
  const failures: string[] = [];
  if (timelineAssetIds.size === 0)
    failures.push("Timeline does not reference a Project Asset output");
  if (!componentLinked)
    failures.push(
      "Timeline does not contain a live Remotion sourceNodeId reference",
    );
  return checkResult(
    rubric,
    failures.length === 0,
    failures.length === 0
      ? "Timeline Project Asset and Remotion source references are connected"
      : failures.join("; "),
    {
      timelineAssetRefs: timelineAssetIds.size,
      componentLinked,
      remotionItems: remotionItems.length,
    },
  );
}

async function evaluateRubric(
  rubric: ArtifactRubric,
  context: EvaluationContext,
): Promise<EvaluationCheck> {
  switch (rubric.type) {
    case "artifact-exists":
      return evaluateArtifactExists(rubric, context);
    case "artifact-set":
      return evaluateArtifactSet(rubric, context);
    case "director-stage":
      return evaluateDirectorStage(rubric, context);
    case "timeline":
      return evaluateTimeline(rubric, context);
    case "mg-character":
      return evaluateMgCharacter(rubric, context);
    case "media":
      return evaluateMedia(rubric, context);
    case "visual-frames":
      return evaluateVisualFrames(rubric, context);
    case "mixed-lineage":
      return evaluateMixedLineage(rubric, context);
  }
}

function failedChecks(
  benchmark: ArtifactBenchmarkCase,
  detail: string,
): EvaluationCheck[] {
  return benchmark.rubric.map((rubric) => checkResult(rubric, false, detail));
}

function roundedScore(value: number): number {
  return Math.round(value * 100) / 100;
}

function evaluateOutcomeGate(
  benchmark: ArtifactBenchmarkCase,
  submission: LoadedSubmission,
): ArtifactEvaluationReport["outcomeGate"] {
  const byId = new Map(
    submission.artifacts.map((artifact) => [artifact.descriptor.id, artifact]),
  );
  const missingArtifactIds: string[] = [];
  const invalidArtifactIds: string[] = [];
  for (const deliverable of benchmark.outcome.deliverables) {
    const artifact = byId.get(deliverable.artifactId);
    if (!artifact) {
      missingArtifactIds.push(deliverable.artifactId);
      continue;
    }
    if (
      artifact.descriptor.kind !== deliverable.kind ||
      artifact.error ||
      !artifact.evidence
    ) {
      invalidArtifactIds.push(deliverable.artifactId);
    }
  }
  const passed =
    missingArtifactIds.length === 0 && invalidArtifactIds.length === 0;
  const details: string[] = [];
  if (missingArtifactIds.length > 0)
    details.push(`missing deliverables: ${missingArtifactIds.join(", ")}`);
  if (invalidArtifactIds.length > 0)
    details.push(`invalid deliverables: ${invalidArtifactIds.join(", ")}`);
  return {
    status: passed ? "pass" : "fail",
    detail: passed
      ? "All outcome deliverables are declared, readable, and have the required kind"
      : details.join("; "),
    missingArtifactIds,
    invalidArtifactIds,
  };
}

const unavailableOutcomeGate: ArtifactEvaluationReport["outcomeGate"] = {
  status: "fail",
  detail: "Outcome deliverables cannot be verified without a valid submission",
  missingArtifactIds: [],
  invalidArtifactIds: [],
};

export async function evaluateSubmission(
  input: EvaluateSubmissionInput,
): Promise<ArtifactEvaluationReport> {
  const benchmarkResult = ArtifactBenchmarkCaseSchema.safeParse(
    input.benchmark,
  );
  if (!benchmarkResult.success) {
    return {
      schemaVersion: 1,
      benchmarkId: input.benchmark?.id ?? "invalid-benchmark",
      taskId: null,
      status: "fail",
      score: 0,
      checks: [],
      artifacts: [],
      outcomeGate: unavailableOutcomeGate,
      error: `Invalid benchmark: ${formatIssues(benchmarkResult.error.issues)}`,
    };
  }
  const benchmark = benchmarkResult.data;
  const submission = await loadSubmission(input.workspace);
  if (!submission.submission) {
    return {
      schemaVersion: 1,
      benchmarkId: benchmark.id,
      taskId: null,
      status: "fail",
      score: 0,
      checks: failedChecks(
        benchmark,
        submission.error ?? "Submission could not be loaded",
      ),
      artifacts: [],
      outcomeGate: {
        ...unavailableOutcomeGate,
        missingArtifactIds: benchmark.outcome.deliverables.map(
          (deliverable) => deliverable.artifactId,
        ),
      },
      error: submission.error,
    };
  }

  const evidence = submission.artifacts.flatMap((artifact) =>
    artifact.evidence ? [artifact.evidence] : [],
  );
  if (submission.submission.taskId !== benchmark.id) {
    const detail = `Submission taskId '${submission.submission.taskId}' does not match benchmark '${benchmark.id}'`;
    return {
      schemaVersion: 1,
      benchmarkId: benchmark.id,
      taskId: submission.submission.taskId,
      status: "fail",
      score: 0,
      checks: failedChecks(benchmark, detail),
      artifacts: evidence,
      outcomeGate: evaluateOutcomeGate(benchmark, submission),
      error: detail,
    };
  }

  const context: EvaluationContext = {
    submission,
    artifactById: new Map(
      submission.artifacts.map((artifact) => [
        artifact.descriptor.id,
        artifact,
      ]),
    ),
    directorCache: new Map(),
    timelineCache: new Map(),
    remotionComponentCache: new Map(),
  };
  const checks = await Promise.all(
    benchmark.rubric.map((rubric) => evaluateRubric(rubric, context)),
  );
  const totalWeight = checks.reduce((sum, check) => sum + check.weight, 0);
  const awardedWeight = checks.reduce(
    (sum, check) => sum + check.awardedWeight,
    0,
  );
  const score =
    totalWeight > 0 ? roundedScore((awardedWeight / totalWeight) * 100) : 0;
  const requiredGatePassed = checks.every(
    (check) => !check.required || check.status === "pass",
  );
  const outcomeGate = evaluateOutcomeGate(benchmark, submission);
  return {
    schemaVersion: 1,
    benchmarkId: benchmark.id,
    taskId: submission.submission.taskId,
    status:
      requiredGatePassed &&
      outcomeGate.status === "pass" &&
      score >= benchmark.passScore
        ? "pass"
        : "fail",
    score,
    checks,
    artifacts: evidence,
    outcomeGate,
  };
}
