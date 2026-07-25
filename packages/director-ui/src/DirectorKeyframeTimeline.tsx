import React, { useState } from "react";
import type {
  DirectorStageActionClip,
  DirectorStageSequenceShot,
  DirectorStageState,
} from "@clash/shared-types";
import {
  TimelineRuler,
  frameToPixels,
  getPixelsPerFrame,
} from "@master-clash/remotion-ui";
import { directorTokens } from "./tokens";

export interface DirectorKeyframeTimelineProps {
  animation: NonNullable<DirectorStageState["animation"]>;
  playheadSeconds: number;
  zoom: number;
  viewportWidth: number;
  targetLabels?: Record<string, string>;
  onSeek: (timeSeconds: number) => void;
  selectedKeyframeId?: string;
  onSelectKeyframe?: (trackId: string, keyframeId: string) => void;
  onChangeKeyframe?: (trackId: string, keyframeId: string, timeSeconds: number) => void;
  selectedActionClipId?: string;
  onSelectActionClip?: (clipId: string) => void;
  onChangeActionClip?: (
    clipId: string,
    timing: Pick<DirectorStageActionClip, "startTime" | "durationSeconds">,
  ) => void;
  shots?: DirectorStageSequenceShot[];
  selectedShotId?: string;
  selectedShotIds?: string[];
  primaryShotId?: string;
  onSelectShot?: (
    shotId: string,
    gesture: { toggle: boolean; range: boolean },
  ) => void;
  onChangeShot?: (
    shotId: string,
    timing: Pick<DirectorStageSequenceShot, "startTime" | "durationSeconds">,
  ) => void;
}

const LABEL_WIDTH = 144;
const ROW_HEIGHT = 32;

export type DirectorActionClipEditMode = "move" | "trim-start" | "trim-end";
export type DirectorSequenceShotEditMode = DirectorActionClipEditMode;

export interface DirectorShotSelection {
  selectedShotIds: string[];
  primaryShotId?: string;
  anchorShotId?: string;
}

export function updateDirectorShotSelection(input: {
  orderedShotIds: string[];
  selectedShotIds: string[];
  clickedShotId: string;
  toggle?: boolean;
  range?: boolean;
  anchorShotId?: string;
}): DirectorShotSelection {
  const orderedShotIds = [...new Set(input.orderedShotIds)];
  if (!orderedShotIds.includes(input.clickedShotId)) {
    return {
      selectedShotIds: input.selectedShotIds.filter((id) => orderedShotIds.includes(id)),
      primaryShotId: input.selectedShotIds.at(-1),
      anchorShotId: input.anchorShotId,
    };
  }
  if (input.range) {
    const anchorShotId = orderedShotIds.includes(input.anchorShotId ?? "")
      ? input.anchorShotId!
      : input.clickedShotId;
    const anchorIndex = orderedShotIds.indexOf(anchorShotId);
    const clickedIndex = orderedShotIds.indexOf(input.clickedShotId);
    const rangeIds = orderedShotIds.slice(
      Math.min(anchorIndex, clickedIndex),
      Math.max(anchorIndex, clickedIndex) + 1,
    );
    return {
      selectedShotIds: input.toggle
        ? orderedShotIds.filter((id) =>
            input.selectedShotIds.includes(id) || rangeIds.includes(id))
        : rangeIds,
      primaryShotId: input.clickedShotId,
      anchorShotId,
    };
  }
  if (input.toggle) {
    const selected = new Set(input.selectedShotIds);
    if (selected.has(input.clickedShotId)) selected.delete(input.clickedShotId);
    else selected.add(input.clickedShotId);
    const selectedShotIds = orderedShotIds.filter((id) => selected.has(id));
    return {
      selectedShotIds,
      primaryShotId: selected.has(input.clickedShotId)
        ? input.clickedShotId
        : selectedShotIds.at(-1),
      anchorShotId: input.clickedShotId,
    };
  }
  return {
    selectedShotIds: [input.clickedShotId],
    primaryShotId: input.clickedShotId,
    anchorShotId: input.clickedShotId,
  };
}

function editDirectorTimedBlock({
  clip,
  mode,
  deltaSeconds,
  timelineDurationSeconds,
  fps,
}: {
  clip: Pick<DirectorStageActionClip, "startTime" | "durationSeconds">;
  mode: DirectorActionClipEditMode;
  deltaSeconds: number;
  timelineDurationSeconds: number;
  fps: number;
}): Pick<DirectorStageActionClip, "startTime" | "durationSeconds"> {
  const frameSeconds = 1 / Math.max(1, fps);
  const snappedDelta = Math.round(deltaSeconds * fps) / fps;
  if (mode === "move") {
    return {
      startTime: Math.min(
        Math.max(0, timelineDurationSeconds - clip.durationSeconds),
        Math.max(0, clip.startTime + snappedDelta),
      ),
      durationSeconds: clip.durationSeconds,
    };
  }
  if (mode === "trim-start") {
    const endTime = clip.startTime + clip.durationSeconds;
    const startTime = Math.min(
      endTime - frameSeconds,
      Math.max(0, clip.startTime + snappedDelta),
    );
    return { startTime, durationSeconds: endTime - startTime };
  }
  return {
    startTime: clip.startTime,
    durationSeconds: Math.min(
      timelineDurationSeconds - clip.startTime,
      Math.max(frameSeconds, clip.durationSeconds + snappedDelta),
    ),
  };
}

export function editDirectorKeyframeTime({
  originalTime,
  deltaSeconds,
  timelineDurationSeconds,
  fps,
}: {
  originalTime: number;
  deltaSeconds: number;
  timelineDurationSeconds: number;
  fps: number;
}): number {
  const snappedTime = Math.round((originalTime + deltaSeconds) * fps) / Math.max(1, fps);
  return Math.min(timelineDurationSeconds, Math.max(0, snappedTime));
}

export function editDirectorActionClipTiming(input: {
  clip: DirectorStageActionClip;
  mode: DirectorActionClipEditMode;
  deltaSeconds: number;
  timelineDurationSeconds: number;
  fps: number;
}): Pick<DirectorStageActionClip, "startTime" | "durationSeconds"> {
  return editDirectorTimedBlock(input);
}

export function editDirectorSequenceShotTiming({
  shot,
  mode,
  deltaSeconds,
  timelineDurationSeconds,
  fps,
}: {
  shot: DirectorStageSequenceShot;
  mode: DirectorSequenceShotEditMode;
  deltaSeconds: number;
  timelineDurationSeconds: number;
  fps: number;
}): Pick<DirectorStageSequenceShot, "startTime" | "durationSeconds"> {
  return editDirectorTimedBlock({
    clip: shot,
    mode,
    deltaSeconds,
    timelineDurationSeconds,
    fps,
  });
}

const ACTION_LABELS: Record<DirectorStageActionClip["action"], string> = {
  idle: "Idle",
  walk: "Walk",
  run: "Run",
  sit: "Sit",
  crouch: "Crouch",
  kneel: "Kneel",
  wave: "Wave",
  point: "Point",
  think: "Think",
  "hands-up": "Hands up",
  interact: "Interact",
  ride: "Ride",
  talk: "Talk",
  dance: "Dance",
  jump: "Jump",
  roll: "Roll",
  pickup: "Pick up",
  push: "Push",
  punch: "Punch",
  swim: "Swim",
  drive: "Drive",
  death: "Death",
};

type ActionDragState = {
  clip: DirectorStageActionClip;
  mode: DirectorActionClipEditMode;
  startClientX: number;
  preview?: Pick<DirectorStageActionClip, "startTime" | "durationSeconds">;
};

type KeyframeDragState = {
  trackId: string;
  keyframeId: string;
  originalTime: number;
  startClientX: number;
  previewTime?: number;
};

type ShotDragState = {
  shot: DirectorStageSequenceShot;
  mode: DirectorSequenceShotEditMode;
  startClientX: number;
  preview?: Pick<DirectorStageSequenceShot, "startTime" | "durationSeconds">;
};

export function DirectorKeyframeTimeline({
  animation,
  playheadSeconds,
  zoom,
  viewportWidth,
  targetLabels,
  onSeek,
  selectedKeyframeId,
  onSelectKeyframe,
  onChangeKeyframe,
  selectedActionClipId,
  onSelectActionClip,
  onChangeActionClip,
  shots,
  selectedShotId,
  selectedShotIds,
  primaryShotId,
  onSelectShot,
  onChangeShot,
}: DirectorKeyframeTimelineProps): React.ReactElement {
  const durationInFrames = Math.max(1, Math.round(animation.durationSeconds * animation.fps));
  const pixelsPerFrame = getPixelsPerFrame(zoom);
  const contentWidth = Math.max(
    viewportWidth - LABEL_WIDTH,
    frameToPixels(durationInFrames, pixelsPerFrame),
  );
  const [actionDrag, setActionDrag] = useState<ActionDragState>();
  const [keyframeDrag, setKeyframeDrag] = useState<KeyframeDragState>();
  const [shotDrag, setShotDrag] = useState<ShotDragState>();
  const pixelsPerSecond = animation.fps * pixelsPerFrame;
  const actionGroups = [...new Set(
    (animation.actionClips ?? []).map((clip) => `${clip.targetId}:${clip.layer}`),
  )].map((key) => {
    const separator = key.lastIndexOf(":");
    return {
      key,
      targetId: key.slice(0, separator),
      layer: key.slice(separator + 1) as DirectorStageActionClip["layer"],
    };
  }).sort((left, right) =>
    left.targetId.localeCompare(right.targetId) ||
    (left.layer === "full-body" ? -1 : 1),
  );
  const editFromPointer = (
    drag: ActionDragState,
    clientX: number,
  ): Pick<DirectorStageActionClip, "startTime" | "durationSeconds"> =>
    editDirectorActionClipTiming({
      clip: drag.clip,
      mode: drag.mode,
      deltaSeconds: (clientX - drag.startClientX) / pixelsPerSecond,
      timelineDurationSeconds: animation.durationSeconds,
      fps: animation.fps,
    });
  const beginActionDrag = (
    event: React.PointerEvent<HTMLElement>,
    clip: DirectorStageActionClip,
    mode: DirectorActionClipEditMode,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    onSelectActionClip?.(clip.id);
    setActionDrag({ clip, mode, startClientX: event.clientX });
  };
  const moveActionDrag = (event: React.PointerEvent<HTMLElement>, clipId: string) => {
    if (!actionDrag || actionDrag.clip.id !== clipId) return;
    setActionDrag({
      ...actionDrag,
      preview: editFromPointer(actionDrag, event.clientX),
    });
  };
  const finishActionDrag = (event: React.PointerEvent<HTMLElement>, clipId: string) => {
    if (!actionDrag || actionDrag.clip.id !== clipId) return;
    const timing = editFromPointer(actionDrag, event.clientX);
    onChangeActionClip?.(clipId, timing);
    setActionDrag(undefined);
  };
  const keyframeTimeFromPointer = (drag: KeyframeDragState, clientX: number) =>
    editDirectorKeyframeTime({
      originalTime: drag.originalTime,
      deltaSeconds: (clientX - drag.startClientX) / pixelsPerSecond,
      timelineDurationSeconds: animation.durationSeconds,
      fps: animation.fps,
    });
  const beginKeyframeDrag = (
    event: React.PointerEvent<HTMLButtonElement>,
    trackId: string,
    keyframeId: string,
    originalTime: number,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    onSelectKeyframe?.(trackId, keyframeId);
    setKeyframeDrag({ trackId, keyframeId, originalTime, startClientX: event.clientX });
  };
  const moveKeyframeDrag = (event: React.PointerEvent<HTMLButtonElement>, keyframeId: string) => {
    if (!keyframeDrag || keyframeDrag.keyframeId !== keyframeId) return;
    setKeyframeDrag({
      ...keyframeDrag,
      previewTime: keyframeTimeFromPointer(keyframeDrag, event.clientX),
    });
  };
  const finishKeyframeDrag = (event: React.PointerEvent<HTMLButtonElement>, keyframeId: string) => {
    if (!keyframeDrag || keyframeDrag.keyframeId !== keyframeId) return;
    onChangeKeyframe?.(
      keyframeDrag.trackId,
      keyframeDrag.keyframeId,
      keyframeTimeFromPointer(keyframeDrag, event.clientX),
    );
    setKeyframeDrag(undefined);
  };
  const editShotFromPointer = (
    drag: ShotDragState,
    clientX: number,
  ): Pick<DirectorStageSequenceShot, "startTime" | "durationSeconds"> =>
    editDirectorSequenceShotTiming({
      shot: drag.shot,
      mode: drag.mode,
      deltaSeconds: (clientX - drag.startClientX) / pixelsPerSecond,
      timelineDurationSeconds: animation.durationSeconds,
      fps: animation.fps,
    });
  const beginShotDrag = (
    event: React.PointerEvent<HTMLElement>,
    shot: DirectorStageSequenceShot,
    mode: DirectorSequenceShotEditMode,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    onSelectShot?.(shot.id, {
      toggle: event.metaKey || event.ctrlKey,
      range: event.shiftKey,
    });
    setShotDrag({ shot, mode, startClientX: event.clientX });
  };
  const moveShotDrag = (event: React.PointerEvent<HTMLElement>, shotId: string) => {
    if (!shotDrag || shotDrag.shot.id !== shotId) return;
    setShotDrag({
      ...shotDrag,
      preview: editShotFromPointer(shotDrag, event.clientX),
    });
  };
  const finishShotDrag = (event: React.PointerEvent<HTMLElement>, shotId: string) => {
    if (!shotDrag || shotDrag.shot.id !== shotId) return;
    onChangeShot?.(shotId, editShotFromPointer(shotDrag, event.clientX));
    setShotDrag(undefined);
  };
  const usesSequenceShots = shots !== undefined;
  const hasShotLane = usesSequenceShots
    ? shots.length > 0
    : (animation.cameraCues?.length ?? 0) > 0;

  return (
    <section
      data-director-keyframe-timeline=""
      style={{
        position: "relative",
        display: "grid",
        gridTemplateColumns: `${LABEL_WIDTH}px minmax(0, 1fr)`,
        overflow: "hidden",
        background: directorTokens.timelineSurface,
        color: directorTokens.timelineLabel,
      }}
    >
      <div
        aria-hidden="true"
        style={{ borderRight: `1px solid ${directorTokens.timelineDivider}` }}
      />
      <TimelineRuler
        durationInFrames={durationInFrames}
        contentEndInFrames={durationInFrames}
        pixelsPerFrame={pixelsPerFrame}
        fps={animation.fps}
        onSeek={(frame) => onSeek(frame / animation.fps)}
        zoom={zoom}
        scrollLeft={0}
        viewportWidth={Math.max(0, viewportWidth - LABEL_WIDTH)}
        tokens={{
          background: directorTokens.timelineSurface,
          minorTick: directorTokens.timelineDivider,
          majorTick: directorTokens.timelineMuted,
          label: directorTokens.timelineLabel,
        }}
      />
      {(animation.storyBeats?.length ?? 0) > 0 ? (
        <>
          <div
            data-director-story-track=""
            style={{
              height: ROW_HEIGHT,
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "0 10px",
              borderTop: `1px solid ${directorTokens.timelineDivider}`,
              borderRight: `1px solid ${directorTokens.timelineDivider}`,
              fontSize: 11,
            }}
          >
            <strong>Story</strong>
            <span style={{ color: directorTokens.timelineMuted }}>beats</span>
          </div>
          <div
            data-director-story-lane=""
            style={{
              position: "relative",
              width: contentWidth,
              height: ROW_HEIGHT,
              borderTop: `1px solid ${directorTokens.timelineDivider}`,
            }}
          >
            {animation.storyBeats?.map((beat) => (
              <button
                key={beat.id}
                type="button"
                data-director-story-beat={beat.id}
                aria-label={`${beat.title} story beat at ${beat.startTime} seconds`}
                onClick={() => onSeek(beat.startTime)}
                title={beat.dialogue?.text}
                style={{
                  position: "absolute",
                  left: frameToPixels(beat.startTime * animation.fps, pixelsPerFrame),
                  top: 4,
                  width: Math.max(
                    18,
                    frameToPixels(beat.durationSeconds * animation.fps, pixelsPerFrame),
                  ),
                  height: ROW_HEIGHT - 8,
                  overflow: "hidden",
                  padding: "0 8px",
                  border: `1px solid ${directorTokens.timelineMuted}`,
                  borderRadius: 4,
                  background: `color-mix(in srgb, ${directorTokens.selection} 22%, ${directorTokens.timelineSurface})`,
                  color: directorTokens.timelineLabel,
                  fontSize: 10,
                  textAlign: "left",
                  whiteSpace: "nowrap",
                  textOverflow: "ellipsis",
                }}
              >
                <strong>{beat.title}</strong>
                {beat.dialogue ? ` · ${beat.dialogue.text}` : ""}
              </button>
            ))}
          </div>
        </>
      ) : null}
      {hasShotLane ? (
        <>
          <div
            data-director-camera-track=""
            style={{
              height: ROW_HEIGHT,
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "0 10px",
              borderTop: `1px solid ${directorTokens.timelineDivider}`,
              borderRight: `1px solid ${directorTokens.timelineDivider}`,
              fontSize: 11,
            }}
          >
            <strong>Shots</strong>
            <span style={{ color: directorTokens.timelineMuted }}>camera cuts</span>
          </div>
          <div
            data-director-camera-lane=""
            style={{
              position: "relative",
              width: contentWidth,
              height: ROW_HEIGHT,
              borderTop: `1px solid ${directorTokens.timelineDivider}`,
            }}
          >
            {usesSequenceShots ? shots.map((shot) => {
              const timing = shotDrag?.shot.id === shot.id && shotDrag.preview
                ? shotDrag.preview
                : shot;
              const selected = selectedShotIds
                ? selectedShotIds.includes(shot.id)
                : selectedShotId === shot.id;
              const primary = (primaryShotId ?? selectedShotId) === shot.id;
              return (
                <button
                  key={shot.id}
                  type="button"
                  data-director-sequence-shot={shot.id}
                  data-director-primary-shot={primary ? "true" : undefined}
                  aria-label={`${shot.name} shot at ${timing.startTime} seconds`}
                  aria-pressed={selected}
                  onClick={() => {
                    onSeek(shot.startTime);
                  }}
                  onPointerDown={(event) => beginShotDrag(event, shot, "move")}
                  onPointerMove={(event) => moveShotDrag(event, shot.id)}
                  onPointerUp={(event) => finishShotDrag(event, shot.id)}
                  onPointerCancel={() => setShotDrag(undefined)}
                  onKeyDown={(event) => {
                    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                    event.preventDefault();
                    const direction = event.key === "ArrowLeft" ? -1 : 1;
                    onChangeShot?.(shot.id, editDirectorSequenceShotTiming({
                      shot,
                      mode: "move",
                      deltaSeconds: direction * (event.shiftKey ? 10 : 1) / animation.fps,
                      timelineDurationSeconds: animation.durationSeconds,
                      fps: animation.fps,
                    }));
                  }}
                  style={{
                    position: "absolute",
                    left: frameToPixels(timing.startTime * animation.fps, pixelsPerFrame),
                    top: 4,
                    width: Math.max(
                      18,
                      frameToPixels(timing.durationSeconds * animation.fps, pixelsPerFrame),
                    ),
                    height: ROW_HEIGHT - 8,
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    overflow: "hidden",
                    padding: "0 8px",
                    border: `1px solid ${selected ? directorTokens.selection : directorTokens.timelineKeyframe}`,
                    borderRadius: 4,
                    background: selected
                      ? `color-mix(in srgb, ${directorTokens.selection} 72%, ${directorTokens.timelineSurface})`
                      : `color-mix(in srgb, ${directorTokens.timelineKeyframe} 46%, ${directorTokens.timelineSurface})`,
                    color: directorTokens.timelineLabel,
                    fontSize: 10,
                    fontWeight: 650,
                    textAlign: "left",
                    whiteSpace: "nowrap",
                    cursor: shotDrag?.shot.id === shot.id ? "grabbing" : "grab",
                  }}
                >
                  <span
                    data-shot-trim="start"
                    aria-hidden="true"
                    onPointerDown={(event) => beginShotDrag(event, shot, "trim-start")}
                    style={{
                      position: "absolute",
                      inset: "0 auto 0 0",
                      width: 5,
                      cursor: "ew-resize",
                      background: selected ? directorTokens.selection : "transparent",
                    }}
                  />
                  <strong>{shot.name}</strong>
                  <span style={{ color: directorTokens.timelineMuted }}>
                    {targetLabels?.[shot.cameraId] ?? shot.cameraId}
                  </span>
                  <span style={{ color: directorTokens.timelineMuted }}>
                    {shot.transition === "dissolve" ? "Dissolve" : "Cut"}
                  </span>
                  <span
                    data-shot-trim="end"
                    aria-hidden="true"
                    onPointerDown={(event) => beginShotDrag(event, shot, "trim-end")}
                    style={{
                      position: "absolute",
                      inset: "0 0 0 auto",
                      width: 5,
                      cursor: "ew-resize",
                      background: selected ? directorTokens.selection : "transparent",
                    }}
                  />
                </button>
              );
            }) : animation.cameraCues?.map((cue) => (
              <button
                key={cue.id}
                type="button"
                data-director-camera-cue={cue.id}
                aria-label={`${cue.name} camera cue at ${cue.startTime} seconds`}
                onClick={() => onSeek(cue.startTime)}
                style={{
                  position: "absolute",
                  left: frameToPixels(cue.startTime * animation.fps, pixelsPerFrame),
                  top: 4,
                  width: Math.max(
                    18,
                    frameToPixels(cue.durationSeconds * animation.fps, pixelsPerFrame),
                  ),
                  height: ROW_HEIGHT - 8,
                  overflow: "hidden",
                  padding: "0 8px",
                  border: `1px solid ${directorTokens.timelineKeyframe}`,
                  borderRadius: 4,
                  background: `color-mix(in srgb, ${directorTokens.timelineKeyframe} 46%, ${directorTokens.timelineSurface})`,
                  color: directorTokens.timelineLabel,
                  fontSize: 10,
                  fontWeight: 650,
                  textAlign: "left",
                  whiteSpace: "nowrap",
                  textOverflow: "ellipsis",
                }}
              >
                {cue.name}
              </button>
            ))}
          </div>
        </>
      ) : null}
      {animation.tracks.map((track) => (
        <React.Fragment key={track.id}>
          <div
            data-director-track-label={track.id}
            style={{
              height: ROW_HEIGHT,
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "0 10px",
              borderTop: `1px solid ${directorTokens.timelineDivider}`,
              borderRight: `1px solid ${directorTokens.timelineDivider}`,
              fontSize: 11,
              minWidth: 0,
            }}
          >
            <strong style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {targetLabels?.[track.targetId] ?? track.targetId}
            </strong>
            <span style={{ color: directorTokens.timelineMuted }}>{track.property}</span>
          </div>
          <div
            data-director-track-lane={track.id}
            style={{
              position: "relative",
              width: contentWidth,
              height: ROW_HEIGHT,
              borderTop: `1px solid ${directorTokens.timelineDivider}`,
            }}
          >
            {track.keyframes.map((keyframe) => {
              const previewTime = keyframeDrag?.keyframeId === keyframe.id
                ? keyframeDrag.previewTime ?? keyframe.time
                : keyframe.time;
              return (
                <button
                  key={keyframe.id}
                  type="button"
                  data-director-keyframe={keyframe.id}
                  aria-label={`${track.targetId} ${track.property} at ${previewTime} seconds`}
                  aria-pressed={selectedKeyframeId === keyframe.id}
                  onClick={() => onSelectKeyframe?.(track.id, keyframe.id)}
                  onPointerDown={(event) => beginKeyframeDrag(event, track.id, keyframe.id, keyframe.time)}
                  onPointerMove={(event) => moveKeyframeDrag(event, keyframe.id)}
                  onPointerUp={(event) => finishKeyframeDrag(event, keyframe.id)}
                  onPointerCancel={() => setKeyframeDrag(undefined)}
                  onKeyDown={(event) => {
                    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                    event.preventDefault();
                    const direction = event.key === "ArrowLeft" ? -1 : 1;
                    onChangeKeyframe?.(track.id, keyframe.id, editDirectorKeyframeTime({
                      originalTime: keyframe.time,
                      deltaSeconds: direction * (event.shiftKey ? 10 : 1) / animation.fps,
                      timelineDurationSeconds: animation.durationSeconds,
                      fps: animation.fps,
                    }));
                  }}
                  style={{
                    position: "absolute",
                    left: frameToPixels(previewTime * animation.fps, pixelsPerFrame),
                    top: "50%",
                    width: 9,
                    height: 9,
                    padding: 0,
                    border: 0,
                    borderRadius: 1,
                    background: directorTokens.timelineKeyframe,
                    transform: "translate(-50%, -50%) rotate(45deg)",
                    cursor: keyframeDrag?.keyframeId === keyframe.id ? "grabbing" : "grab",
                    outline: selectedKeyframeId === keyframe.id
                      ? `2px solid ${directorTokens.selection}`
                      : "none",
                  }}
                />
              );
            })}
          </div>
        </React.Fragment>
      ))}
      {actionGroups.map(({ key, targetId, layer }) => (
        <React.Fragment key={`action-${key}`}>
          <div
            data-director-action-track={targetId}
            style={{
              height: ROW_HEIGHT,
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "0 10px",
              borderTop: `1px solid ${directorTokens.timelineDivider}`,
              borderRight: `1px solid ${directorTokens.timelineDivider}`,
              fontSize: 11,
              minWidth: 0,
            }}
          >
            <strong style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {targetLabels?.[targetId] ?? targetId}
            </strong>
            <span style={{ color: directorTokens.timelineMuted }}>
              {layer === "upper-body" ? "upper" : "body"}
            </span>
          </div>
          <div
            data-director-action-lane={key}
            style={{
              position: "relative",
              width: contentWidth,
              height: ROW_HEIGHT,
              borderTop: `1px solid ${directorTokens.timelineDivider}`,
            }}
          >
            {(animation.actionClips ?? [])
              .filter((clip) => clip.targetId === targetId && clip.layer === layer)
              .map((clip) => {
                const timing = actionDrag?.clip.id === clip.id && actionDrag.preview
                  ? actionDrag.preview
                  : clip;
                const selected = selectedActionClipId === clip.id;
                return (
                  <button
                    key={clip.id}
                    type="button"
                    data-director-action-clip={clip.id}
                    aria-label={`${ACTION_LABELS[clip.action]} action from ${timing.startTime.toFixed(2)} seconds for ${timing.durationSeconds.toFixed(2)} seconds`}
                    aria-pressed={selected}
                    onClick={() => onSelectActionClip?.(clip.id)}
                    onPointerDown={(event) => beginActionDrag(event, clip, "move")}
                    onPointerMove={(event) => moveActionDrag(event, clip.id)}
                    onPointerUp={(event) => finishActionDrag(event, clip.id)}
                    onPointerCancel={() => setActionDrag(undefined)}
                    onKeyDown={(event) => {
                      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                      event.preventDefault();
                      const direction = event.key === "ArrowLeft" ? -1 : 1;
                      onChangeActionClip?.(clip.id, editDirectorActionClipTiming({
                        clip,
                        mode: "move",
                        deltaSeconds: direction * (event.shiftKey ? 10 : 1) / animation.fps,
                        timelineDurationSeconds: animation.durationSeconds,
                        fps: animation.fps,
                      }));
                    }}
                    style={{
                      position: "absolute",
                      left: frameToPixels(timing.startTime * animation.fps, pixelsPerFrame),
                      top: 4,
                      width: Math.max(12, frameToPixels(timing.durationSeconds * animation.fps, pixelsPerFrame)),
                      height: ROW_HEIGHT - 8,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      overflow: "hidden",
                      padding: "0 8px",
                      border: `1px solid ${selected ? directorTokens.selection : directorTokens.timelineMuted}`,
                      borderRadius: 4,
                      background: selected
                        ? `color-mix(in srgb, ${directorTokens.selection} 72%, ${directorTokens.timelineSurface})`
                        : `color-mix(in srgb, ${directorTokens.timelineKeyframe} 36%, ${directorTokens.timelineSurface})`,
                      color: directorTokens.timelineLabel,
                      cursor: actionDrag?.clip.id === clip.id ? "grabbing" : "grab",
                      outline: "none",
                      fontSize: 10,
                      textAlign: "left",
                    }}
                  >
                    <span
                      data-action-trim="start"
                      aria-hidden="true"
                      onPointerDown={(event) => beginActionDrag(event, clip, "trim-start")}
                      style={{
                        position: "absolute",
                        inset: "0 auto 0 0",
                        width: 5,
                        cursor: "ew-resize",
                        background: selected ? directorTokens.selection : "transparent",
                      }}
                    />
                    <strong style={{ whiteSpace: "nowrap", fontWeight: 650 }}>{ACTION_LABELS[clip.action]}</strong>
                    <span style={{ whiteSpace: "nowrap", color: directorTokens.timelineMuted }}>
                      {clip.layer === "upper-body" ? "Upper body" : "Full body"}
                    </span>
                    <span
                      data-action-trim="end"
                      aria-hidden="true"
                      onPointerDown={(event) => beginActionDrag(event, clip, "trim-end")}
                      style={{
                        position: "absolute",
                        inset: "0 0 0 auto",
                        width: 5,
                        cursor: "ew-resize",
                        background: selected ? directorTokens.selection : "transparent",
                      }}
                    />
                  </button>
                );
              })}
          </div>
        </React.Fragment>
      ))}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          pointerEvents: "none",
          top: 0,
          bottom: 0,
          left: LABEL_WIDTH + frameToPixels(playheadSeconds * animation.fps, pixelsPerFrame),
          width: 1,
          background: directorTokens.selection,
        }}
      />
    </section>
  );
}
