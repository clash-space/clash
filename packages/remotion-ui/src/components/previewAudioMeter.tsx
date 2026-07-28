import React, { useSyncExternalStore } from 'react';
import { colors, typography } from './timeline/styles';

export type StereoAudioLevels = {
  left: number;
  right: number;
};

export type PreviewAudioMeterStore = {
  getSnapshot: () => StereoAudioLevels;
  subscribe: (listener: () => void) => () => void;
  setLevels: (levels: StereoAudioLevels) => void;
};

const SILENCE: StereoAudioLevels = { left: 0, right: 0 };
const MINIMUM_DECIBELS = -60;
const MAXIMUM_DECIBELS = 6;
const SCALE_MARKS = [6, 0, -6, -12, -20, -30, -50, MINIMUM_DECIBELS] as const;

export const calculateRms = (samples: Float32Array): number => {
  if (samples.length === 0) return 0;
  let squaredTotal = 0;
  for (const sample of samples) {
    squaredTotal += sample * sample;
  }
  return Math.sqrt(squaredTotal / samples.length);
};

export const amplitudeToDecibels = (amplitude: number): number => (
  amplitude > 0 ? 20 * Math.log10(amplitude) : Number.NEGATIVE_INFINITY
);

export const createPreviewAudioMeterStore = (): PreviewAudioMeterStore => {
  let snapshot = SILENCE;
  const listeners = new Set<() => void>();

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setLevels: (levels) => {
      const next = {
        left: Math.max(0, Math.min(1, levels.left)),
        right: Math.max(0, Math.min(1, levels.right)),
      };
      if (
        Math.abs(next.left - snapshot.left) < 0.0005
        && Math.abs(next.right - snapshot.right) < 0.0005
      ) {
        return;
      }
      snapshot = next;
      listeners.forEach((listener) => listener());
    },
  };
};

export const getPreviewAudioMeterValue = (amplitude: number) => {
  const decibels = amplitudeToDecibels(amplitude);
  const clamped = Number.isFinite(decibels)
    ? Math.max(MINIMUM_DECIBELS, Math.min(MAXIMUM_DECIBELS, decibels))
    : MINIMUM_DECIBELS;
  return {
    decibels,
    rounded: Number.isFinite(decibels) ? Math.round(decibels) : MINIMUM_DECIBELS,
    percentage: ((clamped - MINIMUM_DECIBELS) / (MAXIMUM_DECIBELS - MINIMUM_DECIBELS)) * 100,
  };
};

const AudioChannelMeter: React.FC<{
  amplitude: number;
  channel: 'L' | 'R';
  label: string;
}> = ({ amplitude, channel, label }) => {
  const value = getPreviewAudioMeterValue(amplitude);
  return (
    <div style={styles.channelColumn}>
      <output aria-label={`${label} current decibels`} style={styles.currentValue}>
        {Number.isFinite(value.decibels) ? value.rounded : '−∞'}
      </output>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={MINIMUM_DECIBELS}
        aria-valuemax={MAXIMUM_DECIBELS}
        aria-valuenow={value.rounded}
        aria-valuetext={Number.isFinite(value.decibels) ? `${value.rounded} dB` : '−∞ dB'}
        style={styles.meterTrack}
      >
        <span
          aria-hidden="true"
          style={{
            ...styles.meterFill,
            height: `${value.percentage}%`,
          }}
        />
      </div>
      <span aria-hidden="true" style={styles.channelLabel}>{channel}</span>
    </div>
  );
};

export const PreviewAudioMeter: React.FC<{ store: PreviewAudioMeterStore }> = ({ store }) => {
  const levels = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  return (
    <aside aria-label="Live audio level meter" data-preview-audio-meter="" style={styles.panel}>
      <div aria-hidden="true" style={styles.scale}>
        <span style={styles.scaleTitle}>dB</span>
        <div style={styles.scaleMarks}>
          {SCALE_MARKS.map((mark) => (
            <span key={mark} style={styles.scaleMark}>
              {mark === MINIMUM_DECIBELS ? '−∞' : mark}
            </span>
          ))}
        </div>
        <span style={styles.scaleFooter} />
      </div>
      <AudioChannelMeter amplitude={levels.left} channel="L" label="Left audio level" />
      <AudioChannelMeter amplitude={levels.right} channel="R" label="Right audio level" />
    </aside>
  );
};

const styles: Record<string, React.CSSProperties> = {
  panel: {
    display: 'grid',
    gridTemplateColumns: '30px 1fr 1fr',
    flex: '0 0 112px',
    width: 112,
    minWidth: 112,
    height: '100%',
    gap: 6,
    padding: '9px 8px 7px 6px',
    borderLeft: `1px solid ${colors.border.subtle}`,
    backgroundColor: colors.bg.secondary,
    color: colors.text.tertiary,
    boxSizing: 'border-box',
    fontFamily: typography.fontFamily.mono,
    fontSize: 10,
    fontVariantNumeric: 'tabular-nums',
  },
  scale: {
    display: 'grid',
    gridTemplateRows: '16px minmax(0, 1fr) 15px',
    minHeight: 0,
  },
  scaleTitle: {
    alignSelf: 'start',
    textAlign: 'right',
    color: colors.text.tertiary,
  },
  scaleMarks: {
    display: 'flex',
    minHeight: 0,
    flexDirection: 'column',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  scaleMark: {
    lineHeight: 1,
  },
  scaleFooter: {
    display: 'block',
  },
  channelColumn: {
    display: 'grid',
    gridTemplateRows: '16px minmax(0, 1fr) 15px',
    minHeight: 0,
    textAlign: 'center',
  },
  currentValue: {
    alignSelf: 'start',
    color: colors.text.secondary,
    fontSize: 10,
    lineHeight: '12px',
  },
  meterTrack: {
    position: 'relative',
    minHeight: 0,
    overflow: 'hidden',
    borderRadius: 3,
    backgroundColor: 'var(--clash-warm-muted, #f4f1eb)',
    boxShadow: 'inset 0 0 0 1px var(--clash-warm-border, #e1ddd5)',
  },
  meterFill: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    left: 0,
    minHeight: 0,
    borderRadius: 2,
    background: 'linear-gradient(to top, var(--clash-accent, #ff6b50) 0%, var(--clash-accent, #ff6b50) 82%, #f59e0b 92%, #ef4444 100%)',
    transition: 'height 45ms linear',
  },
  channelLabel: {
    alignSelf: 'end',
    color: colors.text.secondary,
    lineHeight: '12px',
  },
};
