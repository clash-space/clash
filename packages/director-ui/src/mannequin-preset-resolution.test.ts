import { describe, expect, it } from "vitest";
import { evaluateDirectorMannequinActionPose } from "./mannequin";

describe("agent-authored mannequin pose presets", () => {
  it("resolves semantic preset joints when the persisted pose stores no duplicates", () => {
    const pose = evaluateDirectorMannequinActionPose({
      basePose: { preset: "sitting", joints: {} },
      timeSeconds: 0.5,
      locomotionSpeed: 0,
      activeActions: [],
    });

    expect(pose.preset).toBe("sitting");
    expect(pose.joints.leftLeg?.[0]).toBeCloseTo(-Math.PI / 2);
    expect(pose.joints.rightCalf?.[0]).toBeCloseTo(-Math.PI / 2);
  });
});
