import { readFile } from "node:fs/promises";
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

  Object.defineProperty(globalThis, "self", {
    configurable: true,
    value: globalThis,
  });
  Object.defineProperty(globalThis, "createImageBitmap", {
    configurable: true,
    value: async () => ({ width: 1, height: 1, close() {} }),
  });

  try {
    return await run();
  } finally {
    if (hadSelf) {
      Object.defineProperty(globalThis, "self", {
        configurable: true,
        value: previousSelf,
      });
    } else {
      Reflect.deleteProperty(globalThis, "self");
    }
    if (hadCreateImageBitmap) {
      Object.defineProperty(globalThis, "createImageBitmap", {
        configurable: true,
        value: previousCreateImageBitmap,
      });
    } else {
      Reflect.deleteProperty(globalThis, "createImageBitmap");
    }
  }
}

describe("inspectHumanoidRig real asset compatibility", () => {
  it("recognizes the shipped UAL motion rig and a captured Tripo Auto-Rig result", async () => {
    const [ual, tripo] = await withNodeTextureLoading(() => Promise.all([
      parseGlb(UAL_STANDARD_URL),
      parseGlb(TRIPO_AUTO_RIG_URL),
    ]));
    const inspectHumanoidRig = (directorCore as any).inspectHumanoidRig;

    expect(inspectHumanoidRig).toBeTypeOf("function");

    expect(inspectHumanoidRig(ual.scene)).toMatchObject({
      compatible: true,
      boneMap: {
        hips: "pelvis",
        leftUpperArm: "upperarm_l",
        leftLowerArm: "lowerarm_l",
        rightUpperArm: "upperarm_r",
        rightLowerArm: "lowerarm_r",
        leftUpperLeg: "thigh_l",
        leftLowerLeg: "calf_l",
        leftFoot: "foot_l",
        rightUpperLeg: "thigh_r",
        rightLowerLeg: "calf_r",
        rightFoot: "foot_r",
      },
    });
    expect(inspectHumanoidRig(tripo.scene)).toMatchObject({
      compatible: true,
      boneMap: {
        hips: "mixamorigHips",
        leftUpperArm: "mixamorigLeftArm",
        leftLowerArm: "mixamorigLeftForeArm",
        rightUpperArm: "mixamorigRightArm",
        rightLowerArm: "mixamorigRightForeArm",
        leftUpperLeg: "mixamorigLeftUpLeg",
        leftLowerLeg: "mixamorigLeftLeg",
        leftFoot: "mixamorigLeftFoot",
        rightUpperLeg: "mixamorigRightUpLeg",
        rightLowerLeg: "mixamorigRightLeg",
        rightFoot: "mixamorigRightFoot",
      },
    });
  });
});
