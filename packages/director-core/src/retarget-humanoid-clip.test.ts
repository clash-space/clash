import {
  AnimationClip,
  Bone,
  Object3D,
  Quaternion,
  QuaternionKeyframeTrack,
  VectorKeyframeTrack,
} from "three";
import { describe, expect, it } from "vitest";
import * as directorCore from "./index";

function rootMotionFixture() {
  const sourceRoot = new Object3D();
  const targetRoot = new Object3D();
  const sourceHips = new Bone();
  const targetHips = new Bone();
  sourceHips.name = "SourceHips";
  targetHips.name = "TargetHips";
  // Deliberately different rests: root motion must be emitted relative to these.
  sourceHips.position.set(1, 2, 3);
  targetHips.position.set(10, 20, 30);
  sourceRoot.add(sourceHips);
  targetRoot.add(targetHips);

  const mappings = [
    ["head", "Head"],
    ["leftUpperLeg", "LeftUpperLeg"],
    ["leftLowerLeg", "LeftLowerLeg"],
    ["leftFoot", "LeftFoot"],
    ["rightUpperLeg", "RightUpperLeg"],
    ["rightLowerLeg", "RightLowerLeg"],
    ["rightFoot", "RightFoot"],
  ].map(([semantic, suffix]) => ({
    semantic,
    sourceBoneName: `Source${suffix}`,
    targetBoneName: `Target${suffix}`,
  }));

  const addLeg = (hips: Bone, prefix: string, side: number, scale: number) => {
    const upper = new Bone();
    const lower = new Bone();
    const foot = new Bone();
    upper.name = `${prefix}${side < 0 ? "Left" : "Right"}UpperLeg`;
    lower.name = `${prefix}${side < 0 ? "Left" : "Right"}LowerLeg`;
    foot.name = `${prefix}${side < 0 ? "Left" : "Right"}Foot`;
    upper.position.set(side * scale, 0, 0);
    lower.position.set(0, -scale, 0);
    foot.position.set(0, -scale, 0);
    hips.add(upper);
    upper.add(lower);
    lower.add(foot);
  };
  const addHead = (hips: Bone, prefix: string, scale: number) => {
    const head = new Bone();
    head.name = `${prefix}Head`;
    head.position.set(0, 3 * scale, 0);
    hips.add(head);
  };

  addHead(sourceHips, "Source", 1);
  addLeg(sourceHips, "Source", -1, 1);
  addLeg(sourceHips, "Source", 1, 1);
  addHead(targetHips, "Target", 2);
  addLeg(targetHips, "Target", -1, 2);
  addLeg(targetHips, "Target", 1, 2);
  sourceRoot.updateMatrixWorld(true);
  targetRoot.updateMatrixWorld(true);

  return {
    sourceRoot,
    targetRoot,
    targetHips,
    mappings: [
      { semantic: "hips", sourceBoneName: "SourceHips", targetBoneName: "TargetHips" },
      ...mappings,
    ],
    clip: new AnimationClip("root-motion", 1, [
      new QuaternionKeyframeTrack("SourceHips.quaternion", [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
      new VectorKeyframeTrack("SourceHips.position", [0, 1], [1, 2, 3, 3, 4, 7]),
    ]),
  };
}

describe("retargetHumanoidClip", () => {
  it("preserves root motion at the target's two-times body scale", () => {
    const fixture = rootMotionFixture();
    const retargetHumanoidClip = (directorCore as any).retargetHumanoidClip;
    const retargeted: AnimationClip = retargetHumanoidClip({
      clip: fixture.clip,
      sourceRoot: fixture.sourceRoot,
      targetRoot: fixture.targetRoot,
      boneMapping: fixture.mappings,
      rootMotion: "preserve",
    } as any);

    const targetTrack = retargeted.tracks.find(
      (track) => track.name === "TargetHips.position",
    );
    expect(targetTrack).toBeInstanceOf(VectorKeyframeTrack);
    expect([
      targetTrack!.values[3]! - 10,
      targetTrack!.values[4]! - 20,
      targetTrack!.values[5]! - 30,
    ]).toEqual([4, 4, 8]);
  });

  it("keeps scaled vertical root motion while making horizontal motion in-place", () => {
    const fixture = rootMotionFixture();
    const retargetHumanoidClip = (directorCore as any).retargetHumanoidClip;
    const retargeted: AnimationClip = retargetHumanoidClip({
      clip: fixture.clip,
      sourceRoot: fixture.sourceRoot,
      targetRoot: fixture.targetRoot,
      boneMapping: fixture.mappings,
      rootMotion: "in-place",
    } as any);

    const targetTrack = retargeted.tracks.find(
      (track) => track.name === "TargetHips.position",
    );
    expect(targetTrack).toBeInstanceOf(VectorKeyframeTrack);
    expect([
      targetTrack!.values[3]! - 10,
      targetTrack!.values[4]! - 20,
      targetTrack!.values[5]! - 30,
    ]).toEqual([0, 4, 0]);
  });

  it("expresses a source bind-pose key in the target bone's bind pose", () => {
    const sourceRoot = new Object3D();
    const sourceHips = new Bone();
    const sourceUpperArm = new Bone();
    sourceHips.name = "SourceHips";
    sourceUpperArm.name = "SourceUpperArm";
    sourceRoot.add(sourceHips);
    sourceHips.add(sourceUpperArm);

    const targetRoot = new Object3D();
    const targetHips = new Bone();
    const targetUpperArm = new Bone();
    targetHips.name = "TargetHips";
    targetUpperArm.name = "TargetUpperArm";
    targetRoot.add(targetHips);
    targetHips.add(targetUpperArm);

    const halfSqrt = Math.SQRT1_2;
    const sourceBind = new Quaternion(halfSqrt, 0, 0, halfSqrt); // +90° X
    const targetBind = new Quaternion(0, 0, halfSqrt, halfSqrt); // +90° Z
    sourceUpperArm.quaternion.copy(sourceBind);
    targetUpperArm.quaternion.copy(targetBind);
    sourceRoot.updateMatrixWorld(true);
    targetRoot.updateMatrixWorld(true);

    const sourceClip = new AnimationClip("source-bind-pose", 1, [
      new QuaternionKeyframeTrack(
        "SourceUpperArm.quaternion",
        [0],
        sourceBind.toArray(),
      ),
    ]);

    const retargetHumanoidClip = (directorCore as any).retargetHumanoidClip;
    expect(retargetHumanoidClip).toBeTypeOf("function");

    const retargeted: AnimationClip = retargetHumanoidClip({
      clip: sourceClip,
      sourceRoot,
      targetRoot,
      boneMapping: [
        {
          semantic: "leftUpperArm",
          sourceBoneName: "SourceUpperArm",
          targetBoneName: "TargetUpperArm",
        },
      ],
    });
    const targetTrack = retargeted.tracks.find(
      (track) => track.name === "TargetUpperArm.quaternion",
    );
    expect(targetTrack).toBeInstanceOf(QuaternionKeyframeTrack);

    const retargetedKey = new Quaternion().fromArray(targetTrack!.values);
    expect(retargetedKey.x).toBeCloseTo(targetBind.x, 6);
    expect(retargetedKey.y).toBeCloseTo(targetBind.y, 6);
    expect(retargetedKey.z).toBeCloseTo(targetBind.z, 6);
    expect(retargetedKey.w).toBeCloseTo(targetBind.w, 6);
    expect(retargetedKey.angleTo(sourceBind)).toBeGreaterThan(1);
  });
});
