import * as THREE from "three";
import { BVHLoader } from "three/examples/jsm/loaders/BVHLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import {
  inspectDirectorHumanoidRig,
  type DirectorHumanoidRigReport,
} from "./humanoid-profile";

export type DirectorHumanoidSourceFormat = "gltf" | "glb" | "fbx" | "bvh";
export type DirectorSignedAxis = "+X" | "-X" | "+Y" | "-Y" | "+Z" | "-Z";

export interface DirectorCoordinateSystem {
  unitMeters: number;
  upAxis: DirectorSignedAxis;
  forwardAxis: DirectorSignedAxis;
  handedness: "left" | "right";
}

export const CLASH_HUMANOID_COORDINATE_SYSTEM = Object.freeze({
  unitMeters: 1,
  upAxis: "+Y",
  forwardAxis: "+Z",
  handedness: "right",
} satisfies DirectorCoordinateSystem);

export interface ParsedDirectorHumanoidSource {
  format: DirectorHumanoidSourceFormat;
  root: THREE.Group;
  animations: THREE.AnimationClip[];
}

export interface NormalizedDirectorHumanoidSource {
  root: THREE.Group;
  animations: THREE.AnimationClip[];
  coordinates: typeof CLASH_HUMANOID_COORDINATE_SYSTEM;
  sourceCoordinates: DirectorCoordinateSystem;
  sourceToClashMatrix: THREE.Matrix4;
}

export type DirectorHumanoidSourceIssue =
  | {
    code: "incompatible-rig";
    severity: "error";
    message: string;
  }
  | {
    code: "missing-animation";
    severity: "error";
    message: string;
  };

export interface PreparedDirectorHumanoidSource
  extends NormalizedDirectorHumanoidSource {
  format: DirectorHumanoidSourceFormat;
  rig: DirectorHumanoidRigReport;
  admitted: boolean;
  issues: DirectorHumanoidSourceIssue[];
}

function formatFromFileName(fileName: string): DirectorHumanoidSourceFormat {
  const extension = /\.([^.]+)$/.exec(fileName.trim())?.[1]?.toLowerCase();
  if (
    extension === "gltf"
    || extension === "glb"
    || extension === "fbx"
    || extension === "bvh"
  ) {
    return extension;
  }
  throw new Error(`Unsupported humanoid source format: ${fileName}`);
}

function arrayBufferFromData(data: string | ArrayBuffer): ArrayBuffer {
  return typeof data === "string"
    ? new TextEncoder().encode(data).buffer
    : data;
}

function textFromData(data: string | ArrayBuffer): string {
  return typeof data === "string"
    ? data
    : new TextDecoder().decode(data);
}

export async function parseDirectorHumanoidSource({
  fileName,
  data,
  resourcePath = "",
}: {
  fileName: string;
  data: string | ArrayBuffer;
  resourcePath?: string;
}): Promise<ParsedDirectorHumanoidSource> {
  const format = formatFromFileName(fileName);
  if (format === "gltf" || format === "glb") {
    const gltf = await new Promise<GLTF>((resolve, reject) => {
      new GLTFLoader().parse(
        format === "gltf" ? textFromData(data) : arrayBufferFromData(data),
        resourcePath,
        resolve,
        reject,
      );
    });
    return {
      format,
      root: SkeletonUtils.clone(gltf.scene) as THREE.Group,
      animations: gltf.animations.map((clip) => clip.clone()),
    };
  }

  if (format === "fbx") {
    const root = new FBXLoader().parse(arrayBufferFromData(data), resourcePath);
    return {
      format,
      root,
      animations: (root.animations ?? []).map((clip) => clip.clone()),
    };
  }

  const parsed = new BVHLoader().parse(textFromData(data));
  const root = new THREE.Group();
  root.name = "DirectorBVHSource";
  const skeletonRoot = parsed.skeleton.bones.find((bone) => bone.parent === null)
    ?? parsed.skeleton.bones[0];
  if (skeletonRoot) root.add(skeletonRoot);
  return {
    format,
    root,
    animations: [parsed.clip.clone()],
  };
}

function vectorForAxis(axis: DirectorSignedAxis): THREE.Vector3 {
  const sign = axis.startsWith("-") ? -1 : 1;
  switch (axis.at(-1)) {
    case "X":
      return new THREE.Vector3(sign, 0, 0);
    case "Y":
      return new THREE.Vector3(0, sign, 0);
    case "Z":
      return new THREE.Vector3(0, 0, sign);
    default:
      throw new Error(`Invalid coordinate axis: ${axis}`);
  }
}

export function directorSourceToClashMatrix(
  coordinates: DirectorCoordinateSystem,
): THREE.Matrix4 {
  if (!Number.isFinite(coordinates.unitMeters) || coordinates.unitMeters <= 0) {
    throw new Error("Humanoid source unitMeters must be a positive finite number");
  }
  const up = vectorForAxis(coordinates.upAxis);
  const forward = vectorForAxis(coordinates.forwardAxis);
  if (Math.abs(up.dot(forward)) > 1e-6) {
    throw new Error("Humanoid source up and forward axes must be perpendicular");
  }
  const right = coordinates.handedness === "right"
    ? new THREE.Vector3().crossVectors(up, forward)
    : new THREE.Vector3().crossVectors(forward, up);
  const sourceBasis = new THREE.Matrix4().makeBasis(right, up, forward);
  const sourceToClash = sourceBasis.invert();
  return new THREE.Matrix4()
    .makeScale(
      coordinates.unitMeters,
      coordinates.unitMeters,
      coordinates.unitMeters,
    )
    .multiply(sourceToClash);
}

export function normalizeDirectorHumanoidSource({
  root,
  animations,
  coordinates,
}: {
  root: THREE.Object3D;
  animations: readonly THREE.AnimationClip[];
  coordinates: DirectorCoordinateSystem;
}): NormalizedDirectorHumanoidSource {
  const sourceToClashMatrix = directorSourceToClashMatrix(coordinates);
  const adapter = new THREE.Group();
  adapter.name = "ClashHumanoidCoordinateAdapter";
  adapter.matrix.copy(sourceToClashMatrix);
  adapter.matrixAutoUpdate = false;
  adapter.matrixWorldNeedsUpdate = true;
  adapter.userData.clashCoordinateSystem = CLASH_HUMANOID_COORDINATE_SYSTEM;
  adapter.userData.sourceCoordinateSystem = { ...coordinates };
  adapter.add(SkeletonUtils.clone(root));
  adapter.updateWorldMatrix(true, true);
  return {
    root: adapter,
    animations: animations.map((clip) => clip.clone()),
    coordinates: CLASH_HUMANOID_COORDINATE_SYSTEM,
    sourceCoordinates: { ...coordinates },
    sourceToClashMatrix,
  };
}

export async function prepareDirectorHumanoidSource({
  fileName,
  data,
  coordinates,
  resourcePath,
  requireAnimations = false,
}: {
  fileName: string;
  data: string | ArrayBuffer;
  coordinates: DirectorCoordinateSystem;
  resourcePath?: string;
  requireAnimations?: boolean;
}): Promise<PreparedDirectorHumanoidSource> {
  const parsed = await parseDirectorHumanoidSource({ fileName, data, resourcePath });
  const normalized = normalizeDirectorHumanoidSource({
    root: parsed.root,
    animations: parsed.animations,
    coordinates,
  });
  const rig = inspectDirectorHumanoidRig(normalized.root);
  const issues: DirectorHumanoidSourceIssue[] = [];
  if (!rig.compatible) {
    issues.push({
      code: "incompatible-rig",
      severity: "error",
      message: `Source is missing ${rig.issues.length} Clash Humanoid Rig v1 bones`,
    });
  }
  if (requireAnimations && normalized.animations.length === 0) {
    issues.push({
      code: "missing-animation",
      severity: "error",
      message: "Motion sources must contain at least one animation clip",
    });
  }
  return {
    ...normalized,
    format: parsed.format,
    rig,
    admitted: issues.length === 0,
    issues,
  };
}
