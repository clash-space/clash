import React from 'react';
import { colors } from './styles';

const formatCoordinate = (value: number): string => (
  Number(value.toFixed(3)).toString()
);

export type AudioFadeEnvelopeGeometry = {
  boundaryY: number;
  bottomY: number;
  fadeInCurve: string;
  fadeInMask: string;
  fadeOutCurve: string;
  fadeOutMask: string;
};

export function createAudioFadeEnvelopeGeometry({
  width,
  boundaryY,
  bottomY,
  fadeInWidth,
  fadeOutWidth,
}: {
  width: number;
  boundaryY: number;
  bottomY: number;
  fadeInWidth: number;
  fadeOutWidth: number;
}): AudioFadeEnvelopeGeometry {
  const safeBoundaryY = Math.max(0, boundaryY);
  const safeBottomY = Math.max(safeBoundaryY + 1, bottomY);
  const controlY = Math.max(0, safeBoundaryY - 1);
  const fadeInCurve = `M 0 ${formatCoordinate(safeBottomY)} Q ${formatCoordinate(fadeInWidth / 2)} ${formatCoordinate(controlY)} ${formatCoordinate(fadeInWidth)} ${formatCoordinate(safeBoundaryY)}`;
  const fadeOutCurve = `M ${formatCoordinate(width)} ${formatCoordinate(safeBottomY)} Q ${formatCoordinate(width - (fadeOutWidth / 2))} ${formatCoordinate(controlY)} ${formatCoordinate(width - fadeOutWidth)} ${formatCoordinate(safeBoundaryY)}`;

  return {
    boundaryY: safeBoundaryY,
    bottomY: safeBottomY,
    fadeInCurve,
    fadeInMask: `${fadeInCurve} L 0 ${formatCoordinate(safeBoundaryY)} Z`,
    fadeOutCurve,
    fadeOutMask: `${fadeOutCurve} L ${formatCoordinate(width)} ${formatCoordinate(safeBoundaryY)} Z`,
  };
}

export function AudioFadeEnvelope({
  width,
  height,
  boundaryY,
  bottomY,
  fadeInWidth,
  fadeOutWidth,
}: {
  width: number;
  height: number;
  boundaryY: number;
  bottomY: number;
  fadeInWidth: number;
  fadeOutWidth: number;
}) {
  if (fadeInWidth <= 0 && fadeOutWidth <= 0) {
    return null;
  }

  const geometry = createAudioFadeEnvelopeGeometry({
    width,
    boundaryY,
    bottomY,
    fadeInWidth,
    fadeOutWidth,
  });

  return (
    <svg
      data-audio-fade-control=""
      data-fade-anchor="waveform-boundary"
      data-fade-boundary-y={formatCoordinate(geometry.boundaryY)}
      aria-hidden="true"
      width={width}
      height={height}
      viewBox={`0 0 ${Math.max(1, width)} ${Math.max(1, height)}`}
      preserveAspectRatio="none"
      style={{
        inset: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
        position: 'absolute',
        zIndex: 3,
      }}
    >
      {fadeInWidth > 0 ? (
        <>
          <path
            data-audio-fade-mask="in"
            d={geometry.fadeInMask}
            fill={colors.audio.fadeMask}
            pointerEvents="none"
          />
          <path
            data-audio-fade-curve="in"
            d={geometry.fadeInCurve}
            fill="none"
            stroke={colors.audio.fadeEdge}
            strokeWidth={0.5}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
        </>
      ) : null}
      {fadeOutWidth > 0 ? (
        <>
          <path
            data-audio-fade-mask="out"
            d={geometry.fadeOutMask}
            fill={colors.audio.fadeMask}
            pointerEvents="none"
          />
          <path
            data-audio-fade-curve="out"
            d={geometry.fadeOutCurve}
            fill="none"
            stroke={colors.audio.fadeEdge}
            strokeWidth={0.5}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
        </>
      ) : null}
    </svg>
  );
}
