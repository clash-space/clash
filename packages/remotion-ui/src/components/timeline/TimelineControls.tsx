import React from 'react';
import { TimelineIconButton, TimelineRangeInput } from '../ui/controls';
import { Tooltip } from '../ui/tooltip';
import { colors, typography } from './styles';
import { sliderValueToZoom, zoomToSliderValue } from './zoom';

// Hoisted CSS — built once per module rather than re-templated on every render.
const ZOOM_SLIDER_STYLES = `
  .zoom-slider::-webkit-slider-runnable-track {
    width: 100%;
    height: 4px;
    background: ${colors.border.default};
    border-radius: 2px;
  }

  .zoom-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: ${colors.accent.primary};
    cursor: grab;
    margin-top: -6px;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
    transition: all 0.15s ease;
    border: 2px solid var(--clash-accent-foreground, #fffefd);
  }

  .zoom-slider:hover::-webkit-slider-thumb {
    transform: scale(1.1);
    box-shadow: 0 3px 8px rgba(0, 0, 0, 0.4);
  }

  .zoom-slider:active::-webkit-slider-thumb {
    cursor: grabbing;
    transform: scale(1.15);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
  }

  .zoom-slider::-moz-range-track {
    width: 100%;
    height: 4px;
    background: ${colors.border.default};
    border-radius: 2px;
    border: none;
  }

  .zoom-slider::-moz-range-thumb {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: ${colors.accent.primary};
    cursor: grab;
    border: 2px solid var(--clash-accent-foreground, #fffefd);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
    transition: all 0.15s ease;
  }

  .zoom-slider:hover::-moz-range-thumb {
    transform: scale(1.1);
    box-shadow: 0 3px 8px rgba(0, 0, 0, 0.4);
  }

  .zoom-slider:active::-moz-range-thumb {
    cursor: grabbing;
    transform: scale(1.15);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
  }

  .zoom-slider:focus-visible::-webkit-slider-thumb {
    outline: 2px solid ${colors.accent.primary};
    outline-offset: 2px;
  }
  .zoom-slider:focus-visible::-moz-range-thumb {
    outline: 2px solid ${colors.accent.primary};
    outline-offset: 2px;
  }
  .timeline-icon-btn:focus-visible {
    outline: 2px solid ${colors.accent.primary};
    outline-offset: 2px;
  }
`;

interface ZoomControlProps {
  zoom: number;
  min: number;
  max: number;
  onZoomChange: (zoom: number) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomToFit?: () => void;
  onZoomReset?: () => void;
}

export const ZoomControl: React.FC<ZoomControlProps> = ({
  zoom,
  min,
  max,
  onZoomChange,
  onZoomIn,
  onZoomOut,
  onZoomToFit,
  onZoomReset,
}) => {
  const canZoomIn = zoom < max;
  const canZoomOut = zoom > min;
  const sliderValue = zoomToSliderValue(zoom, min, max);
  const zoomPercent = `${Math.round(zoom * 100)}%`;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      height: 32,
    }}>
      {/* Zoom Out Button */}
      <TimelineIconButton
        onClick={onZoomOut}
        disabled={!canZoomOut}
        aria-label="Zoom out"
        className="timeline-icon-btn"
        style={{
          width: 28,
          height: 28,
          padding: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'transparent',
          border: `1px solid ${colors.border.default}`,
          borderRadius: '6px',
          color: canZoomOut ? colors.text.primary : colors.text.disabled,
          fontSize: 16,
          lineHeight: 1,
          cursor: canZoomOut ? 'pointer' : 'not-allowed',
          opacity: canZoomOut ? 1 : 0.3,
          transition: 'all 0.15s ease',
        }}
        onMouseEnter={(e) => {
          if (canZoomOut) {
            e.currentTarget.style.backgroundColor = colors.bg.hover;
            e.currentTarget.style.borderColor = colors.accent.primary;
          }
        }}
        onMouseLeave={(e) => {
          if (canZoomOut) {
            e.currentTarget.style.backgroundColor = 'transparent';
            e.currentTarget.style.borderColor = colors.border.default;
          }
        }}
      >
        −
      </TimelineIconButton>

      {/* Slider */}
      <div style={{
        position: 'relative',
        width: 112,
        height: 28,
        display: 'flex',
        alignItems: 'center',
      }}>
        <Tooltip label={`Zoom ${zoomPercent}`}>
          <TimelineRangeInput
            min={0}
            max={100}
            step={0.1}
            value={sliderValue}
            onChange={(e) => onZoomChange(sliderValueToZoom(parseFloat(e.target.value), min, max))}
            aria-label="Timeline zoom"
            aria-valuetext={zoomPercent}
            className="zoom-slider"
            style={{
              width: '100%',
              height: 4,
              outline: 'none',
              WebkitAppearance: 'none',
              appearance: 'none',
              background: 'transparent',
              cursor: 'pointer',
              margin: 0,
            }}
          />
        </Tooltip>

        <style>{ZOOM_SLIDER_STYLES}</style>
      </div>

      {/* Zoom In Button */}
      <TimelineIconButton
        onClick={onZoomIn}
        disabled={!canZoomIn}
        aria-label="Zoom in"
        className="timeline-icon-btn"
        style={{
          width: 28,
          height: 28,
          padding: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'transparent',
          border: `1px solid ${colors.border.default}`,
          borderRadius: '6px',
          color: canZoomIn ? colors.text.primary : colors.text.disabled,
          fontSize: 16,
          lineHeight: 1,
          cursor: canZoomIn ? 'pointer' : 'not-allowed',
          opacity: canZoomIn ? 1 : 0.3,
          transition: 'all 0.15s ease',
        }}
        onMouseEnter={(e) => {
          if (canZoomIn) {
            e.currentTarget.style.backgroundColor = colors.bg.hover;
            e.currentTarget.style.borderColor = colors.accent.primary;
          }
        }}
        onMouseLeave={(e) => {
          if (canZoomIn) {
            e.currentTarget.style.backgroundColor = 'transparent';
            e.currentTarget.style.borderColor = colors.border.default;
          }
        }}
      >
        +
      </TimelineIconButton>

      {onZoomReset ? (
        <Tooltip label="Reset zoom to 100%">
          <TimelineIconButton
            onClick={onZoomReset}
            aria-label="Reset zoom to 100%"
            className="timeline-icon-btn"
            style={{
              minWidth: 40,
              height: 28,
              padding: '0 6px',
              backgroundColor: 'transparent',
              border: 0,
              borderRadius: 6,
              color: colors.text.secondary,
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: typography.fontSize.xs,
              fontVariantNumeric: 'tabular-nums',
              fontWeight: 600,
            }}
          >
            {zoomPercent}
          </TimelineIconButton>
        </Tooltip>
      ) : null}

      {onZoomToFit ? (
        <Tooltip label="Zoom to fit">
          <TimelineIconButton
            onClick={onZoomToFit}
            aria-label="Zoom to fit"
            className="timeline-icon-btn"
            style={{
              width: 32,
              height: 28,
              padding: 0,
              backgroundColor: 'transparent',
              border: `1px solid ${colors.border.default}`,
              borderRadius: 6,
              color: colors.text.secondary,
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: typography.fontSize.xs,
              fontWeight: 600,
            }}
          >
            Fit
          </TimelineIconButton>
        </Tooltip>
      ) : null}

    </div>
  );
};

interface SnapButtonProps {
  enabled: boolean;
  onToggle: () => void;
}

export const SnapButton: React.FC<SnapButtonProps> = ({ enabled, onToggle }) => {
  return (
    <div style={{ position: 'relative' }}>
      <Tooltip label={`Snapping ${enabled ? 'on' : 'off'}`}>
        <TimelineIconButton
          onClick={onToggle}
          aria-label={enabled ? 'Disable snapping' : 'Enable snapping'}
          aria-pressed={enabled}
          className="timeline-icon-btn"
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = colors.bg.hover;
            e.currentTarget.style.borderColor = colors.accent.primary;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
            e.currentTarget.style.borderColor = colors.border.default;
          }}
          style={{
            width: 28,
            height: 28,
            padding: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'transparent',
            border: `1px solid ${colors.border.default}`,
            borderRadius: '6px',
            cursor: 'pointer',
            opacity: enabled ? 1 : 0.3,
            transition: 'all 0.15s ease',
          }}
        >
          {/* Bootstrap Icons Magnet - Professional Design */}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M8 1a7 7 0 0 0-7 7v3h4V8a3 3 0 0 1 6 0v3h4V8a7 7 0 0 0-7-7m7 11h-4v3h4zM5 12H1v3h4zM0 8a8 8 0 1 1 16 0v8h-6V8a2 2 0 1 0-4 0v8H0z"
              fill={enabled ? colors.accent.primary : colors.text.primary}
            />
          </svg>
        </TimelineIconButton>
      </Tooltip>
    </div>
  );
};
