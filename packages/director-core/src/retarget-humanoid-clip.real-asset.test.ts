import { readFile } from "node:fs/promises";
import {
  AnimationClip,
  AnimationMixer,
  Vector3,
  type Object3D,
} from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { describe, expect, it } from "vitest";
import * as directorCore from "./index";

const UAL_STANDARD_URL = new URL(
  "../../director-ui/assets/starter-library/motions/UAL1_Standard.glb",
  import.meta.url,
);
const TRIPO_AUTO_RIG_URL = new URL(
  "../../../apps/local-api/src/fixtures/tripo-auto-rig-live-traffic.jsonl.blobs/3e6a945dfc96c64510beb32379d24d73751c249fec001e0d826c051e7061dade.bin",
  import.meta.url,
);

async function parseGlb(url: URL): Promise<GLTF> {
  const bytes = await readFile(url);
  const data = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  );
  return await new Promise<GLTF>((resolve, reject) => {
    new GLTFLoader().parse(data, "", resolve, reject);
  });
}

async function withNodeTextureLoading<T>(run: () => Promise<T>): Promise<T> {
  const hadSelf = Object.hasOwn(globalThis, "self");
  const previousSelf = Reflect.get(globalThis, "self");
  const hadCreateImageBitmap = Object.hasOwn(globalThis, "createImageBitmap");
  const previousCreateImageBitmap = Reflect.get(globalThis, "createImageBitmap");
  Object.defineProperty(globalThis, "self", { configurable: true, value: globalThis });
  Object.defineProperty(globalThis, "createImageBitmap", {
    configurable: true,
    value: async () => ({ width: 1, height: 1, close() {} }),
  });
  try {
    return await run();
  } finally {
    if (hadSelf) Object.defineProperty(globalThis, "self", { configurable: true, value: previousSelf });
    else Reflect.deleteProperty(globalThis, "self");
    if (hadCreateImageBitmap) {
      Object.defineProperty(globalThis, "createImageBitmap", { configurable: true, value: previousCreateImageBitmap });
    } else Reflect.deleteProperty(globalThis, "createImageBitmap");
  }
}

type Semantic = "leftUpperArm" | "leftLowerArm" | "rightUpperArm" | "rightLowerArm" | "leftUpperLeg" | "leftLowerLeg" | "rightUpperLeg" | "rightLowerLeg";
const segmentEnds: Record<Semantic, string> = {
  leftUpperArm: "leftLowerArm",
  leftLowerArm: "leftHand",
  rightUpperArm: "rightLowerArm",
  rightLowerArm: "rightHand",
  leftUpperLeg: "leftLowerLeg",
  leftLowerLeg: "leftFoot",
  rightUpperLeg: "rightLowerLeg",
  rightLowerLeg: "rightFoot",
};

function actorFrame(root: Object3D, map: Record<string, string>) {
  const bones = new Map<string, Object3D>();
  root.traverse((node) => { if (node.name) bones.set(node.name, node); });
  const point = (semantic: string) => bones.get(map[semantic])!.getWorldPosition(new Vector3());
  const hips = point("hips");
  const up = point("head").sub(hips).normalize();
  const right = point("rightUpperLeg").sub(point("leftUpperLeg")).normalize();
  const forward = new Vector3().crossVectors(right, up).normalize();
  return { right, up, forward };
}

function directionInFrame(root: Object3D, map: Record<string, string>, semantic: Semantic, frame: ReturnType<typeof actorFrame>) {
  const bones = new Map<string, Object3D>();
  root.traverse((node) => { if (node.name) bones.set(node.name, node); });
  const from = bones.get(map[semantic])!.getWorldPosition(new Vector3());
  const to = bones.get(map[segmentEnds[semantic]])!.getWorldPosition(new Vector3());
  const direction = to.sub(from).normalize();
  return new Vector3(direction.dot(frame.right), direction.dot(frame.up), direction.dot(frame.forward));
}

describe("retargetHumanoidClip real asset", () => {
  it("preserves semantic segment direction in each rig's bind actor frame", async () => {
    const [ual, tripo] = await withNodeTextureLoading(() => Promise.all([
      parseGlb(UAL_STANDARD_URL), parseGlb(TRIPO_AUTO_RIG_URL),
    ]));
    const inspectHumanoidRig = (directorCore as any).inspectHumanoidRig;
    const retargetHumanoidClip = (directorCore as any).retargetHumanoidClip;
    const sourceReport = inspectHumanoidRig(ual.scene);
    const targetReport = inspectHumanoidRig(tripo.scene);
    expect(sourceReport.compatible).toBe(true);
    expect(targetReport.compatible).toBe(true);
    const sourceMap = sourceReport.boneMap as Record<string, string>;
    const targetMap = targetReport.boneMap as Record<string, string>;
    const clip = ual.animations.find((animation) => animation.name === "Walk_Loop");
    if (!clip) throw new Error("UAL1_Standard.glb is missing Walk_Loop");
    const retargeted: AnimationClip = retargetHumanoidClip({
      clip,
      sourceRoot: ual.scene,
      targetRoot: tripo.scene,
      boneMapping: Object.keys(sourceMap).map((semantic) => ({
        semantic,
        sourceBoneName: sourceMap[semantic],
        targetBoneName: targetMap[semantic],
      })),
    });

    ual.scene.updateMatrixWorld(true);
    tripo.scene.updateMatrixWorld(true);
    const sourceFrame = actorFrame(ual.scene, sourceMap);
    const targetFrame = actorFrame(tripo.scene, targetMap);
    const sourceMixer = new AnimationMixer(ual.scene);
    const targetMixer = new AnimationMixer(tripo.scene);
    sourceMixer.clipAction(clip).play();
    targetMixer.clipAction(retargeted).play();
    const samples = [0.17, 0.41, 0.73].map((fraction) => clip.duration * fraction);
    const segments: Semantic[] = ["leftUpperArm", "leftLowerArm", "rightUpperArm", "rightLowerArm", "leftUpperLeg", "leftLowerLeg", "rightUpperLeg", "rightLowerLeg"];
    for (const time of samples) {
      sourceMixer.setTime(time);
      targetMixer.setTime(time);
      ual.scene.updateMatrixWorld(true);
      tripo.scene.updateMatrixWorld(true);
      for (const segment of segments) {
        const sourceDirection = directionInFrame(ual.scene, sourceMap, segment, sourceFrame);
        const targetDirection = directionInFrame(tripo.scene, targetMap, segment, targetFrame);
        const dot = sourceDirection.dot(targetDirection);
        expect(dot, `sample ${time.toFixed(6)} segment ${segment}`).toBeGreaterThan(0);
      }
    }
  });
});
