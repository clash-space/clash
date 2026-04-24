import React, { useState, useRef, useEffect } from 'react';
import { colors } from './styles';

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
    border: 2px solid #fff;
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
    border: 2px solid #fff;
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
}

export const ZoomControl: React.FC<ZoomControlProps> = ({
  zoom,
  min,
  max,
  onZoomChange,
  onZoomIn,
  onZoomOut,
}) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const sliderRef = useRef<HTMLInputElement>(null);
  const [tooltipX, setTooltipX] = useState(0);
  const [tooltipY, setTooltipY] = useState(0);

  const canZoomIn = zoom < max;
  const canZoomOut = zoom > min;

  const updateTooltipPosition = () => {
    if (!sliderRef.current) return;
    const rect = sliderRef.current.getBoundingClientRect();
    const percentage = (zoom - min) / (max - min);
    const thumbX = rect.left + percentage * rect.width;
    setTooltipX(thumbX);
    setTooltipY(rect.top);
  };

  const handleMouseDown = () => {
    setIsDragging(true);
    setShowTooltip(true);
    updateTooltipPosition();
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    setShowTooltip(false);
  };

  const handleMouseMove = () => {
    if (showTooltip || isDragging) {
      updateTooltipPosition();
    }
  };

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('mousemove', updateTooltipPosition);
      return () => {
        window.removeEventListener('mouseup', handleMouseUp);
        window.removeEventListener('mousemove', updateTooltipPosition);
      };
    }
  }, [isDragging]);

  return (
    <div style={{ 
      display: 'flex', 
      alignItems: 'center', 
      gap: 12,
      height: 32, // 固定容器高度确保对齐
    }}>
      {/* Zoom Out Button */}
      <button
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
      </button>

      {/* Slider */}
      <div style={{ 
        position: 'relative', 
        width: 180,
        height: 28, // 与按钮高度一致
        display: 'flex',
        alignItems: 'center', // 垂直居中对齐
      }}>
        <input
          ref={sliderRef}
          type="range"
          min={min}
          max={max}
          step={0.01}
          value={zoom}
          onChange={(e) => onZoomChange(parseFloat(e.target.value))}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseEnter={() => {
            setShowTooltip(true);
            updateTooltipPosition();
          }}
          onMouseLeave={() => !isDragging && setShowTooltip(false)}
          aria-label="Timeline zoom"
          aria-valuetext={`${zoom.toFixed(2)} times`}
          className="zoom-slider"
          style={{
            width: '100%',
            height: 4,
            outline: 'none',
            WebkitAppearance: 'none',
            appearance: 'none',
            background: 'transparent',
            cursor: 'pointer',
            margin: 0, // 移除默认margin
          }}
        />

        <style>{ZOOM_SLIDER_STYLES}</style>
      </div>

      {/* Zoom In Button */}
      <button
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
      </button>

      {/* Tooltip */}
      {showTooltip && (
        <div
          style={{
            position: 'fixed',
            left: tooltipX,
            top: tooltipY - 50,
            transform: 'translateX(-50%)',
            backgroundColor: '#000',
            color: '#fff',
            padding: '8px 14px',
            borderRadius: '6px',
            fontSize: '14px',
            fontWeight: 700,
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.8)',
            zIndex: 999999,
          }}
        >
          {zoom.toFixed(2)}×
          <div
            style={{
              position: 'absolute',
              bottom: -6,
              left: '50%',
              transform: 'translateX(-50%)',
              width: 0,
              height: 0,
              borderLeft: '6px solid transparent',
              borderRight: '6px solid transparent',
              borderTop: '6px solid #000',
            }}
          />
        </div>
      )}
    </div>
  );
};

interface SnapButtonProps {
  enabled: boolean;
  onToggle: () => void;
}

export const SnapButton: React.FC<SnapButtonProps> = ({ enabled, onToggle }) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [tooltipX, setTooltipX] = useState(0);
  const [tooltipY, setTooltipY] = useState(0);

  const updateTooltipPosition = () => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setTooltipX(rect.left + rect.width / 2);
    setTooltipY(rect.top);
  };

  return (
    <div style={{ position: 'relative' }}>
      <button
        ref={buttonRef}
        onClick={onToggle}
        aria-label={enabled ? 'Disable snapping' : 'Enable snapping'}
        title={enabled ? 'Snapping on' : 'Snapping off'}
        aria-pressed={enabled}
        className="timeline-icon-btn"
        onMouseEnter={(e) => {
          setShowTooltip(true);
          updateTooltipPosition();
          e.currentTarget.style.backgroundColor = colors.bg.hover;
          e.currentTarget.style.borderColor = colors.accent.primary;
        }}
        onMouseLeave={(e) => {
          setShowTooltip(false);
          e.currentTarget.style.backgroundColor = 'transparent';
          e.currentTarget.style.borderColor = colors.border.default;
        }}
        onMouseMove={(e) => {
          if (showTooltip) {
            const rect = e.currentTarget.getBoundingClientRect();
            setTooltipX(rect.left + rect.width / 2);
            setTooltipY(rect.top);
          }
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
      </button>

      {/* Tooltip */}
      {showTooltip && (
        <div
          style={{
            position: 'fixed',
            left: tooltipX,
            top: tooltipY - 40,
            transform: 'translateX(-50%)',
            backgroundColor: '#000',
            color: '#fff',
            padding: '8px 14px',
            borderRadius: '6px',
            fontSize: '13px',
            fontWeight: 700,
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.8)',
            zIndex: 999999,
          }}
        >
          磁吸 {enabled ? '开启' : '关闭'}
          <div
            style={{
              position: 'absolute',
              bottom: -6,
              left: '50%',
              transform: 'translateX(-50%)',
              width: 0,
              height: 0,
              borderLeft: '6px solid transparent',
              borderRight: '6px solid transparent',
              borderTop: '6px solid #000',
            }}
          />
        </div>
      )}
    </div>
  );
};
