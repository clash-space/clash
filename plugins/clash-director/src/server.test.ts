import test from "node:test";
import assert from "node:assert/strict";

test("registers Director headless tools while the GUI is quarantined", async () => {
  const module = await import("./server.js").catch(() => ({} as Record<string, any>));
  assert.equal(typeof module.registerDirectorPluginMcp, "function");
  const tools = new Map<string, any>();
  const resources = new Map<string, any>();
  const fakeServer = {
    registerTool(name: string, config: any, callback: (input: any) => Promise<any>) {
      tools.set(name, { config, callback }); return {};
    },
    registerResource(name: string, uri: string, _config: any, callback: () => Promise<any>) {
      resources.set(name, { uri, callback }); return {};
    },
  };
  const stages = [{ id: "stage-1", name: "Blocking", state: { objects: [], cameras: [] } }];
  const adapter = {
    list: async () => stages,
    get: async () => stages[0],
    create: async () => stages[0],
    save: async () => ({ applied: true }),
    attach: async () => stages[0],
    detach: async () => stages[0],
    mutate: async () => stages[0],
  };
  module.registerDirectorPluginMcp(fakeServer, adapter, "window.__DIRECTOR_APP__ = true;");
  assert.ok(tools.has("clash_director_schema"));
  assert.deepEqual(
    [...tools.keys()],
    module.DIRECTOR_PLUGIN_TOOL_NAMES.filter((name: string) => name !== "clash_director_open"),
  );
  assert.equal(resources.size, 0);
  assert.deepEqual(tools.get("clash_director_list")?.config.annotations, { readOnlyHint: true });
  for (const [name, tool] of tools) {
    assert.match(
      tool.config.description,
      /^Use when: .+ Effect: .+ Returns: .+ Next: .+$/,
      `${name} must advertise a complete operational contract`,
    );
  }
  const captureDescription = tools.get("clash_director_capture")?.config.description;
  assert.match(captureDescription, /Project Asset identit/i);
  assert.match(captureDescription, /downstream Timeline/i);
  assert.match(captureDescription, /does not mutate the Stage/i);
  assert.doesNotMatch(captureDescription, /for Stage shots/i);
  for (const name of [
    "clash_director_list",
    "clash_director_get",
    "clash_director_save",
    "clash_director_scene_update",
  ]) {
    assert.equal(
      tools.get(name)?.config._meta.ui.resourceUri,
      undefined,
      `${name} must not instantiate the Director App`,
    );
    assert.equal(tools.get(name)?.config._meta["ui/resourceUri"], undefined);
  }

  const stateSchema = tools.get("clash_director_save")?.config.inputSchema.state;
  const keyframeSchema = tools.get("clash_director_keyframe_upsert")?.config
    .inputSchema.keyframe;
  assert.equal(
    typeof tools.get("clash_director_save")?.config.inputSchema.baseRevisionId?.safeParse,
    "function",
  );
  assert.equal(typeof stateSchema?.safeParse, "function");
  assert.equal(keyframeSchema.safeParse({}).success, false);
  assert.equal(
    keyframeSchema.safeParse({
      durationSeconds: 2,
      fps: 30,
      trackId: "actor-turn",
      targetId: "actor",
      property: "rotation",
      id: "turn-0",
      time: 0,
      value: [0, 0, 0],
      interpolation: "linear",
    }).success,
    true,
  );
  const currentState: any = {
    schemaVersion: 1,
    scene: { backgroundColor: "#171816", grid: { visible: true, snap: false, size: 1 } },
    objects: [{
      id: "actor",
      name: "Actor",
      kind: "mannequin",
      visible: true,
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      mannequin: { bodyType: "neutral", pose: { preset: "standing", joints: {} } },
    }],
    cameras: [{
      id: "camera",
      name: "Camera",
      position: [0, 1.6, 5],
      rotation: [0, 0, 0],
      fov: 50,
    }],
    shots: [],
    motionAssets: [{
      id: "wave-motion",
      name: "Wave Motion",
      assetId: "motion-asset",
      sourceFormat: "glb",
      clipName: "Wave",
      sourceRig: {
        profileId: "humanoid-v1",
        skeletonType: "biped",
        restPose: "t-pose",
        upAxis: "+Y",
        forwardAxis: "+Z",
        metersPerUnit: 1,
        rootBone: "Root",
      },
    }],
    shotSequence: [{
      id: "shot-1",
      name: "Shot 1",
      cameraId: "camera",
      startTime: 0,
      durationSeconds: 2,
      aspectRatio: "9:16",
      transition: "cut",
    }],
    animation: {
      durationSeconds: 2,
      fps: 30,
      tracks: [{
        id: "actor-turn",
        targetId: "actor",
        property: "rotation",
        keyframes: [
          { id: "turn-0", time: 0, value: [0, 0, 0], interpolation: "linear" },
          { id: "turn-1", time: 2, value: [0, 15, 0], interpolation: "linear" },
        ],
      }],
      storyBeats: [{
        id: "beat-1",
        title: "Recognition",
        startTime: 0,
        durationSeconds: 2,
        participantIds: ["actor"],
      }],
      cameraCues: [{
        id: "cue-1",
        name: "Hold on actor",
        cameraId: "camera",
        startTime: 0,
        durationSeconds: 2,
      }],
    },
  };
  currentState.scene.environmentCalibration = {
    projection: "equirectangular",
    capturePosition: [0, 1.6, 0],
    captureRotation: [0, 0, 0],
    horizonV: 0.5,
    forwardU: 0.5,
    gridCellMeters: 1,
    workingVolume: {
      mode: "bounded-box",
      preset: "standard",
      size: [20, 8, 20],
      origin: [0, 0, 0],
    },
  };
  const parsed = stateSchema.safeParse(currentState);
  assert.equal(parsed.success, true);
  assert.deepEqual(parsed.data, currentState, "MCP validation must never strip canonical Stage fields");
  assert.equal(stateSchema.safeParse({
    ...currentState,
    objects: [{ ...currentState.objects[0], kind: undefined, type: "mannequin" }],
  }).success, false, "native schema must reject the legacy type discriminator");

  const compactJsonSchema = stateSchema["~standard"].jsonSchema.input({ target: "draft-2020-12" });
  assert.equal(compactJsonSchema.type, "object");
  assert.equal(compactJsonSchema.definitions, undefined);
  assert.equal(compactJsonSchema.$defs, undefined);
  assert.match(compactJsonSchema.description ?? "", /clash_director_schema/);

  const schemaResult = await tools.get("clash_director_schema").callback({ contract: "state" });
  assert.equal(schemaResult.isError, undefined);
  assert.equal(schemaResult.structuredContent.source, "@clash/shared-types");
  assert.match(JSON.stringify(schemaResult.structuredContent.jsonSchema), /environmentCalibration/);
});

test("returns automatic stale pulls as structured Director merge recovery", async () => {
  const module = await import("./server.js") as Record<string, any>;
  const tools = new Map<string, any>();
  const fakeServer = {
    registerTool(name: string, _config: any, callback: (input: any) => Promise<any>) {
      tools.set(name, { callback }); return {};
    },
    registerResource() { return {}; },
  };
  const recovery = {
    schemaVersion: 1,
    code: "STALE_READ",
    entityKind: "director-stage",
    entityId: "stage-1",
    currentRevisionId: "revision-2",
    editedProjectionPath: "director-stages/stage-1.director-stage.json",
    latestProjectionPath: ".clash/recovery/director-stage/stage-1.latest.director-stage.json",
    recoveryReceiptPath: ".clash/recovery/director-stage/stage-1.recovery.json",
    next: "Merge the edited projection into the latest projection, then retry the apply command.",
    resubmitted: false,
  };
  const adapter = {
    list: async () => [], get: async () => ({}), capture: async () => ({}),
    create: async () => ({}), attach: async () => ({}), detach: async () => ({}),
    mutate: async () => ({}),
    save: async () => {
      throw new Error(`STALE_READ: latest pulled. CLASH_RECOVERY=${JSON.stringify(recovery)}`);
    },
  };
  module.registerDirectorPluginMcp(fakeServer, adapter, "");

  const result = await tools.get("clash_director_save").callback({
    stageId: "stage-1",
    baseRevisionId: "revision-1",
    state: {},
  });

  assert.equal(result.isError, true);
  assert.deepEqual(result.structuredContent, {
    error: {
      code: "STALE_READ",
      message: "STALE_READ: latest pulled.",
      recovery,
    },
  });
});
