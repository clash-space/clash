import type { Object3D } from "three";

/** The semantic bones required by the shipped Clash humanoid profile. */
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

export type HumanoidRigBone = keyof typeof HUMANOID_BONE_ALIASES;

export const CLASH_HUMANOID_RIG_V1 = {
  id: "clash-humanoid-v1",
  version: 1,
  topology: "humanoid",
  requiredBones: Object.freeze(
    Object.keys(HUMANOID_BONE_ALIASES) as HumanoidRigBone[],
  ),
} as const;

export interface HumanoidRigIssue {
  code: "missing-bone";
  severity: "error";
  bone: HumanoidRigBone;
  message: string;
}

export interface HumanoidRigReport {
  profileId: typeof CLASH_HUMANOID_RIG_V1.id;
  compatible: boolean;
  boneMap: Partial<Record<HumanoidRigBone, string>>;
  issues: HumanoidRigIssue[];
}

/**
 * Normalize exporter punctuation and the optional Mixamo namespace while
 * retaining the original node name in inspection reports.
 */
function normalizedBoneName(name: string): string {
  return name
    .replace(/^mixamorig(?:[\s:._-]*)/i, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
}

/** Inspect a scene graph against the backend-neutral Clash humanoid profile. */
export function inspectHumanoidRig(root: Object3D): HumanoidRigReport {
  const bonesByName = new Map<string, Object3D>();
  root.traverse((node) => {
    if (node.type !== "Bone" || !node.name) return;
    const normalizedName = normalizedBoneName(node.name);
    if (!bonesByName.has(normalizedName)) {
      bonesByName.set(normalizedName, node);
    }
  });

  const boneMap: Partial<Record<HumanoidRigBone, string>> = {};
  const issues: HumanoidRigIssue[] = [];

  for (const bone of CLASH_HUMANOID_RIG_V1.requiredBones) {
    const match = HUMANOID_BONE_ALIASES[bone]
      .map((alias) => bonesByName.get(alias))
      .find((candidate) => candidate !== undefined);
    if (match) {
      boneMap[bone] = match.name;
      continue;
    }
    issues.push({
      code: "missing-bone",
      severity: "error",
      bone,
      message: `Clash Humanoid Rig v1 requires ${bone}`,
    });
  }

  return {
    profileId: CLASH_HUMANOID_RIG_V1.id,
    compatible: issues.length === 0,
    boneMap,
    issues,
  };
}
