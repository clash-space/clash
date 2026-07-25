import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DIRECTOR_MANNEQUIN_POSE_PRESETS,
  evaluateDirectorStage,
} from "@clash/director-ui";
import type { DirectorStageState } from "@clash/shared-types";
import {
  DIRECTOR_MANNEQUIN_BODY_TYPES,
  buildDirectorPanoramaPrompt,
  createDirectorMannequin,
  describeDirectorPanoramaGenerationSetup,
  directorUniformScale,
  prepareDirectorCaptureState,
} from "./ProjectDirectorStageSurface";
import * as directorSurface from "./ProjectDirectorStageSurface";

const state: DirectorStageState = {
  schemaVersion: 1,
  scene: {
    backgroundColor: "#101114",
    grid: { visible: true, snap: false, size: 1 },
  },
  objects: [],
  cameras: [{
    id: "camera-existing",
    name: "Existing camera",
    position: [0, 2, 8],
    rotation: [0, 0, 0],
    fov: 45,
  }],
  shots: [],
  activeCameraId: "camera-existing",
  animation: { durationSeconds: 10, fps: 30, tracks: [] },
};

describe("ProjectDirectorStageSurface", () => {
  it("builds a playable three-character story with dialogue and camera coverage", () => {
    const buildStory = (directorSurface as any).createDirectorThreeActorStory;
    expect(buildStory).toBeTypeOf("function");
    const story = buildStory({
      ...state,
      objects: [],
      cameras: [],
      activeCameraId: undefined,
      animation: undefined,
    });

    expect(story.objects.filter((object: any) => object.kind === "mannequin")).toHaveLength(3);
    expect(story.objects.find((object: any) => object.id === "story-table")).toMatchObject({
      kind: "model",
      model: { assetId: "builtin:polyhaven:wooden-table-02" },
      transform: { scale: [1.1, 1.1, 1.1] },
    });
    expect(story.objects.find((object: any) => object.id === "story-chair")).toMatchObject({
      kind: "model",
      model: { assetId: "builtin:polyhaven:arm-chair-01" },
    });
    expect(story.cameras.length).toBeGreaterThanOrEqual(6);
    expect(story.animation.durationSeconds).toBe(32);
    expect(story.animation.storyBeats.map((beat: any) => beat.dialogue?.text).filter(Boolean)).toEqual([
      "他不会来了。",
      "我只带来这个。",
      "你看过里面的内容？",
      "先别拆。",
      "现在已经太晚了。",
    ]);
    expect(story.animation.cameraCues.map((cue: any) => cue.name)).toEqual([
      "Establishing push",
      "Lead arrival",
      "Waiting reaction",
      "Reverse close-up",
      "Intervention pan",
      "Three-shot arc",
      "Closing pull-out",
    ]);
    expect(story.shotSequence.map((shot: any) => ({
      name: shot.name,
      cameraId: shot.cameraId,
      startTime: shot.startTime,
      durationSeconds: shot.durationSeconds,
      transition: shot.transition,
    }))).toEqual([
      { name: "Establishing push", cameraId: "story-camera-establish", startTime: 0, durationSeconds: 4, transition: "cut" },
      { name: "Lead arrival", cameraId: "story-camera-lead", startTime: 4, durationSeconds: 5, transition: "cut" },
      { name: "Waiting reaction", cameraId: "story-camera-ots", startTime: 9, durationSeconds: 4, transition: "cut" },
      { name: "Reverse close-up", cameraId: "story-camera-reverse", startTime: 13, durationSeconds: 4, transition: "cut" },
      { name: "Intervention pan", cameraId: "story-camera-intervention", startTime: 17, durationSeconds: 5, transition: "cut" },
      { name: "Three-shot arc", cameraId: "story-camera-arc", startTime: 22, durationSeconds: 5, transition: "dissolve" },
      { name: "Closing pull-out", cameraId: "story-camera-closing", startTime: 27, durationSeconds: 5, transition: "cut" },
    ]);
    const movingShots = story.shotSequence.filter((shot: any) => shot.cameraMove);
    expect(movingShots).toHaveLength(4);
    expect(movingShots.map((shot: any) => shot.cameraMove.rig.kind)).toEqual([
      "dolly",
      "truck",
      "pan",
      "crane",
    ]);
    expect(movingShots.every((shot: any) =>
      shot.cameraMove.easing === "linear"
      && shot.cameraMove.rig.settleInSeconds > 0
      && shot.cameraMove.rig.settleOutSeconds > 0
      && shot.cameraMove.rig.lens.mode === "locked",
    )).toBe(true);
    expect(story.shotSequence.every((shot: any) => shot.composition?.primarySubjectId)).toBe(true);
    expect(story.animation.tracks.some((track: any) =>
      track.targetId.startsWith("story-camera-")
      && ["position", "fov", "focalLengthMm"].includes(track.property),
    )).toBe(false);
    for (const [shotId, sampleTime] of [
      ["story-shot-ots", 11],
      ["story-shot-reverse", 15],
    ] as const) {
      const shot = story.shotSequence.find((candidate: any) => candidate.id === shotId);
      const evaluated = evaluateDirectorStage(story, sampleTime);
      const camera = evaluated.cameras.find((candidate: any) => candidate.id === shot.cameraId)!;
      const primary = evaluated.objects.find(
        (candidate: any) => candidate.id === shot.composition.primarySubjectId,
      )!;
      expect(Math.hypot(
        camera.position[0] - primary.transform.position[0],
        camera.position[1] - primary.transform.position[1],
        camera.position[2] - primary.transform.position[2],
      )).toBeGreaterThan(3.5);
    }
    expect(story.cameras.every((camera: any) =>
      camera.optics?.projection === "perspective"
      && camera.optics.focalLengthMm > 0
      && camera.optics.focusDistanceM > 0
      && camera.optics.fStop > 0,
    )).toBe(true);
    expect(story.motionAssets).toHaveLength(18);
    expect(story.motionAssets).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "motion:quaternius-casual-hoodie:walk",
        clipName: "Walk",
        sourceFormat: "gltf",
        sourceRig: expect.objectContaining({
          profileId: "clash-humanoid-v1",
          skeletonType: "biped",
          upAxis: "+Y",
          forwardAxis: "+Z",
        }),
      }),
      expect.objectContaining({
        id: "motion:quaternius-universal-animation-standard:sit",
        clipName: "Sitting_Idle_Loop",
        sourceFormat: "glb",
      }),
    ]));
    expect(story.animation.actionClips.every((clip: any) =>
      clip.motionAssetId
      && clip.retargeting?.mode === "humanoid"
      && clip.rootMotionMode === "in-place",
    )).toBe(true);
    const source = readFileSync(
      new URL("./ProjectDirectorStageSurface.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("auditDirectorShotComposition");
    expect(source).toContain("Composition checks");

    const referenceFrameRequests = (directorSurface as any).directorReferenceFrameRequests(
      story,
      "16:9",
    );
    expect(referenceFrameRequests.map((request: any) => request.timeSeconds)).toEqual([
      0,
      4,
      9,
      13,
      17,
      22,
      27,
      32 - 1 / 30,
    ]);
    expect(referenceFrameRequests.at(-1)).toMatchObject({
      shotId: "story-shot-closing",
      cameraId: "story-camera-closing",
      name: "Closing pull-out · End",
    });
  });

  it("plans a complete preview separately from sorted selected-Shot renders", () => {
    const plan = (directorSurface as any).createDirectorVideoExportPlan;
    expect(plan).toBeTypeOf("function");
    const story = (directorSurface as any).createDirectorThreeActorStory({
      ...state,
      objects: [],
      cameras: [],
      activeCameraId: undefined,
      animation: undefined,
    });

    expect(plan({
      state: story,
      aspectRatio: "16:9",
      mode: "sequence-preview",
      selectedShotIds: ["story-shot-reverse"],
    })).toEqual([expect.objectContaining({
      scope: "sequence",
      startTime: 0,
      durationSeconds: 32,
      shotIds: story.shotSequence.map((shot: any) => shot.id),
    })]);

    expect(plan({
      state: story,
      aspectRatio: "16:9",
      mode: "selected-shots",
      selectedShotIds: ["story-shot-closing", "story-shot-lead"],
    })).toEqual([
      expect.objectContaining({
        scope: "shot",
        shotId: "story-shot-lead",
        cameraId: "story-camera-lead",
        startTime: 4,
        durationSeconds: 5,
      }),
      expect.objectContaining({
        scope: "shot",
        shotId: "story-shot-closing",
        cameraId: "story-camera-closing",
        startTime: 27,
        durationSeconds: 5,
      }),
    ]);
  });

  it("exposes the three-character story as a persisted empty-stage workflow", () => {
    const source = readFileSync(
      new URL("./ProjectDirectorStageSurface.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("Stage three-actor story");
    expect(source).toContain("1 scene · 7 shots · 7 story beats");
    expect(source).toContain("save(createDirectorThreeActorStory(state))");
    expect(source).toContain("state.objects.length > 0 || state.cameras.length > 0");
    expect(source).toContain(
      "data-director-active-camera={evaluatedStage.activeCameraId}",
    );
  });

  it("keeps capture and video export disabled until the remounted WebGL renderer is ready", () => {
    const source = readFileSync(
      new URL("./ProjectDirectorStageSurface.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("const [viewportReady, setViewportReady] = useState(false)");
    expect(source).toContain("data-director-viewport-ready={viewportReady}");
    expect(source).toContain("onReady={() => setViewportReady(true)}");
    expect(source).toContain("disabled={!viewportReady || captureStatus === \"capturing\"}");
    expect(source).toContain("disabled={!viewportReady || !onExportVideo");
  });

  it("assigns professional action layers and clamps new clips to the timeline", () => {
    const defaultLayer = (directorSurface as any).directorActionDefaultLayer;
    const createActionClip = (directorSurface as any).createDirectorActionClip;
    expect(defaultLayer).toBeTypeOf("function");
    expect(createActionClip).toBeTypeOf("function");
    expect(defaultLayer("wave")).toBe("upper-body");
    expect(defaultLayer("walk")).toBe("full-body");
    expect(defaultLayer("interact")).toBe("full-body");
    expect((directorSurface as any).DIRECTOR_ACTION_OPTIONS).toContainEqual({
      value: "interact",
      label: "Interact",
    });
    expect((directorSurface as any).DIRECTOR_ACTION_OPTIONS.slice(0, 4)).toEqual([
      { value: "idle", label: "Idle" },
      { value: "walk", label: "Walk" },
      { value: "run", label: "Run" },
      { value: "wave", label: "Wave" },
    ]);
    expect((directorSurface as any).DIRECTOR_ACTION_OPTIONS).toContainEqual({
      value: "sit",
      label: "Sit · Experimental",
    });
    expect((directorSurface as any).DIRECTOR_ACTION_OPTIONS).toEqual(expect.arrayContaining([
      { value: "dance", label: "Dance" },
      { value: "jump", label: "Jump" },
      { value: "push", label: "Push" },
      { value: "punch", label: "Punch" },
      { value: "drive", label: "Drive · Vehicle" },
    ]));

    expect(createActionClip({
      id: "wave-a",
      targetId: "actor-a",
      action: "wave",
      layer: "upper-body",
      startTime: 9,
      durationSeconds: 3,
      blendSeconds: 0.25,
      timelineDurationSeconds: 10,
      fps: 30,
    })).toEqual({
      id: "wave-a",
      targetId: "actor-a",
      action: "wave",
      layer: "upper-body",
      startTime: 9,
      durationSeconds: 1,
      blendInSeconds: 0.25,
      blendOutSeconds: 0.25,
      playbackRate: 1,
    });
  });

  it("exposes user-authored action controls and selected-clip editing in the Motion inspector", () => {
    const source = readFileSync(
      new URL("./ProjectDirectorStageSurface.tsx", import.meta.url),
      "utf8",
    );
    for (const control of [
      'ariaLabel="Action"',
      'ariaLabel="Action layer"',
      'aria-label="Action duration"',
      'aria-label="Action transition"',
      "Add action at",
      "Remove action clip",
      "onSelectActionClip",
      "onChangeActionClip",
    ]) {
      expect(source).toContain(control);
    }
  });

  it("exposes complete camera keyframing and selected-key editing controls", () => {
    const source = readFileSync(
      new URL("./ProjectDirectorStageSurface.tsx", import.meta.url),
      "utf8",
    );
    for (const control of [
      "Add focal length keyframe",
      'ariaLabel="New key interpolation"',
      'aria-label="Selected keyframe time"',
      'ariaLabel="Selected keyframe interpolation"',
      "Update key from current value",
      "Remove keyframe",
      "onChangeKeyframe",
    ]) {
      expect(source).toContain(control);
    }
  });

  it("pins captured keyframes to the current Stage clock for packet lineage", () => {
    const source = readFileSync(
      new URL("./ProjectDirectorStageSurface.tsx", import.meta.url),
      "utf8",
    );
    const captureCallback =
      source.match(/const captureShot = async \(\) => \{[\s\S]*?\n {2}\};/)?.[0] ?? "";

    expect(captureCallback).toContain("timeSeconds: playheadSeconds");
  });

  it("builds a visible lead-camera preset instead of copying the actor path", () => {
    const buildCameraMoveCommands = (directorSurface as any).buildDirectorCameraMoveCommands;
    const source = readFileSync(
      new URL("./ProjectDirectorStageSurface.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain('ariaLabel="Camera move preset"');
    expect(source).toContain("Lead · front three-quarter");
    expect(source).toContain("Arc around");
    expect(source).toContain("Apply camera move");
    expect(source).toContain(
      'useState<DirectorKeyframeInterpolation>("linear")',
    );
    expect(buildCameraMoveCommands).toBeTypeOf("function");
    const trackingState: DirectorStageState = {
      ...state,
      objects: [{
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
      }],
      cameras: [{
        ...state.cameras[0]!,
        id: "camera-a",
        position: [0, 1.5, 4],
      }],
      activeCameraId: "camera-a",
      shotSequence: [{
        id: "shot-lead",
        name: "Lead",
        cameraId: "camera-a",
        startTime: 0,
        durationSeconds: 5,
        aspectRatio: "16:9",
        transition: "cut",
      }],
      animation: {
        durationSeconds: 10,
        fps: 30,
        tracks: [{
          id: "actor-a-position",
          targetId: "actor-a",
          property: "position",
          keyframes: [
            { id: "walk-start", time: 0, value: [0, 0, 0], interpolation: "linear" },
            { id: "walk-end", time: 5, value: [2, 0, 0], interpolation: "bezier" },
          ],
        }],
      },
    };

    const commands = buildCameraMoveCommands({
      state: trackingState,
      cameraId: "camera-a",
      targetObjectId: "actor-a",
      preset: "lead",
      shotId: "shot-lead",
    });
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      op: "sequence-shot.upsert",
      shot: {
        id: "shot-lead",
        cameraMove: {
          preset: "lead",
          easing: "linear",
          rig: {
            kind: "dolly",
            settleInSeconds: 0.45,
            settleOutSeconds: 0.45,
            orientation: {
              mode: "target-object",
              objectId: "actor-a",
              sampling: "live",
            },
            lens: { mode: "locked" },
          },
        },
        composition: {
          primarySubjectId: "actor-a",
          minimumCameraDistanceM: 1.5,
        },
      },
    });
    expect(commands.some((command: any) => command.op === "keyframe.upsert")).toBe(false);
    expect(trackingState.animation?.tracks[0]?.keyframes[1]?.interpolation).toBe("bezier");
  });

  it("offers crane, reveal, and arc-push camera moves with material 3D travel", () => {
    const presets = (directorSurface as any).DIRECTOR_CAMERA_MOVE_PRESETS;
    const buildCameraMoveCommands = (directorSurface as any).buildDirectorCameraMoveCommands;
    expect(presets.map((preset: any) => preset.value)).toEqual(
      expect.arrayContaining(["crane-up", "reveal", "arc-push"]),
    );
    const trackingState: DirectorStageState = {
      ...state,
      objects: [{
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
      }],
      cameras: [{
        ...state.cameras[0]!,
        id: "camera-a",
      }],
      shotSequence: [{
        id: "shot-crane",
        name: "Crane",
        cameraId: "camera-a",
        startTime: 0,
        durationSeconds: 6,
        aspectRatio: "16:9",
        transition: "cut",
      }],
      animation: {
        durationSeconds: 6,
        fps: 30,
        tracks: [{
          id: "actor-a-position",
          targetId: "actor-a",
          property: "position",
          keyframes: [
            { id: "start", time: 0, value: [0, 0, 0], interpolation: "linear" },
            { id: "end", time: 6, value: [4, 0, 0], interpolation: "linear" },
          ],
        }],
      },
    };
    const craneCommands = buildCameraMoveCommands({
      state: trackingState,
      cameraId: "camera-a",
      targetObjectId: "actor-a",
      preset: "crane-up",
      shotId: "shot-crane",
    });
    const cameraHeights = (craneCommands[0] as any).shot.cameraMove.rig.path.points
      .map((point: number[]) => point[1]);
    expect(Math.max(...cameraHeights) - Math.min(...cameraHeights)).toBeGreaterThan(3);
  });

  it("persists inferred animation metadata for imported rigged models", () => {
    const source = readFileSync(
      new URL("./ProjectDirectorStageSurface.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("animation?: DirectorBuiltinModelRig");
    expect(source).toContain("animation: uploaded.animation");
    expect(source).toContain("selectedObject.model.animation");
  });

  it("creates a persisted camera from the free Director view before capture", () => {
    const prepared = prepareDirectorCaptureState({
      state,
      viewMode: "director",
      cameraPose: {
        position: [4, 3, 9],
        rotation: [-0.1, 0.4, 0],
        fov: 52,
      },
      cameraId: "camera-new",
      cameraName: "Shot 2",
    });

    expect(prepared.cameraId).toBe("camera-new");
    expect(prepared.state.activeCameraId).toBe("camera-new");
    expect(prepared.state.cameras.at(-1)).toMatchObject({
      id: "camera-new",
      position: [4, 3, 9],
      fov: 52,
    });
    expect(state.cameras).toHaveLength(1);
  });

  it("captures through the active persisted camera in camera view", () => {
    const prepared = prepareDirectorCaptureState({
      state,
      viewMode: "camera",
      cameraPose: { position: [9, 9, 9], rotation: [1, 1, 1], fov: 90 },
      cameraId: "ignored",
      cameraName: "Ignored",
    });
    expect(prepared).toEqual({ state, cameraId: "camera-existing" });
  });

  it("turns a scene brief into an explicit 2:1 equirectangular generation contract", () => {
    const prompt = buildDirectorPanoramaPrompt("雨夜里的上海街角");
    expect(prompt).toContain("雨夜里的上海街角");
    expect(prompt).toContain("360-degree equirectangular panorama");
    expect(prompt).toContain("2:1");
    expect(prompt).toContain("seamless left and right edges");
    expect(prompt).toContain("no text");
  });

  it("keeps calibration geometry out of the generated panorama", () => {
    const prompt = buildDirectorPanoramaPrompt("雨夜里的上海街角", {
      calibrationGrid: true,
    });
    expect(prompt).toContain("level, unobstructed floor");
    expect(prompt).toContain("Do not draw");
    expect(prompt).toContain("grid");
    expect(prompt).toContain("chroma");
    expect(prompt).not.toContain("Render a temporary");
  });

  it("tells panorama generation the selected finite stage dimensions", () => {
    const prompt = buildDirectorPanoramaPrompt("clean rehearsal room", {
      workingVolume: {
        mode: "bounded-box",
        preset: "custom",
        size: [36, 8, 20],
        origin: [0, 0, 0],
      },
    });
    expect(prompt).toContain("1.6 m high capture origin");
    expect(prompt).toContain("36 m wide × 20 m deep × 8 m high");
    expect(prompt).toContain("human-scale distances");
  });

  it("explains background-sphere generation before, during, and after the request", () => {
    expect(describeDirectorPanoramaGenerationSetup()).toEqual({
      mode: "background-sphere",
      modeLabel: "Background sphere",
      detail: "No physical size · camera rotation only · no translation parallax",
      actionLabel: "Generate background panorama",
      generatingLabel: "Generating background panorama…",
      receiptLabel: "Generated as Background sphere",
      receiptDetail: "2:1 · 2048×1024 · calibration saved",
    });
  });

  it("explains finite-space generation with the selected proxy dimensions", () => {
    expect(describeDirectorPanoramaGenerationSetup({
      mode: "bounded-box",
      preset: "standard",
      size: [28, 5.2, 28],
      origin: [0, 0, 0],
    })).toEqual({
      mode: "bounded-box",
      modeLabel: "Standard stage",
      detail: "28 × 28 × 5.2 m · 1.6 m capture origin · finite proxy projection",
      actionLabel: "Generate for 28 m stage",
      generatingLabel: "Generating for 28 m stage…",
      receiptLabel: "Generated for Standard stage",
      receiptDetail: "2:1 · 2048×1024 · calibration saved",
    });
  });

  it("uses panorama metadata to lock the camera and render keyed validation colors", () => {
    const source = readFileSync(
      new URL("./ProjectDirectorStageSurface.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("directorPanoramaCalibrationCamera");
    expect(source).toContain("directorPanoramaEnvironmentRotation");
    expect(source).toContain("panoramaCalibrationLocked");
    expect(source).toContain('aria-label="Lock panorama calibration camera"');
    expect(source).toContain("calibrationCamera={panoramaCalibrationCamera}");
    expect(source).toContain("renderPalette={panoramaCalibrationPalette}");
    expect(source).toContain('gridMinor: "#00ff66"');
    expect(source).toContain('gridMajor: "#00ff66"');
  });

  it("defaults panorama setup to a background sphere and keeps finite spaces explicit", () => {
    const source = readFileSync(
      new URL("./ProjectDirectorStageSurface.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("DIRECTOR_PANORAMA_WORKING_VOLUME_PRESETS");
    expect(source).toContain("createDirectorPanoramaCalibration");
    expect(source).toContain("directorPanoramaWorkingVolume");
    expect(source).toContain('ariaLabel="Environment mode"');
    expect(source).toContain('value: "background-sphere"');
    expect(source).toContain("Background sphere");
    expect(source).toContain('value={activePanoramaVolume?.preset ?? "background-sphere"}');
    expect(source).toContain('"Panorama space width"');
    expect(source).toContain('"Panorama space depth"');
    expect(source).toContain('"Panorama space height"');
    expect(source).toContain("Custom space");
    expect(source).toContain("uploaded.calibration ?? activePanoramaCalibration");
    expect(source).toContain(
      "selectedPanorama?.calibration ?? activePanoramaCalibration",
    );
    expect(source).toContain("Distant backdrop");
    expect(source).toContain("no translation parallax");
    expect(source).toContain("calibration: activePanoramaCalibration");
  });

  it("creates every supported mannequin body type with an intentional default color", () => {
    expect(DIRECTOR_MANNEQUIN_BODY_TYPES).toHaveLength(9);
    expect(DIRECTOR_MANNEQUIN_BODY_TYPES.find((body) => body.value === "broad")?.label).toBe("Broad");
    const mannequins = DIRECTOR_MANNEQUIN_BODY_TYPES.map((body, index) =>
      createDirectorMannequin({ id: `actor-${index}`, index, bodyType: body.value }),
    );

    expect(mannequins.map((mannequin) => mannequin.mannequin.bodyType)).toEqual(
      DIRECTOR_MANNEQUIN_BODY_TYPES.map((body) => body.value),
    );
    expect(new Set(mannequins.map((mannequin) => mannequin.color)).size).toBeGreaterThanOrEqual(6);
    expect(mannequins[0]).toMatchObject({
      color: "#e8ebef",
      mannequin: { bodyType: "neutral", bodyShape: 0 },
    });
  });

  it("turns one character-size control into a proportional 3D scale", () => {
    expect(directorUniformScale(1.25)).toEqual([1.25, 1.25, 1.25]);
    expect(directorUniformScale(0.2)).toEqual([0.5, 0.5, 0.5]);
    expect(directorUniformScale(3)).toEqual([2, 2, 2]);
  });

  it("uses the shared 3D/timing packages and existing tokenized Clash controls", () => {
    const source = readFileSync(new URL("./ProjectDirectorStageSurface.tsx", import.meta.url), "utf8");
    expect(source).toContain("DirectorViewport");
    expect(source).toContain("DirectorKeyframeTimeline");
    expect(source).toContain("assetUrls={modelAssetUrls}");
    expect(source).toContain("applyDirectorStageCommand");
    expect(source).toContain("SelectMenu");
    expect(source).toContain("IconButton");
    expect(source).toContain("--clash-director-panel-width");
    expect(source).toContain("Capture shot");
    expect(source).toContain("Preview sequence");
    expect(source).toContain("Lens presets");
    expect(source).toContain("Camera focal length");
    expect(source).toContain("Camera focus distance");
    expect(source).toContain("Camera aperture");
    expect(source).toContain("Vertical FOV");
    expect(source).toContain("Camera pitch");
    expect(source).toContain("Camera yaw");
    expect(source).toContain("Camera roll");
    expect(source).toContain("Focus target");
    expect(source).toContain("Focus offset");
    expect(source).toContain("Add angle keyframe");
    expect(source).toContain("cameraFovFromFocalLength");
    expect(source).toContain("cameraFocalLengthFromFov");
    expect(source).toContain("viewport.record");
    expect(source).toContain("startTimeSeconds: render.startTime");
    expect(source).toContain('exportDirectorVideo("sequence-preview")');
    expect(source).toContain('exportDirectorVideo("selected-shots")');
    expect(source).toContain("onExportVideo");
    expect(source).toContain("directorReferenceFrameRequests");
    expect(source).toContain("referenceFrames");
    expect(source).toContain("Import GLB/glTF");
    expect(source).toContain("Upload panorama");
    expect(source).toContain('ariaLabel="AI panorama environment mode"');
    expect(source).toContain("data-director-panorama-generation-setup");
    expect(source).toContain("data-director-panorama-generation-receipt");
    expect(source).toContain("panoramaGenerationSetup.actionLabel");
    expect(source).toContain("panoramaGenerationReceipt.receiptLabel");
    expect(source).toContain("Preview panorama in viewport");
    expect(source).toContain("showEnvironmentBackground={showPanoramaBackground}");
    expect(source).toContain("Reference scene");
    expect(source).toContain("onGeneratePanorama");
    expect(source).toContain("Pose preset");
    expect(source).toContain("TabProvider");
    expect(source).toContain('id="properties"');
    expect(source).toContain('id="pose"');
    expect(source).toContain('id="motion"');
    expect(source).toContain("Character profile");
    expect(source).toContain("Body shape");
    expect(source).toContain('aria-label="Body shape"');
    expect(source).toContain("Character size");
    expect(source).toContain('aria-label="Character scale"');
    expect(source).toContain("Panorama alignment");
    expect(source).toContain('aria-label="Panorama horizon"');
    expect(source).toContain('aria-label="Panorama yaw"');
    expect(source).toContain('aria-label="Generate panorama calibration grid"');
    expect(source).toContain("Calibration pass");
    expect(source).toContain("bodyShapeLabel");
    expect(source).not.toContain("Heavy mannequin");
    expect(source).toContain("Color palette");
    expect(source).toContain("Reset joint");
    expect(source).toContain("DIRECTOR_MANNEQUIN_POSE_PRESETS");
    expect(Object.values(DIRECTOR_MANNEQUIN_POSE_PRESETS).map((preset) => preset.label)).toEqual(
      expect.arrayContaining(["T-pose", "Crouching", "Kneeling"]),
    );
    expect(source).toContain("Show skeleton");
    expect(source).toContain("<Switch");
    expect(source).toContain("checked={showSkeleton}");
    expect(source).toContain("onCheckedChange={setShowSkeleton}");
    expect(source).not.toContain("Show skeleton ·");
    expect(source).toContain("Joint controls");
    expect(source).toContain("Joint pitch");
    expect(source).toContain("Joint yaw");
    expect(source).toContain("Joint roll");
    expect(source).toContain("showSelectedSkeleton={showSkeleton}");
    expect(source).toContain("Add position keyframe");
    expect(source).toContain("selectedCameraId={selectedCameraId}");
    expect(source).toContain("targetLabels={timelineTargetLabels}");
    expect(source).toContain("shots={state.shotSequence}");
    expect(source).toContain("selectedShotIds={selectedSequenceShotIds}");
    expect(source).toContain("primaryShotId={primarySequenceShotId}");
    expect(source).toContain("Add shot");
    expect(source).toContain("Shot transition");
    expect(source).toContain("Preview sequence");
    expect(source).toContain("Generate selected shots");
    expect(source).toContain("Install CC0 action library");
    expect(source).toContain("Motion source");
    expect(source).not.toContain("bg-[#");
  });

  it("creates a horse and rider composition with a real saddle attachment", () => {
    const createComposition = (directorSurface as any).createDirectorHorseRiderComposition;
    expect(createComposition).toBeTypeOf("function");
    const objects = createComposition({ horseId: "horse-a", riderId: "rider-a", index: 0 });
    expect(objects).toEqual([
      expect.objectContaining({
        id: "horse-a",
        kind: "creature",
        creature: { species: "horse", build: "warmblood", gait: "auto" },
      }),
      expect.objectContaining({
        id: "rider-a",
        kind: "mannequin",
        attachment: expect.objectContaining({ parentId: "horse-a", socket: "saddle" }),
        mannequin: expect.objectContaining({ pose: expect.objectContaining({ preset: "riding" }) }),
      }),
    ]);
  });

  it("exposes saddle authoring and real 3D generation controls", () => {
    const source = readFileSync(new URL("./ProjectDirectorStageSurface.tsx", import.meta.url), "utf8");
    for (const control of [
      "Attach to saddle",
      "Detach from parent",
      "Generate 3D model",
      'aria-label="3D model prompt"',
      'ariaLabel="3D model quality"',
      "onGenerateModel",
      "Hunyuan3D V3",
    ]) {
      expect(source).toContain(control);
    }
  });

  it("keeps authored assets separate from explicit blockout helpers", () => {
    const source = readFileSync(new URL("./ProjectDirectorStageSurface.tsx", import.meta.url), "utf8");
    for (const control of [
      "Browse real 3D assets",
      "Production assets",
      "Blockout only",
      "DIRECTOR_BUILTIN_MODEL_ASSETS",
      "CC0",
      "Lights",
      "Add point light",
      "Add spot light",
      'ariaLabel="Light type"',
      'aria-label="Light intensity"',
    ]) {
      expect(source).toContain(control);
    }
    const editableActorsIndex = source.indexOf("Editable actors");
    const mannequinMapIndex = source.indexOf(
      "DIRECTOR_MANNEQUIN_BODY_TYPES.map",
      editableActorsIndex,
    );
    const blockoutIndex = source.indexOf("Blockout only");
    const boxProxyIndex = source.indexOf("Box proxy", blockoutIndex);

    expect(editableActorsIndex).toBeGreaterThan(-1);
    expect(mannequinMapIndex).toBeGreaterThan(editableActorsIndex);
    expect(mannequinMapIndex).toBeLessThan(blockoutIndex);
    expect(boxProxyIndex).toBeGreaterThan(blockoutIndex);
    expect(source).not.toContain("onSelect={() => addProp(");
    expect(source).not.toContain("onSelect={() => addSetPiece(");
    expect(source).not.toContain("onSelect={() => addVehicle(");
    expect(source).not.toContain("onSelect={addHorse}");
    expect(source).not.toContain("onSelect={addHorseRider}");
  });

  it("reserves one compact header slot for the collapsed Copilot avatar", () => {
    const source = readFileSync(new URL("./ProjectDirectorStageSurface.tsx", import.meta.url), "utf8");
    expect(source).toContain("headerEndInset?: number");
    expect(source).toContain("style={{ paddingRight: headerEndInset }}");
  });
});
