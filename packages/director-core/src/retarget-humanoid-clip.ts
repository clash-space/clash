import {
  AnimationClip,
  AnimationMixer,
  Bone,
  Matrix4,
  LoopOnce,
  PropertyBinding,
  Quaternion,
  QuaternionKeyframeTrack,
  Vector3,
  VectorKeyframeTrack,
  type Object3D,
} from "three";

export interface HumanoidBoneMapping {
  semantic: string;
  sourceBoneName: string;
  targetBoneName: string;
}

export interface RetargetHumanoidClipOptions {
  clip: AnimationClip;
  sourceRoot: Object3D;
  targetRoot: Object3D;
  boneMapping: readonly HumanoidBoneMapping[];
  /** Keep full root translation, or retain only vertical motion (the default). */
  rootMotion?: "in-place" | "preserve";
  /** Stabilize horizontal foot motion at detected contacts (off by default). */
  footLock?: "off" | "contact";
}

interface LocalTransform {
  position: [number, number, number];
  quaternion: [number, number, number, number];
  scale: [number, number, number];
}

interface RestMapping {
  semantic: string;
  sourceBone: Bone;
  targetBone: Bone;
  sourceRestWorldInverse: Quaternion;
  targetRestWorld: Quaternion;
  targetRestLocal: Quaternion;
}

interface RootMotionMapping {
  sourceBone: Bone;
  targetBone: Bone;
  sourceRestLocalPosition: Vector3;
  targetRestLocalPosition: Vector3;
  sourceRestParentWorld: Quaternion;
  targetRestParentWorld: Quaternion;
}

function namedBones(root: Object3D): Map<string, Bone> {
  const bones = new Map<string, Bone>();
  root.traverse((node) => {
    if (node instanceof Bone && node.name && !bones.has(node.name)) {
      bones.set(node.name, node);
    }
  });
  return bones;
}

function quaternionTrackBoneName(trackName: string): string | undefined {
  const binding = PropertyBinding.parseTrackName(trackName);
  if (binding.propertyName !== "quaternion") return undefined;
  if (binding.objectName === "bones") return binding.objectIndex;
  return binding.nodeName;
}

function snapshotTransforms(root: Object3D): Map<Object3D, LocalTransform> {
  const transforms = new Map<Object3D, LocalTransform>();
  root.traverse((node) => {
    transforms.set(node, {
      position: [node.position.x, node.position.y, node.position.z],
      quaternion: [node.quaternion.x, node.quaternion.y, node.quaternion.z, node.quaternion.w],
      scale: [node.scale.x, node.scale.y, node.scale.z],
    });
  });
  return transforms;
}

function restoreTransforms(transforms: ReadonlyMap<Object3D, LocalTransform>): void {
  for (const [node, transform] of transforms) {
    node.position.fromArray(transform.position);
    node.quaternion.fromArray(transform.quaternion);
    node.scale.fromArray(transform.scale);
  }
}

function hierarchyDepth(bone: Bone): number {
  let depth = 0;
  let parent = bone.parent;
  while (parent) {
    depth += 1;
    parent = parent.parent;
  }
  return depth;
}

function actorFrameQuaternion(
  bonesBySemantic: ReadonlyMap<string, Bone>,
): Quaternion | undefined {
  const hips = bonesBySemantic.get("hips");
  const head = bonesBySemantic.get("head");
  const leftUpperLeg = bonesBySemantic.get("leftUpperLeg");
  const rightUpperLeg = bonesBySemantic.get("rightUpperLeg");
  if (!hips || !head || !leftUpperLeg || !rightUpperLeg) return undefined;

  const hipsPosition = hips.getWorldPosition(new Vector3());
  const up = head.getWorldPosition(new Vector3()).sub(hipsPosition);
  const right = rightUpperLeg.getWorldPosition(new Vector3())
    .sub(leftUpperLeg.getWorldPosition(new Vector3()));
  if (up.lengthSq() === 0 || right.lengthSq() === 0) return undefined;
  up.normalize();
  right.normalize();
  const forward = new Vector3().crossVectors(right, up);
  if (forward.lengthSq() === 0) return undefined;
  forward.normalize();

  return new Quaternion().setFromRotationMatrix(
    new Matrix4().makeBasis(right, up, forward),
  );
}

function bodyScale(restMappings: readonly RestMapping[]): number {
  const bySemantic = new Map(restMappings.map((mapping) => [mapping.semantic, mapping]));
  const hips = bySemantic.get("hips");
  const leftFoot = bySemantic.get("leftFoot");
  const rightFoot = bySemantic.get("rightFoot");
  if (!hips || !leftFoot || !rightFoot) return 1;

  const sourceDistance = (
    hips.sourceBone.getWorldPosition(new Vector3()).distanceTo(leftFoot.sourceBone.getWorldPosition(new Vector3()))
    + hips.sourceBone.getWorldPosition(new Vector3()).distanceTo(rightFoot.sourceBone.getWorldPosition(new Vector3()))
  ) / 2;
  const targetDistance = (
    hips.targetBone.getWorldPosition(new Vector3()).distanceTo(leftFoot.targetBone.getWorldPosition(new Vector3()))
    + hips.targetBone.getWorldPosition(new Vector3()).distanceTo(rightFoot.targetBone.getWorldPosition(new Vector3()))
  ) / 2;
  return sourceDistance > 0 && targetDistance > 0 ? targetDistance / sourceDistance : 1;
}

function actorFrameAlignment(restMappings: readonly RestMapping[]): Quaternion {
  const sourceBonesBySemantic = new Map<string, Bone>();
  const targetBonesBySemantic = new Map<string, Bone>();
  for (const mapping of restMappings) {
    if (!sourceBonesBySemantic.has(mapping.semantic)) {
      sourceBonesBySemantic.set(mapping.semantic, mapping.sourceBone);
    }
    if (!targetBonesBySemantic.has(mapping.semantic)) {
      targetBonesBySemantic.set(mapping.semantic, mapping.targetBone);
    }
  }
  const sourceFrame = actorFrameQuaternion(sourceBonesBySemantic);
  const targetFrame = actorFrameQuaternion(targetBonesBySemantic);
  if (!sourceFrame || !targetFrame) return new Quaternion();
  return targetFrame.multiply(sourceFrame.invert());
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

function retargetedKeyTimes(clip: AnimationClip): number[] {
  return [...new Set(clip.tracks.flatMap((track) => [...track.times]))]
    .sort((left, right) => left - right);
}

function stabilizeFootContacts({
  clip,
  targetRoot,
  hips,
  feet,
  targetActorUp,
}: {
  clip: AnimationClip;
  targetRoot: Object3D;
  hips: Bone;
  feet: readonly Bone[];
  targetActorUp: Vector3;
}): AnimationClip {
  const keyTimes = retargetedKeyTimes(clip);
  if (keyTimes.length < 3 || feet.length === 0) return clip;

  const targetPose = snapshotTransforms(targetRoot);
  const footPositions = new Map(feet.map((foot) => [foot, [] as Vector3[]]));
  const hipsPositions: Vector3[] = [];
  const hipsParentRestWorld = hips.parent
    ? hips.parent.getWorldQuaternion(new Quaternion())
    : new Quaternion();
  const mixer = new AnimationMixer(targetRoot);
  const action = mixer.clipAction(clip);
  action.setLoop(LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();

  try {
    for (const time of keyTimes) {
      restoreTransforms(targetPose);
      targetRoot.updateMatrixWorld(true);
      mixer.setTime(time);
      targetRoot.updateMatrixWorld(true);
      hipsPositions.push(hips.position.clone());
      for (const foot of feet) {
        footPositions.get(foot)!.push(foot.getWorldPosition(new Vector3()));
      }
    }
  } finally {
    action.stop();
    mixer.uncacheClip(clip);
    restoreTransforms(targetPose);
    targetRoot.updateMatrixWorld(true);
  }

  const totalCorrections = keyTimes.map(() => new Vector3());
  const correctionCounts = keyTimes.map(() => 0);
  for (const foot of feet) {
    const positions = footPositions.get(foot)!;
    for (const anchor of localMinimumContacts(positions)) {
      for (let keyIndex = anchor - 1; keyIndex <= anchor + 1; keyIndex += 1) {
        const correction = positions[anchor]!.clone().sub(positions[keyIndex]!);
        correction.addScaledVector(targetActorUp, -correction.dot(targetActorUp));
        totalCorrections[keyIndex]!.add(correction);
        correctionCounts[keyIndex]! += 1;
      }
    }
  }
  if (!correctionCounts.some((count) => count > 0)) return clip;

  const values = new Float32Array(keyTimes.length * 3);
  for (let keyIndex = 0; keyIndex < keyTimes.length; keyIndex += 1) {
    const count = correctionCounts[keyIndex]!;
    const correction = count > 0
      ? totalCorrections[keyIndex]!.clone().multiplyScalar(1 / count)
      : new Vector3();
    const localCorrection = correction.applyQuaternion(hipsParentRestWorld.clone().invert());
    hipsPositions[keyIndex]!.clone().add(localCorrection).toArray(values, keyIndex * 3);
  }

  const hipsPositionTrack = clip.tracks.find((track) => {
    const binding = PropertyBinding.parseTrackName(track.name);
    const boneName = binding.objectName === "bones" ? binding.objectIndex : binding.nodeName;
    return track instanceof VectorKeyframeTrack
      && binding.propertyName === "position"
      && boneName === hips.name;
  });
  const lockedHipsTrack = new VectorKeyframeTrack(`${hips.name}.position`, keyTimes, values);
  if (hipsPositionTrack) lockedHipsTrack.setInterpolation(hipsPositionTrack.getInterpolation());
  return new AnimationClip(
    clip.name,
    clip.duration,
    hipsPositionTrack
      ? clip.tracks.map((track) => track === hipsPositionTrack ? lockedHipsTrack : track)
      : [...clip.tracks, lockedHipsTrack],
  );
}

/**
 * Retargets source animation in world space relative to both rigs' bind poses.
 * This preserves the source's animated segment directions even when the two
 * skeletons use different local axes or parent orientations.
 */
export function retargetHumanoidClip({
  clip,
  sourceRoot,
  targetRoot,
  boneMapping,
  rootMotion = "in-place",
  footLock = "off",
}: RetargetHumanoidClipOptions): AnimationClip {
  const sourceBones = namedBones(sourceRoot);
  const targetBones = namedBones(targetRoot);
  const sourcePose = snapshotTransforms(sourceRoot);
  const targetPose = snapshotTransforms(targetRoot);

  sourceRoot.updateMatrixWorld(true);
  targetRoot.updateMatrixWorld(true);

  const mappingsByTarget = new Map<string, HumanoidBoneMapping>();
  for (const mapping of [...boneMapping].sort((left, right) => (
    left.targetBoneName.localeCompare(right.targetBoneName)
    || left.sourceBoneName.localeCompare(right.sourceBoneName)
    || left.semantic.localeCompare(right.semantic)
  ))) {
    if (!mappingsByTarget.has(mapping.targetBoneName)) {
      mappingsByTarget.set(mapping.targetBoneName, mapping);
    }
  }

  const restMappings: RestMapping[] = [];
  for (const mapping of mappingsByTarget.values()) {
    const sourceBone = sourceBones.get(mapping.sourceBoneName);
    const targetBone = targetBones.get(mapping.targetBoneName);
    if (!sourceBone || !targetBone) continue;
    restMappings.push({
      semantic: mapping.semantic,
      sourceBone,
      targetBone,
      sourceRestWorldInverse: sourceBone.getWorldQuaternion(new Quaternion()).invert(),
      targetRestWorld: targetBone.getWorldQuaternion(new Quaternion()),
      targetRestLocal: targetBone.quaternion.clone(),
    });
  }
  restMappings.sort((left, right) => (
    hierarchyDepth(left.targetBone) - hierarchyDepth(right.targetBone)
    || left.targetBone.name.localeCompare(right.targetBone.name)
    || left.sourceBone.name.localeCompare(right.sourceBone.name)
  ));

  const sourceToTargetActorAlignment = actorFrameAlignment(restMappings);
  const targetToSourceActorAlignment = sourceToTargetActorAlignment.clone().invert();
  const targetActorUp = new Vector3(0, 1, 0).applyQuaternion(
    actorFrameQuaternion(new Map(restMappings.map((mapping) => [mapping.semantic, mapping.targetBone])))
      ?? new Quaternion(),
  );
  const scale = bodyScale(restMappings);

  const hipsMapping = restMappings.find((mapping) => mapping.semantic === "hips");
  const rootMotionTrack = hipsMapping && clip.tracks.find((track) => {
    const binding = PropertyBinding.parseTrackName(track.name);
    const boneName = binding.objectName === "bones" ? binding.objectIndex : binding.nodeName;
    return binding.propertyName === "position" && boneName === hipsMapping.sourceBone.name;
  });
  const rootMotionMapping: RootMotionMapping | undefined = hipsMapping && rootMotionTrack
    ? {
      sourceBone: hipsMapping.sourceBone,
      targetBone: hipsMapping.targetBone,
      sourceRestLocalPosition: hipsMapping.sourceBone.position.clone(),
      targetRestLocalPosition: hipsMapping.targetBone.position.clone(),
      sourceRestParentWorld: hipsMapping.sourceBone.parent
        ? hipsMapping.sourceBone.parent.getWorldQuaternion(new Quaternion())
        : new Quaternion(),
      targetRestParentWorld: hipsMapping.targetBone.parent
        ? hipsMapping.targetBone.parent.getWorldQuaternion(new Quaternion())
        : new Quaternion(),
    }
    : undefined;

  const mappedSourceNames = new Set(restMappings.map(({ sourceBone }) => sourceBone.name));
  const keyTimes = [...new Set(clip.tracks.flatMap((track) => {
    const quaternionBoneName = quaternionTrackBoneName(track.name);
    if (quaternionBoneName && mappedSourceNames.has(quaternionBoneName)) return [...track.times];
    if (rootMotionTrack === track) return [...track.times];
    return [];
  }))].sort((left, right) => left - right);

  if (restMappings.length === 0 || keyTimes.length === 0) {
    return new AnimationClip(clip.name, clip.duration, []);
  }

  const values = new Map<RestMapping, Float32Array>();
  const rootMotionValues = rootMotionMapping && new Float32Array(keyTimes.length * 3);
  const previousKeys = new Map<RestMapping, Quaternion>();
  for (const mapping of restMappings) {
    values.set(mapping, new Float32Array(keyTimes.length * 4));
  }

  const mixer = new AnimationMixer(sourceRoot);
  const action = mixer.clipAction(clip);
  action.setLoop(LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();

  try {
    for (let keyIndex = 0; keyIndex < keyTimes.length; keyIndex += 1) {
      restoreTransforms(sourcePose);
      sourceRoot.updateMatrixWorld(true);
      mixer.setTime(keyTimes[keyIndex]!);
      sourceRoot.updateMatrixWorld(true);

      for (const mapping of restMappings) {
        mapping.targetBone.quaternion.copy(mapping.targetRestLocal);
      }
      targetRoot.updateMatrixWorld(true);

      if (rootMotionMapping && rootMotionValues) {
        const sourceLocalDelta = rootMotionMapping.sourceBone.position.clone()
          .sub(rootMotionMapping.sourceRestLocalPosition);
        const targetWorldDelta = sourceLocalDelta
          .applyQuaternion(rootMotionMapping.sourceRestParentWorld)
          .applyQuaternion(sourceToTargetActorAlignment)
          .multiplyScalar(scale);
        if (rootMotion === "in-place") {
          targetWorldDelta.projectOnVector(targetActorUp);
        }
        const targetLocalDelta = targetWorldDelta.applyQuaternion(
          rootMotionMapping.targetRestParentWorld.clone().invert(),
        );
        rootMotionMapping.targetRestLocalPosition.clone()
          .add(targetLocalDelta)
          .toArray(rootMotionValues, keyIndex * 3);
      }

      for (const mapping of restMappings) {
        const sourceAnimatedWorld = mapping.sourceBone.getWorldQuaternion(new Quaternion());
        const sourceWorldDelta = sourceAnimatedWorld.multiply(mapping.sourceRestWorldInverse);
        const targetWorldDelta = sourceToTargetActorAlignment.clone()
          .multiply(sourceWorldDelta)
          .multiply(targetToSourceActorAlignment);
        const desiredTargetWorld = targetWorldDelta.multiply(mapping.targetRestWorld);
        const parentWorld = mapping.targetBone.parent
          ? mapping.targetBone.parent.getWorldQuaternion(new Quaternion())
          : new Quaternion();
        const targetLocal = parentWorld.invert().multiply(desiredTargetWorld).normalize();
        const previousKey = previousKeys.get(mapping);
        if (previousKey && previousKey.dot(targetLocal) < 0) {
          targetLocal.set(-targetLocal.x, -targetLocal.y, -targetLocal.z, -targetLocal.w);
        }
        previousKeys.set(mapping, targetLocal.clone());
        targetLocal.toArray(values.get(mapping)!, keyIndex * 4);
        mapping.targetBone.quaternion.copy(targetLocal);
        mapping.targetBone.updateWorldMatrix(true, false);
      }
    }
  } finally {
    action.stop();
    mixer.uncacheClip(clip);
    restoreTransforms(sourcePose);
    restoreTransforms(targetPose);
    sourceRoot.updateMatrixWorld(true);
    targetRoot.updateMatrixWorld(true);
  }

  const tracks = restMappings.map((mapping) => (
    new QuaternionKeyframeTrack(
      `${mapping.targetBone.name}.quaternion`,
      keyTimes,
      values.get(mapping)!,
    )
  ));
  if (rootMotionMapping && rootMotionValues) {
    tracks.push(new VectorKeyframeTrack(
      `${rootMotionMapping.targetBone.name}.position`,
      keyTimes,
      rootMotionValues,
    ));
  }
  const rawRetargeted = new AnimationClip(clip.name, clip.duration, tracks);
  if (footLock === "off" || !hipsMapping) return rawRetargeted;
  const feet = ["leftFoot", "rightFoot"].flatMap((semantic) => {
    const mapping = restMappings.find((candidate) => candidate.semantic === semantic);
    return mapping ? [mapping.targetBone] : [];
  });
  return stabilizeFootContacts({
    clip: rawRetargeted,
    targetRoot,
    hips: hipsMapping.targetBone,
    feet,
    targetActorUp,
  });
}
