import * as THREE from "three";

const HUMANOID_BONE_ALIASES = {
  hips: ["hips", "pelvis"],
  spine: ["spine", "spine1", "spine01", "abdomen"],
  chest: ["spine3", "spine03", "spine2", "spine02", "chest", "upperchest"],
  neck: ["neck", "neck01"],
  head: ["head"],
  leftUpperArm: ["leftarm", "leftupperarm", "upperarml"],
  leftLowerArm: ["leftforearm", "leftlowerarm", "lowerarml"],
  leftHand: ["lefthand", "handl", "wristl"],
  rightUpperArm: ["rightarm", "rightupperarm", "upperarmr"],
  rightLowerArm: ["rightforearm", "rightlowerarm", "lowerarmr"],
  rightHand: ["righthand", "handr", "wristr"],
  leftUpperLeg: ["leftupleg", "leftupperleg", "thighl", "upperlegl"],
  leftLowerLeg: ["leftleg", "leftlowerleg", "shinl", "lowerlegl", "calfl"],
  leftFoot: ["leftfoot", "footl"],
  rightUpperLeg: ["rightupleg", "rightupperleg", "thighr", "upperlegr"],
  rightLowerLeg: ["rightleg", "rightlowerleg", "shinr", "lowerlegr", "calfr"],
  rightFoot: ["rightfoot", "footr"],
} as const;

export type DirectorHumanoidBone = keyof typeof HUMANOID_BONE_ALIASES;

export const CLASH_HUMANOID_RIG_V1 = {
  id: "clash-humanoid-v1",
  version: 1,
  topology: "humanoid",
  requiredBones: Object.freeze(
    Object.keys(HUMANOID_BONE_ALIASES) as DirectorHumanoidBone[],
  ),
} as const;

export interface DirectorHumanoidRigIssue {
  code: "missing-bone";
  severity: "error";
  bone: DirectorHumanoidBone;
  message: string;
}

export interface DirectorHumanoidRigReport {
  profileId: typeof CLASH_HUMANOID_RIG_V1.id;
  compatible: boolean;
  boneMap: Partial<Record<DirectorHumanoidBone, string>>;
  issues: DirectorHumanoidRigIssue[];
}

export type DirectorHumanoidPoseIssue =
  | {
    code: "arm-torso-clearance";
    severity: "error";
    side: "left" | "right";
    joint: "elbow" | "hand";
    clearanceRatio: number;
    minimumRatio: number;
    message: string;
  }
  | {
    code: "hand-lower-body-clearance";
    severity: "error";
    side: "left" | "right";
    joint: "hand";
    region: "upper-leg";
    clearanceRatio: number;
    minimumRatio: number;
    message: string;
  };

export interface DirectorHumanoidPoseAudit {
  profileId: typeof CLASH_HUMANOID_RIG_V1.id;
  issues: DirectorHumanoidPoseIssue[];
}

export interface DirectorHumanoidFootMotionMetrics {
  plantedFrames: number;
  meanSlideMetersPerSecond: number;
  minimumHeightMeters: number;
}

export type DirectorHumanoidMotionIssue =
  | {
    code: "incompatible-rig";
    severity: "error";
    message: string;
  }
  | {
    code: "foot-slide";
    severity: "error";
    side: "left" | "right";
    meanSlideMetersPerSecond: number;
    maximumMetersPerSecond: number;
    message: string;
  }
  | {
    code: "ground-contact-asymmetry";
    severity: "error";
    contactHeightDeltaMeters: number;
    maximumMeters: number;
    message: string;
  }
  | {
    code: "joint-limit";
    severity: "error";
    bone: DirectorHumanoidBone;
    excursionDegrees: number;
    maximumDegrees: number;
    message: string;
  }
  | {
    code: "self-intersection";
    severity: "error";
    side: "left" | "right";
    joint: "elbow" | "hand";
    region: "torso" | "upper-leg";
    message: string;
  };

export interface DirectorHumanoidMotionAudit {
  profileId: typeof CLASH_HUMANOID_RIG_V1.id;
  sampleCount: number;
  metrics: {
    leftFoot: DirectorHumanoidFootMotionMetrics;
    rightFoot: DirectorHumanoidFootMotionMetrics;
    contactHeightDeltaMeters: number;
    recommendedActorSpeedMetersPerSecond: number;
    maximumJointExcursionDegrees: Partial<Record<DirectorHumanoidBone, number>>;
  };
  issues: DirectorHumanoidMotionIssue[];
}

const HUMANOID_JOINT_EXCURSION_LIMIT_DEGREES: Readonly<
  Partial<Record<DirectorHumanoidBone, number>>
> = {
  chest: 85,
  neck: 85,
  head: 85,
  leftUpperArm: 160,
  leftLowerArm: 165,
  rightUpperArm: 160,
  rightLowerArm: 165,
  leftUpperLeg: 125,
  leftLowerLeg: 165,
  rightUpperLeg: 125,
  rightLowerLeg: 165,
};

function normalizedBoneName(name: string): string {
  return name
    .replace(/^mixamorig/i, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
}

export function inspectDirectorHumanoidRig(
  root: THREE.Object3D,
): DirectorHumanoidRigReport {
  const bonesByName = new Map<string, THREE.Bone>();
  root.traverse((object) => {
    if (object instanceof THREE.Bone) {
      bonesByName.set(normalizedBoneName(object.name), object);
    }
  });

  const boneMap: Partial<Record<DirectorHumanoidBone, string>> = {};
  const issues: DirectorHumanoidRigIssue[] = [];
  for (const bone of CLASH_HUMANOID_RIG_V1.requiredBones) {
    const match = HUMANOID_BONE_ALIASES[bone]
      .map((alias) => bonesByName.get(alias))
      .find((candidate) => candidate !== undefined);
    if (match) {
      boneMap[bone] = match.name;
    } else {
      issues.push({
        code: "missing-bone",
        severity: "error",
        bone,
        message: `Clash Humanoid Rig v1 requires ${bone}`,
      });
    }
  }

  return {
    profileId: CLASH_HUMANOID_RIG_V1.id,
    compatible: issues.length === 0,
    boneMap,
    issues,
  };
}

export function auditDirectorHumanoidPose(
  root: THREE.Object3D,
  {
    minimumArmClearanceRatio = 0.4,
    minimumHandToUpperLegClearanceRatio = 0.04,
  }: {
    minimumArmClearanceRatio?: number;
    minimumHandToUpperLegClearanceRatio?: number;
  } = {},
): DirectorHumanoidPoseAudit {
  const rig = inspectDirectorHumanoidRig(root);
  if (!rig.compatible) {
    return { profileId: CLASH_HUMANOID_RIG_V1.id, issues: [] };
  }
  root.updateWorldMatrix(true, true);
  const position = new THREE.Vector3();
  const chest = root.getObjectByName(rig.boneMap.chest!);
  const chestX = chest!.getWorldPosition(position).x;
  const issues: DirectorHumanoidPoseIssue[] = [];

  for (const side of ["left", "right"] as const) {
    const upperArmName = side === "left" ? rig.boneMap.leftUpperArm : rig.boneMap.rightUpperArm;
    const elbowName = side === "left" ? rig.boneMap.leftLowerArm : rig.boneMap.rightLowerArm;
    const handName = side === "left" ? rig.boneMap.leftHand : rig.boneMap.rightHand;
    const upperArmX = root.getObjectByName(upperArmName!)!.getWorldPosition(position).x;
    const sideDirection = Math.sign(upperArmX - chestX);
    const shoulderClearance = Math.abs(upperArmX - chestX);

    for (const [joint, boneName] of [
      ["elbow", elbowName],
      ["hand", handName],
    ] as const) {
      const jointX = root.getObjectByName(boneName!)!.getWorldPosition(position).x;
      const clearanceRatio = ((jointX - chestX) * sideDirection) / shoulderClearance;
      if (clearanceRatio < minimumArmClearanceRatio) {
        issues.push({
          code: "arm-torso-clearance",
          severity: "error",
          side,
          joint,
          clearanceRatio,
          minimumRatio: minimumArmClearanceRatio,
          message: `${side} ${joint} entered the torso clearance envelope`,
        });
      }
    }

    const upperLegName = side === "left"
      ? rig.boneMap.leftUpperLeg
      : rig.boneMap.rightUpperLeg;
    const lowerLegName = side === "left"
      ? rig.boneMap.leftLowerLeg
      : rig.boneMap.rightLowerLeg;
    const upperLeg = root.getObjectByName(upperLegName!)!;
    const lowerLeg = root.getObjectByName(lowerLegName!)!;
    const hand = root.getObjectByName(handName!)!;
    const thighStart = upperLeg.getWorldPosition(new THREE.Vector3());
    const thighEnd = lowerLeg.getWorldPosition(new THREE.Vector3());
    const thighLength = thighStart.distanceTo(thighEnd);
    const handPoints: THREE.Vector3[] = [];
    hand.traverse((object) => {
      if (object instanceof THREE.Bone) {
        handPoints.push(object.getWorldPosition(new THREE.Vector3()));
      }
    });
    const thighDirection = thighEnd.clone().sub(thighStart);
    const thighLengthSquared = thighDirection.lengthSq();
    const clearance = Math.min(...handPoints.map((point) => {
      const alongThigh = thighLengthSquared > 0
        ? THREE.MathUtils.clamp(
          point.clone().sub(thighStart).dot(thighDirection) / thighLengthSquared,
          0,
          1,
        )
        : 0;
      const closestPoint = thighStart.clone().addScaledVector(
        thighDirection,
        alongThigh,
      );
      return point.distanceTo(closestPoint);
    }));
    const clearanceRatio = thighLength > 0 ? clearance / thighLength : 0;
    if (clearanceRatio < minimumHandToUpperLegClearanceRatio) {
      issues.push({
        code: "hand-lower-body-clearance",
        severity: "error",
        side,
        joint: "hand",
        region: "upper-leg",
        clearanceRatio,
        minimumRatio: minimumHandToUpperLegClearanceRatio,
        message: `${side} hand entered the upper-leg clearance envelope`,
      });
    }
  }

  return { profileId: CLASH_HUMANOID_RIG_V1.id, issues };
}

function poseSkeletonAtBindPose(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (object instanceof THREE.SkinnedMesh) object.skeleton.pose();
  });
  root.updateWorldMatrix(true, true);
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function auditDirectorHumanoidMotion({
  root,
  clip,
  actorSpeedMetersPerSecond,
  playbackRate = 1,
  sampleRate = 30,
  maximumMeanFootSlideMetersPerSecond = 0.25,
  maximumContactHeightDeltaMeters = 0.02,
  minimumArmClearanceRatio = 0.1,
  minimumHandToUpperLegClearanceRatio = 0.04,
}: {
  root: THREE.Object3D;
  clip: THREE.AnimationClip;
  actorSpeedMetersPerSecond: number;
  playbackRate?: number;
  sampleRate?: number;
  maximumMeanFootSlideMetersPerSecond?: number;
  maximumContactHeightDeltaMeters?: number;
  minimumArmClearanceRatio?: number;
  minimumHandToUpperLegClearanceRatio?: number;
}): DirectorHumanoidMotionAudit {
  const rig = inspectDirectorHumanoidRig(root);
  const emptyFoot = {
    plantedFrames: 0,
    meanSlideMetersPerSecond: 0,
    minimumHeightMeters: 0,
  };
  if (!rig.compatible) {
    return {
      profileId: CLASH_HUMANOID_RIG_V1.id,
      sampleCount: 0,
      metrics: {
        leftFoot: emptyFoot,
        rightFoot: emptyFoot,
        contactHeightDeltaMeters: 0,
        recommendedActorSpeedMetersPerSecond: 0,
        maximumJointExcursionDegrees: {},
      },
      issues: [{
        code: "incompatible-rig",
        severity: "error",
        message: "Motion QA requires a Clash Humanoid Rig v1 compatible skeleton",
      }],
    };
  }

  const safePlaybackRate = Math.max(0.01, playbackRate);
  const safeSampleRate = Math.max(1, sampleRate);
  const actorDuration = Math.max(0, clip.duration) / safePlaybackRate;
  const sampleCount = Math.max(2, Math.ceil(actorDuration * safeSampleRate) + 1);
  poseSkeletonAtBindPose(root);

  const restRotations: Partial<Record<DirectorHumanoidBone, THREE.Quaternion>> = {};
  for (const bone of CLASH_HUMANOID_RIG_V1.requiredBones) {
    const object = root.getObjectByName(rig.boneMap[bone]!);
    if (object) restRotations[bone] = object.quaternion.clone();
  }

  const leftFoot = root.getObjectByName(rig.boneMap.leftFoot!)!;
  const rightFoot = root.getObjectByName(rig.boneMap.rightFoot!)!;
  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(clip).play();
  action.paused = true;
  const footSamples: Record<"left" | "right", THREE.Vector3[]> = {
    left: [],
    right: [],
  };
  const plantedForwardVelocities: Record<"left" | "right", number[]> = {
    left: [],
    right: [],
  };
  const sampleTimes: number[] = [];
  const maximumJointExcursionDegrees: Partial<Record<DirectorHumanoidBone, number>> = {};
  const selfIntersectionKeys = new Set<string>();

  for (let index = 0; index < sampleCount; index += 1) {
    const actorTime = actorDuration * index / (sampleCount - 1);
    const clipTime = Math.min(clip.duration, actorTime * safePlaybackRate);
    action.time = clipTime;
    mixer.update(0);
    root.updateWorldMatrix(true, true);
    sampleTimes.push(actorTime);
    footSamples.left.push(leftFoot.getWorldPosition(new THREE.Vector3()));
    footSamples.right.push(rightFoot.getWorldPosition(new THREE.Vector3()));

    for (const [bone, maximumDegrees] of Object.entries(
      HUMANOID_JOINT_EXCURSION_LIMIT_DEGREES,
    ) as Array<[DirectorHumanoidBone, number]>) {
      const object = root.getObjectByName(rig.boneMap[bone]!);
      const rest = restRotations[bone];
      if (!object || !rest) continue;
      const excursionDegrees = THREE.MathUtils.radToDeg(rest.angleTo(object.quaternion));
      maximumJointExcursionDegrees[bone] = Math.max(
        maximumJointExcursionDegrees[bone] ?? 0,
        excursionDegrees,
      );
      if (excursionDegrees > maximumDegrees) {
        selfIntersectionKeys.add(`joint-limit:${bone}`);
      }
    }

    for (const issue of auditDirectorHumanoidPose(root, {
      minimumArmClearanceRatio,
      minimumHandToUpperLegClearanceRatio,
    }).issues) {
      selfIntersectionKeys.add(
        `self-intersection:${issue.side}:${issue.joint}:${
          issue.code === "hand-lower-body-clearance" ? "upper-leg" : "torso"
        }`,
      );
    }
  }

  const metricsForFoot = (
    side: "left" | "right",
  ): DirectorHumanoidFootMotionMetrics => {
    const positions = footSamples[side];
    const minimumHeightMeters = Math.min(...positions.map((position) => position.y));
    const contactMarginMeters = 0.03;
    const planted = positions.map(
      (position) => position.y <= minimumHeightMeters + contactMarginMeters,
    );
    const slideSpeeds: number[] = [];
    for (let index = 1; index < positions.length; index += 1) {
      if (!planted[index] || !planted[index - 1]) continue;
      const elapsed = sampleTimes[index]! - sampleTimes[index - 1]!;
      if (elapsed <= 0) continue;
      const localVelocityX = (
        positions[index]!.x - positions[index - 1]!.x
      ) / elapsed;
      const localVelocityZ = (
        positions[index]!.z - positions[index - 1]!.z
      ) / elapsed;
      plantedForwardVelocities[side].push(-localVelocityZ);
      slideSpeeds.push(Math.hypot(
        localVelocityX,
        localVelocityZ + actorSpeedMetersPerSecond,
      ));
    }
    return {
      plantedFrames: planted.filter(Boolean).length,
      meanSlideMetersPerSecond: mean(slideSpeeds),
      minimumHeightMeters,
    };
  };

  const leftMetrics = metricsForFoot("left");
  const rightMetrics = metricsForFoot("right");
  const contactHeightDeltaMeters = Math.abs(
    leftMetrics.minimumHeightMeters - rightMetrics.minimumHeightMeters,
  );
  const recommendedActorSpeedMetersPerSecond = Math.max(0, mean([
    ...plantedForwardVelocities.left,
    ...plantedForwardVelocities.right,
  ]));
  const issues: DirectorHumanoidMotionIssue[] = [];
  for (const [side, metrics] of [
    ["left", leftMetrics],
    ["right", rightMetrics],
  ] as const) {
    if (metrics.meanSlideMetersPerSecond > maximumMeanFootSlideMetersPerSecond) {
      issues.push({
        code: "foot-slide",
        severity: "error",
        side,
        meanSlideMetersPerSecond: metrics.meanSlideMetersPerSecond,
        maximumMetersPerSecond: maximumMeanFootSlideMetersPerSecond,
        message: `${side} planted foot slides too quickly`,
      });
    }
  }
  if (contactHeightDeltaMeters > maximumContactHeightDeltaMeters) {
    issues.push({
      code: "ground-contact-asymmetry",
      severity: "error",
      contactHeightDeltaMeters,
      maximumMeters: maximumContactHeightDeltaMeters,
      message: "Left and right foot contacts do not share a stable ground plane",
    });
  }
  for (const key of selfIntersectionKeys) {
    const [code, first, second, third] = key.split(":");
    if (code === "joint-limit") {
      const bone = first as DirectorHumanoidBone;
      issues.push({
        code,
        severity: "error",
        bone,
        excursionDegrees: maximumJointExcursionDegrees[bone]!,
        maximumDegrees: HUMANOID_JOINT_EXCURSION_LIMIT_DEGREES[bone]!,
        message: `${bone} exceeds the Clash Humanoid Rig v1 joint limit`,
      });
    } else {
      issues.push({
        code: "self-intersection",
        severity: "error",
        side: first as "left" | "right",
        joint: second as "elbow" | "hand",
        region: third as "torso" | "upper-leg",
        message: `${first} ${second} enters the ${third} envelope during the clip`,
      });
    }
  }

  mixer.stopAllAction();
  mixer.uncacheRoot(root);
  poseSkeletonAtBindPose(root);
  return {
    profileId: CLASH_HUMANOID_RIG_V1.id,
    sampleCount,
    metrics: {
      leftFoot: leftMetrics,
      rightFoot: rightMetrics,
      contactHeightDeltaMeters,
      recommendedActorSpeedMetersPerSecond,
      maximumJointExcursionDegrees,
    },
    issues,
  };
}
