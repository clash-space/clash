import test from "node:test";
import assert from "node:assert/strict";

test("exposes the complete agent-first Director tool contract", async () => {
  const module = await import("./contract.js").catch(() => ({} as Record<string, unknown>));
  assert.deepEqual(module.DIRECTOR_PLUGIN_TOOL_NAMES, [
    "clash_director_open",
    "clash_director_list",
    "clash_director_get",
    "clash_director_create",
    "clash_director_save",
    "clash_director_attach",
    "clash_director_detach",
    "clash_director_object_add",
    "clash_director_object_update",
    "clash_director_object_remove",
    "clash_director_object_group",
    "clash_director_object_ungroup",
    "clash_director_camera_add",
    "clash_director_camera_update",
    "clash_director_camera_remove",
    "clash_director_scene_update",
    "clash_director_keyframe_upsert",
    "clash_director_keyframe_remove",
    "clash_director_action_upsert",
    "clash_director_action_remove",
  ]);
  assert.equal(typeof module.buildDirectorCliArgs, "function");
  const buildDirectorCliArgs = module.buildDirectorCliArgs as (
    name: string,
    input: Record<string, unknown>,
  ) => string[];
  assert.deepEqual(buildDirectorCliArgs("clash_director_attach", {
    stageId: "stage-1",
    canvasId: "main",
    nodeId: "director-action-1",
    projectId: "project-1",
  }), [
    "director", "attach", "--stage", "stage-1", "--canvas", "main",
    "--node", "director-action-1", "--project", "project-1", "--json",
  ]);
  assert.deepEqual(buildDirectorCliArgs("clash_director_keyframe_remove", {
    stageId: "stage-1",
    projectId: "project-1",
    keyframe: { trackId: "camera-position", id: "key-1" },
  }), [
    "director", "keyframe", "remove", "--track", "camera-position", "--id", "key-1",
    "--stage", "stage-1", "--project", "project-1", "--json",
  ]);
  assert.deepEqual(buildDirectorCliArgs("clash_director_action_upsert", {
    stageId: "stage-1",
    action: {
      id: "wave-1",
      targetId: "actor-1",
      action: "wave",
      layer: "upper-body",
      startTime: 0.5,
      durationSeconds: 3,
      blendInSeconds: 0.2,
      blendOutSeconds: 0.2,
      playbackRate: 1,
      timelineDurationSeconds: 4,
      fps: 30,
    },
  }), [
    "director", "action", "upsert", "--id", "wave-1", "--target", "actor-1",
    "--action", "wave", "--layer", "upper-body", "--start", "0.5",
    "--clip-duration", "3", "--blend-in", "0.2", "--blend-out", "0.2",
    "--playback-rate", "1", "--timeline-duration", "4", "--fps", "30",
    "--stage", "stage-1", "--json",
  ]);
});
