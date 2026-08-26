import { readFile } from "node:fs/promises";

import { createExecutorContext, type ExecutorContext } from "@clash/action-sdk";
import { inspectHumanoidRig } from "@clash/director-core";
import type {
  ExecutablePluginInvocation,
  ExecutablePluginOutput,
} from "@clash/shared-types/executable-plugin";
import {
  AnimationMixer,
  LoopOnce,
  PropertyBinding,
  Vector3,
  type Object3D,
} from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { describe, expect, it, vi } from "vitest";

import { plugin } from "./stdio.js";

const TRIPO_AUTO_RIG_URL = new URL(
  "../../../apps/local-api/src/fixtures/tripo-auto-rig-live-traffic.jsonl.blobs/3e6a945dfc96c64510beb32379d24d73751c249fec001e0d826c051e7061dade.bin",
  import.meta.url,
);
const UAL_STANDARD_URL = new URL(
  "../../clash/runtime/assets/starter-library/motions/UAL1_Standard.glb",
  import.meta.url,
);

const invocation: ExecutablePluginInvocation = {
  protocol: "clash.plugin.invoke/v1",
  invocationId: "retarget-humanoid-1",
  taskId: "retarget-humanoid-run-1",
  projectId: "project-1",
  target: {
    pluginId: "clash.director",
    version: "0.1.0",
    exportId: "retarget-humanoid",
    schemaHash: `sha256:${"0".repeat(64)}`,
    kind: "action",
  },
  operation: "submit",
  input: {
    values: {
      clipName: "Walk_Loop",
      rootMotion: "in-place",
      footLock: "off",
    },
    references: [
      {
        slot: "target",
        index: 0,
        asset: {
          assetId: "tripo-auto-rig-target",
          uri: "clash-asset://tripo-auto-rig-target",
          kind: "model",
          mediaType: "model/gltf-binary",
        },
      },
      {
        slot: "motion",
        index: 0,
        asset: {
          assetId: "ual1-standard-motion",
          uri: "clash-asset://ual1-standard-motion",
          kind: "model",
          mediaType: "model/gltf-binary",
        },
      },
    ],
  },
  assetInputs: [{ match: { kinds: ["model"] }, representations: ["bytes"] }],
  actor: { kind: "agent" },
};

async function parseGlb(bytes: Uint8Array): Promise<GLTF> {
  const data = new Uint8Array(bytes).buffer;
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
    } else {
      Reflect.deleteProperty(globalThis, "createImageBitmap");
    }
  }
}

function context(referenceBytes: ReadonlyMap<string, Uint8Array>, uploaded: { bytes?: Uint8Array }): ExecutorContext {
  return createExecutorContext({
    reference: async (reference) => {
      if (!("asset" in reference)) throw new Error(`Missing frozen bytes for ${reference.slot}.`);
      const bytes = referenceBytes.get(reference.asset.assetId);
      if (!bytes) throw new Error(`Missing frozen bytes for ${reference.slot}.`);
      return { form: "bytes", bytes, kind: reference.asset.kind, mediaType: reference.asset.mediaType };
    },
    upload: async (request) => {
      uploaded.bytes = request.bytes;
      expect(request).toMatchObject({ kind: "model", mediaType: "model/gltf-binary" });
      return {
        slot: request.slot,
        kind: "asset",
        asset: {
          assetId: "retargeted-humanoid",
          uri: "clash-asset://retargeted-humanoid",
          kind: "model",
          mediaType: "model/gltf-binary",
        },
      } satisfies ExecutablePluginOutput;
    },
  });
}

type Foot = "leftFoot" | "rightFoot";
type WalkSamples = {
  readonly times: readonly number[];
  readonly positions: Readonly<Record<Foot, readonly Vector3[]>>;
};

const FEET: readonly Foot[] = ["leftFoot", "rightFoot"];

function walkKeyTimes(clip: GLTF["animations"][number]): number[] {
  return [...new Set(clip.tracks.flatMap((track) => [...track.times]))].sort((left, right) => left - right);
}

function bone(root: Object3D, name: string): Object3D {
  const result = root.getObjectByName(name);
  if (!result) throw new Error(`Walk_Loop target rig is missing ${name}.`);
  return result;
}

function sampleWalkLoop(output: GLTF): WalkSamples {
  const report = inspectHumanoidRig(output.scene);
  expect(report.compatible).toBe(true);
  const clip = output.animations.find((candidate) => candidate.name === "Walk_Loop");
  if (!clip) throw new Error("Retargeted output is missing Walk_Loop.");

  const times = walkKeyTimes(clip);
  const feet = Object.fromEntries(FEET.map((foot) => {
    const name = report.boneMap[foot];
    if (!name) throw new Error(`Compatible target rig is missing ${foot}.`);
    return [foot, bone(output.scene, name)];
  })) as Record<Foot, Object3D>;
  const positions: Record<Foot, Vector3[]> = { leftFoot: [], rightFoot: [] };
  const mixer = new AnimationMixer(output.scene);
  const action = mixer.clipAction(clip);
  action.setLoop(LoopOnce, 0).play();

  for (const time of times) {
    mixer.setTime(time);
    output.scene.updateMatrixWorld(true);
    for (const foot of FEET) positions[foot].push(feet[foot].getWorldPosition(new Vector3()));
  }
  mixer.stopAllAction();
  return { times, positions };
}

function localMinimumContacts(positions: readonly Vector3[]): number[] {
  const minima: number[] = [];
  for (let index = 1; index < positions.length - 1; index += 1) {
    if (positions[index]!.y <= positions[index - 1]!.y && positions[index]!.y <= positions[index + 1]!.y) {
      minima.push(index);
    }
  }

  const contacts: number[] = [];
  for (let start = 0; start < minima.length;) {
    let end = start;
    while (minima[end + 1] === minima[end]! + 1) end += 1;
    contacts.push(minima[Math.floor((start + end) / 2)]!);
    start = end + 1;
  }
  return contacts;
}

function contactSlide(positions: readonly Vector3[], contacts: readonly number[]): number {
  return contacts.reduce((total, index) => total + Math.hypot(
    positions[index + 1]!.x - positions[index - 1]!.x,
    positions[index + 1]!.z - positions[index - 1]!.z,
  ), 0);
}

function totalContactSlide(samples: WalkSamples, contacts: Readonly<Record<Foot, readonly number[]>>): number {
  return FEET.reduce((total, foot) => total + contactSlide(samples.positions[foot], contacts[foot]), 0);
}

describe("Director humanoid retarget Action", () => {
  it("retargets the captured Tripo Auto-Rig GLB from the shipped UAL walk", async () => {
    const [targetBytes, motionBytes] = await Promise.all([
      readFile(TRIPO_AUTO_RIG_URL),
      readFile(UAL_STANDARD_URL),
    ]);
    const uploaded: { bytes?: Uint8Array } = {};

    await expect(plugin.invoke(
      invocation,
      context(new Map([
        ["tripo-auto-rig-target", targetBytes],
        ["ual1-standard-motion", motionBytes],
      ]), uploaded),
    )).resolves.toMatchObject({ status: "completed" });

    expect(uploaded.bytes).toBeInstanceOf(Uint8Array);
    const output = await withNodeTextureLoading(() => parseGlb(uploaded.bytes!));
    const report = inspectHumanoidRig(output.scene);
    expect(report.compatible).toBe(true);

    const clip = output.animations.find((candidate) => candidate.name === "Walk_Loop");
    expect(clip).toBeDefined();
    const tripoBones = new Set(Object.values(report.boneMap));
    expect(clip?.tracks.some((track) => {
      const binding = PropertyBinding.parseTrackName(track.name);
      const boneName = binding.objectName === "bones" ? binding.objectIndex : binding.nodeName;
      return binding.propertyName === "quaternion" && tripoBones.has(boneName);
    })).toBe(true);
  });

  it("plays contact sampling without PropertyBinding target warnings and embeds varying motion", async () => {
    const [targetBytes, motionBytes] = await Promise.all([
      readFile(TRIPO_AUTO_RIG_URL),
      readFile(UAL_STANDARD_URL),
    ]);
    const uploaded: { bytes?: Uint8Array } = {};
    const contactInvocation: ExecutablePluginInvocation = {
      ...invocation,
      input: {
        ...invocation.input,
        values: { ...invocation.input.values, footLock: "contact" },
      },
    };
    const warnings: unknown[][] = [];
    const warningSpy = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      warnings.push(args);
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      warnings.push(args);
    });

    try {
      await expect(plugin.invoke(
        contactInvocation,
        context(new Map([
          ["tripo-auto-rig-target", targetBytes],
          ["ual1-standard-motion", motionBytes],
        ]), uploaded),
      )).resolves.toMatchObject({ status: "completed" });
    } finally {
      warningSpy.mockRestore();
      errorSpy.mockRestore();
    }

    expect(warnings.flat().map(String)).not.toContainEqual(expect.stringContaining(
      "THREE.PropertyBinding: No target node found for track:",
    ));
    expect(uploaded.bytes).toBeInstanceOf(Uint8Array);
    const output = await withNodeTextureLoading(() => parseGlb(uploaded.bytes!));
    const clip = output.animations.find((candidate) => candidate.name === "Walk_Loop");
    expect(clip?.tracks.some((track) =>
      Array.from(track.values).some((value, index, values) => index > 0 && value !== values[0]),
    )).toBe(true);
  });

  it("reduces foot slide at off-motion contacts on the captured Tripo target", async () => {
    const [targetBytes, motionBytes] = await Promise.all([
      readFile(TRIPO_AUTO_RIG_URL),
      readFile(UAL_STANDARD_URL),
    ]);
    const referenceBytes = new Map([
      ["tripo-auto-rig-target", targetBytes],
      ["ual1-standard-motion", motionBytes],
    ]);
    const offUpload: { bytes?: Uint8Array } = {};

    await expect(plugin.invoke(invocation, context(referenceBytes, offUpload))).resolves.toMatchObject({
      status: "completed",
    });
    expect(offUpload.bytes).toBeInstanceOf(Uint8Array);
    const offOutput = await withNodeTextureLoading(() => parseGlb(offUpload.bytes!));
    const offSamples = sampleWalkLoop(offOutput);
    const contacts = Object.fromEntries(FEET.map((foot) => [
      foot,
      localMinimumContacts(offSamples.positions[foot]),
    ])) as Record<Foot, number[]>;
    expect(FEET.flatMap((foot) => contacts[foot])).not.toHaveLength(0);

    const contactUpload: { bytes?: Uint8Array } = {};
    const contactInvocation: ExecutablePluginInvocation = {
      ...invocation,
      input: {
        ...invocation.input,
        values: { ...invocation.input.values, footLock: "contact" },
      },
    };
    await expect(plugin.invoke(contactInvocation, context(referenceBytes, contactUpload))).resolves.toMatchObject({
      status: "completed",
    });

    expect(contactUpload.bytes).toBeInstanceOf(Uint8Array);
    const contactOutput = await withNodeTextureLoading(() => parseGlb(contactUpload.bytes!));
    const contactSamples = sampleWalkLoop(contactOutput);
    expect(contactOutput.animations.some((clip) => clip.name === "Walk_Loop" && clip.tracks.length > 0)).toBe(true);
    expect(contactSamples.times).toEqual(offSamples.times);
    expect(totalContactSlide(contactSamples, contacts)).toBeLessThan(totalContactSlide(offSamples, contacts));
  });

  it("preserves root motion on the captured Tripo target with the shipped UAL walk", async () => {
    const [targetBytes, motionBytes] = await Promise.all([
      readFile(TRIPO_AUTO_RIG_URL),
      readFile(UAL_STANDARD_URL),
    ]);
    const uploaded: { bytes?: Uint8Array } = {};
    const preserveInvocation: ExecutablePluginInvocation = {
      ...invocation,
      input: {
        ...invocation.input,
        values: { ...invocation.input.values, rootMotion: "preserve" },
      },
    };

    await expect(plugin.invoke(
      preserveInvocation,
      context(new Map([
        ["tripo-auto-rig-target", targetBytes],
        ["ual1-standard-motion", motionBytes],
      ]), uploaded),
    )).resolves.toMatchObject({ status: "completed" });

    expect(uploaded.bytes).toBeInstanceOf(Uint8Array);
    const output = await withNodeTextureLoading(() => parseGlb(uploaded.bytes!));
    const report = inspectHumanoidRig(output.scene);
    expect(report.compatible).toBe(true);
    const clip = output.animations.find((candidate) => candidate.name === "Walk_Loop");
    expect(clip).toBeDefined();
    const hipsBone = report.boneMap.hips;
    expect(clip?.tracks.some((track) => {
      const binding = PropertyBinding.parseTrackName(track.name);
      const boneName = binding.objectName === "bones" ? binding.objectIndex : binding.nodeName;
      return (binding.propertyName === "position" || binding.propertyName === "translation")
        && boneName === hipsBone;
    })).toBe(true);
  });
});
