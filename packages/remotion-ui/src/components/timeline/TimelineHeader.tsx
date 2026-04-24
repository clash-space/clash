import React from 'react';
import { colors, timeline, typography, borderRadius, shadows } from './styles';
import { formatTime } from './utils/timeFormatter';
import { ZoomControl, SnapButton } from './TimelineControls';

interface TimelineHeaderProps {
  currentFrame: number;
  fps: number;
  durationInFrames: number;
  playing: boolean;
  zoom: number;
  snapEnabled: boolean;
  autoFitEnabled?: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomToFit?: () => void;
  onZoomReset?: () => void;
  onToggleSnap: () => void;
  onToggleAutoFit?: () => void;
  onTogglePlay: () => void;
  onZoomChange: (zoom: number) => void;
  zoomLimits?: { min: number; max: number };
}

export const TimelineHeader: React.FC<TimelineHeaderProps> = ({
  currentFrame,
  fps,
  durationInFrames,
  playing,
  zoom,
  snapEnabled,
  autoFitEnabled: _autoFitEnabled = false,
  onZoomIn,
  onZoomOut,
  onZoomToFit: _onZoomToFit,
  onZoomReset: _onZoomReset,
  onToggleSnap,
  onToggleAutoFit: _onToggleAutoFit,
  onTogglePlay,
  onZoomChange,
  zoomLimits,
}) => {
  const limits = zoomLimits || { min: timeline.zoomMin, max: timeline.zoomMax };

  return (
    <div
        style={{
          height: timeline.headerHeight,
          backgroundColor: colors.bg.secondary,
          borderBottom: `1px solid ${colors.border.default}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          boxShadow: shadows.sm,
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}
      >
      {/* 左侧：时间显示 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div
          style={{
            backgroundColor: colors.bg.elevated,
            padding: '6px 12px',
            borderRadius: borderRadius.md,
            fontFamily: typography.fontFamily.mono,
            fontSize: typography.fontSize.sm,
            color: colors.text.primary,
            border: `1px solid ${colors.border.default}`,
          }}
        >
          {formatTime(currentFrame, fps)}
        </div>
        <div style={{ color: colors.text.secondary, fontFamily: typography.fontFamily.mono, fontSize: typography.fontSize.sm }}>
          /
        </div>
        <div
          style={{
            backgroundColor: colors.bg.elevated,
            padding: '6px 12px',
            borderRadius: borderRadius.md,
            fontFamily: typography.fontFamily.mono,
            fontSize: typography.fontSize.sm,
            color: colors.text.primary,
            border: `1px solid ${colors.border.default}`,
          }}
        >
          {formatTime(durationInFrames, fps)}
        </div>
      </div>

      {/* 中间：播放按钮 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
        <button
          onClick={onTogglePlay}
          aria-label={playing ? 'Pause' : 'Play'}
          style={{
            width: 36,
            height: 36,
            borderRadius: 9999,
            backgroundColor: colors.accent.primary,
            border: 'none',
            color: '#ffffff',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: shadows.sm,
          }}
        >
          {playing ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>
      </div>

      {/* 右侧：控制按钮 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
        <ZoomControl
          zoom={zoom}
          min={limits.min}
          max={limits.max}
          onZoomChange={onZoomChange}
          onZoomIn={onZoomIn}
          onZoomOut={onZoomOut}
        />

        {/* 分隔线 */}
        <div
          style={{
            width: 1,
            height: 20,
            backgroundColor: colors.border.default,
          }}
        />

        <SnapButton
          enabled={snapEnabled}
          onToggle={onToggleSnap}
        />
      </div>
    </div>
  );
};
