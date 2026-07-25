import { describe, expect, it } from "vitest";
import type { DirectorStageState } from "@clash/shared-types";
import * as directorCore from "./index";
import {
  DIRECTOR_CAMERA_LENS_PRESETS,
  aspectRatioDimensions,
  cameraFocalLengthFromFov,
  cameraFovFromFocalLength,
  cameraLookAtRotation,
  directorObjectFocusPoint,
  evaluateDirectorStage,
  sampleKeyframes,
} from "./index";

const state: DirectorStageState = {
  schemaVersion: 1,
  scene: {
    backgroundColor: "#101114",
    grid: { visible: true, snap: false, size: 1 },
  },
  objects: [
    {
      id: "actor-a",
      name: "Actor A",
      kind: "mannequin",
      visible: true,
      transform: {
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
      mannequin: {
        bodyType: "neutral",
        pose: { preset: "standing", joints: {} },
      },
    },
  ],
  cameras: [
    {
      id: "camera-a",
      name: "Camera A",
      position: [0, 2, 8],
      rotation: [0, 0, 0],
      fov: 45,
      targetObjectId: "actor-a",
    },
  ],
  shots: [],
  activeCameraId: "camera-a",
  animation: {
    durationSeconds: 4,
    fps: 30,
    tracks: [
      {
        id: "actor-x",
        targetId: "actor-a",
        property: "position",
        keyframes: [
          { id: "a", time: 0, value: [0, 0, 0], interpolation: "linear" },
          { id: "b", time: 4, value: [8, 0, 0], interpolation: "linear" },
        ],
      },
      {
        id: "camera-fov",
        targetId: "camera-a",
        property: "fov",
        keyframes: [
          { id: "a", time: 0, value: 45, interpolation: "hold" },
          { id: "b", time: 3, value: 80, interpolation: "linear" },
        ],
      },
    ],
  },
};

describe("Director Stage core", () => {
  it("samples a physical camera rig with settle windows, arc-length travel, and a locked lens", () => {
    const sampleCameraRig = (directorCore as any).sampleDirectorCameraRig;
    expect(sampleCameraRig).toBeTypeOf("function");

    const rig = {
      kind: "dolly",
      settleInSeconds: 0.5,
      settleOutSeconds: 0.5,
      path: {
        interpolation: "catmull-rom",
        points: [
          [0, 1.6, 8],
          [0.2, 1.7, 5],
          [3.4, 2.1, 3],
          [4, 2.2, 0],
        ],
      },
      orientation: {
        mode: "fixed-target",
        target: [0, 1.4, 0],
      },
      lens: {
        mode: "locked",
        focalLengthMm: 50,
      },
    };

    const durationSeconds = 5;
    const opening = sampleCameraRig(rig, 0.4, durationSeconds);
    const moveStart = sampleCameraRig(rig, 0.5, durationSeconds);
    const closing = sampleCameraRig(rig, 4.8, durationSeconds);
    expect(opening.phase).toBe("settle-in");
    expect(opening.position).toEqual([0, 1.6, 8]);
    expect(moveStart.position).toEqual([0, 1.6, 8]);
    expect(closing.phase).toBe("settle-out");
    expect(closing.position).toEqual([4, 2.2, 0]);

    const cruiseTimes = [1.25, 2, 2.75, 3.5];
    const cruiseSamples = cruiseTimes.map((time) => (
      sampleCameraRig(rig, time, durationSeconds)
    ));
    const travel = cruiseTimes.slice(1).map((toTime, index) => {
      const fromTime = cruiseTimes[index]!;
      let distance = 0;
      let previous = sampleCameraRig(rig, fromTime, durationSeconds).position;
      for (let step = 1; step <= 12; step += 1) {
        const position = sampleCameraRig(
          rig,
          fromTime + (toTime - fromTime) * (step / 12),
          durationSeconds,
        ).position;
        distance += Math.hypot(
          position[0] - previous[0],
          position[1] - previous[1],
          position[2] - previous[2],
        );
        previous = position;
      }
      return distance;
    });
    expect(Math.max(...travel) - Math.min(...travel)).toBeLessThan(0.08);
    expect(cruiseSamples.every((sample) => sample.focalLengthMm === 50)).toBe(true);
    expect(cruiseSamples.every((sample) => sample.rotation.every(Number.isFinite))).toBe(true);
  });

  it("keeps a true orbit at constant radius around its physical pivot", () => {
    const sampleCameraRig = (directorCore as any).sampleDirectorCameraRig;
    const rig = {
      kind: "orbit",
      settleInSeconds: 0.25,
      settleOutSeconds: 0.25,
      orbit: {
        pivot: [1, 1.2, -2],
        radius: 4,
        height: 1.8,
        startAngleDegrees: -45,
        endAngleDegrees: 45,
      },
      orientation: {
        mode: "fixed-target",
        target: [1, 1.2, -2],
      },
      lens: {
        mode: "locked",
        focalLengthMm: 65,
      },
    };

    const samples = [0.25, 1, 2, 3, 3.75].map((time) => (
      sampleCameraRig(rig, time, 4)
    ));
    expect(samples.map((sample) => Math.hypot(
      sample.position[0] - 1,
      sample.position[2] + 2,
    ))).toEqual(samples.map(() => expect.closeTo(4, 6)));
    expect(samples.map((sample) => sample.position[1])).toEqual(
      samples.map(() => expect.closeTo(1.8, 6)),
    );
    expect(samples[0]?.position).not.toEqual(samples.at(-1)?.position);
  });

  it("uses shortest-path quaternion orientation independently from camera position", () => {
    const sampleCameraRig = (directorCore as any).sampleDirectorCameraRig;
    const degrees = (value: number) => value * Math.PI / 180;
    const rig = {
      kind: "pan",
      settleInSeconds: 0,
      settleOutSeconds: 0,
      path: {
        interpolation: "linear",
        points: [[0, 1.6, 6], [0, 1.6, 6]],
      },
      orientation: {
        mode: "keyed",
        startRotation: [0, degrees(170), 0],
        endRotation: [0, degrees(-170), 0],
      },
      lens: {
        mode: "locked",
        focalLengthMm: 85,
      },
      maxAngularVelocityDegPerSecond: 30,
      maxAngularAccelerationDegPerSecondSquared: 60,
    };

    const opening = sampleCameraRig(rig, 0, 2);
    const midpoint = sampleCameraRig(rig, 1, 2);
    const closing = sampleCameraRig(rig, 2, 2);
    const quaternionFromEuler = (rotation: number[]) => {
      const [x, y, z] = rotation;
      const c1 = Math.cos(x! / 2);
      const c2 = Math.cos(y! / 2);
      const c3 = Math.cos(z! / 2);
      const s1 = Math.sin(x! / 2);
      const s2 = Math.sin(y! / 2);
      const s3 = Math.sin(z! / 2);
      return [
        s1 * c2 * c3 + c1 * s2 * s3,
        c1 * s2 * c3 - s1 * c2 * s3,
        c1 * c2 * s3 + s1 * s2 * c3,
        c1 * c2 * c3 - s1 * s2 * s3,
      ];
    };
    const expectedYawQuaternion = (yaw: number) => [
      0,
      Math.sin(yaw / 2),
      0,
      Math.cos(yaw / 2),
    ];
    const orientationDot = (rotation: number[], expectedYaw: number) => (
      Math.abs(quaternionFromEuler(rotation).reduce(
        (sum, component, index) => (
          sum + component * expectedYawQuaternion(expectedYaw)[index]!
        ),
        0,
      ))
    );
    const angularDistance = (from: number[], to: number[]) => {
      const fromQuaternion = quaternionFromEuler(from);
      const toQuaternion = quaternionFromEuler(to);
      const dot = Math.min(1, Math.abs(fromQuaternion.reduce(
        (sum, component, index) => sum + component * toQuaternion[index]!,
        0,
      )));
      return 2 * Math.acos(dot);
    };
    const rampStep = angularDistance(
      sampleCameraRig(rig, 0, 2).rotation,
      sampleCameraRig(rig, 0.1, 2).rotation,
    );
    const cruiseStep = angularDistance(
      sampleCameraRig(rig, 0.9, 2).rotation,
      sampleCameraRig(rig, 1, 2).rotation,
    );
    expect(opening.position).toEqual(closing.position);
    expect(orientationDot(opening.rotation, degrees(170))).toBeCloseTo(1, 5);
    expect(orientationDot(midpoint.rotation, Math.PI)).toBeCloseTo(1, 5);
    expect(orientationDot(closing.rotation, degrees(-170))).toBeCloseTo(1, 5);
    expect(rampStep).toBeLessThan(cruiseStep);
  });

  it("keeps smooth position velocity continuous through an intermediate key", () => {
    const samplePosition = (directorCore as any).samplePositionKeyframes;
    expect(samplePosition).toBeTypeOf("function");
    const keys = [
      { id: "start", time: 0, value: [0, 0, 0], interpolation: "bezier" },
      { id: "middle", time: 1, value: [1, 0, 0], interpolation: "bezier" },
      { id: "end", time: 2, value: [2, 0.5, 0], interpolation: "linear" },
    ];
    const before = samplePosition(keys, 0.99);
    const middle = samplePosition(keys, 1);
    const after = samplePosition(keys, 1.01);
    const velocity = (from: number[], to: number[]) => (
      to.map((value, index) => (value - from[index]!) / 0.01)
    );
    const beforeVelocity = velocity(before, middle);
    const afterVelocity = velocity(middle, after);
    const beforeSpeed = Math.hypot(...beforeVelocity);
    const afterSpeed = Math.hypot(...afterVelocity);
    const directionDot = beforeVelocity.reduce(
      (sum, value, index) => sum + value * afterVelocity[index]!,
      0,
    ) / (beforeSpeed * afterSpeed);

    expect(beforeSpeed).toBeGreaterThan(0.5);
    expect(afterSpeed).toBeGreaterThan(0.5);
    expect(Math.abs(beforeSpeed - afterSpeed)).toBeLessThan(0.08);
    expect(directionDot).toBeGreaterThan(0.995);
  });

  it("measures cumulative position-path distance at the playhead", () => {
    const pathDistance = (directorCore as any).directorPositionPathDistance;
    expect(pathDistance).toBeTypeOf("function");
    const keys = [
      { id: "start", time: 0, value: [0, 0, 0], interpolation: "linear" },
      { id: "middle", time: 2, value: [2, 0, 0], interpolation: "linear" },
      { id: "end", time: 4, value: [2, 0, 2], interpolation: "linear" },
    ];

    expect(pathDistance(keys, 0)).toBe(0);
    expect(pathDistance(keys, 1)).toBeCloseTo(1, 6);
    expect(pathDistance(keys, 2)).toBeCloseTo(2, 6);
    expect(pathDistance(keys, 3)).toBeCloseTo(3, 6);
    expect(pathDistance(keys, 4)).toBeCloseTo(4, 6);
  });

  it("switches the active camera from persisted camera cues", () => {
    const multiCameraState = {
      ...state,
      cameras: [
        ...state.cameras,
        {
          id: "camera-b",
          name: "Camera B",
          position: [4, 2, 6] as [number, number, number],
          rotation: [0, 0, 0] as [number, number, number],
          fov: 35,
          targetObjectId: "actor-a",
        },
      ],
      animation: {
        ...state.animation!,
        cameraCues: [
          { id: "opening", name: "Opening", cameraId: "camera-a", startTime: 0, durationSeconds: 2 },
          { id: "reverse", name: "Reverse", cameraId: "camera-b", startTime: 2, durationSeconds: 2 },
        ],
      },
    } as DirectorStageState;

    expect(evaluateDirectorStage(multiCameraState, 1).activeCameraId).toBe("camera-a");
    expect(evaluateDirectorStage(multiCameraState, 2.5).activeCameraId).toBe("camera-b");
    expect(evaluateDirectorStage(multiCameraState, 4).activeCameraId).toBe("camera-b");
  });

  it("uses the first-class timed shot sequence as the canonical camera cut plan", () => {
    const sequencedState = {
      ...state,
      cameras: [
        ...state.cameras,
        {
          id: "camera-b",
          name: "Camera B",
          position: [4, 2, 6] as [number, number, number],
          rotation: [0, 0, 0] as [number, number, number],
          fov: 35,
          targetObjectId: "actor-a",
        },
      ],
      shotSequence: [
        {
          id: "opening",
          name: "Opening",
          cameraId: "camera-a",
          startTime: 0,
          durationSeconds: 2,
          aspectRatio: "16:9",
          transition: "cut",
        },
        {
          id: "reverse",
          name: "Reverse",
          cameraId: "camera-b",
          startTime: 2,
          durationSeconds: 2,
          aspectRatio: "16:9",
          transition: "cut",
        },
      ],
      animation: {
        ...state.animation!,
        cameraCues: [{
          id: "legacy-cue",
          name: "Legacy cue",
          cameraId: "camera-a",
          startTime: 2,
          durationSeconds: 2,
        }],
      },
    } as DirectorStageState;

    expect(evaluateDirectorStage(sequencedState, 1).activeCameraId).toBe("camera-a");
    expect(evaluateDirectorStage(sequencedState, 2.5).activeCameraId).toBe("camera-b");
    expect(evaluateDirectorStage(sequencedState, 4).activeCameraId).toBe("camera-b");
  });

  it("evaluates the active shot rig after legacy tracks without averaged-target drift", () => {
    const actorB = {
      ...state.objects[0]!,
      id: "actor-b",
      transform: {
        ...state.objects[0]!.transform,
        position: [8, 0, 0] as [number, number, number],
      },
    };
    const rig = {
      kind: "dolly" as const,
      settleInSeconds: 0.5,
      settleOutSeconds: 0.5,
      path: {
        interpolation: "catmull-rom" as const,
        points: [
          [0, 2, 8],
          [0.5, 2, 6],
          [2, 2, 4],
        ] as [number, number, number][],
      },
      orientation: {
        mode: "fixed-target" as const,
        target: [0, 1.7, 0] as [number, number, number],
      },
      lens: {
        mode: "locked" as const,
        focalLengthMm: 50,
      },
    };
    const rigState = {
      ...state,
      objects: [...state.objects, actorB],
      cameras: [{
        ...state.cameras[0]!,
        targetObjectId: undefined,
        targetObjectIds: ["actor-a", "actor-b"],
        optics: {
          projection: "perspective" as const,
          focalLengthMm: 35,
          sensorWidthMm: 36,
          sensorHeightMm: 24,
          focusDistanceM: 8,
          fStop: 4,
          shutterAngleDegrees: 180,
          iso: 400,
          nearClipM: 0.1,
          farClipM: 1_000,
        },
      }],
      shotSequence: [{
        id: "shot-rig",
        name: "Motivated dolly",
        cameraId: "camera-a",
        startTime: 0,
        durationSeconds: 4,
        aspectRatio: "16:9" as const,
        transition: "cut" as const,
        cameraMove: {
          preset: "dolly-in",
          easing: "linear" as const,
          rig,
        },
      }],
      animation: {
        ...state.animation!,
        tracks: [{
          id: "legacy-camera-position",
          targetId: "camera-a",
          property: "position" as const,
          keyframes: [
            { id: "from", time: 0, value: [20, 2, 20], interpolation: "linear" as const },
            { id: "to", time: 4, value: [30, 2, 30], interpolation: "linear" as const },
          ],
        }],
      },
    } satisfies DirectorStageState;

    const expected = (directorCore as any).sampleDirectorCameraRig(rig, 2, 4);
    const evaluated = evaluateDirectorStage(rigState, 2);
    const camera = evaluated.cameras[0]!;
    expect(camera.position).toEqual(expected.position);
    expect(camera.rotation).toEqual(expected.rotation);
    expect(camera.optics?.focalLengthMm).toBe(50);
    expect(camera.fov).toBeCloseTo(cameraFovFromFocalLength(50, 24), 5);
  });

  it("holds a shot-start subject target instead of drifting with a moving actor", () => {
    const targetLockedState = {
      ...state,
      shotSequence: [{
        id: "locked-target-shot",
        name: "Locked target",
        cameraId: "camera-a",
        startTime: 0,
        durationSeconds: 4,
        aspectRatio: "16:9" as const,
        transition: "cut" as const,
        cameraMove: {
          preset: "locked-pan",
          easing: "linear" as const,
          rig: {
            kind: "pan" as const,
            settleInSeconds: 0,
            settleOutSeconds: 0,
            path: {
              interpolation: "linear" as const,
              points: [
                [0, 2, 8],
                [0, 2, 8],
              ] as [number, number, number][],
            },
            orientation: {
              mode: "target-object" as const,
              objectId: "actor-a",
              sampling: "shot-start" as const,
            },
            lens: {
              mode: "locked" as const,
              focalLengthMm: 50,
            },
          },
        },
      }],
    } satisfies DirectorStageState;

    const openingRotation = evaluateDirectorStage(targetLockedState, 0).cameras[0]!.rotation;
    const closingRotation = evaluateDirectorStage(targetLockedState, 3.9).cameras[0]!.rotation;
    expect(closingRotation).toEqual(openingRotation);
  });

  it("audits shot axis, subject spacing, camera distance, and line-of-sight occlusion", () => {
    const auditShot = (directorCore as any).auditDirectorShotComposition;
    expect(auditShot).toBeTypeOf("function");
    const actorB = {
      ...state.objects[0]!,
      id: "actor-b",
      transform: {
        ...state.objects[0]!.transform,
        position: [0, 0, 4] as [number, number, number],
      },
    };
    const actorC = {
      ...state.objects[0]!,
      id: "actor-c",
      transform: {
        ...state.objects[0]!.transform,
        position: [2, 0, 0] as [number, number, number],
      },
    };
    const auditState = {
      ...state,
      objects: [...state.objects, actorB, actorC],
      shotSequence: [{
        id: "shot-audit",
        name: "Unsafe setup",
        cameraId: "camera-a",
        startTime: 0,
        durationSeconds: 4,
        aspectRatio: "16:9" as const,
        transition: "cut" as const,
        composition: {
          primarySubjectId: "actor-a",
          secondarySubjectIds: ["actor-b"],
          headroomRatio: 0.1,
          leadRoomRatio: 0.15,
          minimumCameraDistanceM: 10,
          minimumSubjectSeparationM: 5,
          axis: {
            fromObjectId: "actor-a",
            toObjectId: "actor-c",
            cameraSide: "right" as const,
          },
        },
      }],
    } satisfies DirectorStageState;

    const issues = auditShot(auditState, "shot-audit", [0]);
    expect(issues.map((issue: any) => issue.code)).toEqual(expect.arrayContaining([
      "axis-crossed",
      "camera-too-close",
      "subjects-too-close",
      "subject-occluded",
    ]));
  });

  it("accepts safe full-body headroom without forcing close-up spacing", () => {
    const fullBodyState = {
      ...state,
      shotSequence: [{
        id: "full-body",
        name: "Full body",
        cameraId: "camera-a",
        startTime: 0,
        durationSeconds: 4,
        aspectRatio: "16:9" as const,
        transition: "cut" as const,
        composition: {
          primarySubjectId: "actor-a",
          headroomRatio: 0.08,
          leadRoomRatio: 0.1,
          minimumCameraDistanceM: 1,
          minimumSubjectSeparationM: 0,
        },
      }],
    } satisfies DirectorStageState;

    expect(
      (directorCore as any).auditDirectorShotComposition(
        fullBodyState,
        "full-body",
        [0],
      ).map((issue: any) => issue.code),
    ).not.toContain("headroom");
  });

  it("evaluates keyframed physical lens and focus values with a coherent FOV", () => {
    const opticalState = {
      ...state,
      cameras: [{
        ...state.cameras[0]!,
        optics: {
          projection: "perspective",
          focalLengthMm: 35,
          sensorWidthMm: 36,
          sensorHeightMm: 24,
          focusDistanceM: 2,
          fStop: 2.8,
          shutterAngleDegrees: 180,
          iso: 400,
          nearClipM: 0.1,
          farClipM: 1_000,
        },
      }],
      animation: {
        ...state.animation!,
        tracks: [
          {
            id: "camera-focal-length",
            targetId: "camera-a",
            property: "focalLengthMm",
            keyframes: [
              { id: "focal-start", time: 0, value: 35, interpolation: "linear" },
              { id: "focal-end", time: 4, value: 70, interpolation: "linear" },
            ],
          },
          {
            id: "camera-focus-distance",
            targetId: "camera-a",
            property: "focusDistanceM",
            keyframes: [
              { id: "focus-start", time: 0, value: 2, interpolation: "linear" },
              { id: "focus-end", time: 4, value: 10, interpolation: "linear" },
            ],
          },
        ],
      },
    } as DirectorStageState;

    const evaluated = evaluateDirectorStage(opticalState, 2);
    expect(evaluated.cameras[0]?.optics?.focalLengthMm).toBeCloseTo(52.5, 5);
    expect(evaluated.cameras[0]?.optics?.focusDistanceM).toBeCloseTo(6, 5);
    expect(evaluated.cameras[0]?.fov).toBeCloseTo(
      cameraFovFromFocalLength(52.5, 24),
      5,
    );
  });

  it("frames the center of multiple camera targets", () => {
    const focusPoint = (directorCore as any).directorCameraFocusPoint;
    expect(focusPoint).toBeTypeOf("function");
    const actorB = {
      ...state.objects[0]!,
      id: "actor-b",
      transform: { ...state.objects[0]!.transform, position: [4, 0, 0] },
    };
    expect(focusPoint({
      ...state.cameras[0]!,
      targetObjectId: undefined,
      targetObjectIds: ["actor-a", "actor-b"],
      targetOffset: [0, 1, 0],
    }, [...state.objects, actorB])).toEqual([2, 1, 0]);
  });

  it("evaluates action clip local time and blend weight at the playhead", () => {
    const evaluateActionClips = (directorCore as any).evaluateDirectorActionClips;
    expect(evaluateActionClips).toBeTypeOf("function");

    const animation = {
      durationSeconds: 10,
      fps: 30,
      tracks: [],
      actionClips: [{
        id: "wave-a",
        targetId: "actor-a",
        action: "wave",
        layer: "upper-body",
        startTime: 2,
        durationSeconds: 3,
        blendInSeconds: 0.2,
        blendOutSeconds: 0.4,
        playbackRate: 1.5,
      }],
    };

    expect(evaluateActionClips(animation, "actor-a", 1.9)).toEqual([]);
    expect(evaluateActionClips(animation, "actor-a", 2.1)).toEqual([
      expect.objectContaining({
        clip: expect.objectContaining({ id: "wave-a" }),
        localTimeSeconds: expect.closeTo(0.15, 5),
        weight: expect.closeTo(0.5, 5),
      }),
    ]);
    expect(evaluateActionClips(animation, "actor-a", 4.8)[0]?.weight).toBeCloseTo(0.5, 5);
    expect(evaluateActionClips(animation, "actor-a", 5.01)).toEqual([]);
  });

  it("loops a reusable source motion without changing the authored clip duration", () => {
    const evaluateActionClips = (directorCore as any).evaluateDirectorActionClips;
    const animation = {
      durationSeconds: 8,
      fps: 30,
      tracks: [],
      actionClips: [{
        id: "walk-a",
        targetId: "actor-a",
        action: "walk",
        layer: "full-body",
        startTime: 0,
        durationSeconds: 8,
        blendInSeconds: 0,
        blendOutSeconds: 0,
        playbackRate: 1,
        motionAssetId: "motion-walk",
        sourceStartSeconds: 0.1,
        sourceDurationSeconds: 1,
        loopMode: "repeat",
        rootMotionMode: "in-place",
      }],
    };

    expect(evaluateActionClips(animation, "actor-a", 2.35)[0]).toMatchObject({
      clip: { id: "walk-a", motionAssetId: "motion-walk" },
      localTimeSeconds: expect.closeTo(0.45, 5),
      weight: 1,
    });
  });

  it("returns concurrent full-body and upper-body clips in deterministic layer order", () => {
    const evaluateActionClips = (directorCore as any).evaluateDirectorActionClips;
    expect(evaluateActionClips).toBeTypeOf("function");
    const animation = {
      durationSeconds: 10,
      fps: 30,
      tracks: [],
      actionClips: [
        {
          id: "wave",
          targetId: "actor-a",
          action: "wave",
          layer: "upper-body",
          startTime: 1,
          durationSeconds: 4,
          blendInSeconds: 0,
          blendOutSeconds: 0,
          playbackRate: 1,
        },
        {
          id: "walk",
          targetId: "actor-a",
          action: "walk",
          layer: "full-body",
          startTime: 0,
          durationSeconds: 6,
          blendInSeconds: 0,
          blendOutSeconds: 0,
          playbackRate: 1,
        },
      ],
    };

    expect(evaluateActionClips(animation, "actor-a", 2).map(
      (active: { clip: { id: string } }) => active.clip.id,
    )).toEqual(["walk", "wave"]);
  });

  it("locks the calibration view to the panorama capture geometry", () => {
    const calibrationPose = (directorCore as any).directorPanoramaCalibrationCamera;
    expect(calibrationPose).toBeTypeOf("function");

    expect(calibrationPose({
      projection: "equirectangular",
      capturePosition: [0, 1.6, 0],
      captureRotation: [0, Math.PI / 4, 0],
      horizonV: 0.5,
      forwardU: 0.5,
      gridCellMeters: 1,
    })).toEqual({
      position: [0, 1.6, 0],
      rotation: [0, Math.PI / 4, 0],
      fov: 60,
    });
  });

  it("maps panorama spec points onto Three's negative-Z camera direction", () => {
    const environmentRotation = (directorCore as any).directorPanoramaEnvironmentRotation;
    expect(environmentRotation).toBeTypeOf("function");

    expect(environmentRotation({
      projection: "equirectangular",
      capturePosition: [0, 1.6, 0],
      captureRotation: [0, 0, 0],
      horizonV: 0.5,
      forwardU: 0.5,
      gridCellMeters: 1,
    })).toEqual([0, Math.PI / 2, 0]);
    const rotated = environmentRotation({
      projection: "equirectangular",
      capturePosition: [0, 1.6, 0],
      captureRotation: [0, Math.PI / 4, 0],
      horizonV: 0.55,
      forwardU: 0.25,
      gridCellMeters: 1,
    });
    expect(rotated[0]).toBeCloseTo(-Math.PI * 0.05, 10);
    expect(rotated[1]).toBeCloseTo(Math.PI / 4, 10);
    expect(rotated[2]).toBe(0);
  });

  it("renders an exact-size equirectangular reference image with keyed spec points", () => {
    const renderReference = (directorCore as any).renderDirectorPanoramaReference;
    expect(renderReference).toBeTypeOf("function");

    const rendered = renderReference({ width: 32, height: 16 });
    expect(rendered).toMatchObject({
      width: 32,
      height: 16,
      calibration: {
        projection: "equirectangular",
        capturePosition: [0, 1.6, 0],
        captureRotation: [0, 0, 0],
        horizonV: 0.5,
        forwardU: 0.5,
        gridCellMeters: 1,
      },
    });
    expect(rendered.calibration).not.toHaveProperty("workingVolume");
    expect(rendered.pixels).toBeInstanceOf(Uint8ClampedArray);
    expect(rendered.pixels).toHaveLength(32 * 16 * 4);

    const pixel = (x: number, y: number) =>
      Array.from(rendered.pixels.slice((y * 32 + x) * 4, (y * 32 + x + 1) * 4));
    expect(pixel(3, 8)).toEqual([0, 255, 102, 255]);
    expect(pixel(16, 3)).toEqual([255, 0, 255, 255]);
    expect(pixel(24, 3)).toEqual([0, 217, 255, 255]);
  });

  it("keeps generic panoramas spherical until a finite space is explicit", () => {
    const presets = (directorCore as any).DIRECTOR_PANORAMA_WORKING_VOLUME_PRESETS;
    const resolve = (directorCore as any).directorPanoramaWorkingVolume;
    const calibration = (directorCore as any).createDirectorPanoramaCalibration;

    expect(presets.map((preset: { id: string }) => preset.id)).toEqual([
      "compact",
      "standard",
      "large",
    ]);
    expect(presets.find((preset: { id: string }) => preset.id === "compact")).toMatchObject({
      size: [12, 3.6, 12],
    });
    expect(presets.find((preset: { id: string }) => preset.id === "standard")).toMatchObject({
      size: [28, 5.2, 28],
    });
    expect(presets.find((preset: { id: string }) => preset.id === "large")).toMatchObject({
      size: [60, 12, 60],
    });

    expect(resolve()).toBeUndefined();
    expect(calibration()).not.toHaveProperty("workingVolume");
    expect(calibration("compact")).toMatchObject({
      capturePosition: [0, 1.6, 0],
      workingVolume: {
        preset: "compact",
        size: [12, 3.6, 12],
      },
    });
    expect(resolve({
      projection: "equirectangular",
      capturePosition: [0, 1.6, 0],
      captureRotation: [0, 0, 0],
      horizonV: 0.5,
      forwardU: 0.5,
      gridCellMeters: 1,
      workingVolume: {
        mode: "bounded-box",
        preset: "custom",
        size: [36, 8, 20],
        origin: [2, 0, -3],
      },
    })).toMatchObject({
      preset: "custom",
      size: [36, 8, 20],
      origin: [2, 0, -3],
    });
  });

  it("renders a calibration reference with the explicitly selected finite setup", () => {
    const renderReference = (directorCore as any).renderDirectorPanoramaReference;
    const calibration = (directorCore as any).createDirectorPanoramaCalibration("large");

    expect(renderReference({
      width: 32,
      height: 16,
      calibration,
    }).calibration).toEqual(calibration);
  });

  it("samples numeric and vector keyframes with hold and linear interpolation", () => {
    expect(sampleKeyframes([
      { id: "a", time: 0, value: 0, interpolation: "linear" },
      { id: "b", time: 2, value: 10, interpolation: "linear" },
    ], 1)).toBe(5);
    expect(sampleKeyframes([
      { id: "a", time: 0, value: [0, 1, 2], interpolation: "linear" },
      { id: "b", time: 2, value: [10, 5, 6], interpolation: "linear" },
    ], 1)).toEqual([5, 3, 4]);
    expect(sampleKeyframes([
      { id: "a", time: 0, value: 45, interpolation: "hold" },
      { id: "b", time: 2, value: 90, interpolation: "linear" },
    ], 1.9)).toBe(45);
  });

  it("takes the shortest angular path across the camera rotation wrap", () => {
    const degrees = (value: number) => value * Math.PI / 180;
    const rotationState: DirectorStageState = {
      ...state,
      cameras: [{
        ...state.cameras[0]!,
        targetObjectId: undefined,
        rotation: [0, degrees(350), 0],
      }],
      animation: {
        durationSeconds: 2,
        fps: 30,
        tracks: [{
          id: "camera-rotation",
          targetId: "camera-a",
          property: "rotation",
          keyframes: [
            { id: "start", time: 0, value: [0, degrees(350), 0], interpolation: "linear" },
            { id: "end", time: 2, value: [0, degrees(10), 0], interpolation: "linear" },
          ],
        }],
      },
    };

    const yaw = evaluateDirectorStage(rotationState, 1).cameras[0]!.rotation[1];
    expect(Math.abs(yaw % (Math.PI * 2))).toBeLessThan(1e-6);
  });

  it("evaluates immutable object transforms and camera properties at playhead time", () => {
    const evaluated = evaluateDirectorStage(state, 2);
    expect(evaluated).not.toBe(state);
    expect(evaluated.objects[0]?.transform.position).toEqual([4, 0, 0]);
    expect(evaluated.cameras[0]?.fov).toBe(45);
    expect(state.objects[0]?.transform.position).toEqual([0, 0, 0]);
  });

  it("derives a stable camera pitch and yaw for an object target", () => {
    const [pitch, yaw, roll] = cameraLookAtRotation([0, 2, 8], [0, 0, 0]);
    expect(pitch).toBeCloseTo(-0.244978, 4);
    expect(yaw).toBeCloseTo(0, 4);
    expect(roll).toBe(0);
  });

  it("aims Three's negative-Z camera axis at off-center targets", () => {
    const position: [number, number, number] = [1, 1.65, 4.2];
    const target: [number, number, number] = [-3, 1.2, 0.5];
    const rotation = cameraLookAtRotation(position, target);
    const [x, y, z] = rotation;
    const c1 = Math.cos(x / 2);
    const c2 = Math.cos(y / 2);
    const c3 = Math.cos(z / 2);
    const s1 = Math.sin(x / 2);
    const s2 = Math.sin(y / 2);
    const s3 = Math.sin(z / 2);
    const quaternion = [
      s1 * c2 * c3 + c1 * s2 * s3,
      c1 * s2 * c3 - s1 * c2 * s3,
      c1 * c2 * s3 + s1 * s2 * c3,
      c1 * c2 * c3 - s1 * s2 * s3,
    ];
    const [qx, qy, qz, qw] = quaternion;
    const ix = -qy;
    const iy = qx;
    const iz = -qw;
    const iw = qz;
    const forward = [
      ix * qw + iw * -qx + iy * -qz - iz * -qy,
      iy * qw + iw * -qy + iz * -qx - ix * -qz,
      iz * qw + iw * -qz + ix * -qy - iy * -qx,
    ];
    const targetDirection = target.map(
      (component, index) => component - position[index]!,
    );
    const targetLength = Math.hypot(...targetDirection);
    const alignment = forward.reduce(
      (sum, component, index) => (
        sum + component * targetDirection[index]! / targetLength
      ),
      0,
    );
    expect(alignment).toBeGreaterThan(0.999999);
  });

  it("round-trips full-frame focal length and vertical FOV for lens controls", () => {
    const wideFov = cameraFovFromFocalLength(24);
    expect(wideFov).toBeCloseTo(53.1301, 3);
    expect(cameraFocalLengthFromFov(wideFov)).toBeCloseTo(24, 4);
    expect(DIRECTOR_CAMERA_LENS_PRESETS).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "ultra-wide", focalLengthMm: 14 }),
      expect.objectContaining({ id: "wide", focalLengthMm: 24 }),
      expect.objectContaining({ id: "standard", focalLengthMm: 50 }),
      expect.objectContaining({ id: "portrait", focalLengthMm: 85 }),
    ]));
  });

  it("resolves a stable object focus point with an optional camera offset", () => {
    const actor = state.objects[0]!;
    expect(directorObjectFocusPoint(actor)).toEqual([0, 1.1, 0]);
    expect(directorObjectFocusPoint(actor, [0.25, 1.7, -0.4])).toEqual([0.25, 1.7, -0.4]);
  });

  it("aims a bound camera through the same focus point used by the viewport", () => {
    const focused = evaluateDirectorStage({
      ...state,
      animation: undefined,
      cameras: [{
        ...state.cameras[0]!,
        targetOffset: [0, 1.7, 0],
      }],
    }, 0);
    expect(focused.cameras[0]?.rotation).toEqual(
      cameraLookAtRotation([0, 2, 8], [0, 1.7, 0]),
    );
  });

  it("fits supported shot ratios inside a requested long edge", () => {
    expect(aspectRatioDimensions("16:9", 1920)).toEqual({ width: 1920, height: 1080 });
    expect(aspectRatioDimensions("9:16", 1920)).toEqual({ width: 1080, height: 1920 });
    expect(aspectRatioDimensions("1:1", 1200)).toEqual({ width: 1200, height: 1200 });
  });

  it("resolves a mounted rider through the horse saddle hierarchy", () => {
    const worldTransform = (directorCore as any).directorObjectWorldTransform;
    expect(worldTransform).toBeTypeOf("function");
    const objects = [
      {
        id: "horse-a",
        name: "Horse A",
        kind: "creature",
        visible: true,
        transform: { position: [10, 0, 5], rotation: [0, Math.PI / 2, 0], scale: [1, 1, 1] },
        creature: { species: "horse", build: "warmblood", gait: "auto" },
      },
      {
        id: "rider-a",
        name: "Rider A",
        kind: "mannequin",
        visible: true,
        transform: { position: [0, 0.05, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        attachment: {
          parentId: "horse-a",
          socket: "saddle",
          offset: { position: [0, 1.62, -0.08], rotation: [0, 0, 0], scale: [1, 1, 1] },
        },
        mannequin: { bodyType: "neutral", pose: { preset: "riding", joints: {} } },
      },
    ];

    const resolved = worldTransform(objects, "rider-a");
    expect(resolved.position[0]).toBeCloseTo(9.92, 5);
    expect(resolved.position[1]).toBeCloseTo(1.67, 5);
    expect(resolved.position[2]).toBeCloseTo(5, 5);
    expect(resolved.rotation[1]).toBeCloseTo(Math.PI / 2, 5);
  });

  it("aims cameras at the mounted actor's evaluated world position", () => {
    const mountedState = {
      ...state,
      animation: undefined,
      objects: [
        {
          id: "horse-a",
          name: "Horse A",
          kind: "creature",
          visible: true,
          transform: { position: [4, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
          creature: { species: "horse", build: "warmblood", gait: "auto" },
        },
        {
          ...state.objects[0]!,
          attachment: {
            parentId: "horse-a",
            socket: "saddle",
            offset: { position: [0, 1.62, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
          },
        },
      ],
      cameras: [{ ...state.cameras[0]!, targetObjectId: "actor-a", targetOffset: [0, 0.4, 0] }],
    } as any;
    const evaluated = evaluateDirectorStage(mountedState, 0);
    expect(evaluated.cameras[0]?.rotation).toEqual(
      cameraLookAtRotation([0, 2, 8], [4, 2.02, 0]),
    );
  });
});
