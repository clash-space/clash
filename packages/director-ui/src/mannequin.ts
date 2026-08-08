import * as THREE from "three";
import type { EvaluatedDirectorActionClip } from "@clash/director-core";
import type {
  DirectorStageActionName,
  DirectorStageVector3,
} from "@clash/shared-types";

export type DirectorMannequinPosePreset = {
  label: string;
  joints: Record<string, DirectorStageVector3>;
};

export const DIRECTOR_MANNEQUIN_POSE_PRESETS = {
  standing: { label: "Standing", joints: {} },
  "t-pose": {
    label: "T-pose",
    joints: {
      leftArm: [0, 0, Math.PI / 2],
      rightArm: [0, 0, -Math.PI / 2],
    },
  },
  walking: {
    label: "Walking",
    joints: {
      leftArm: [0.48, 0, 0],
      rightArm: [-0.48, 0, 0],
      leftLeg: [-0.46, 0, 0],
      rightLeg: [0.46, 0, 0],
      rightCalf: [0.42, 0, 0],
    },
  },
  running: {
    label: "Running",
    joints: {
      torso: [0.18, 0, 0],
      leftArm: [0.9, 0, 0],
      rightArm: [-0.9, 0, 0],
      leftForearm: [-1.1, 0, 0],
      rightForearm: [-1.1, 0, 0],
      leftLeg: [-0.88, 0, 0],
      rightLeg: [0.72, 0, 0],
      rightCalf: [1.18, 0, 0],
    },
  },
  sitting: {
    label: "Sitting",
    joints: {
      torso: [0.08, 0, 0],
      leftLeg: [-Math.PI / 2, 0, 0],
      rightLeg: [-Math.PI / 2, 0, 0],
      leftCalf: [-Math.PI / 2, 0, 0],
      rightCalf: [-Math.PI / 2, 0, 0],
    },
  },
  riding: {
    label: "Riding",
    joints: {
      torso: [0.08, 0, 0],
      pelvis: [-0.08, 0, 0],
      leftLeg: [-1.22, 0.18, -0.32],
      rightLeg: [-1.22, -0.18, 0.32],
      leftCalf: [-0.72, 0, 0],
      rightCalf: [-0.72, 0, 0],
      leftArm: [0.18, 0.08, -0.16],
      rightArm: [0.18, -0.08, 0.16],
      leftForearm: [-1.05, 0, 0],
      rightForearm: [-1.05, 0, 0],
    },
  },
  crouching: {
    label: "Crouching",
    joints: {
      torso: [0.36, 0, 0],
      leftLeg: [-0.78, 0, 0],
      rightLeg: [-0.78, 0, 0],
      leftCalf: [-1.1, 0, 0],
      rightCalf: [-1.1, 0, 0],
    },
  },
  kneeling: {
    label: "Kneeling",
    joints: {
      torso: [0.12, 0, 0],
      leftLeg: [-0.18, 0, 0],
      leftCalf: [-1.5, 0, 0],
      rightLeg: [-1.18, 0, 0],
      rightCalf: [-1.42, 0, 0],
    },
  },
  pointing: {
    label: "Pointing",
    joints: {
      rightArm: [0, -0.16, -Math.PI / 2],
      rightForearm: [0, 0, 0],
      torso: [0, -0.16, 0],
    },
  },
  waving: {
    label: "Waving",
    joints: {
      torso: [0.02, -0.025, 0.008],
      neck: [0.012, 0.028, -0.008],
      head: [0.008, 0.018, -0.008],
      rightShoulder: [0, 0, 0],
      rightArm: [0.12, -0.08, -1.9],
      rightForearm: [-0.18, 0.5, -1.2],
      rightHand: [0.04, -0.08, -0.3],
    },
  },
  "hands-up": {
    label: "Hands up",
    joints: {
      leftArm: [0, 0, Math.PI * 0.72],
      rightArm: [0, 0, -Math.PI * 0.72],
    },
  },
  thinking: {
    label: "Thinking",
    joints: {
      head: [0.08, -0.16, 0.1],
      rightArm: [0.2, 0, -0.3],
      rightForearm: [-1.75, 0.18, 0],
      leftForearm: [-1.1, 0, 0],
    },
  },
  "hands-on-hips": {
    label: "Hands on hips",
    joints: {
      leftArm: [0, 0.18, -0.36],
      rightArm: [0, -0.18, 0.36],
      leftForearm: [-1.34, 0, -0.24],
      rightForearm: [-1.34, 0, 0.24],
    },
  },
  reaching: {
    label: "Reaching",
    joints: {
      torso: [0.18, 0, 0],
      leftArm: [-1.1, 0, -0.9],
      rightArm: [-1.1, 0, 0.9],
    },
  },
  pushing: {
    label: "Pushing",
    joints: {
      torso: [0.2, 0, 0],
      leftArm: [-0.92, 0, -0.82],
      rightArm: [-0.92, 0, 0.82],
      leftForearm: [-0.28, 0, 0],
      rightForearm: [-0.28, 0, 0],
    },
  },
  phone: {
    label: "Using phone",
    joints: {
      head: [0.24, 0, 0],
      leftArm: [0.1, 0, -0.2],
      rightArm: [0.1, 0, 0.2],
      leftForearm: [-1.52, 0.18, 0],
      rightForearm: [-1.52, -0.18, 0],
    },
  },
  custom: { label: "Custom", joints: {} },
} satisfies Record<string, DirectorMannequinPosePreset>;

export const DIRECTOR_MANNEQUIN_POSE_JOINTS = [
  { value: "head", label: "Head" },
  { value: "neck", label: "Neck" },
  { value: "torso", label: "Torso" },
  { value: "pelvis", label: "Pelvis" },
  { value: "leftShoulder", label: "Left shoulder" },
  { value: "leftArm", label: "Left upper arm" },
  { value: "leftForearm", label: "Left forearm" },
  { value: "leftHand", label: "Left hand" },
  { value: "rightShoulder", label: "Right shoulder" },
  { value: "rightArm", label: "Right upper arm" },
  { value: "rightForearm", label: "Right forearm" },
  { value: "rightHand", label: "Right hand" },
  { value: "leftLeg", label: "Left thigh" },
  { value: "leftCalf", label: "Left calf" },
  { value: "rightLeg", label: "Right thigh" },
  { value: "rightCalf", label: "Right calf" },
] as const;

export const DIRECTOR_MANNEQUIN_POSE_BONES = {
  head: "mixamorig:Head",
  neck: "mixamorig:Neck",
  torso: "mixamorig:Spine2",
  pelvis: "mixamorig:Hips",
  leftShoulder: "mixamorig:LeftShoulder",
  leftArm: "mixamorig:LeftArm",
  leftHand: "mixamorig:LeftHand",
  rightShoulder: "mixamorig:RightShoulder",
  rightArm: "mixamorig:RightArm",
  rightHand: "mixamorig:RightHand",
  leftForearm: "mixamorig:LeftForeArm",
  rightForearm: "mixamorig:RightForeArm",
  leftLeg: "mixamorig:LeftUpLeg",
  rightLeg: "mixamorig:RightUpLeg",
  leftCalf: "mixamorig:LeftLeg",
  rightCalf: "mixamorig:RightLeg",
} as const;

export const DIRECTOR_MANNEQUIN_SKELETON_BONES = {
  head: "mixamorig:Head",
  neck: "mixamorig:Neck",
  torso: "mixamorig:Spine2",
  pelvis: "mixamorig:Hips",
  leftShoulder: "mixamorig:LeftShoulder",
  leftArm: "mixamorig:LeftArm",
  leftForearm: "mixamorig:LeftForeArm",
  leftHand: "mixamorig:LeftHand",
  rightShoulder: "mixamorig:RightShoulder",
  rightArm: "mixamorig:RightArm",
  rightForearm: "mixamorig:RightForeArm",
  rightHand: "mixamorig:RightHand",
  leftLeg: "mixamorig:LeftUpLeg",
  leftCalf: "mixamorig:LeftLeg",
  leftFoot: "mixamorig:LeftFoot",
  rightLeg: "mixamorig:RightUpLeg",
  rightCalf: "mixamorig:RightLeg",
  rightFoot: "mixamorig:RightFoot",
} as const;

export const DIRECTOR_MANNEQUIN_SKELETON_CONNECTIONS = [
  ["head", "neck"],
  ["neck", "torso"],
  ["torso", "pelvis"],
  ["torso", "leftShoulder"],
  ["leftShoulder", "leftArm"],
  ["leftArm", "leftForearm"],
  ["leftForearm", "leftHand"],
  ["torso", "rightShoulder"],
  ["rightShoulder", "rightArm"],
  ["rightArm", "rightForearm"],
  ["rightForearm", "rightHand"],
  ["pelvis", "leftLeg"],
  ["leftLeg", "leftCalf"],
  ["leftCalf", "leftFoot"],
  ["pelvis", "rightLeg"],
  ["rightLeg", "rightCalf"],
  ["rightCalf", "rightFoot"],
] as const;

export type DirectorMannequinPose = {
  preset?: string;
  joints: Record<string, DirectorStageVector3>;
};

export function animateDirectorMannequinWalkCycle(
  pose: DirectorMannequinPose,
  timeSeconds: number,
  speed: number,
  distanceMeters?: number,
): DirectorMannequinPose {
  if (!Number.isFinite(speed) || speed <= 0.04) return pose;
  if (pose.preset !== "standing" && pose.preset !== "walking") return pose;

  const normalizedSpeed = THREE.MathUtils.clamp(speed / 2.4, 0, 1);
  const stepsPerSecond = 1.25 + normalizedSpeed * 0.6;
  const phase = Number.isFinite(distanceMeters)
    ? Math.PI * 2 * Math.max(0, distanceMeters ?? 0) / 0.78
    : Math.PI * 2 * stepsPerSecond * timeSeconds;
  const swing = Math.sin(phase);
  const stride = THREE.MathUtils.clamp(0.26 + speed * 0.18, 0.28, 0.62);
  const armSwing = swing * stride * 0.82;
  const legSwing = swing * stride;

  return {
    ...pose,
    joints: {
      ...pose.joints,
      torso: [0.035 + Math.abs(swing) * 0.025, 0, 0],
      leftArm: [armSwing, 0, 0],
      rightArm: [-armSwing, 0, 0],
      leftForearm: [-0.18 - Math.max(0, -swing) * 0.24, 0, 0],
      rightForearm: [-0.18 - Math.max(0, swing) * 0.24, 0, 0],
      leftLeg: [-legSwing, 0, 0],
      rightLeg: [legSwing, 0, 0],
      leftCalf: [Math.max(0, -swing) * 0.68, 0, 0],
      rightCalf: [Math.max(0, swing) * 0.68, 0, 0],
    },
  };
}

const DIRECTOR_ACTION_POSE_PRESETS: Record<
  DirectorStageActionName,
  keyof typeof DIRECTOR_MANNEQUIN_POSE_PRESETS
> = {
  idle: "standing",
  walk: "walking",
  run: "running",
  sit: "sitting",
  crouch: "crouching",
  kneel: "kneeling",
  wave: "waving",
  point: "pointing",
  think: "thinking",
  "hands-up": "hands-up",
  interact: "standing",
  ride: "riding",
  talk: "standing",
  dance: "standing",
  jump: "standing",
  roll: "crouching",
  pickup: "crouching",
  push: "standing",
  punch: "standing",
  swim: "standing",
  drive: "sitting",
  death: "standing",
};

const DIRECTOR_UPPER_BODY_JOINTS = new Set([
  "head",
  "neck",
  "torso",
  "leftShoulder",
  "leftArm",
  "leftForearm",
  "leftHand",
  "rightShoulder",
  "rightArm",
  "rightForearm",
  "rightHand",
]);

function actionPose(
  action: DirectorStageActionName,
  localTimeSeconds: number,
  locomotionSpeed: number,
): DirectorMannequinPose {
  const presetName = DIRECTOR_ACTION_POSE_PRESETS[action];
  const preset = DIRECTOR_MANNEQUIN_POSE_PRESETS[presetName];
  const pose: DirectorMannequinPose = {
    preset: presetName,
    joints: { ...preset.joints },
  };
  if (action === "walk") {
    return animateDirectorMannequinWalkCycle(
      pose,
      localTimeSeconds,
      Math.max(0.8, locomotionSpeed),
    );
  }
  if (action === "run") {
    const speed = Math.max(2.4, locomotionSpeed);
    const phase = Math.PI * 2 * (2 + Math.min(speed, 5) * 0.16) * localTimeSeconds;
    const swing = Math.sin(phase);
    return {
      ...pose,
      joints: {
        ...pose.joints,
        torso: [0.16 + Math.abs(swing) * 0.05, 0, 0],
        leftArm: [swing * 0.92, 0, 0],
        rightArm: [-swing * 0.92, 0, 0],
        leftForearm: [-0.9 - Math.max(0, -swing) * 0.3, 0, 0],
        rightForearm: [-0.9 - Math.max(0, swing) * 0.3, 0, 0],
        leftLeg: [-swing * 0.94, 0, 0],
        rightLeg: [swing * 0.94, 0, 0],
        leftCalf: [Math.max(0, -swing) * 1.12, 0, 0],
        rightCalf: [Math.max(0, swing) * 1.12, 0, 0],
      },
    };
  }
  if (action === "wave") {
    const phase = localTimeSeconds * Math.PI * 2 * 1.35;
    const wave = Math.sin(phase);
    const shoulderSettle = Math.cos(phase) * 0.035;
    return {
      ...pose,
      joints: {
        ...pose.joints,
        torso: [0.02, -0.025 - wave * 0.01, 0.008],
        neck: [0.012, 0.028 + wave * 0.008, -0.008],
        head: [0.008, 0.018 + wave * 0.006, -0.008],
        rightShoulder: [0, 0, 0],
        rightArm: [0.12 + shoulderSettle, -0.08 + wave * 0.035, -1.9 + wave * 0.05],
        rightForearm: [-0.18 + shoulderSettle, 0.5 + wave * 0.11, -1.2 + wave * 0.12],
        rightHand: [0.04, -0.08 - wave * 0.04, -0.3 + wave * 0.08],
      },
    };
  }
  return pose;
}

function blendJoint(
  from: DirectorStageVector3 | undefined,
  to: DirectorStageVector3 | undefined,
  weight: number,
): DirectorStageVector3 {
  const source = from ?? [0, 0, 0];
  const target = to ?? [0, 0, 0];
  return [
    source[0] + (target[0] - source[0]) * weight,
    source[1] + (target[1] - source[1]) * weight,
    source[2] + (target[2] - source[2]) * weight,
  ];
}

function blendActionPose(
  basePose: DirectorMannequinPose,
  targetPose: DirectorMannequinPose,
  weight: number,
  layer: EvaluatedDirectorActionClip["clip"]["layer"],
): DirectorMannequinPose {
  const joints = { ...basePose.joints };
  const names = layer === "upper-body"
    ? Object.keys(targetPose.joints).filter((name) => DIRECTOR_UPPER_BODY_JOINTS.has(name))
    : [...new Set([...Object.keys(basePose.joints), ...Object.keys(targetPose.joints)])];
  for (const name of names) {
    joints[name] = blendJoint(basePose.joints[name], targetPose.joints[name], weight);
  }
  return { preset: "custom", joints };
}

export function evaluateDirectorMannequinActionPose({
  basePose,
  timeSeconds,
  locomotionSpeed,
  locomotionDistance,
  activeActions,
}: {
  basePose: DirectorMannequinPose;
  timeSeconds: number;
  locomotionSpeed: number;
  locomotionDistance?: number;
  activeActions: EvaluatedDirectorActionClip[];
}): DirectorMannequinPose {
  const semanticPreset = DIRECTOR_MANNEQUIN_POSE_PRESETS[
    basePose.preset as keyof typeof DIRECTOR_MANNEQUIN_POSE_PRESETS
  ];
  const resolvedBasePose = semanticPreset
    ? {
        ...basePose,
        joints: {
          ...semanticPreset.joints,
          ...basePose.joints,
        },
      }
    : basePose;
  let evaluated = animateDirectorMannequinWalkCycle(
    resolvedBasePose,
    timeSeconds,
    locomotionSpeed,
    locomotionDistance,
  );
  for (const active of activeActions) {
    evaluated = blendActionPose(
      evaluated,
      actionPose(active.clip.action, active.localTimeSeconds, locomotionSpeed),
      active.weight,
      active.clip.layer,
    );
  }
  return evaluated;
}

type DirectorMannequinSkeletonJoint = keyof typeof DIRECTOR_MANNEQUIN_SKELETON_BONES;
export type DirectorMannequinSkeleton = Record<DirectorMannequinSkeletonJoint, THREE.Vector3>;
type DirectorMannequinBoneIndex = Map<string, THREE.Object3D>;

const directorMannequinBoneIndexes = new WeakMap<THREE.Object3D, DirectorMannequinBoneIndex>();
const directorMannequinBaseQuaternions = new WeakMap<THREE.Object3D, THREE.Quaternion>();

function runtimeBoneName(name: string): string {
  return THREE.PropertyBinding.sanitizeNodeName(name);
}

function indexBone(boneIndex: DirectorMannequinBoneIndex, object: THREE.Object3D): void {
  if (!object.name) return;
  boneIndex.set(object.name, object);
  boneIndex.set(runtimeBoneName(object.name), object);
}

const directedLimbs = {
  leftArm: "mixamorig:LeftForeArm",
  rightArm: "mixamorig:RightForeArm",
  leftLeg: "mixamorig:LeftLeg",
  rightLeg: "mixamorig:RightLeg",
} as const;

function baseQuaternion(bone: THREE.Object3D): THREE.Quaternion {
  const stored = directorMannequinBaseQuaternions.get(bone);
  if (stored) return stored;
  const base = bone.quaternion.clone();
  directorMannequinBaseQuaternions.set(bone, base);
  return base;
}

export function bindDirectorMannequinRig(character: THREE.Object3D): void {
  let boneIndex = directorMannequinBoneIndexes.get(character);
  if (!boneIndex) {
    const createdIndex = new Map<string, THREE.Object3D>();
    character.traverse((object) => {
      indexBone(createdIndex, object);
      if (object instanceof THREE.SkinnedMesh) {
        for (const bone of object.skeleton.bones) {
          indexBone(createdIndex, bone);
        }
      }
    });
    directorMannequinBoneIndexes.set(character, createdIndex);
    boneIndex = createdIndex;
  }
  for (const bone of boneIndex.values()) {
    if (!directorMannequinBaseQuaternions.has(bone)) {
      directorMannequinBaseQuaternions.set(bone, bone.quaternion.clone());
    }
  }
}

function boundBone(character: THREE.Object3D, boneName: string): THREE.Object3D | undefined {
  const boneIndex = directorMannequinBoneIndexes.get(character);
  return boneIndex?.get(boneName)
    ?? boneIndex?.get(runtimeBoneName(boneName))
    ?? character.getObjectByName(boneName)
    ?? character.getObjectByName(runtimeBoneName(boneName))
    ?? undefined;
}

export function applyDirectorMannequinPose(
  character: THREE.Object3D,
  pose: DirectorMannequinPose,
): void {
  bindDirectorMannequinRig(character);
  for (const boneName of Object.values(DIRECTOR_MANNEQUIN_POSE_BONES)) {
    const bone = boundBone(character, boneName);
    if (bone) bone.quaternion.copy(baseQuaternion(bone));
  }

  for (const [joint, boneName] of Object.entries(DIRECTOR_MANNEQUIN_POSE_BONES)) {
    if (joint in directedLimbs) continue;
    const bone = boundBone(character, boneName);
    if (!bone) continue;
    const rotation = pose.joints[joint] ?? [0, 0, 0];
    bone.quaternion.copy(baseQuaternion(bone)).multiply(
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation, "XYZ")),
    );
  }

  character.updateWorldMatrix(true, true);
  const characterWorld = character.getWorldQuaternion(new THREE.Quaternion());
  for (const [joint, childBoneName] of Object.entries(directedLimbs)) {
    const boneName = DIRECTOR_MANNEQUIN_POSE_BONES[joint as keyof typeof directedLimbs];
    const bone = boundBone(character, boneName);
    const child = boundBone(character, childBoneName);
    if (!bone?.parent || !child) continue;
    const rotation = pose.joints[joint] ?? [0, 0, 0];
    const targetInWorld = new THREE.Vector3(0, -1, 0)
      .applyEuler(new THREE.Euler(...rotation, "XYZ"))
      .normalize()
      .applyQuaternion(characterWorld);
    const parentWorldInverse = bone.parent
      .getWorldQuaternion(new THREE.Quaternion())
      .invert();
    const targetInParent = targetInWorld.applyQuaternion(parentWorldInverse);
    const base = baseQuaternion(bone);
    const bindDirection = child.position.clone().normalize().applyQuaternion(base);
    const alignment = new THREE.Quaternion().setFromUnitVectors(bindDirection, targetInParent);
    bone.quaternion.copy(alignment.multiply(base));
    bone.updateWorldMatrix(false, true);
  }
  character.updateWorldMatrix(true, true);
}

export function readDirectorMannequinSkeleton(
  character: THREE.Object3D,
  target?: Partial<DirectorMannequinSkeleton>,
): DirectorMannequinSkeleton {
  character.updateWorldMatrix(true, true);
  const skeleton = target ?? {};
  for (const [joint, boneName] of Object.entries(DIRECTOR_MANNEQUIN_SKELETON_BONES)) {
    const bone = boundBone(character, boneName);
    if (!bone) throw new Error(`Director mannequin is missing bound bone ${boneName}`);
    const point = skeleton[joint as DirectorMannequinSkeletonJoint] ?? new THREE.Vector3();
    bone.getWorldPosition(point);
    skeleton[joint as DirectorMannequinSkeletonJoint] = point;
  }
  return skeleton as DirectorMannequinSkeleton;
}
