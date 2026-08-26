import { NodeIO, type Document, type Node as GltfNode } from "@gltf-transform/core";
import {
  inspectHumanoidRig,
  retargetHumanoidClip,
  type HumanoidBoneMapping,
} from "@clash/director-core";
import type { ExecutorContext } from "@clash/action-sdk";
import type {
  ExecutablePluginInvocation,
  ExecutablePluginReference,
} from "@clash/shared-types/executable-plugin";
import {
  AnimationClip,
  Bone,
  InterpolateDiscrete,
  Object3D,
  PropertyBinding,
  QuaternionKeyframeTrack,
  VectorKeyframeTrack,
} from "three";

const GLB_MIME_TYPE = "model/gltf-binary";
const ROOT_MOTION_VALUES = new Set(["in-place", "preserve"]);
const FOOT_LOCK_VALUES = new Set(["off", "contact"]);

interface HumanoidRetargetParameters {
  clipName: string;
  rootMotion: "in-place" | "preserve";
  footLock: "off" | "contact";
}

interface ThreeHierarchy {
  root: Object3D;
  nodesByName: ReadonlyMap<string, GltfNode>;
}

function normalizedMediaType(mediaType: string | undefined): string | undefined {
  return mediaType?.split(";", 1)[0]?.trim().toLowerCase();
}

function isGlb(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 12) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(0, true) === 0x46546c67
    && view.getUint32(4, true) === 2
    && view.getUint32(8, true) === bytes.byteLength;
}

function modelReference(
  invocation: ExecutablePluginInvocation,
  slot: "target" | "motion",
): ExecutablePluginReference {
  const references = invocation.input.references.filter((reference) => reference.slot === slot);
  if (references.length !== 1) {
    throw new Error(`Humanoid retarget requires exactly one frozen ${slot} model reference.`);
  }
  const reference = references[0]!;
  if (
    !("asset" in reference)
    || reference.index !== 0
    || reference.asset.kind !== "model"
    || normalizedMediaType(reference.asset.mediaType) !== GLB_MIME_TYPE
  ) {
    throw new Error(`Humanoid retarget requires ${slot} to be a model/gltf-binary model reference.`);
  }
  return reference;
}

function parameters(values: Record<string, unknown>): HumanoidRetargetParameters {
  const clipName = typeof values.clipName === "string" ? values.clipName.trim() : "";
  if (!clipName) throw new Error("Humanoid retarget requires a non-empty clipName.");
  const rootMotion = values.rootMotion;
  if (typeof rootMotion !== "string" || !ROOT_MOTION_VALUES.has(rootMotion)) {
    throw new Error("Humanoid retarget rootMotion must be in-place or preserve.");
  }
  const footLock = values.footLock;
  if (typeof footLock !== "string" || !FOOT_LOCK_VALUES.has(footLock)) {
    throw new Error("Humanoid retarget footLock must be off or contact.");
  }
  return {
    clipName,
    rootMotion: rootMotion as HumanoidRetargetParameters["rootMotion"],
    footLock: footLock as HumanoidRetargetParameters["footLock"],
  };
}

async function glbBytes(
  reference: ExecutablePluginReference,
  context: ExecutorContext,
): Promise<Uint8Array> {
  const resolved = await context.reference(reference);
  if ("kind" in resolved && resolved.kind && resolved.kind !== "model") {
    throw new Error(`Humanoid retarget requires model delivery, received ${resolved.kind}.`);
  }
  const resolvedMediaType = "mediaType" in resolved ? resolved.mediaType : undefined;
  const resolvedType = normalizedMediaType(resolvedMediaType);
  if (resolvedType && resolvedType !== GLB_MIME_TYPE) {
    throw new Error(`Humanoid retarget requires model/gltf-binary delivery, received ${resolvedMediaType}.`);
  }

  let bytes: Uint8Array;
  if (resolved.form === "bytes") {
    bytes = resolved.bytes;
  } else if (resolved.form === "executor-url" || resolved.form === "provider-url") {
    const url = resolved.form === "executor-url" ? resolved.executorUrl : resolved.providerUrl;
    const response = await globalThis.fetch(url);
    if (!response.ok) {
      throw new Error(`Humanoid retarget could not fetch frozen model reference: ${response.status} ${response.statusText}.`);
    }
    const contentType = normalizedMediaType(response.headers.get("content-type") ?? undefined);
    if (contentType && contentType !== GLB_MIME_TYPE) {
      throw new Error(`Humanoid retarget fetched ${contentType}, not model/gltf-binary.`);
    }
    bytes = new Uint8Array(await response.arrayBuffer());
  } else {
    throw new Error("Humanoid retarget requires bytes or a fetchable model reference URL.");
  }

  if (!isGlb(bytes)) throw new Error("Humanoid retarget requires a valid GLB binary.");
  return bytes;
}

async function readGlb(bytes: Uint8Array, label: string): Promise<Document> {
  try {
    return await new NodeIO().readBinary(bytes);
  } catch (error) {
    throw new Error(`Humanoid retarget could not read the ${label} GLB.`, { cause: error });
  }
}

function threeHierarchy(document: Document): ThreeHierarchy {
  const root = new Object3D();
  const gltfNodes = document.getRoot().listNodes();
  const jointNodes = new Set(document.getRoot().listSkins().flatMap((skin) => skin.listJoints()));
  const threeByNode = new Map<GltfNode, Object3D>();
  const nodesByName = new Map<string, GltfNode>();

  for (const node of gltfNodes) {
    const threeNode = jointNodes.has(node) ? new Bone() : new Object3D();
    const rawName = node.getName();
    threeNode.name = PropertyBinding.sanitizeNodeName(rawName);
    threeNode.position.fromArray(node.getTranslation());
    threeNode.quaternion.fromArray(node.getRotation());
    threeNode.scale.fromArray(node.getScale());
    if (threeNode.name) {
      if (nodesByName.has(threeNode.name)) {
        throw new Error(`Humanoid retarget requires unique PropertyBinding-safe node names; ${rawName} collides at ${threeNode.name}.`);
      }
      nodesByName.set(threeNode.name, node);
    }
    threeByNode.set(node, threeNode);
  }
  for (const node of gltfNodes) {
    const threeNode = threeByNode.get(node)!;
    const parent = node.getParentNode();
    if (parent) threeByNode.get(parent)!.add(threeNode);
    else root.add(threeNode);
  }
  root.updateMatrixWorld(true);
  return { root, nodesByName };
}

function motionClip(document: Document, clipName: string): AnimationClip {
  const animations = document.getRoot().listAnimations().filter((animation) => animation.getName() === clipName);
  if (animations.length !== 1) {
    throw new Error(`Humanoid retarget requires exactly one motion clip named ${clipName}.`);
  }
  const tracks: (QuaternionKeyframeTrack | VectorKeyframeTrack)[] = [];
  for (const channel of animations[0]!.listChannels()) {
    const path = channel.getTargetPath();
    if (path !== "rotation" && path !== "translation") continue;
    const target = channel.getTargetNode();
    const sampler = channel.getSampler();
    const input = sampler?.getInput()?.getArray();
    const output = sampler?.getOutput()?.getArray();
    if (!target?.getName() || !sampler || !input || !output || input.constructor !== Float32Array || output.constructor !== Float32Array) {
      throw new Error(`Humanoid retarget motion clip ${clipName} has an invalid ${path} channel.`);
    }
    if (sampler.getInterpolation() === "CUBICSPLINE") {
      throw new Error(`Humanoid retarget does not support CUBICSPLINE ${path} interpolation in ${clipName}.`);
    }
    const valueSize = path === "rotation" ? 4 : 3;
    if (input.length * valueSize !== output.length) {
      throw new Error(`Humanoid retarget motion clip ${clipName} has an invalid ${path} keyframe count.`);
    }
    const track = path === "rotation"
      ? new QuaternionKeyframeTrack(`${PropertyBinding.sanitizeNodeName(target.getName())}.quaternion`, new Float32Array(input), new Float32Array(output))
      : new VectorKeyframeTrack(`${PropertyBinding.sanitizeNodeName(target.getName())}.position`, new Float32Array(input), new Float32Array(output));
    if (sampler.getInterpolation() === "STEP") track.setInterpolation(InterpolateDiscrete);
    tracks.push(track);
  }
  if (!tracks.some((track) => track instanceof QuaternionKeyframeTrack)) {
    throw new Error(`Humanoid retarget motion clip ${clipName} has no rotation channels.`);
  }
  return new AnimationClip(clipName, -1, tracks);
}

function compatibleRig(root: Object3D, label: "target" | "motion"): Record<string, string> {
  const report = inspectHumanoidRig(root);
  if (!report.compatible) {
    throw new Error(`Humanoid retarget ${label} rig is incompatible: ${report.issues.map((issue) => issue.bone).join(", ")}.`);
  }
  return report.boneMap as Record<string, string>;
}

function appendRetargetedAnimation(
  document: Document,
  clip: AnimationClip,
  nodesByName: ReadonlyMap<string, GltfNode>,
): void {
  if (!clip.tracks.length) throw new Error("Humanoid retarget produced no animated target bones.");
  for (const animation of document.getRoot().listAnimations()) {
    if (animation.getName() === clip.name) animation.dispose();
  }
  const buffer = document.getRoot().listBuffers()[0] ?? document.createBuffer();
  const animation = document.createAnimation(clip.name);
  for (const track of clip.tracks) {
    const isRotation = track instanceof QuaternionKeyframeTrack;
    const isTranslation = track instanceof VectorKeyframeTrack;
    const suffix = isRotation ? ".quaternion" : ".position";
    const targetPath = isRotation ? "rotation" : "translation";
    const valueType = isRotation ? "VEC4" : "VEC3";
    const boneName = track.name.endsWith(suffix) ? track.name.slice(0, -suffix.length) : "";
    const targetNode = nodesByName.get(boneName);
    if ((!isRotation && !isTranslation) || !boneName || !targetNode || !(track.values instanceof Float32Array)) {
      throw new Error(`Humanoid retarget could not encode animated bone ${boneName || track.name}.`);
    }
    const input = document.createAccessor(`${boneName}:times`, buffer)
      .setType("SCALAR")
      .setArray(new Float32Array(track.times));
    const output = document.createAccessor(`${boneName}:${targetPath}s`, buffer)
      .setType(valueType)
      .setArray(new Float32Array(track.values));
    const sampler = document.createAnimationSampler(`${boneName}:${targetPath}`)
      .setInput(input)
      .setOutput(output)
      .setInterpolation(track.getInterpolation() === InterpolateDiscrete ? "STEP" : "LINEAR");
    animation.addSampler(sampler).addChannel(
      document.createAnimationChannel(`${boneName}:${targetPath}`)
        .setTargetNode(targetNode)
        .setTargetPath(targetPath)
        .setSampler(sampler),
    );
  }
}

export async function retargetHumanoid(
  invocation: ExecutablePluginInvocation,
  context: ExecutorContext,
) {
  const retargetParameters = parameters(invocation.input.values);
  const targetReference = modelReference(invocation, "target");
  const motionReference = modelReference(invocation, "motion");
  const [targetBytes, motionBytes] = await Promise.all([
    glbBytes(targetReference, context),
    glbBytes(motionReference, context),
  ]);
  const [targetDocument, motionDocument] = await Promise.all([
    readGlb(targetBytes, "target"),
    readGlb(motionBytes, "motion"),
  ]);
  const target = threeHierarchy(targetDocument);
  const motion = threeHierarchy(motionDocument);
  const targetBones = compatibleRig(target.root, "target");
  const motionBones = compatibleRig(motion.root, "motion");
  const clip = motionClip(motionDocument, retargetParameters.clipName);
  const boneMapping: HumanoidBoneMapping[] = Object.keys(motionBones).flatMap((semantic) => {
    const sourceBoneName = motionBones[semantic];
    const targetBoneName = targetBones[semantic];
    return sourceBoneName && targetBoneName ? [{ semantic, sourceBoneName, targetBoneName }] : [];
  });
  const retargeted = retargetHumanoidClip({
    clip,
    sourceRoot: motion.root,
    targetRoot: target.root,
    boneMapping,
    rootMotion: retargetParameters.rootMotion,
    footLock: retargetParameters.footLock,
  });
  appendRetargetedAnimation(targetDocument, retargeted, target.nodesByName);
  const bytes = await new NodeIO().writeBinary(targetDocument);
  return {
    status: "completed" as const,
    media: {
      "animated-model": { bytes, kind: "model" as const, mediaType: GLB_MIME_TYPE },
    },
  };
}
