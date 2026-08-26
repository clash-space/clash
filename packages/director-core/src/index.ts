export {
  CLASH_HUMANOID_RIG_V1,
  inspectHumanoidRig,
  type HumanoidRigBone,
  type HumanoidRigIssue,
  type HumanoidRigReport,
} from "./inspect-humanoid-rig";

export {
  retargetHumanoidClip,
  type HumanoidBoneMapping,
  type RetargetHumanoidClipOptions,
} from "./retarget-humanoid-clip";

import type {
  DirectorStageActionClip,
  DirectorStageCamera,
  DirectorStageCameraRig,
  DirectorStageEnvironmentCalibration,
  DirectorStageObject,
  DirectorStageState,
  DirectorStageTransform,
  DirectorStageVector3,
  DirectorStageWorkingVolume,
  DirectorStageWorkingVolumePreset,
} from "@clash/shared-types";

export type DirectorStageKeyframe = NonNullable<
  DirectorStageState["animation"]
>["tracks"][number]["keyframes"][number];
export type DirectorStageAspectRatio = DirectorStageState["shots"][number]["aspectRatio"];

type KeyframeValue = number | DirectorStageVector3;

export type DirectorCameraRigPath = NonNullable<DirectorStageCameraRig["path"]>;
export type DirectorCameraRig = DirectorStageCameraRig;

export interface SampledDirectorCameraRig {
  phase: "settle-in" | "move" | "settle-out";
  progress: number;
  position: DirectorStageVector3;
  rotation: DirectorStageVector3;
  focalLengthMm: number;
}

export interface EvaluatedDirectorActionClip {
  clip: DirectorStageActionClip;
  localTimeSeconds: number;
  weight: number;
}

export const DIRECTOR_CAMERA_SENSOR_HEIGHT_MM = 24;

export type DirectorPanoramaWorkingVolumePresetId = Exclude<
  DirectorStageWorkingVolumePreset,
  "custom"
>;

export const DIRECTOR_PANORAMA_WORKING_VOLUME_PRESETS: ReadonlyArray<{
  id: DirectorPanoramaWorkingVolumePresetId;
  label: string;
  description: string;
  size: DirectorStageVector3;
}> = [
  {
    id: "compact",
    label: "Compact studio",
    description: "Portraits, tabletop scenes, and small blocking setups",
    size: [12, 3.6, 12],
  },
  {
    id: "standard",
    label: "Standard stage",
    description: "Dialogue, group blocking, and most uploaded panoramas",
    size: [28, 5.2, 28],
  },
  {
    id: "large",
    label: "Large location",
    description: "Crowds, vehicles, and broad exterior compositions",
    size: [60, 12, 60],
  },
];

function directorPanoramaPreset(
  presetId: DirectorPanoramaWorkingVolumePresetId,
): DirectorStageWorkingVolume {
  const preset = DIRECTOR_PANORAMA_WORKING_VOLUME_PRESETS.find(
    (candidate) => candidate.id === presetId,
  ) ?? DIRECTOR_PANORAMA_WORKING_VOLUME_PRESETS[1]!;
  return {
    mode: "bounded-box",
    preset: preset.id,
    size: [...preset.size],
    origin: [0, 0, 0],
  };
}

export function directorPanoramaWorkingVolume(
  calibration?: Pick<DirectorStageEnvironmentCalibration, "workingVolume">,
): DirectorStageWorkingVolume | undefined {
  const volume = calibration?.workingVolume;
  if (!volume) return undefined;
  return {
    ...volume,
    size: [...volume.size],
    origin: [...volume.origin],
  };
}

export function createDirectorPanoramaCalibration(
  presetId?: DirectorPanoramaWorkingVolumePresetId,
): DirectorStageEnvironmentCalibration {
  const calibration: DirectorStageEnvironmentCalibration = {
    projection: "equirectangular",
    capturePosition: [0, 1.6, 0],
    captureRotation: [0, 0, 0],
    horizonV: 0.5,
    forwardU: 0.5,
    gridCellMeters: 1,
  };
  return presetId
    ? { ...calibration, workingVolume: directorPanoramaPreset(presetId) }
    : calibration;
}

export function directorPanoramaCalibrationCamera(
  calibration: DirectorStageEnvironmentCalibration,
): {
  position: DirectorStageVector3;
  rotation: DirectorStageVector3;
  fov: number;
} {
  return {
    position: [...calibration.capturePosition],
    rotation: [...calibration.captureRotation],
    fov: 60,
  };
}

export function directorPanoramaEnvironmentRotation(
  calibration: DirectorStageEnvironmentCalibration,
): DirectorStageVector3 {
  return [
    calibration.captureRotation[0] + (0.5 - calibration.horizonV) * Math.PI,
    calibration.captureRotation[1] + (calibration.forwardU - 0.25) * Math.PI * 2,
    calibration.captureRotation[2],
  ];
}

const DIRECTOR_PANORAMA_GRID_COLOR = [0, 255, 102] as const;
const DIRECTOR_PANORAMA_FORWARD_COLOR = [255, 0, 255] as const;
const DIRECTOR_PANORAMA_RIGHT_COLOR = [0, 217, 255] as const;

function distanceToGridLine(value: number, interval: number): number {
  const remainder = Math.abs(value % interval);
  return Math.min(remainder, interval - remainder);
}

export function renderDirectorPanoramaReference({
  width = 2048,
  height = 1024,
  calibration = createDirectorPanoramaCalibration(),
}: {
  width?: number;
  height?: number;
  calibration?: DirectorStageEnvironmentCalibration;
} = {}): {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  calibration: DirectorStageEnvironmentCalibration;
} {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new TypeError("Panorama reference dimensions must be positive integers");
  }
  if (width !== height * 2) {
    throw new RangeError("Panorama reference must use an exact 2:1 aspect ratio");
  }

  const pixels = new Uint8ClampedArray(width * height * 4);
  const horizonPixel = height * 0.5;
  const forwardPixel = width * calibration.forwardU;
  const rightPixel = width * 0.75;

  for (let pixelY = 0; pixelY < height; pixelY += 1) {
    const textureV = 1 - (pixelY + 0.5) / height;
    const latitude = (textureV - 0.5) * Math.PI;
    const cosLatitude = Math.cos(latitude);
    const directionY = Math.sin(latitude);

    for (let pixelX = 0; pixelX < width; pixelX += 1) {
      const textureU = (pixelX + 0.5) / width;
      const longitude = (textureU - 0.5) * Math.PI * 2;
      const directionX = cosLatitude * Math.cos(longitude);
      const directionZ = cosLatitude * Math.sin(longitude);
      const index = (pixelY * width + pixelX) * 4;
      let red = 7;
      let green = 9;
      let blue = 13;

      if (directionY < -1e-6) {
        const distance = -calibration.capturePosition[1] / directionY;
        const worldX = calibration.capturePosition[0] + directionX * distance;
        const worldZ = calibration.capturePosition[2] + directionZ * distance;
        const projectedPixelWidth = Math.max(0.02, distance * (Math.PI * 2 / width));
        const minorLine = Math.min(
          distanceToGridLine(worldX, calibration.gridCellMeters),
          distanceToGridLine(worldZ, calibration.gridCellMeters),
        ) <= projectedPixelWidth;
        const majorLine = Math.min(
          distanceToGridLine(worldX, calibration.gridCellMeters * 5),
          distanceToGridLine(worldZ, calibration.gridCellMeters * 5),
        ) <= projectedPixelWidth * 1.8;
        red = 8;
        green = 12;
        blue = 18;
        if (minorLine || majorLine) {
          [red, green, blue] = DIRECTOR_PANORAMA_GRID_COLOR;
        }
      }

      if (Math.abs(pixelY + 0.5 - horizonPixel) <= 1) {
        [red, green, blue] = DIRECTOR_PANORAMA_GRID_COLOR;
      }
      if (Math.abs(pixelX + 0.5 - forwardPixel) <= 1) {
        [red, green, blue] = DIRECTOR_PANORAMA_FORWARD_COLOR;
      } else if (Math.abs(pixelX + 0.5 - rightPixel) <= 1) {
        [red, green, blue] = DIRECTOR_PANORAMA_RIGHT_COLOR;
      }

      pixels[index] = red;
      pixels[index + 1] = green;
      pixels[index + 2] = blue;
      pixels[index + 3] = 255;
    }
  }

  return { width, height, pixels, calibration };
}

export const DIRECTOR_CAMERA_LENS_PRESETS = [
  { id: "ultra-wide", label: "Ultra-wide", focalLengthMm: 14 },
  { id: "wide", label: "Wide", focalLengthMm: 24 },
  { id: "documentary", label: "Documentary", focalLengthMm: 35 },
  { id: "standard", label: "Standard", focalLengthMm: 50 },
  { id: "portrait", label: "Portrait", focalLengthMm: 85 },
  { id: "telephoto", label: "Telephoto", focalLengthMm: 135 },
] as const;

export function cameraFovFromFocalLength(
  focalLengthMm: number,
  sensorHeightMm = DIRECTOR_CAMERA_SENSOR_HEIGHT_MM,
): number {
  const focalLength = Math.max(1, focalLengthMm);
  const sensorHeight = Math.max(1, sensorHeightMm);
  return 2 * Math.atan(sensorHeight / (2 * focalLength)) * 180 / Math.PI;
}

export function cameraFocalLengthFromFov(
  fovDegrees: number,
  sensorHeightMm = DIRECTOR_CAMERA_SENSOR_HEIGHT_MM,
): number {
  const fov = Math.min(179, Math.max(1, fovDegrees)) * Math.PI / 180;
  const sensorHeight = Math.max(1, sensorHeightMm);
  return sensorHeight / (2 * Math.tan(fov / 2));
}

export function directorDefaultFocusOffset(
  object: DirectorStageObject,
): DirectorStageVector3 {
  if (object.kind === "mannequin" || object.kind === "crowd") return [0, 1.1, 0];
  if (object.kind === "creature") return [0, 1.35, 0];
  if (object.kind === "primitive") return [0, 0.5 * object.transform.scale[1], 0];
  if (object.kind === "set") return [0, 1.5 * object.transform.scale[1], 0];
  if (object.kind === "vehicle") return [0, 0.65 * object.transform.scale[1], 0];
  if (object.kind === "light") return [0, 0, 0];
  return [0, 0.75 * object.transform.scale[1], 0];
}

export function directorObjectFocusPoint(
  object: DirectorStageObject,
  offset: DirectorStageVector3 = directorDefaultFocusOffset(object),
): DirectorStageVector3 {
  return [
    object.transform.position[0] + offset[0],
    object.transform.position[1] + offset[1],
    object.transform.position[2] + offset[2],
  ];
}

/** Resolve the world-space focus point for a single-subject or group camera. */
export function directorCameraFocusPoint(
  camera: DirectorStageCamera,
  objects: readonly DirectorStageObject[],
): DirectorStageVector3 | undefined {
  const targetIds = camera.targetObjectIds?.length
    ? camera.targetObjectIds
    : camera.targetObjectId
      ? [camera.targetObjectId]
      : [];
  const points = targetIds.flatMap((targetId) => {
    const target = objects.find((object) => object.id === targetId);
    if (!target) return [];
    const worldTransform = directorObjectWorldTransform(objects, target.id)
      ?? target.transform;
    const worldTarget = { ...target, transform: worldTransform } as DirectorStageObject;
    return [directorObjectFocusPoint(worldTarget, camera.targetOffset)];
  });
  if (!points.length) return undefined;
  return points.reduce<DirectorStageVector3>(
    (sum, point) => [
      sum[0] + point[0] / points.length,
      sum[1] + point[1] / points.length,
      sum[2] + point[2] / points.length,
    ],
    [0, 0, 0],
  );
}

function rotateVector(
  vector: DirectorStageVector3,
  rotation: DirectorStageVector3,
): DirectorStageVector3 {
  let [x, y, z] = vector;
  const [pitch, yaw, roll] = rotation;
  const cosX = Math.cos(pitch);
  const sinX = Math.sin(pitch);
  [y, z] = [y * cosX - z * sinX, y * sinX + z * cosX];
  const cosY = Math.cos(yaw);
  const sinY = Math.sin(yaw);
  [x, z] = [x * cosY + z * sinY, -x * sinY + z * cosY];
  const cosZ = Math.cos(roll);
  const sinZ = Math.sin(roll);
  [x, y] = [x * cosZ - y * sinZ, x * sinZ + y * cosZ];
  return [x, y, z];
}

export function composeDirectorTransforms(
  parent: DirectorStageTransform,
  local: DirectorStageTransform,
): DirectorStageTransform {
  const scaledPosition: DirectorStageVector3 = [
    local.position[0] * parent.scale[0],
    local.position[1] * parent.scale[1],
    local.position[2] * parent.scale[2],
  ];
  const rotatedPosition = rotateVector(scaledPosition, parent.rotation);
  return {
    position: [
      parent.position[0] + rotatedPosition[0],
      parent.position[1] + rotatedPosition[1],
      parent.position[2] + rotatedPosition[2],
    ],
    rotation: [
      parent.rotation[0] + local.rotation[0],
      parent.rotation[1] + local.rotation[1],
      parent.rotation[2] + local.rotation[2],
    ],
    scale: [
      parent.scale[0] * local.scale[0],
      parent.scale[1] * local.scale[1],
      parent.scale[2] * local.scale[2],
    ],
  };
}

export function directorObjectWorldTransform(
  objects: readonly DirectorStageObject[],
  objectId: string,
  visited: ReadonlySet<string> = new Set(),
): DirectorStageTransform | undefined {
  const object = objects.find((candidate) => candidate.id === objectId);
  if (!object) return undefined;
  if (!object.attachment || visited.has(object.id)) {
    return {
      position: [...object.transform.position],
      rotation: [...object.transform.rotation],
      scale: [...object.transform.scale],
    };
  }
  const parent = directorObjectWorldTransform(
    objects,
    object.attachment.parentId,
    new Set([...visited, object.id]),
  );
  if (!parent) return object.transform;
  return composeDirectorTransforms(
    composeDirectorTransforms(parent, object.attachment.offset),
    object.transform,
  );
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Resolve the action clips affecting one mannequin at a playhead time. */
export function evaluateDirectorActionClips(
  animation: DirectorStageState["animation"],
  targetId: string,
  timeSeconds: number,
): EvaluatedDirectorActionClip[] {
  if (!animation) return [];
  return (animation.actionClips ?? [])
    .filter((clip) => {
      const endTime = clip.startTime + clip.durationSeconds;
      return clip.targetId === targetId && timeSeconds >= clip.startTime && timeSeconds <= endTime;
    })
    .map((clip) => {
      const elapsed = timeSeconds - clip.startTime;
      const remaining = clip.durationSeconds - elapsed;
      const blendInWeight = clip.blendInSeconds > 0
        ? clamp01(elapsed / clip.blendInSeconds)
        : 1;
      const blendOutWeight = clip.blendOutSeconds > 0
        ? clamp01(remaining / clip.blendOutSeconds)
        : 1;
      const sourceStartSeconds = clip.sourceStartSeconds ?? 0;
      const unboundedLocalTime = elapsed * clip.playbackRate;
      const sourceDurationSeconds = clip.sourceDurationSeconds;
      let localTimeSeconds = sourceStartSeconds + unboundedLocalTime;
      if (sourceDurationSeconds) {
        if (clip.loopMode === "repeat") {
          localTimeSeconds = sourceStartSeconds
            + (
              (unboundedLocalTime % sourceDurationSeconds)
              + sourceDurationSeconds
            ) % sourceDurationSeconds;
        } else if (clip.loopMode === "hold") {
          localTimeSeconds = sourceStartSeconds
            + Math.min(unboundedLocalTime, sourceDurationSeconds);
        }
      }
      return {
        clip,
        localTimeSeconds,
        weight: Math.min(blendInWeight, blendOutWeight),
      };
    })
    .sort((left, right) => {
      const leftLayer = left.clip.layer === "full-body" ? 0 : 1;
      const rightLayer = right.clip.layer === "full-body" ? 0 : 1;
      return leftLayer - rightLayer ||
        left.clip.startTime - right.clip.startTime ||
        left.clip.id.localeCompare(right.clip.id);
    });
}

function interpolateValue(
  from: KeyframeValue,
  to: KeyframeValue,
  progress: number,
): KeyframeValue {
  if (typeof from === "number" && typeof to === "number") {
    return from + (to - from) * progress;
  }
  if (Array.isArray(from) && Array.isArray(to)) {
    return [
      from[0] + (to[0] - from[0]) * progress,
      from[1] + (to[1] - from[1]) * progress,
      from[2] + (to[2] - from[2]) * progress,
    ];
  }
  return from;
}

type DirectorVectorKeyframe = DirectorStageKeyframe & {
  value: DirectorStageVector3;
};

function directorVectorKeyframes(
  keyframes: DirectorStageKeyframe[],
): DirectorVectorKeyframe[] {
  return keyframes
    .filter((keyframe): keyframe is DirectorVectorKeyframe => (
      Array.isArray(keyframe.value)
      && keyframe.value.length === 3
      && keyframe.value.every(Number.isFinite)
      && Number.isFinite(keyframe.time)
    ))
    .sort((left, right) => left.time - right.time);
}

function directorPositionTangent(
  keys: DirectorVectorKeyframe[],
  index: number,
): DirectorStageVector3 {
  const previous = keys[Math.max(0, index - 1)]!;
  const next = keys[Math.min(keys.length - 1, index + 1)]!;
  const duration = Math.max(Number.EPSILON, next.time - previous.time);
  if (previous === next) return [0, 0, 0];
  return [
    (next.value[0] - previous.value[0]) / duration,
    (next.value[1] - previous.value[1]) / duration,
    (next.value[2] - previous.value[2]) / duration,
  ];
}

function interpolateDirectorPositionHermite(
  from: DirectorStageVector3,
  to: DirectorStageVector3,
  fromTangent: DirectorStageVector3,
  toTangent: DirectorStageVector3,
  progress: number,
  durationSeconds: number,
): DirectorStageVector3 {
  const squared = progress * progress;
  const cubed = squared * progress;
  const fromWeight = 2 * cubed - 3 * squared + 1;
  const fromTangentWeight = cubed - 2 * squared + progress;
  const toWeight = -2 * cubed + 3 * squared;
  const toTangentWeight = cubed - squared;
  return from.map((component, index) => (
    fromWeight * component
    + fromTangentWeight * durationSeconds * fromTangent[index]!
    + toWeight * to[index]!
    + toTangentWeight * durationSeconds * toTangent[index]!
  )) as DirectorStageVector3;
}

/**
 * Sample a vector position track.
 *
 * Smooth segments use time-aware cubic Hermite tangents, so adjacent smooth
 * segments retain a continuous first derivative instead of stopping at every
 * intermediate key.
 */
export function samplePositionKeyframes(
  keyframes: DirectorStageKeyframe[],
  timeSeconds: number,
): DirectorStageVector3 | undefined {
  const keys = directorVectorKeyframes(keyframes);
  const first = keys[0];
  const last = keys[keys.length - 1];
  if (!first || !last) return undefined;
  if (timeSeconds <= first.time) return [...first.value] as DirectorStageVector3;
  if (timeSeconds >= last.time) return [...last.value] as DirectorStageVector3;

  const nextIndex = keys.findIndex((keyframe) => keyframe.time >= timeSeconds);
  const next = keys[nextIndex];
  const previous = keys[nextIndex - 1];
  if (!next || !previous) return [...last.value] as DirectorStageVector3;
  if (previous.interpolation === "hold") {
    return [...previous.value] as DirectorStageVector3;
  }
  const duration = Math.max(Number.EPSILON, next.time - previous.time);
  const progress = clamp01((timeSeconds - previous.time) / duration);
  if (previous.interpolation === "bezier") {
    return interpolateDirectorPositionHermite(
      previous.value,
      next.value,
      directorPositionTangent(keys, nextIndex - 1),
      directorPositionTangent(keys, nextIndex),
      progress,
      duration,
    );
  }
  return interpolateValue(previous.value, next.value, progress) as DirectorStageVector3;
}

/**
 * Measure distance travelled along a position track up to a playhead time.
 * Linear segments are exact; smooth segments use a stable numerical arc-length
 * approximation suitable for deterministic seek-time animation.
 */
export function directorPositionPathDistance(
  keyframes: DirectorStageKeyframe[],
  timeSeconds: number,
): number {
  const keys = directorVectorKeyframes(keyframes);
  const first = keys[0];
  if (!first || keys.length < 2 || timeSeconds <= first.time) return 0;
  const clampedTime = Math.min(timeSeconds, keys[keys.length - 1]!.time);
  let distance = 0;
  for (let index = 0; index < keys.length - 1; index += 1) {
    const from = keys[index]!;
    const to = keys[index + 1]!;
    if (clampedTime <= from.time) break;
    const segmentDuration = Math.max(Number.EPSILON, to.time - from.time);
    const segmentProgress = clamp01((clampedTime - from.time) / segmentDuration);
    if (segmentProgress <= 0) continue;
    if (from.interpolation === "hold") {
      if (clampedTime < to.time) break;
      continue;
    }
    if (from.interpolation === "linear") {
      distance += Math.hypot(
        to.value[0] - from.value[0],
        to.value[1] - from.value[1],
        to.value[2] - from.value[2],
      ) * segmentProgress;
    } else {
      const steps = Math.max(4, Math.ceil(24 * segmentProgress));
      let previousPosition = samplePositionKeyframes(keys, from.time)!;
      for (let step = 1; step <= steps; step += 1) {
        const sampleTime = from.time
          + segmentDuration * segmentProgress * (step / steps);
        const position = samplePositionKeyframes(keys, sampleTime)!;
        distance += Math.hypot(
          position[0] - previousPosition[0],
          position[1] - previousPosition[1],
          position[2] - previousPosition[2],
        );
        previousPosition = position;
      }
    }
    if (clampedTime < to.time) break;
  }
  return distance;
}

function interpolateAngle(from: number, to: number, progress: number): number {
  const fullTurn = Math.PI * 2;
  const delta = ((to - from + Math.PI) % fullTurn + fullTurn) % fullTurn - Math.PI;
  return from + delta * progress;
}

function sampleRotationKeyframes(
  keyframes: DirectorStageKeyframe[],
  timeSeconds: number,
): DirectorStageVector3 | undefined {
  if (!keyframes.length) return undefined;
  const keys = [...keyframes].sort((left, right) => left.time - right.time);
  const first = keys[0];
  const last = keys[keys.length - 1];
  if (!first || !last || !Array.isArray(first.value) || !Array.isArray(last.value)) return undefined;
  if (timeSeconds <= first.time) return [...first.value];
  if (timeSeconds >= last.time) return [...last.value];

  const nextIndex = keys.findIndex((key) => key.time >= timeSeconds);
  const next = keys[nextIndex];
  const previous = keys[nextIndex - 1];
  if (!next || !previous || !Array.isArray(next.value) || !Array.isArray(previous.value)) {
    return [...last.value];
  }
  if (previous.interpolation === "hold") return [...previous.value];
  const duration = Math.max(Number.EPSILON, next.time - previous.time);
  let progress = clamp01((timeSeconds - previous.time) / duration);
  if (previous.interpolation === "bezier") {
    progress = progress * progress * (3 - 2 * progress);
  }
  return [
    interpolateAngle(previous.value[0], next.value[0], progress),
    interpolateAngle(previous.value[1], next.value[1], progress),
    interpolateAngle(previous.value[2], next.value[2], progress),
  ];
}

/** Sample a Director Stage animation track without mutating its stored keys. */
export function sampleKeyframes(
  keyframes: DirectorStageKeyframe[],
  timeSeconds: number,
): KeyframeValue | undefined {
  if (!keyframes.length) return undefined;
  const keys = [...keyframes].sort((left, right) => left.time - right.time);
  const first = keys[0];
  const last = keys[keys.length - 1];
  if (!first || !last) return undefined;
  if (timeSeconds <= first.time) return first.value;
  if (timeSeconds >= last.time) return last.value;

  const nextIndex = keys.findIndex((key) => key.time >= timeSeconds);
  const next = keys[nextIndex];
  const previous = keys[nextIndex - 1];
  if (!next || !previous) return last.value;
  if (previous.interpolation === "hold") return previous.value;

  const duration = Math.max(Number.EPSILON, next.time - previous.time);
  let progress = clamp01((timeSeconds - previous.time) / duration);
  if (previous.interpolation === "bezier") {
    progress = progress * progress * (3 - 2 * progress);
  }
  return interpolateValue(previous.value, next.value, progress);
}

/**
 * Convert a target point to Three-compatible Euler pitch/yaw/roll values.
 * Cameras look down their local negative Z axis.
 */
export function cameraLookAtRotation(
  position: DirectorStageVector3,
  target: DirectorStageVector3,
): DirectorStageVector3 {
  return directorEulerFromQuaternion(directorLookAtQuaternion(position, target));
}

type DirectorQuaternion = [number, number, number, number];

function directorLookAtQuaternion(
  position: DirectorStageVector3,
  target: DirectorStageVector3,
): DirectorQuaternion {
  let zx = position[0] - target[0];
  let zy = position[1] - target[1];
  let zz = position[2] - target[2];
  let zLength = Math.hypot(zx, zy, zz);
  if (zLength <= Number.EPSILON) {
    zz = 1;
    zLength = 1;
  }
  zx /= zLength;
  zy /= zLength;
  zz /= zLength;
  let xx = zz;
  let xy = 0;
  let xz = -zx;
  let xLength = Math.hypot(xx, xy, xz);
  if (xLength <= Number.EPSILON) {
    zx += 0.0001;
    zLength = Math.hypot(zx, zy, zz);
    zx /= zLength;
    zy /= zLength;
    zz /= zLength;
    xx = zz;
    xz = -zx;
    xLength = Math.hypot(xx, xz);
  }
  xx /= xLength;
  xy /= xLength;
  xz /= xLength;
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  const m11 = xx;
  const m12 = yx;
  const m13 = zx;
  const m21 = xy;
  const m22 = yy;
  const m23 = zy;
  const m31 = xz;
  const m32 = yz;
  const m33 = zz;
  const trace = m11 + m22 + m33;
  if (trace > 0) {
    const scale = 0.5 / Math.sqrt(trace + 1);
    return [
      (m32 - m23) * scale,
      (m13 - m31) * scale,
      (m21 - m12) * scale,
      0.25 / scale,
    ];
  }
  if (m11 > m22 && m11 > m33) {
    const scale = 2 * Math.sqrt(1 + m11 - m22 - m33);
    return [
      0.25 * scale,
      (m12 + m21) / scale,
      (m13 + m31) / scale,
      (m32 - m23) / scale,
    ];
  }
  if (m22 > m33) {
    const scale = 2 * Math.sqrt(1 + m22 - m11 - m33);
    return [
      (m12 + m21) / scale,
      0.25 * scale,
      (m23 + m32) / scale,
      (m13 - m31) / scale,
    ];
  }
  const scale = 2 * Math.sqrt(1 + m33 - m11 - m22);
  return [
    (m13 + m31) / scale,
    (m23 + m32) / scale,
    0.25 * scale,
    (m21 - m12) / scale,
  ];
}

function directorQuaternionFromEuler(
  rotation: DirectorStageVector3,
): DirectorQuaternion {
  const [x, y, z] = rotation;
  const c1 = Math.cos(x / 2);
  const c2 = Math.cos(y / 2);
  const c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2);
  const s2 = Math.sin(y / 2);
  const s3 = Math.sin(z / 2);
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  ];
}

function directorEulerFromQuaternion(
  quaternion: DirectorQuaternion,
): DirectorStageVector3 {
  const [x, y, z, w] = quaternion;
  return [
    Math.atan2(
      2 * (x * w - y * z),
      w * w - x * x - y * y + z * z,
    ),
    Math.asin(Math.max(-1, Math.min(1, 2 * (x * z + y * w)))),
    Math.atan2(
      2 * (z * w - x * y),
      w * w + x * x - y * y - z * z,
    ),
  ];
}

function directorSlerpQuaternion(
  from: DirectorQuaternion,
  to: DirectorQuaternion,
  progress: number,
): DirectorQuaternion {
  let target = [...to] as DirectorQuaternion;
  let dot = from.reduce(
    (sum, component, index) => sum + component * target[index]!,
    0,
  );
  if (dot < 0) {
    target = target.map((component) => -component) as DirectorQuaternion;
    dot = -dot;
  }
  if (dot > 0.9995) {
    const interpolated = from.map((component, index) => (
      component + (target[index]! - component) * progress
    )) as DirectorQuaternion;
    const length = Math.hypot(...interpolated);
    return interpolated.map((component) => component / length) as DirectorQuaternion;
  }
  const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
  const sinAngle = Math.sin(angle);
  const fromWeight = Math.sin((1 - progress) * angle) / sinAngle;
  const toWeight = Math.sin(progress * angle) / sinAngle;
  return from.map((component, index) => (
    component * fromWeight + target[index]! * toWeight
  )) as DirectorQuaternion;
}

function directorQuaternionAngularDistance(
  from: DirectorQuaternion,
  to: DirectorQuaternion,
): number {
  const dot = Math.min(1, Math.abs(from.reduce(
    (sum, component, index) => sum + component * to[index]!,
    0,
  )));
  return 2 * Math.acos(dot);
}

function directorAngularMotionProgress(
  rig: DirectorCameraRig,
  progress: number,
  moveDurationSeconds: number,
): number {
  if (rig.orientation.mode !== "keyed" || progress <= 0 || progress >= 1) {
    return progress;
  }
  const angle = directorQuaternionAngularDistance(
    directorQuaternionFromEuler(rig.orientation.startRotation),
    directorQuaternionFromEuler(rig.orientation.endRotation),
  );
  if (angle <= Number.EPSILON) return progress;
  const duration = Math.max(Number.EPSILON, moveDurationSeconds);
  const acceleration = rig.maxAngularAccelerationDegPerSecondSquared
    ? rig.maxAngularAccelerationDegPerSecondSquared * Math.PI / 180
    : undefined;
  const maxVelocity = rig.maxAngularVelocityDegPerSecond
    ? rig.maxAngularVelocityDegPerSecond * Math.PI / 180
    : undefined;
  if (!acceleration) {
    return progress;
  }
  const discriminant = duration * duration - 4 * angle / acceleration;
  if (discriminant < 0) {
    return progress * progress * (3 - 2 * progress);
  }
  const accelerationTime = (
    duration - Math.sqrt(Math.max(0, discriminant))
  ) / 2;
  const peakVelocity = acceleration * accelerationTime;
  if (maxVelocity && peakVelocity > maxVelocity + 1e-9) {
    return progress * progress * (3 - 2 * progress);
  }
  const elapsed = progress * duration;
  let travelledAngle: number;
  if (elapsed < accelerationTime) {
    travelledAngle = 0.5 * acceleration * elapsed * elapsed;
  } else if (elapsed > duration - accelerationTime) {
    const remaining = duration - elapsed;
    travelledAngle = angle - 0.5 * acceleration * remaining * remaining;
  } else {
    travelledAngle = (
      0.5 * acceleration * accelerationTime * accelerationTime
      + peakVelocity * (elapsed - accelerationTime)
    );
  }
  return clamp01(travelledAngle / angle);
}

function sampleDirectorCameraOrientation(
  rig: DirectorCameraRig,
  position: DirectorStageVector3,
  progress: number,
  moveDurationSeconds: number,
): DirectorStageVector3 {
  if (rig.orientation.mode === "fixed-target") {
    return cameraLookAtRotation(position, rig.orientation.target);
  }
  if (rig.orientation.mode === "keyed") {
    const angularProgress = directorAngularMotionProgress(
      rig,
      progress,
      moveDurationSeconds,
    );
    return directorEulerFromQuaternion(directorSlerpQuaternion(
      directorQuaternionFromEuler(rig.orientation.startRotation),
      directorQuaternionFromEuler(rig.orientation.endRotation),
      angularProgress,
    ));
  }
  return [0, 0, 0];
}

function sampleDirectorCameraPath(
  path: DirectorCameraRigPath,
  progress: number,
): DirectorStageVector3 {
  const points = path.points;
  const first = points[0] ?? [0, 0, 0];
  const last = points[points.length - 1] ?? first;
  if (points.length < 2 || progress <= 0) return [...first];
  if (progress >= 1) return [...last];
  const segmentCount = points.length - 1;
  const scaledProgress = progress * segmentCount;
  const segmentIndex = Math.min(segmentCount - 1, Math.floor(scaledProgress));
  const localProgress = scaledProgress - segmentIndex;
  const from = points[segmentIndex]!;
  const to = points[segmentIndex + 1]!;
  if (path.interpolation === "linear") {
    return interpolateValue(from, to, localProgress) as DirectorStageVector3;
  }

  const before = points[Math.max(0, segmentIndex - 1)]!;
  const after = points[Math.min(points.length - 1, segmentIndex + 2)]!;
  const squared = localProgress * localProgress;
  const cubed = squared * localProgress;
  return from.map((component, index) => (
    0.5 * (
      2 * component
      + (-before[index]! + to[index]!) * localProgress
      + (
        2 * before[index]!
        - 5 * component
        + 4 * to[index]!
        - after[index]!
      ) * squared
      + (
        -before[index]!
        + 3 * component
        - 3 * to[index]!
        + after[index]!
      ) * cubed
    )
  )) as DirectorStageVector3;
}

function arcLengthParameter(
  path: DirectorCameraRigPath,
  progress: number,
): number {
  if (progress <= 0 || path.points.length < 2) return 0;
  if (progress >= 1) return 1;
  const sampleCount = Math.max(64, (path.points.length - 1) * 64);
  const distances = new Array<number>(sampleCount + 1).fill(0);
  let previous = sampleDirectorCameraPath(path, 0);
  for (let index = 1; index <= sampleCount; index += 1) {
    const parameter = index / sampleCount;
    const position = sampleDirectorCameraPath(path, parameter);
    distances[index] = distances[index - 1]! + Math.hypot(
      position[0] - previous[0],
      position[1] - previous[1],
      position[2] - previous[2],
    );
    previous = position;
  }
  const totalDistance = distances[sampleCount]!;
  if (totalDistance <= Number.EPSILON) return progress;
  const targetDistance = totalDistance * progress;
  let upperIndex = distances.findIndex((distance) => distance >= targetDistance);
  if (upperIndex < 1) upperIndex = 1;
  const lowerIndex = upperIndex - 1;
  const lowerDistance = distances[lowerIndex]!;
  const upperDistance = distances[upperIndex]!;
  const distanceProgress = upperDistance === lowerDistance
    ? 0
    : (targetDistance - lowerDistance) / (upperDistance - lowerDistance);
  return (lowerIndex + distanceProgress) / sampleCount;
}

/**
 * Sample a persisted physical camera move in shot-local time.
 *
 * Settle windows hold exact endpoint poses. The move window traverses the
 * stored path by arc length, keeping camera speed stable even on curved paths.
 */
export function sampleDirectorCameraRig(
  rig: DirectorCameraRig,
  timeSeconds: number,
  durationSeconds: number,
): SampledDirectorCameraRig {
  const duration = Math.max(0, durationSeconds);
  const settleIn = Math.min(duration, Math.max(0, rig.settleInSeconds));
  const settleOut = Math.min(
    Math.max(0, duration - settleIn),
    Math.max(0, rig.settleOutSeconds),
  );
  const moveDuration = Math.max(
    Number.EPSILON,
    duration - settleIn - settleOut,
  );
  const time = Math.min(duration, Math.max(0, timeSeconds));
  const phase = time < settleIn
    ? "settle-in"
    : time >= duration - settleOut
      ? "settle-out"
      : "move";
  const progress = phase === "settle-in"
    ? 0
    : phase === "settle-out"
      ? 1
      : clamp01((time - settleIn) / moveDuration);
  const pathParameter = rig.path
    ? arcLengthParameter(rig.path, progress)
    : progress;
  const position = rig.kind === "orbit" && rig.orbit
    ? (() => {
        const angle = (
          rig.orbit.startAngleDegrees
          + (rig.orbit.endAngleDegrees - rig.orbit.startAngleDegrees) * progress
        ) * Math.PI / 180;
        return [
          rig.orbit.pivot[0] + Math.sin(angle) * rig.orbit.radius,
          rig.orbit.height,
          rig.orbit.pivot[2] + Math.cos(angle) * rig.orbit.radius,
        ] as DirectorStageVector3;
      })()
    : sampleDirectorCameraPath(
        rig.path ?? {
          interpolation: "linear",
          points: [[0, 0, 0], [0, 0, 0]],
        },
        pathParameter,
      );
  const focalLengthMm = rig.lens.mode === "locked"
    ? rig.lens.focalLengthMm
    : rig.lens.startFocalLengthMm
      + (rig.lens.endFocalLengthMm - rig.lens.startFocalLengthMm) * progress;
  return {
    phase,
    progress,
    position,
    rotation: sampleDirectorCameraOrientation(
      rig,
      position,
      progress,
      moveDuration,
    ),
    focalLengthMm,
  };
}

/** Evaluate animation tracks and target-following cameras at a playhead time. */
export function evaluateDirectorStage(
  state: DirectorStageState,
  timeSeconds: number,
): DirectorStageState {
  const duration = state.animation?.durationSeconds ?? 0;
  const time = duration > 0
    ? Math.min(duration, Math.max(0, timeSeconds))
    : Math.max(0, timeSeconds);
  const objects = state.objects.map((object) => ({
    ...object,
    transform: {
      position: [...object.transform.position] as DirectorStageVector3,
      rotation: [...object.transform.rotation] as DirectorStageVector3,
      scale: [...object.transform.scale] as DirectorStageVector3,
    },
  }));
  const cameras = state.cameras.map((camera) => ({
    ...camera,
    position: [...camera.position] as DirectorStageVector3,
    rotation: [...camera.rotation] as DirectorStageVector3,
    ...(camera.optics ? { optics: { ...camera.optics } } : {}),
  }));

  for (const track of state.animation?.tracks ?? []) {
    const value = track.property === "rotation"
      ? sampleRotationKeyframes(track.keyframes, time)
      : track.property === "position"
        ? samplePositionKeyframes(track.keyframes, time)
        : sampleKeyframes(track.keyframes, time);
    if (value === undefined) continue;
    const object = objects.find((candidate) => candidate.id === track.targetId);
    if (
      object
      && (
        track.property === "position"
        || track.property === "rotation"
        || track.property === "scale"
      )
      && Array.isArray(value)
    ) {
      object.transform[track.property] = [...value] as DirectorStageVector3;
      continue;
    }
    const camera = cameras.find((candidate) => candidate.id === track.targetId);
    if (!camera) continue;
    if (track.property === "fov" && typeof value === "number") {
      camera.fov = value;
    } else if (
      track.property === "focalLengthMm"
      && typeof value === "number"
      && camera.optics
    ) {
      camera.optics.focalLengthMm = value;
      camera.fov = cameraFovFromFocalLength(
        value,
        camera.optics.sensorHeightMm,
      );
    } else if (
      track.property === "focusDistanceM"
      && typeof value === "number"
      && camera.optics
    ) {
      camera.optics.focusDistanceM = value;
    } else if (
      track.property === "fStop"
      && typeof value === "number"
      && camera.optics
    ) {
      camera.optics.fStop = value;
    } else if (track.property === "position" && Array.isArray(value)) {
      camera.position = [...value] as DirectorStageVector3;
    } else if (track.property === "rotation" && Array.isArray(value)) {
      camera.rotation = [...value] as DirectorStageVector3;
    }
  }

  const animationDuration = state.animation?.durationSeconds;
  const activeSequenceShot = [...(state.shotSequence ?? [])]
    .sort((left, right) => left.startTime - right.startTime || left.id.localeCompare(right.id))
    .find((shot) => (
      time >= shot.startTime
      && (
        time < shot.startTime + shot.durationSeconds
        || (
          animationDuration !== undefined
          && Math.abs(time - animationDuration) < 1e-6
          && Math.abs(shot.startTime + shot.durationSeconds - animationDuration) < 1e-6
        )
      )
    ));

  for (const camera of cameras) {
    const focusPoint = directorCameraFocusPoint(camera, objects);
    if (focusPoint) {
      camera.rotation = cameraLookAtRotation(
        camera.position,
        focusPoint,
      );
    }
  }

  const activeRig = activeSequenceShot?.cameraMove?.rig;
  if (activeSequenceShot && activeRig) {
    const rigCamera = cameras.find(
      (camera) => camera.id === activeSequenceShot.cameraId,
    );
    if (rigCamera) {
      let resolvedRig = activeRig;
      const targetOrientation = activeRig.orientation;
      if (targetOrientation.mode === "target-object") {
        const liveTarget = objects.find(
          (object) => object.id === targetOrientation.objectId,
        );
        const storedTarget = state.objects.find(
          (object) => object.id === targetOrientation.objectId,
        );
        const target = targetOrientation.sampling === "live"
          ? liveTarget
          : (() => {
              if (!storedTarget) return undefined;
              const positionTrack = state.animation?.tracks.find((track) => (
                track.targetId === storedTarget.id
                && track.property === "position"
              ));
              const position = positionTrack
                ? samplePositionKeyframes(
                    positionTrack.keyframes,
                    activeSequenceShot.startTime,
                  )
                : undefined;
              return position
                ? {
                    ...storedTarget,
                    transform: {
                      ...storedTarget.transform,
                      position,
                    },
                  } as DirectorStageObject
                : storedTarget;
            })();
        if (target) {
          resolvedRig = {
            ...activeRig,
            orientation: {
              mode: "fixed-target",
              target: directorObjectFocusPoint(
                target,
                targetOrientation.offset,
              ),
            },
          };
        }
      }
      const pose = sampleDirectorCameraRig(
        resolvedRig,
        time - activeSequenceShot.startTime,
        activeSequenceShot.durationSeconds,
      );
      rigCamera.position = pose.position;
      rigCamera.rotation = pose.rotation;
      rigCamera.fov = cameraFovFromFocalLength(
        pose.focalLengthMm,
        rigCamera.optics?.sensorHeightMm,
      );
      if (rigCamera.optics) {
        rigCamera.optics.focalLengthMm = pose.focalLengthMm;
      }
      rigCamera.targetObjectId = undefined;
      rigCamera.targetObjectIds = undefined;
    }
  }

  const activeCameraCue = [...(state.animation?.cameraCues ?? [])]
    .sort((left, right) => left.startTime - right.startTime || left.id.localeCompare(right.id))
    .find((cue) => (
      time >= cue.startTime &&
      (
        time < cue.startTime + cue.durationSeconds ||
        (
          animationDuration !== undefined &&
          Math.abs(time - animationDuration) < 1e-6 &&
          Math.abs(cue.startTime + cue.durationSeconds - animationDuration) < 1e-6
        )
      )
    ));
  const plannedCameraId = activeSequenceShot?.cameraId ?? activeCameraCue?.cameraId;
  const activeCameraId = plannedCameraId
    && cameras.some((camera) => camera.id === plannedCameraId)
    ? plannedCameraId
    : state.activeCameraId;

  return { ...state, activeCameraId, objects, cameras };
}

export type DirectorShotCompositionIssueCode =
  | "axis-crossed"
  | "camera-too-close"
  | "subjects-too-close"
  | "subject-occluded"
  | "headroom"
  | "lead-room";

export interface DirectorShotCompositionIssue {
  code: DirectorShotCompositionIssueCode;
  severity: "warning" | "error";
  shotId: string;
  timeSeconds: number;
  objectId?: string;
  message: string;
}

function directorDistance(
  from: DirectorStageVector3,
  to: DirectorStageVector3,
): number {
  return Math.hypot(
    to[0] - from[0],
    to[1] - from[1],
    to[2] - from[2],
  );
}

function directorCameraScreenPoint(
  camera: DirectorStageCamera,
  point: DirectorStageVector3,
  aspectRatio: DirectorStageAspectRatio,
): [number, number] | undefined {
  const quaternion = directorQuaternionFromEuler(camera.rotation);
  const inverse: DirectorQuaternion = [
    -quaternion[0],
    -quaternion[1],
    -quaternion[2],
    quaternion[3],
  ];
  const rotate = (
    vector: DirectorStageVector3,
    rotation: DirectorQuaternion,
  ): DirectorStageVector3 => {
    const [qx, qy, qz, qw] = rotation;
    const [vx, vy, vz] = vector;
    const ix = qw * vx + qy * vz - qz * vy;
    const iy = qw * vy + qz * vx - qx * vz;
    const iz = qw * vz + qx * vy - qy * vx;
    const iw = -qx * vx - qy * vy - qz * vz;
    return [
      ix * qw + iw * -qx + iy * -qz - iz * -qy,
      iy * qw + iw * -qy + iz * -qx - ix * -qz,
      iz * qw + iw * -qz + ix * -qy - iy * -qx,
    ];
  };
  const local = rotate([
    point[0] - camera.position[0],
    point[1] - camera.position[1],
    point[2] - camera.position[2],
  ], inverse);
  if (local[2] >= -Number.EPSILON) return undefined;
  const [widthRatio, heightRatio] = RATIOS[aspectRatio];
  const aspect = widthRatio / heightRatio;
  const verticalTangent = Math.tan(camera.fov * Math.PI / 360);
  const normalizedX = (local[0] / -local[2]) / (verticalTangent * aspect);
  const normalizedY = (local[1] / -local[2]) / verticalTangent;
  return [(normalizedX + 1) / 2, (1 - normalizedY) / 2];
}

function directorObjectHeight(object: DirectorStageObject): number {
  const scale = Math.abs(object.transform.scale[1]);
  if (object.kind === "mannequin" || object.kind === "crowd" || object.kind === "model") {
    return 1.75 * scale;
  }
  if (object.kind === "creature") return 1.5 * scale;
  if (object.kind === "vehicle") return 1.4 * scale;
  if (object.kind === "primitive") return scale;
  return 2 * scale;
}

/**
 * Audit persisted composition rules at deterministic playhead samples.
 *
 * The checks are intentionally geometry-only so they can run in the editor,
 * export path, and tests without WebGL.
 */
export function auditDirectorShotComposition(
  state: DirectorStageState,
  shotId: string,
  sampleTimes?: readonly number[],
): DirectorShotCompositionIssue[] {
  const shot = state.shotSequence?.find((candidate) => candidate.id === shotId);
  if (!shot?.composition) return [];
  const composition = shot.composition;
  const times = sampleTimes?.length
    ? [...sampleTimes]
    : [
        shot.startTime + shot.durationSeconds * 0.15,
        shot.startTime + shot.durationSeconds * 0.5,
        shot.startTime + shot.durationSeconds * 0.85,
      ];
  const issues: DirectorShotCompositionIssue[] = [];

  for (const sampleTime of times) {
    const evaluated = evaluateDirectorStage(state, sampleTime);
    const camera = evaluated.cameras.find(
      (candidate) => candidate.id === shot.cameraId,
    );
    const primary = evaluated.objects.find(
      (object) => object.id === composition.primarySubjectId,
    );
    if (!camera || !primary) continue;
    const primaryFocus = directorObjectFocusPoint(primary);
    const cameraDistance = directorDistance(camera.position, primaryFocus);
    if (cameraDistance < composition.minimumCameraDistanceM) {
      issues.push({
        code: "camera-too-close",
        severity: "error",
        shotId,
        timeSeconds: sampleTime,
        objectId: primary.id,
        message: `Camera is ${cameraDistance.toFixed(2)}m from the primary subject`,
      });
    }

    for (const secondaryId of composition.secondarySubjectIds ?? []) {
      const secondary = evaluated.objects.find((object) => object.id === secondaryId);
      if (!secondary) continue;
      const separation = directorDistance(
        primary.transform.position,
        secondary.transform.position,
      );
      if (separation < composition.minimumSubjectSeparationM) {
        issues.push({
          code: "subjects-too-close",
          severity: "warning",
          shotId,
          timeSeconds: sampleTime,
          objectId: secondary.id,
          message: `Subjects are only ${separation.toFixed(2)}m apart`,
        });
      }
    }

    const axis = composition.axis;
    if (axis) {
      const from = evaluated.objects.find((object) => object.id === axis.fromObjectId);
      const to = evaluated.objects.find((object) => object.id === axis.toObjectId);
      if (from && to) {
        const lineX = to.transform.position[0] - from.transform.position[0];
        const lineZ = to.transform.position[2] - from.transform.position[2];
        const cameraX = camera.position[0] - from.transform.position[0];
        const cameraZ = camera.position[2] - from.transform.position[2];
        const cross = lineX * cameraZ - lineZ * cameraX;
        const actualSide = cross >= 0 ? "left" : "right";
        if (actualSide !== axis.cameraSide) {
          issues.push({
            code: "axis-crossed",
            severity: "error",
            shotId,
            timeSeconds: sampleTime,
            message: `Camera is on the ${actualSide} side of the dialogue axis`,
          });
        }
      }
    }

    const line: DirectorStageVector3 = [
      primaryFocus[0] - camera.position[0],
      primaryFocus[1] - camera.position[1],
      primaryFocus[2] - camera.position[2],
    ];
    const lineLengthSquared = line.reduce(
      (sum, component) => sum + component * component,
      0,
    );
    if (lineLengthSquared > Number.EPSILON) {
      for (const obstacle of evaluated.objects) {
        if (!obstacle.visible || obstacle.id === primary.id) continue;
        const obstacleFocus = directorObjectFocusPoint(obstacle);
        const relative: DirectorStageVector3 = [
          obstacleFocus[0] - camera.position[0],
          obstacleFocus[1] - camera.position[1],
          obstacleFocus[2] - camera.position[2],
        ];
        const projection = relative.reduce(
          (sum, component, index) => sum + component * line[index]!,
          0,
        ) / lineLengthSquared;
        if (projection <= 0.05 || projection >= 0.95) continue;
        const closest: DirectorStageVector3 = [
          camera.position[0] + line[0] * projection,
          camera.position[1] + line[1] * projection,
          camera.position[2] + line[2] * projection,
        ];
        const clearance = directorDistance(obstacleFocus, closest);
        const radius = Math.max(
          obstacle.kind === "mannequin" || obstacle.kind === "model" ? 0.5 : 0.3,
          Math.max(
            ...obstacle.transform.scale.map((component) => Math.abs(component)),
          ) * 0.4,
        );
        if (clearance < radius) {
          issues.push({
            code: "subject-occluded",
            severity: "warning",
            shotId,
            timeSeconds: sampleTime,
            objectId: obstacle.id,
            message: `${obstacle.name} overlaps the primary line of sight`,
          });
        }
      }
    }

    const headTop: DirectorStageVector3 = [
      primary.transform.position[0],
      primary.transform.position[1] + directorObjectHeight(primary),
      primary.transform.position[2],
    ];
    const headScreen = directorCameraScreenPoint(camera, headTop, shot.aspectRatio);
    const feetScreen = directorCameraScreenPoint(
      camera,
      primary.transform.position,
      shot.aspectRatio,
    );
    const subjectScreenHeight = headScreen && feetScreen
      ? Math.abs(feetScreen[1] - headScreen[1])
      : 1;
    if (
      !headScreen
      || headScreen[1] < 0
      || headScreen[1] > 0.55
      || (
        subjectScreenHeight >= 0.45
        && Math.abs(headScreen[1] - composition.headroomRatio) > 0.2
      )
    ) {
      issues.push({
        code: "headroom",
        severity: "warning",
        shotId,
        timeSeconds: sampleTime,
        objectId: primary.id,
        message: "Primary subject headroom falls outside the requested composition",
      });
    }

    const focusScreen = directorCameraScreenPoint(camera, primaryFocus, shot.aspectRatio);
    if (focusScreen) {
      const facingRight = Math.sin(primary.transform.rotation[1]) >= 0;
      const availableLeadRoom = facingRight ? 1 - focusScreen[0] : focusScreen[0];
      if (availableLeadRoom < composition.leadRoomRatio) {
        issues.push({
          code: "lead-room",
          severity: "warning",
          shotId,
          timeSeconds: sampleTime,
          objectId: primary.id,
          message: "Primary subject lacks the requested lead room",
        });
      }
    }
  }
  return issues;
}

const RATIOS: Record<DirectorStageAspectRatio, readonly [number, number]> = {
  "16:9": [16, 9],
  "9:16": [9, 16],
  "4:3": [4, 3],
  "3:4": [3, 4],
  "1:1": [1, 1],
};

/** Resolve exact integer capture dimensions while keeping the requested long edge. */
export function aspectRatioDimensions(
  aspectRatio: DirectorStageAspectRatio,
  longEdge: number,
): { width: number; height: number } {
  const edge = Math.max(1, Math.round(longEdge));
  const [widthRatio, heightRatio] = RATIOS[aspectRatio];
  if (widthRatio >= heightRatio) {
    return {
      width: edge,
      height: Math.round(edge * heightRatio / widthRatio),
    };
  }
  return {
    width: Math.round(edge * widthRatio / heightRatio),
    height: edge,
  };
}
