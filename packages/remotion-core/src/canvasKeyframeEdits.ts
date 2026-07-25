import type { TimelineItemKeyframes } from '@clash/shared-types';
import type { Item, ItemProperties } from './types';
import { sampleTimelineKeyframes, upsertTimelineKeyframe } from './timelineKeyframes';

export type CanvasTransformEditMode = 'move' | 'scale' | 'rotate';

const getStaticProperties = (item: Item): ItemProperties => ({
  x: item.properties?.x ?? 0,
  y: item.properties?.y ?? 0,
  width: item.properties?.width ?? 1,
  height: item.properties?.height ?? 1,
  rotation: item.properties?.rotation ?? 0,
  opacity: item.properties?.opacity ?? 1,
});

const getItemLocalFrame = (item: Item, compositionFrame: number): number => (
  Math.max(0, Math.min(item.durationInFrames - 1, compositionFrame - item.from))
);

export const resolveCanvasTransformProperties = (
  item: Item,
  compositionFrame: number,
): ItemProperties => {
  const properties = getStaticProperties(item);
  const sampled = sampleTimelineKeyframes(
    item.keyframes,
    getItemLocalFrame(item, compositionFrame),
    {
      position: [properties.x, properties.y],
      scale: [1, 1],
      rotation: properties.rotation ?? 0,
      opacity: properties.opacity ?? 1,
    },
  );
  return {
    x: sampled.position[0],
    y: sampled.position[1],
    width: properties.width * sampled.scale[0],
    height: properties.height * sampled.scale[1],
    rotation: sampled.rotation,
    opacity: sampled.opacity,
  };
};

export const applyCanvasTransformEdit = (
  item: Item,
  compositionFrame: number,
  mode: CanvasTransformEditMode,
  visibleProperties: ItemProperties,
): Partial<Item> => {
  const properties = getStaticProperties(item);
  const itemLocalFrame = getItemLocalFrame(item, compositionFrame);
  let keyframes: TimelineItemKeyframes | undefined;

  if (mode === 'move') {
    if ((item.keyframes?.position?.length ?? 0) > 0) {
      const currentKey = item.keyframes?.position?.find(
        (keyframe) => keyframe.frame === itemLocalFrame,
      );
      keyframes = upsertTimelineKeyframe(item.keyframes, 'position', {
        frame: itemLocalFrame,
        value: [visibleProperties.x, visibleProperties.y],
        interpolation: currentKey?.interpolation ?? 'linear',
      });
    } else {
      properties.x = visibleProperties.x;
      properties.y = visibleProperties.y;
    }
  } else if (mode === 'scale') {
    if ((item.keyframes?.scale?.length ?? 0) > 0) {
      const currentKey = item.keyframes?.scale?.find(
        (keyframe) => keyframe.frame === itemLocalFrame,
      );
      keyframes = upsertTimelineKeyframe(item.keyframes, 'scale', {
        frame: itemLocalFrame,
        value: [
          properties.width === 0 ? 0 : visibleProperties.width / properties.width,
          properties.height === 0 ? 0 : visibleProperties.height / properties.height,
        ],
        interpolation: currentKey?.interpolation ?? 'linear',
      });
    } else {
      properties.width = visibleProperties.width;
      properties.height = visibleProperties.height;
    }
  } else if ((item.keyframes?.rotation?.length ?? 0) > 0) {
    const currentKey = item.keyframes?.rotation?.find(
      (keyframe) => keyframe.frame === itemLocalFrame,
    );
    keyframes = upsertTimelineKeyframe(item.keyframes, 'rotation', {
      frame: itemLocalFrame,
      value: visibleProperties.rotation ?? 0,
      interpolation: currentKey?.interpolation ?? 'linear',
    });
  } else {
    properties.rotation = visibleProperties.rotation ?? 0;
  }

  return {
    properties,
    ...(keyframes ? { keyframes } : {}),
  } as Partial<Item>;
};
