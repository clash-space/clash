import type { DirectorStageActionName } from "@clash/shared-types";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { DirectorBuiltinModelRig } from "./builtin-model-assets";

export interface DirectorEmbeddedModelAnimation {
  clipName: string;
  localTimeSeconds: number;
  weight: number;
}

const ACTION_CLIP_PATTERNS: ReadonlyArray<[
  DirectorStageActionName,
  RegExp,
]> = [
  ["idle", /(?:^|[^a-z])(idle|stand)(?:[^a-z]|$)/i],
  ["walk", /walk/i],
  ["run", /(run|jog|gallop)/i],
  ["sit", /sit/i],
  ["crouch", /(crouch|squat)/i],
  ["kneel", /kneel/i],
  ["wave", /wave/i],
  ["point", /point/i],
  ["think", /think/i],
  ["hands-up", /(hands?.*up|raise.*hands?)/i],
  ["interact", /interact/i],
  ["ride", /rid(e|ing)/i],
  ["talk", /(talk|speak)/i],
  ["dance", /dance/i],
  ["jump", /jump/i],
  ["roll", /(?:^|[^a-z])roll(?:[^a-z]|$)/i],
  ["pickup", /(pick.*up|pickup)/i],
  ["push", /push/i],
  ["punch", /punch/i],
  ["swim", /swim/i],
  ["drive", /driv(e|ing)/i],
  ["death", /(death|die|dying)/i],
];

export function inferDirectorModelRig(input: {
  jointCount: number;
  clipNames: readonly string[];
}): DirectorBuiltinModelRig {
  const clipNames = [...new Set(input.clipNames.map((name) => name.trim()).filter(Boolean))];
  const actionMap: Partial<Record<DirectorStageActionName, string>> = {};
  for (const [action, pattern] of ACTION_CLIP_PATTERNS) {
    const clipName = clipNames.find((name) => pattern.test(name.replaceAll("_", " ")));
    if (clipName) actionMap[action] = clipName;
  }
  return {
    jointCount: Math.max(1, Math.round(input.jointCount)),
    clipNames,
    actionMap,
  };
}

export async function inspectDirectorModelFile(
  file: Pick<File, "name" | "arrayBuffer" | "text">,
): Promise<DirectorBuiltinModelRig | undefined> {
  const source = /\.gltf$/i.test(file.name)
    ? await file.text()
    : await file.arrayBuffer();
  const gltf = await new Promise<GLTF>((resolve, reject) => {
    new GLTFLoader().parse(source, "", resolve, reject);
  });
  let jointCount = 0;
  gltf.scene.traverse((object) => {
    if ((object as { isBone?: boolean }).isBone) jointCount += 1;
  });
  const clipNames = gltf.animations.map((clip) => clip.name).filter(Boolean);
  if (jointCount === 0 || clipNames.length === 0) return undefined;
  const rig = inferDirectorModelRig({ jointCount, clipNames });
  return Object.keys(rig.actionMap).length > 0 ? rig : undefined;
}

export function resolveDirectorEmbeddedModelAnimation(input: {
  rig: DirectorBuiltinModelRig;
  requestedAction?: DirectorStageActionName;
  actionLocalTimeSeconds?: number;
  actionWeight?: number;
  locomotionSpeed: number;
  locomotionDistance?: number;
  timeSeconds: number;
}): DirectorEmbeddedModelAnimation | undefined {
  const fallbackAction: DirectorStageActionName = input.locomotionSpeed > 1.5
    ? "run"
    : input.locomotionSpeed > 0.01
      ? "walk"
      : "idle";
  const action = input.requestedAction ?? fallbackAction;
  const clipName = input.rig.actionMap[action];
  if (!clipName || !input.rig.clipNames.includes(clipName)) return undefined;
  return {
    clipName,
    localTimeSeconds: input.requestedAction
      ? Math.max(0, input.actionLocalTimeSeconds ?? 0)
      : input.locomotionDistance !== undefined && (action === "walk" || action === "run")
        ? Math.max(0, input.locomotionDistance) / (action === "run" ? 3.6 : 1.5)
        : Math.max(0, input.timeSeconds),
    weight: Math.min(1, Math.max(0, input.actionWeight ?? 1)),
  };
}
