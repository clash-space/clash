import * as THREE from "three";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import type { EvaluatedDirectorActionClip } from "@clash/director-core";
import { auditDirectorHumanoidMotion } from "./humanoid-profile";
import type { DirectorHumanoidMotionAudit } from "./humanoid-profile";

type DirectorRetargetClipOptions = Parameters<typeof SkeletonUtils.retargetClip>[3] & {
  localOffsets?: Record<string, THREE.Matrix4>;
  preserveBonePositions?: boolean;
};

const TARGET_TO_SOURCE_BONE = {
  hips: ["hips", "pelvis"],
  spine: ["abdomen", "spine01", "spine"],
  spine1: ["torso", "spine02", "spine2"],
  spine2: ["chest", "spine03", "spine3"],
  neck: ["neck", "neck01"],
  head: ["head"],
  leftshoulder: ["shoulderl", "claviclel"],
  leftarm: ["upperarml"],
  leftforearm: ["lowerarml"],
  lefthand: ["wristl", "handl"],
  leftupleg: ["upperlegl", "thighl"],
  leftleg: ["lowerlegl", "calfl"],
  leftfoot: ["footl"],
  lefttoebase: ["ptl", "balll"],
  rightshoulder: ["shoulderr", "clavicler"],
  rightarm: ["upperarmr"],
  rightforearm: ["lowerarmr"],
  righthand: ["wristr", "handr"],
  rightupleg: ["upperlegr", "thighr"],
  rightleg: ["lowerlegr", "calfr"],
  rightfoot: ["footr"],
  righttoebase: ["ptr", "ballr"],
} as const;

const DIRECTIONAL_CHILD_BONE = {
  leftarm: "leftforearm",
  leftforearm: "lefthand",
  rightarm: "rightforearm",
  rightforearm: "righthand",
  leftupleg: "leftleg",
  leftleg: "leftfoot",
  rightupleg: "rightleg",
  rightleg: "rightfoot",
} as const;

const DIRECTIONAL_SWING_WEIGHT: Partial<Record<keyof typeof DIRECTIONAL_CHILD_BONE, number>> = {
  leftarm: 0.32,
  rightarm: 0.32,
};

const LOCOMOTION_UPPER_ARM_SWING_WEIGHT = 0.68;

function normalizedBoneName(name: string): string {
  return name
    .replace(/^mixamorig/i, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
}

function skinnedMesh(root: THREE.Object3D): THREE.SkinnedMesh {
  let result: THREE.SkinnedMesh | undefined;
  root.traverse((object) => {
    if (!result && object instanceof THREE.SkinnedMesh) result = object;
  });
  if (!result) throw new Error("Director humanoid motion requires a skinned mesh");
  return result;
}

function sourceBoneNameForTarget(
  targetBone: THREE.Bone,
  sourceBonesByName: ReadonlyMap<string, THREE.Bone>,
): string | undefined {
  const targetName = normalizedBoneName(targetBone.name);
  const mappedNames = TARGET_TO_SOURCE_BONE[targetName as keyof typeof TARGET_TO_SOURCE_BONE];
  return mappedNames
    ?.map((mappedName) => sourceBonesByName.get(mappedName)?.name)
    .find((name) => name !== undefined);
}

function restPoseOffsets(
  targetBones: readonly THREE.Bone[],
  sourceBonesByName: ReadonlyMap<string, THREE.Bone>,
): Record<string, THREE.Matrix4> {
  const offsets: Record<string, THREE.Matrix4> = {};
  const sourceRotation = new THREE.Quaternion();
  const targetRotation = new THREE.Quaternion();
  for (const targetBone of targetBones) {
    const sourceName = sourceBoneNameForTarget(targetBone, sourceBonesByName);
    const sourceBone = sourceName
      ? sourceBonesByName.get(normalizedBoneName(sourceName))
      : undefined;
    if (!sourceBone) continue;
    sourceBone.getWorldQuaternion(sourceRotation);
    targetBone.getWorldQuaternion(targetRotation);
    offsets[targetBone.name] = new THREE.Matrix4().makeRotationFromQuaternion(
      sourceRotation.clone().invert().multiply(targetRotation),
    );
  }
  return offsets;
}

function boneNameFromQuaternionTrack(track: THREE.KeyframeTrack): string | undefined {
  return /^\.bones\[([^\]]+)\]\.quaternion$/.exec(track.name)?.[1];
}

function correctRetargetedBoneDirections({
  targetMesh,
  sourceMesh,
  sourceBonesByName,
  sourceClip,
  retargetedClip,
}: {
  targetMesh: THREE.SkinnedMesh;
  sourceMesh: THREE.SkinnedMesh;
  sourceBonesByName: ReadonlyMap<string, THREE.Bone>;
  sourceClip: THREE.AnimationClip;
  retargetedClip: THREE.AnimationClip;
}): void {
  const targetBonesByName = new Map(
    targetMesh.skeleton.bones.map((bone) => [normalizedBoneName(bone.name), bone]),
  );
  const tracksByBone = new Map<string, THREE.QuaternionKeyframeTrack>();
  for (const track of retargetedClip.tracks) {
    const boneName = boneNameFromQuaternionTrack(track);
    if (boneName && track instanceof THREE.QuaternionKeyframeTrack) {
      tracksByBone.set(normalizedBoneName(boneName), track);
    }
  }
  const referenceTrack = tracksByBone.values().next().value as THREE.QuaternionKeyframeTrack | undefined;
  if (!referenceTrack) return;

  const sourceMixer = new THREE.AnimationMixer(sourceMesh);
  const targetMixer = new THREE.AnimationMixer(targetMesh);
  const sourceAction = sourceMixer.clipAction(sourceClip).play();
  const targetAction = targetMixer.clipAction(retargetedClip).play();
  sourceAction.paused = true;
  targetAction.paused = true;
  const sourceStart = new THREE.Vector3();
  const sourceEnd = new THREE.Vector3();
  const targetStart = new THREE.Vector3();
  const targetEnd = new THREE.Vector3();
  const sourceDirection = new THREE.Vector3();
  const targetDirection = new THREE.Vector3();
  const fullSwing = new THREE.Quaternion();
  const swing = new THREE.Quaternion();
  const worldRotation = new THREE.Quaternion();
  const parentWorldRotation = new THREE.Quaternion();
  const localRotation = new THREE.Quaternion();
  const previousRotation = new THREE.Quaternion();

  for (let frameIndex = 0; frameIndex < referenceTrack.times.length; frameIndex += 1) {
    const time = referenceTrack.times[frameIndex] ?? 0;
    sourceAction.time = time;
    targetAction.time = time;
    sourceMixer.update(0);
    targetMixer.update(0);
    sourceMesh.updateMatrixWorld(true);
    targetMesh.updateMatrixWorld(true);

    for (const [targetName, childName] of Object.entries(DIRECTIONAL_CHILD_BONE)) {
      const targetBone = targetBonesByName.get(targetName);
      const targetChild = targetBonesByName.get(childName);
      const targetTrack = tracksByBone.get(targetName);
      if (!targetBone || !targetChild || !targetTrack) continue;
      const sourceBone = TARGET_TO_SOURCE_BONE[
        targetName as keyof typeof TARGET_TO_SOURCE_BONE
      ]
        ?.map((name) => sourceBonesByName.get(name))
        .find((bone) => bone !== undefined);
      const sourceChild = TARGET_TO_SOURCE_BONE[
        childName as keyof typeof TARGET_TO_SOURCE_BONE
      ]
        ?.map((name) => sourceBonesByName.get(name))
        .find((bone) => bone !== undefined);
      if (!sourceBone || !sourceChild) continue;

      sourceBone.getWorldPosition(sourceStart);
      sourceChild.getWorldPosition(sourceEnd);
      targetBone.getWorldPosition(targetStart);
      targetChild.getWorldPosition(targetEnd);
      sourceDirection.subVectors(sourceEnd, sourceStart).normalize();
      targetDirection.subVectors(targetEnd, targetStart).normalize();
      if (sourceDirection.lengthSq() < 0.5 || targetDirection.lengthSq() < 0.5) continue;

      fullSwing.setFromUnitVectors(targetDirection, sourceDirection);
      swing.identity().slerp(
        fullSwing,
        sourceClip.name !== ANNY_SOURCE_CLIP_NAMES.wave
          && (targetName === "leftarm" || targetName === "rightarm")
          ? LOCOMOTION_UPPER_ARM_SWING_WEIGHT
          : DIRECTIONAL_SWING_WEIGHT[targetName as keyof typeof DIRECTIONAL_CHILD_BONE] ?? 1,
      );
      targetBone.getWorldQuaternion(worldRotation);
      worldRotation.premultiply(swing);
      targetBone.parent?.getWorldQuaternion(parentWorldRotation);
      localRotation.copy(parentWorldRotation).invert().multiply(worldRotation).normalize();
      if (frameIndex > 0) {
        previousRotation.fromArray(targetTrack.values, (frameIndex - 1) * 4);
        if (previousRotation.dot(localRotation) < 0) {
          localRotation.set(-localRotation.x, -localRotation.y, -localRotation.z, -localRotation.w);
        }
      }
      localRotation.toArray(targetTrack.values, frameIndex * 4);
      targetBone.quaternion.copy(localRotation);
      targetBone.updateMatrixWorld(true);
    }
  }

  sourceMixer.stopAllAction();
  targetMixer.stopAllAction();
  sourceMixer.uncacheRoot(sourceMesh);
  targetMixer.uncacheRoot(targetMesh);
}

function rootBindableTrack(track: THREE.KeyframeTrack): THREE.KeyframeTrack {
  const cloned = track.clone();
  cloned.name = cloned.name.replace(
    /^\.bones\[([^\]]+)\](\..+)$/,
    "$1$2",
  );
  return cloned;
}

const ANNY_SOURCE_CLIP_NAMES = {
  idle: "Idle_Neutral",
  walk: "Walk",
  run: "Run",
  sit: "Sit",
  crouch: "Crouch",
  kneel: "Kneel",
  wave: "Wave",
  interact: "Interact",
  talk: "Idle_Talking_Loop",
  dance: "Dance_Loop",
  jump: "Jump_Loop",
  roll: "Roll",
  pickup: "PickUp_Table",
  push: "Push_Loop",
  punch: "Punch_Cross",
  swim: "Swim_Fwd_Loop",
  drive: "Driving_Loop",
  death: "Death01",
} as const;

export const CLASH_HUMANOID_MOTION_SOURCES = Object.freeze([
  Object.freeze({
    id: "quaternius-casual-hoodie",
    sourcePageUrl: "https://quaternius.com/packs/ultimatemodularcharacters.html",
    sourceUrl: new URL(
      "../assets/starter-library/models/Casual_Hoodie.gltf",
      import.meta.url,
    ).href,
    license: "CC0-1.0",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    sourceSha256: "dd74886c26998a0fa888b4ce557a0932d7d97b0265dd4c763154d081b7a6cb98",
  }),
  Object.freeze({
    id: "quaternius-universal-animation-standard",
    sourcePageUrl: "https://quaternius.com/packs/universalanimationlibrary.html",
    sourceUrl: new URL(
      "../assets/starter-library/motions/UAL1_Standard.glb",
      import.meta.url,
    ).href,
    license: "CC0-1.0",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    sourceSha256: "69591853d817488edaa8fd9bf8fc1d821eaeaf789f8627b3cd23b41c4ed67997",
  }),
] as const);

export const CLASH_HUMANOID_MOTION_CATALOG_V1 = Object.freeze({
  id: "quaternius-ual1-standard-v1",
  sourceId: "quaternius-universal-animation-standard",
  clips: Object.freeze([
    { id: "t-pose", sourceClip: "A_TPose", category: "utility", loop: false },
    { id: "crouch-forward", sourceClip: "Crouch_Fwd_Loop", category: "locomotion", loop: true },
    { id: "crouch", sourceClip: "Crouch_Idle_Loop", category: "posture", loop: true },
    { id: "dance", sourceClip: "Dance_Loop", category: "performance", loop: true },
    { id: "death", sourceClip: "Death01", category: "performance", loop: false },
    { id: "drive", sourceClip: "Driving_Loop", category: "interaction", loop: true },
    { id: "kneel-fix", sourceClip: "Fixing_Kneeling", category: "interaction", loop: false },
    { id: "hit-chest", sourceClip: "Hit_Chest", category: "combat", loop: false },
    { id: "hit-head", sourceClip: "Hit_Head", category: "combat", loop: false },
    { id: "idle", sourceClip: "Idle_Loop", category: "idle", loop: true },
    { id: "talk", sourceClip: "Idle_Talking_Loop", category: "performance", loop: true },
    { id: "torch-idle", sourceClip: "Idle_Torch_Loop", category: "prop", loop: true, prop: "torch" },
    { id: "interact", sourceClip: "Interact", category: "interaction", loop: false },
    { id: "jog", sourceClip: "Jog_Fwd_Loop", category: "locomotion", loop: true },
    { id: "jump-land", sourceClip: "Jump_Land", category: "locomotion", loop: false },
    { id: "jump", sourceClip: "Jump_Loop", category: "locomotion", loop: true },
    { id: "jump-start", sourceClip: "Jump_Start", category: "locomotion", loop: false },
    { id: "pickup", sourceClip: "PickUp_Table", category: "interaction", loop: false },
    { id: "pistol-aim-down", sourceClip: "Pistol_Aim_Down", category: "prop", loop: false, prop: "pistol" },
    { id: "pistol-aim", sourceClip: "Pistol_Aim_Neutral", category: "prop", loop: false, prop: "pistol" },
    { id: "pistol-aim-up", sourceClip: "Pistol_Aim_Up", category: "prop", loop: false, prop: "pistol" },
    { id: "pistol-idle", sourceClip: "Pistol_Idle_Loop", category: "prop", loop: true, prop: "pistol" },
    { id: "pistol-reload", sourceClip: "Pistol_Reload", category: "prop", loop: false, prop: "pistol" },
    { id: "pistol-shoot", sourceClip: "Pistol_Shoot", category: "prop", loop: false, prop: "pistol" },
    { id: "punch-cross", sourceClip: "Punch_Cross", category: "combat", loop: false },
    { id: "punch-jab", sourceClip: "Punch_Jab", category: "combat", loop: false },
    { id: "push", sourceClip: "Push_Loop", category: "interaction", loop: true },
    { id: "roll", sourceClip: "Roll", category: "locomotion", loop: false },
    { id: "sit-enter", sourceClip: "Sitting_Enter", category: "posture", loop: false },
    { id: "sit-exit", sourceClip: "Sitting_Exit", category: "posture", loop: false },
    { id: "sit", sourceClip: "Sitting_Idle_Loop", category: "posture", loop: true },
    { id: "sit-talk", sourceClip: "Sitting_Talking_Loop", category: "performance", loop: true },
    { id: "spell-enter", sourceClip: "Spell_Simple_Enter", category: "performance", loop: false },
    { id: "spell-exit", sourceClip: "Spell_Simple_Exit", category: "performance", loop: false },
    { id: "spell-idle", sourceClip: "Spell_Simple_Idle_Loop", category: "performance", loop: true },
    { id: "spell-cast", sourceClip: "Spell_Simple_Shoot", category: "performance", loop: false },
    { id: "sprint", sourceClip: "Sprint_Loop", category: "locomotion", loop: true },
    { id: "swim", sourceClip: "Swim_Fwd_Loop", category: "locomotion", loop: true },
    { id: "swim-idle", sourceClip: "Swim_Idle_Loop", category: "posture", loop: true },
    { id: "sword-attack", sourceClip: "Sword_Attack", category: "prop", loop: false, prop: "sword" },
    { id: "sword-idle", sourceClip: "Sword_Idle", category: "prop", loop: true, prop: "sword" },
    { id: "walk-formal", sourceClip: "Walk_Formal_Loop", category: "locomotion", loop: true },
    { id: "walk", sourceClip: "Walk_Loop", category: "locomotion", loop: true },
  ]),
} as const);

export const CLASH_HUMANOID_ACTION_LIBRARY_V1 = Object.freeze({
  id: "clash-humanoid-actions-v1",
  version: 1,
  profileId: "clash-humanoid-v1",
  sourceAssetId: "builtin:quaternius:casual-hoodie",
  sourceLicense: "CC0-1.0",
  actions: Object.freeze([
    { id: "idle", sourceId: "quaternius-casual-hoodie", sourceClip: "Idle_Neutral", layer: "full-body", loop: true },
    { id: "walk", sourceId: "quaternius-casual-hoodie", sourceClip: "Walk", layer: "full-body", loop: true },
    { id: "run", sourceId: "quaternius-casual-hoodie", sourceClip: "Run", layer: "full-body", loop: true },
    { id: "sit", sourceId: "quaternius-universal-animation-standard", sourceClip: "Sitting_Idle_Loop", layer: "full-body", loop: true },
    { id: "crouch", sourceId: "quaternius-universal-animation-standard", sourceClip: "Crouch_Idle_Loop", layer: "full-body", loop: true },
    { id: "kneel", sourceId: "quaternius-universal-animation-standard", sourceClip: "Fixing_Kneeling", layer: "full-body", loop: false },
    { id: "wave", sourceId: "quaternius-casual-hoodie", sourceClip: "Wave", layer: "upper-body", loop: true },
    { id: "interact", sourceId: "quaternius-casual-hoodie", sourceClip: "Interact", layer: "full-body", loop: false },
    { id: "talk", sourceId: "quaternius-universal-animation-standard", sourceClip: "Idle_Talking_Loop", layer: "full-body", loop: true },
    { id: "dance", sourceId: "quaternius-universal-animation-standard", sourceClip: "Dance_Loop", layer: "full-body", loop: true },
    { id: "jump", sourceId: "quaternius-universal-animation-standard", sourceClip: "Jump_Loop", layer: "full-body", loop: true },
    { id: "roll", sourceId: "quaternius-universal-animation-standard", sourceClip: "Roll", layer: "full-body", loop: false },
    { id: "pickup", sourceId: "quaternius-universal-animation-standard", sourceClip: "PickUp_Table", layer: "full-body", loop: false },
    { id: "push", sourceId: "quaternius-universal-animation-standard", sourceClip: "Push_Loop", layer: "full-body", loop: true },
    { id: "punch", sourceId: "quaternius-universal-animation-standard", sourceClip: "Punch_Cross", layer: "full-body", loop: false },
    { id: "swim", sourceId: "quaternius-universal-animation-standard", sourceClip: "Swim_Fwd_Loop", layer: "full-body", loop: true },
    { id: "drive", sourceId: "quaternius-universal-animation-standard", sourceClip: "Driving_Loop", layer: "full-body", loop: true },
    { id: "death", sourceId: "quaternius-universal-animation-standard", sourceClip: "Death01", layer: "full-body", loop: false },
  ]),
} as const);

const ANNY_LOCOMOTION_AUTHORED_SPEED_METERS_PER_SECOND = {
  Walk: 1.5,
  Run: 3.6,
} as const;

export interface DirectorAnnyMotionPlayback {
  base: {
    clipName: string;
    localTimeSeconds: number;
    playbackRate?: number;
    weight: number;
  };
  upperBody?: {
    clipName: string;
    localTimeSeconds: number;
    weight: number;
  };
}

export function resolveDirectorAnnyMotionPlayback({
  posePreset,
  activeActions,
  locomotionSpeed,
  locomotionDistance,
  locomotionSpeeds,
  availableClipNames,
  timeSeconds,
}: {
  posePreset?: string;
  activeActions: EvaluatedDirectorActionClip[];
  locomotionSpeed: number;
  locomotionDistance?: number;
  locomotionSpeeds?: Partial<Record<"Walk" | "Run", number>>;
  availableClipNames?: readonly string[];
  timeSeconds: number;
}): DirectorAnnyMotionPlayback | undefined {
  if (posePreset !== "standing" && posePreset !== "walking") return undefined;
  if (activeActions.some(({ clip }) => !(clip.action in ANNY_SOURCE_CLIP_NAMES))) {
    return undefined;
  }

  const fullBody = [...activeActions].reverse().find(({ clip }) => clip.layer === "full-body");
  const requestedFullBodyClip = fullBody
    ? ANNY_SOURCE_CLIP_NAMES[fullBody.clip.action as keyof typeof ANNY_SOURCE_CLIP_NAMES]
    : undefined;
  const preferredLocomotionClip = locomotionSpeed > 1.5
    ? ANNY_SOURCE_CLIP_NAMES.run
    : locomotionSpeed > 0.04
      ? ANNY_SOURCE_CLIP_NAMES.walk
      : ANNY_SOURCE_CLIP_NAMES.idle;
  const isAvailable = (clipName: string): boolean => (
    availableClipNames === undefined || availableClipNames.includes(clipName)
  );
  if (requestedFullBodyClip && !isAvailable(requestedFullBodyClip)) return undefined;
  const locomotionClip = isAvailable(preferredLocomotionClip)
    ? preferredLocomotionClip
    : isAvailable(ANNY_SOURCE_CLIP_NAMES.walk)
      ? ANNY_SOURCE_CLIP_NAMES.walk
      : ANNY_SOURCE_CLIP_NAMES.idle;
  const upperBody = [...activeActions]
    .reverse()
    .find(({ clip }) => clip.layer === "upper-body" && clip.action === "wave");
  const authoredLocomotionSpeed = !fullBody
    ? locomotionSpeeds?.[
      locomotionClip as keyof typeof ANNY_LOCOMOTION_AUTHORED_SPEED_METERS_PER_SECOND
    ] ?? ANNY_LOCOMOTION_AUTHORED_SPEED_METERS_PER_SECOND[
      locomotionClip as keyof typeof ANNY_LOCOMOTION_AUTHORED_SPEED_METERS_PER_SECOND
    ]
    : undefined;
  const locomotionPlaybackRate = authoredLocomotionSpeed
    ? Math.round((locomotionSpeed / authoredLocomotionSpeed) * 1_000_000) / 1_000_000
    : undefined;

  return {
    base: {
      clipName: requestedFullBodyClip ?? locomotionClip,
      localTimeSeconds: fullBody?.localTimeSeconds
        ?? (authoredLocomotionSpeed && locomotionDistance !== undefined
          ? Math.max(0, locomotionDistance) / authoredLocomotionSpeed
          : Math.max(0, timeSeconds) * (locomotionPlaybackRate ?? 1)),
      ...(locomotionPlaybackRate !== undefined
        ? { playbackRate: locomotionPlaybackRate }
        : {}),
      weight: fullBody?.weight ?? 1,
    },
    ...(upperBody ? {
      upperBody: {
        clipName: ANNY_SOURCE_CLIP_NAMES.wave,
        localTimeSeconds: upperBody.localTimeSeconds,
        weight: upperBody.weight,
      },
    } : {}),
  };
}

function isWaveGestureTrack(track: THREE.KeyframeTrack): boolean {
  const boneName = normalizedBoneName(track.name.split(".")[0] ?? "");
  return boneName === "head"
    || boneName === "neck"
    || boneName.startsWith("spine")
    || boneName.startsWith("leftshoulder")
    || boneName.startsWith("leftarm")
    || boneName.startsWith("leftforearm")
    || boneName.startsWith("lefthand");
}

function createDirectorBoneMaskedClip(
  source: THREE.AnimationClip,
  includeTrack: (track: THREE.KeyframeTrack) => boolean,
): THREE.AnimationClip {
  const clip = new THREE.AnimationClip(source.name, source.duration, source.tracks
    .filter(includeTrack)
    .map((track) => track.clone()));
  clip.blendMode = THREE.NormalAnimationBlendMode;
  return clip;
}

function withoutLocomotionHandRotation(source: THREE.AnimationClip): THREE.AnimationClip {
  const clip = new THREE.AnimationClip(source.name, source.duration, source.tracks
    .filter((track) => {
      const boneName = normalizedBoneName(track.name.split(".")[0] ?? "");
      return !track.name.endsWith(".quaternion")
        || (boneName !== "lefthand" && boneName !== "righthand");
    })
    .map((track) => track.clone()));
  clip.blendMode = source.blendMode;
  return clip;
}

function withoutWaveContactFrames(source: THREE.AnimationClip): THREE.AnimationClip {
  const sourceFramesPerSecond = 30;
  const finalFrame = Math.round(source.duration * sourceFramesPerSecond);
  return THREE.AnimationUtils.subclip(
    source,
    source.name,
    2,
    Math.max(3, finalFrame - 1),
    sourceFramesPerSecond,
  );
}

export interface DirectorAnnyMotionClipLibrary {
  clips: Record<string, THREE.AnimationClip>;
  lowerBodyClips: Record<string, THREE.AnimationClip>;
  upperBodyClips: Record<string, THREE.AnimationClip>;
  locomotionSpeeds: Record<"Walk" | "Run", number>;
  qaReports: Record<string, DirectorHumanoidMotionAudit>;
  releaseReadyClipNames: string[];
}

export interface DirectorHumanoidMotionSource {
  id: string;
  source: THREE.Object3D;
  animations: readonly THREE.AnimationClip[];
}

export function createDirectorAnnyMotionClipLibrary({
  target,
  source,
  animations,
  supplementalSources = [],
}: {
  target: THREE.Object3D;
  source: THREE.Object3D;
  animations: readonly THREE.AnimationClip[];
  supplementalSources?: readonly DirectorHumanoidMotionSource[];
}): DirectorAnnyMotionClipLibrary {
  const sourcesById = new Map<string, DirectorHumanoidMotionSource>([
    ["quaternius-casual-hoodie", {
      id: "quaternius-casual-hoodie",
      source,
      animations,
    }],
    ...supplementalSources.map((motionSource) => [
      motionSource.id,
      motionSource,
    ] as const),
  ]);
  const clips: Record<string, THREE.AnimationClip> = {};
  for (const action of CLASH_HUMANOID_ACTION_LIBRARY_V1.actions) {
    const clipName = ANNY_SOURCE_CLIP_NAMES[
      action.id as keyof typeof ANNY_SOURCE_CLIP_NAMES
    ];
    if (!clipName) continue;
    const motionSource = sourcesById.get(action.sourceId);
    if (!motionSource) continue;
    const sourceClip = motionSource.animations.find(
      (animation) => animation.name === action.sourceClip,
    );
    if (!sourceClip) {
      throw new Error(
        `Director Anny motion source ${action.sourceId} is missing ${action.sourceClip}`,
      );
    }
    const retargeted = retargetDirectorHumanoidClip({
      target,
      source: motionSource.source,
      clip: sourceClip,
      inPlace: true,
    });
    retargeted.name = clipName;
    clips[clipName] = clipName === ANNY_SOURCE_CLIP_NAMES.walk
      || clipName === ANNY_SOURCE_CLIP_NAMES.run
      ? withoutLocomotionHandRotation(retargeted)
      : clipName === ANNY_SOURCE_CLIP_NAMES.wave
        ? createDirectorBoneMaskedClip(
          withoutWaveContactFrames(retargeted),
          isWaveGestureTrack,
        )
        : retargeted;
  }
  const locomotionSpeeds = Object.fromEntries(
    (["Walk", "Run"] as const).map((clipName) => [
      clipName,
      auditDirectorHumanoidMotion({
        root: target,
        clip: clips[clipName]!,
        actorSpeedMetersPerSecond: 0,
        maximumMeanFootSlideMetersPerSecond: Number.POSITIVE_INFINITY,
        maximumContactHeightDeltaMeters: Number.POSITIVE_INFINITY,
        minimumArmClearanceRatio: Number.NEGATIVE_INFINITY,
      }).metrics.recommendedActorSpeedMetersPerSecond,
    ]),
  ) as Record<"Walk" | "Run", number>;
  const qaReports = Object.fromEntries(
    Object.entries(clips).map(([clipName, clip]) => [
      clipName,
      auditDirectorHumanoidMotion({
        root: target,
        clip,
        actorSpeedMetersPerSecond: clipName === "Walk" || clipName === "Run"
          ? locomotionSpeeds[clipName]
          : 0,
        maximumMeanFootSlideMetersPerSecond: clipName === "Kneel"
          || clipName === "Jump_Loop"
          ? Number.POSITIVE_INFINITY
          : clipName === "Dance_Loop" || clipName === "Push_Loop"
            ? 0.32
            : 0.25,
        maximumContactHeightDeltaMeters: clipName === "Crouch"
          ? 0.1
          : clipName === "Kneel"
            || clipName === "Jump_Loop"
            ? Number.POSITIVE_INFINITY
            : clipName === "Push_Loop"
              ? 0.03
            : 0.02,
        minimumHandToUpperLegClearanceRatio: clipName === "Kneel"
          ? Number.NEGATIVE_INFINITY
          : 0.04,
      }),
    ]),
  );
  const releaseReadyClipNames = Object.entries(qaReports)
    .filter(([, report]) => report.issues.length === 0)
    .map(([clipName]) => clipName);
  return {
    clips,
    locomotionSpeeds,
    qaReports,
    releaseReadyClipNames,
    lowerBodyClips: Object.fromEntries(
      Object.entries(clips).map(([name, clip]) => [
        name,
        createDirectorBoneMaskedClip(clip, (track) => !isWaveGestureTrack(track)),
      ]),
    ),
    upperBodyClips: {
      Wave: createDirectorBoneMaskedClip(clips.Wave, isWaveGestureTrack),
    },
  };
}

/**
 * Retargets a humanoid clip onto Anny while preserving the target bind pose.
 * The returned tracks bind from the character root and can be played by a
 * normal AnimationMixer without changing the visible actor identity.
 */
export function retargetDirectorHumanoidClip({
  target,
  source,
  clip,
  inPlace = true,
}: {
  target: THREE.Object3D;
  source: THREE.Object3D;
  clip: THREE.AnimationClip;
  inPlace?: boolean;
}): THREE.AnimationClip {
  const targetMesh = skinnedMesh(target);
  const sourceMesh = skinnedMesh(source);
  targetMesh.skeleton.pose();
  sourceMesh.skeleton.pose();
  target.updateWorldMatrix(true, true);
  source.updateWorldMatrix(true, true);

  const sourceBonesByName = new Map(
    sourceMesh.skeleton.bones.map((bone) => [normalizedBoneName(bone.name), bone]),
  );
  const names: Record<string, string> = {};
  for (const targetBone of targetMesh.skeleton.bones) {
    const sourceName = sourceBoneNameForTarget(targetBone, sourceBonesByName);
    if (sourceName) names[targetBone.name] = sourceName;
  }
  const sourceHip = sourceBonesByName.get("hips");
  const options: DirectorRetargetClipOptions = {
    names,
    hip: sourceHip?.name ?? "Hips",
    hipInfluence: inPlace
      ? new THREE.Vector3(0, 0, 0)
      : new THREE.Vector3(1, 1, 1),
    preserveBoneMatrix: true,
    preserveBonePositions: true,
    localOffsets: restPoseOffsets(targetMesh.skeleton.bones, sourceBonesByName),
  };
  const retargeted = SkeletonUtils.retargetClip(targetMesh, sourceMesh, clip, options);
  correctRetargetedBoneDirections({
    targetMesh,
    sourceMesh,
    sourceBonesByName,
    sourceClip: clip,
    retargetedClip: retargeted,
  });
  const tracks = retargeted.tracks
    .filter((track) => !inPlace || !track.name.endsWith(".position"))
    .map(rootBindableTrack);

  targetMesh.skeleton.pose();
  sourceMesh.skeleton.pose();
  target.updateWorldMatrix(true, true);
  source.updateWorldMatrix(true, true);
  return new THREE.AnimationClip(clip.name, retargeted.duration, tracks);
}
