import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { colors, timeline, typography, shadows, zIndex } from './styles';
import {
  formatTime,
  frameToPixels,
  pixelsToFrame,
} from './utils/timeFormatter';

export interface TimelineRulerTokens {
  background: string;
  minorTick: string;
  majorTick: string;
  label: string;
}

interface TimelineRulerProps {
  durationInFrames: number;
  pixelsPerFrame: number;
  fps: number;
  onSeek: (frame: number) => void;
  zoom: number;
  // Horizontal scroll sync from tracks viewport
  scrollLeft: number;
  // Visible content width to clamp ruler width
  viewportWidth?: number;
  // Limit tick/labels to content end (frames). If omitted, use durationInFrames.
  contentEndInFrames?: number;
  // Left inset to visually shift ruler content right without changing layout
  leftOffset?: number;
  // Semantic visual tokens let other editors reuse timing behavior without
  // inheriting the media Timeline palette.
  tokens?: Partial<TimelineRulerTokens>;
}

// Timeline ruler renders scalable ticks/labels with pixel-driven spacing.
// - Major labels pick a second-step ensuring ≥80px spacing (1/2/5/10/15/30/60...s).
// - Minor ticks aim for ~major/10, clamped by ≥8px.
// - Only generate ticks up to contentEndInFrames to avoid "extra" labels beyond media.
// - SVG strokes snap to 0.5px for crisp 1px lines on all DPRs.
export const TimelineRuler: React.FC<TimelineRulerProps> = ({
  durationInFrames,
  pixelsPerFrame,
  fps,
  onSeek,
  zoom: _zoom,
  scrollLeft,
  viewportWidth,
  contentEndInFrames,
  leftOffset = 0,
  tokens,
}) => {
  const [hoveredFrame, setHoveredFrame] = useState<number | null>(null);
  const [mouseX, setMouseX] = useState<number>(0);

  // Layout targets
  const MIN_LABEL_SPACING_PX = 80; // Prevent label overlap
  const MIN_SUBTICK_SPACING_PX = 8; // Avoid dense hairlines that blur visually

  // Choose label (major) step in seconds to achieve readable spacing
  const pxPerSecond = fps * pixelsPerFrame;
  const labelStepSecondsCandidates = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  const labelStepSeconds = useMemo(() => {
    for (const s of labelStepSecondsCandidates) {
      if (s * pxPerSecond >= MIN_LABEL_SPACING_PX) return s;
    }
    return labelStepSecondsCandidates[labelStepSecondsCandidates.length - 1];
  }, [pxPerSecond]);

  const majorStepFrames = Math.max(1, Math.round(labelStepSeconds * fps));

  // Choose minor step in frames (prefer 1/10 ~ 1/5 of major step), but keep spacing readable
  const minorStepCandidates = useMemo(() => {
    const base = [1, 2, 3, 5, 10, 15, 30, 60];
    return base.filter((f) => f < majorStepFrames);
  }, [majorStepFrames]);

  const minorStepFrames = useMemo(() => {
    // Ideal is major/10, fallback to the largest candidate that fits spacing
    const ideal = Math.max(1, Math.round(majorStepFrames / 10));
    const idealPx = ideal * pixelsPerFrame;
    if (idealPx >= MIN_SUBTICK_SPACING_PX) return ideal;
    for (let i = minorStepCandidates.length - 1; i >= 0; i--) {
      const f = minorStepCandidates[i];
      if (f * pixelsPerFrame >= MIN_SUBTICK_SPACING_PX) return f;
    }
    return 0; // No minor ticks
  }, [majorStepFrames, pixelsPerFrame, minorStepCandidates]);

  const totalWidth = Math.max(frameToPixels(durationInFrames, pixelsPerFrame), viewportWidth ?? 0);

  // Format label as MM:SS (omit frames for readability)
  const formatLabelMMSS = (frame: number) => {
    const totalSeconds = Math.floor(frame / fps);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  };

  // 生成主刻度（与标签对齐）。刻度生成到内容末尾，不必占满显示宽度。
  const mainTicks = useMemo(() => {
    const ticks: { frame: number; position: number; label: string }[] = [];
    const endFrame = Math.max(0, contentEndInFrames ?? durationInFrames);
    for (let frame = 0; frame <= endFrame; frame += majorStepFrames) {
      ticks.push({
        frame,
        position: frameToPixels(frame, pixelsPerFrame),
        label: formatLabelMMSS(frame),
      });
    }
    return ticks;
  }, [durationInFrames, contentEndInFrames, majorStepFrames, pixelsPerFrame, fps]);

  // 生成次刻度
  const subTicks = useMemo(() => {
    if (minorStepFrames <= 0) return [] as { frame: number; position: number }[];
    const ticks: { frame: number; position: number }[] = [];
    const endFrame = Math.max(0, contentEndInFrames ?? durationInFrames);
    for (let frame = 0; frame <= endFrame; frame += minorStepFrames) {
      if (frame % majorStepFrames !== 0) {
        ticks.push({
          frame,
          position: frameToPixels(frame, pixelsPerFrame),
        });
      }
    }
    return ticks;
  }, [durationInFrames, contentEndInFrames, minorStepFrames, majorStepFrames, pixelsPerFrame]);

  // Pixel snapping for crisp 1px SVG strokes
  const crisp = (x: number) => Math.round(x) + 0.5; // align 1px strokes to device pixels

  const handleClick = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const frame = Math.max(0, Math.min(durationInFrames, pixelsToFrame(x + scrollLeft - leftOffset, pixelsPerFrame)));
    onSeek(frame);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const frame = Math.max(0, Math.min(durationInFrames, pixelsToFrame(x + scrollLeft - leftOffset, pixelsPerFrame)));
    setHoveredFrame(frame);
    setMouseX(x);
  };

  const handleMouseLeave = () => {
    setHoveredFrame(null);
  };

  return (
    <div
      data-timeline-ruler=""
      style={{
        position: 'sticky',
        top: 0,
        left: 0,
        right: 0,
        height: timeline.rulerHeight,
        background: tokens?.background ?? colors.bg.primary,
        // Use the track container's top border as the only separator
        boxShadow: 'none',
        zIndex: zIndex.ruler,
        cursor: 'pointer',
        userSelect: 'none',
      }}
      onClick={handleClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {/* SVG 刻度和标签 */}
      <svg
        width={totalWidth}
        height={timeline.rulerHeight}
        style={{
          position: 'absolute',
          left: leftOffset - scrollLeft,
          top: 0,
          willChange: 'transform',
        }}
      >
        {/* 次刻度（细线） */}
        {subTicks.map((tick) => (
          <line
            key={`sub-${tick.frame}`}
            x1={crisp(tick.position)}
            y1={0}
            x2={crisp(tick.position)}
            y2={6}
            stroke={tokens?.minorTick ?? colors.border.subtle}
            strokeWidth={1}
          />
        ))}

        {/* 主刻度（粗线和标签） */}
        {mainTicks.map((tick) => (
          <g key={`main-${tick.frame}`}>
            <line
              x1={crisp(tick.position)}
              y1={0}
              x2={crisp(tick.position)}
              y2={10}
              stroke={tokens?.majorTick ?? colors.text.tertiary}
              strokeWidth={1}
            />
            <text
              x={Math.round(tick.position) + 4}
              y={24}
              fill={tokens?.label ?? colors.text.secondary}
              fontSize={typography.fontSize.xs}
              fontFamily={typography.fontFamily.mono}
            >
              {tick.label}
            </text>
          </g>
        ))}
      </svg>

      {/* 悬停时的时间提示 */}
      {hoveredFrame !== null && (
        <motion.div
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -5 }}
          transition={{ duration: 0.1 }}
          style={{
            position: 'absolute',
            left: mouseX,
            top: -28,
            transform: 'translateX(-50%)',
            backgroundColor: colors.bg.elevated,
            color: colors.text.primary,
            fontSize: typography.fontSize.xs,
            fontFamily: typography.fontFamily.mono,
            padding: '4px 8px',
            borderRadius: 4,
            whiteSpace: 'nowrap',
            boxShadow: shadows.md,
            pointerEvents: 'none',
            zIndex: zIndex.tooltip,
            border: `1px solid ${colors.border.default}`,
          }}
        >
          {formatTime(hoveredFrame, fps)}
        </motion.div>
      )}
    </div>
  );
};
