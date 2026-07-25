export type TimelineWheelAxis = 'x' | 'y';

interface WheelAxisLockOptions {
  releaseAfterMs?: number;
}

interface WheelAxisInput {
  deltaX: number;
  deltaY: number;
  now: number;
  shiftKey?: boolean;
}

interface WheelAxisResolution {
  axis: TimelineWheelAxis;
  delta: number;
}

export function createWheelAxisLock(
  { releaseAfterMs = 140 }: WheelAxisLockOptions = {},
) {
  let lockedAxis: TimelineWheelAxis | null = null;
  let lastEventAt = Number.NEGATIVE_INFINITY;

  return {
    resolve({
      deltaX,
      deltaY,
      now,
      shiftKey = false,
    }: WheelAxisInput): WheelAxisResolution {
      if (now - lastEventAt > releaseAfterMs) {
        lockedAxis = null;
      }

      const horizontalDelta = shiftKey && Math.abs(deltaY) > Math.abs(deltaX)
        ? deltaY
        : deltaX;
      const verticalDelta = shiftKey ? 0 : deltaY;

      if (!lockedAxis) {
        lockedAxis = Math.abs(horizontalDelta) > Math.abs(verticalDelta) ? 'x' : 'y';
      }
      lastEventAt = now;

      return {
        axis: lockedAxis,
        delta: lockedAxis === 'x' ? horizontalDelta : verticalDelta,
      };
    },
    reset() {
      lockedAxis = null;
      lastEventAt = Number.NEGATIVE_INFINITY;
    },
  };
}
