import { describe, expect, it } from 'vitest';
import type { ImageItem } from './types';
import {
  applyCanvasTransformEdit,
  resolveCanvasTransformProperties,
} from './canvasKeyframeEdits';

const keyedImage = (): ImageItem => ({
  id: 'image',
  type: 'image',
  src: 'image.png',
  from: 30,
  durationInFrames: 61,
  properties: {
    x: 10,
    y: 20,
    width: 0.5,
    height: 0.25,
    rotation: 5,
    opacity: 1,
  },
  keyframes: {
    position: [
      { frame: 0, value: [0, 0], interpolation: 'linear' },
      { frame: 20, value: [200, 100], interpolation: 'linear' },
    ],
    scale: [
      { frame: 0, value: [1, 1], interpolation: 'linear' },
      { frame: 20, value: [2, 3], interpolation: 'linear' },
    ],
    rotation: [
      { frame: 0, value: 0, interpolation: 'linear' },
      { frame: 20, value: 90, interpolation: 'linear' },
    ],
  },
});

describe('Canvas keyframe edits', () => {
  it('resolves the visible transform at an item-local playhead frame', () => {
    expect(resolveCanvasTransformProperties(keyedImage(), 40)).toEqual({
      x: 100,
      y: 50,
      width: 0.75,
      height: 0.5,
      rotation: 45,
      opacity: 1,
    });
  });

  it('upserts active channels without replacing static transform values', () => {
    const item = keyedImage();
    const updates = applyCanvasTransformEdit(item, 40, 'scale', {
      x: 100,
      y: 50,
      width: 1,
      height: 0.75,
      rotation: 45,
      opacity: 1,
    });

    expect(updates.properties).toEqual(item.properties);
    expect(updates.keyframes?.scale).toContainEqual({
      frame: 10,
      value: [2, 3],
      interpolation: 'linear',
    });
  });

  it('keeps legacy static editing for channels that have no keys', () => {
    const item = keyedImage();
    item.keyframes = undefined;
    const updates = applyCanvasTransformEdit(item, 40, 'move', {
      x: 300,
      y: -20,
      width: 0.5,
      height: 0.25,
      rotation: 5,
      opacity: 1,
    });

    expect(updates.keyframes).toBeUndefined();
    expect(updates.properties).toMatchObject({ x: 300, y: -20 });
  });
});
