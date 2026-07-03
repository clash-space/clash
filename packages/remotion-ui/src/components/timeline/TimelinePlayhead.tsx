import React, { useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { colors, timeline, zIndex, shadows, animations } from './styles';
import { formatTime, frameToPixels } from './utils/timeFormatter';
import { TimelineSlider } from '../ui/timeline-slider';

interface TimelinePlayheadProps {
  currentFrame: number;
  pixelsPerFrame: number;
  fps: number;
  timelineHeight: number;
  onSeek: (frame: number) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  scrollLeft?: number;
  leftOffset?: number;
  /** Max frame to stop at */
  durationInFrames?: number;
  /** Called when playhead reaches end */
  onPlayEnd?: () => void;
}

export const TimelinePlayhead: React.FC<TimelinePlayheadProps> = React.memo(({
  currentFrame,
  pixelsPerFrame,
  fps,
  timelineHeight: _timelineHeight,
  onSeek,
  onDragStart,
  onDragEnd,
  scrollLeft = 0,
  leftOffset = 0,
  durationInFrames: _durationInFrames = Infinity,
  onPlayEnd: _onPlayEnd,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const maxFrame = Number.isFinite(_durationInFrames)
    ? Math.max(1, Math.round(_durationInFrames))
    : Math.max(1, currentFrame + 1);
  const sliderWidth = maxFrame * pixelsPerFrame;

  // ONE absolutely-positioned wrapper holds both the playhead line and the
  // triangle handle. Movement is applied as a `transform: translate3d` on
  // this wrapper instead of mutating `left` on each child. Two reasons:
  //
  //   1. `left` writes force layout + paint on every frame; with the wrapper
  //      we're in composite-only territory (GPU-accelerated).
  //   2. The triangle is rendered by framer-motion (for its hover/drag scale
  //      animation); writing `transform` directly to it from a useLayoutEffect
  //      fought framer-motion's own transform string and produced jitter.
  //      Pinning the translate to a non-motion ancestor sidesteps that.
  //
  // Within the wrapper, line + triangle are positioned with negative `left`
  // offsets (centered on the wrapper's origin) and never change after mount.
  const wrapperRef = useRef<HTMLDivElement>(null);

  React.useLayoutEffect(() => {
    const pos = frameToPixels(currentFrame, pixelsPerFrame);
    const cX = leftOffset + pos - scrollLeft;
    if (wrapperRef.current) {
      // translate3d (not translateX) to force a GPU layer even on older
      // browsers that don't auto-promote a 2D translate.
      wrapperRef.current.style.transform = `translate3d(${cX}px, 0, 0)`;
    }
  }, [currentFrame, pixelsPerFrame, leftOffset, scrollLeft]);

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: zIndex.playhead,
        pointerEvents: 'none',
      }}
    >
      <TimelineSlider
        min={0}
        max={maxFrame}
        step={1}
        value={Math.min(currentFrame, maxFrame)}
        aria-label="Playhead"
        aria-valuetext={formatTime(currentFrame, fps)}
        onPointerDown={() => {
          setIsDragging(true);
          onDragStart?.();
        }}
        onPointerUp={() => {
          setIsDragging(false);
          onDragEnd?.();
        }}
        onPointerCancel={() => {
          setIsDragging(false);
          onDragEnd?.();
        }}
        onBlur={() => {
          setIsDragging(false);
          onDragEnd?.();
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onChange={(event) => onSeek(Number(event.currentTarget.value))}
        style={{
          position: 'absolute',
          top: 0,
          left: leftOffset - scrollLeft,
          width: Math.max(1, sliderWidth),
          height: Math.max(28, timeline.playheadTriangleSize + 8),
          margin: 0,
          opacity: 0,
          cursor: 'ew-resize',
          pointerEvents: 'auto',
          zIndex: zIndex.playhead + 1,
        }}
      />
      <div
        ref={wrapperRef}
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: 0,
          // Width is just a hit-test box around the playhead origin —
          // children stick out via negative offsets. willChange tells the
          // compositor we'll be retransforming this every frame.
          width: 0,
          willChange: 'transform',
        }}
      >
        {/* 竖线 — centered on the wrapper's origin, never moves relative
            to its parent (the parent's transform handles motion). */}
        <div
          style={{
            position: 'absolute',
            left: -timeline.playheadWidth / 2,
            top: 0,
            bottom: 0,
            width: timeline.playheadWidth,
            backgroundColor: colors.accent.primary,
            boxShadow: isDragging ? '0 0 8px rgba(74, 158, 255, 0.6)' : 'none',
            transition: isDragging ? 'none' : 'box-shadow 0.2s ease',
          }}
        />

        {/* 顶部三角形拖拽手柄 */}
        <motion.div
          aria-hidden="true"
          animate={{
            scale: isDragging ? 1.3 : isHovered ? 1.2 : 1,
          }}
          transition={animations.springGentle}
          style={{
            position: 'absolute',
            left: -timeline.playheadTriangleSize / 2,
            top: -1,
            width: 0,
            height: 0,
            borderLeft: `${timeline.playheadTriangleSize / 2}px solid transparent`,
            borderRight: `${timeline.playheadTriangleSize / 2}px solid transparent`,
            borderTop: `${timeline.playheadTriangleSize}px solid ${colors.accent.primary}`,
            pointerEvents: 'none',
            filter: isDragging ? 'drop-shadow(0 0 4px rgba(74, 158, 255, 0.8))' : 'none',
            display: 'block',
          }}
        >
        {/* Tooltip - 显示当前时间 */}
        {(isHovered || isDragging) && (
          <motion.div
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            transition={{ duration: 0.15 }}
            style={{
              position: 'absolute',
              left: '50%',
              bottom: timeline.playheadTriangleSize + 4,
              transform: 'translateX(-50%)',
              backgroundColor: colors.bg.elevated,
              color: colors.text.primary,
              fontSize: 11,
              fontFamily: 'monospace',
              padding: '4px 8px',
              borderRadius: 4,
              whiteSpace: 'nowrap',
              boxShadow: shadows.md,
              pointerEvents: 'none',
              zIndex: zIndex.tooltip,
            }}
          >
            {formatTime(currentFrame, fps)}
          </motion.div>
        )}
        </motion.div>
      </div>
    </div>
  );
});
