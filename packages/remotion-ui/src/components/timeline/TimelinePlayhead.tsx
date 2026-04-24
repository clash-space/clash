import React, { useCallback, useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { colors, timeline, zIndex, shadows, animations } from './styles';
import { formatTime, frameToPixels } from './utils/timeFormatter';

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

  // Refs for direct DOM manipulation during playback
  const lineRef = useRef<HTMLDivElement>(null);
  const triangleRef = useRef<HTMLDivElement>(null);

  // Refs for stable access in RAF loop without restarting effect
  const scrollLeftRef = useRef(scrollLeft);
  const pixelsPerFrameRef = useRef(pixelsPerFrame);
  const leftOffsetRef = useRef(leftOffset);

  // Update refs on render
  scrollLeftRef.current = scrollLeft;
  pixelsPerFrameRef.current = pixelsPerFrame;
  leftOffsetRef.current = leftOffset;

  // Direct DOM update for static position
  // We use useLayoutEffect to ensure it updates immediately after render
  React.useLayoutEffect(() => {
    const pos = frameToPixels(currentFrame, pixelsPerFrame);
    const cX = leftOffset + pos - scrollLeft;
    const lL = cX - timeline.playheadWidth / 2;
    const tL = cX - timeline.playheadTriangleSize / 2;

    if (lineRef.current) {
      lineRef.current.style.left = `${lL}px`;
    }
    if (triangleRef.current) {
      triangleRef.current.style.left = `${tL}px`;
    }
  }, [currentFrame, pixelsPerFrame, leftOffset, scrollLeft]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      setIsDragging(true);
      onDragStart?.();

      // Resolve the drag container ONCE at drag start — querySelector on every
      // mousemove was walking the DOM tree at pointer-event rate.
      const rightPane = document.querySelector('[data-playhead-container]') as HTMLElement | null;
      const timelineContainer =
        rightPane || (document.querySelector('[data-timeline-container]') as HTMLElement | null);
      const useRightPane = !!rightPane;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!timelineContainer) return;
        const rect = timelineContainer.getBoundingClientRect();
        const xFromContainer = moveEvent.clientX - rect.left;
        const xRelativeToContent = useRightPane
          ? xFromContainer - leftOffset
          : xFromContainer - timeline.trackLabelWidth - leftOffset;
        const x = xRelativeToContent + scrollLeft;
        const frame = Math.max(0, Math.round(x / pixelsPerFrame));
        onSeek(frame);
      };

      const handleMouseUp = () => {
        setIsDragging(false);
        onDragEnd?.();
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [pixelsPerFrame, onSeek, onDragStart, onDragEnd, leftOffset]
  );

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
      {/* 竖线：始终渲染。通过 label 面板更高的 z-index 进行遮挡 */}
      <div
        ref={lineRef}
        style={{
          position: 'absolute',
          // REMOVED 'left' from here completely to allow direct DOM manipulation via refs
          // Both static (useLayoutEffect) and dynamic (RAF) updates use the ref.
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
        ref={triangleRef}
        role="slider"
        aria-label="Playhead"
        aria-valuemin={0}
        aria-valuemax={Number.isFinite(_durationInFrames) ? _durationInFrames : undefined}
        aria-valuenow={currentFrame}
        aria-valuetext={formatTime(currentFrame, fps)}
        tabIndex={0}
        onMouseDown={handleMouseDown}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 10 : 1;
          if (e.key === 'ArrowLeft') {
            e.preventDefault();
            onSeek(Math.max(0, currentFrame - step));
          } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            const max = Number.isFinite(_durationInFrames) ? _durationInFrames : currentFrame + step;
            onSeek(Math.min(max, currentFrame + step));
          } else if (e.key === 'Home') {
            e.preventDefault();
            onSeek(0);
          } else if (e.key === 'End' && Number.isFinite(_durationInFrames)) {
            e.preventDefault();
            onSeek(_durationInFrames);
          }
        }}
        animate={{
          scale: isDragging ? 1.3 : isHovered ? 1.2 : 1,
        }}
        transition={animations.springGentle}
        style={{
          position: 'absolute',
          // REMOVED 'left' from here completely
          top: -1,
          width: 0,
          height: 0,
          borderLeft: `${timeline.playheadTriangleSize / 2}px solid transparent`,
          borderRight: `${timeline.playheadTriangleSize / 2}px solid transparent`,
          borderTop: `${timeline.playheadTriangleSize}px solid ${colors.accent.primary}`,
          cursor: 'ew-resize',
          pointerEvents: 'auto',
          filter: isDragging ? 'drop-shadow(0 0 4px rgba(74, 158, 255, 0.8))' : 'none',
          // 三角形也始终渲染，由更高 z-index 的 label 遮挡
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
  );
});
