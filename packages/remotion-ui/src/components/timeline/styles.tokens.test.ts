import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  colors,
  getTimelineItemTone,
  getTimelineTrackHeight,
  timeline,
} from './styles';

describe('Timeline Canvas design tokens', () => {
  it('uses theme-aware Canvas tokens instead of freezing the light palette in JavaScript', () => {
    const source = readFileSync(new URL('./styles.ts', import.meta.url), 'utf8');

    expect(colors.bg.primary).toBe('var(--clash-warm-surface, #fffefd)');
    expect(colors.bg.secondary).toBe('var(--clash-warm-page, #fbfaf7)');
    expect(colors.bg.hover).toBe('var(--clash-warm-muted, #f4f1eb)');
    expect(colors.text.primary).toBe('var(--foreground, #171717)');
    expect(colors.accent.primary).toBe('var(--clash-accent, #ff6b50)');
    expect(colors.border.default).toBe('var(--clash-warm-border, #e1ddd5)');
    expect(source).toContain('var(--clash-timeline-border-subtle');
    expect(source).not.toContain("default: '#e2e8f0'");
  });

  it('reserves the quiet divider token for structural guides', () => {
    expect(colors.border.subtle).toBe('var(--clash-timeline-border-subtle, #f0ede7)');
    expect(colors.border.subtle).not.toBe(colors.border.default);
    expect(colors.bg).not.toHaveProperty('track');
  });

  it('uses compact editing geometry and a practical zoom range', () => {
    expect(timeline).toMatchObject({
      headerHeight: 44,
      rulerHeight: 28,
      trackHeight: 56,
      trackLabelWidth: 140,
      contentInsetLeft: 16,
      trackBubbleInset: 4,
      trackBubbleRadius: 10,
      itemBorderRadius: 8,
      zoomMin: 0.02,
      zoomMax: 8,
    });
    expect(timeline.contentInsetLeft).toBeGreaterThan(timeline.playheadTriangleSize / 2);
  });

  it('uses semantic lane heights instead of one height for every material type', () => {
    expect(getTimelineTrackHeight('effect')).toBe(36);
    expect(getTimelineTrackHeight('text')).toBe(40);
    expect(getTimelineTrackHeight('audio')).toBe(48);
    expect(getTimelineTrackHeight('visual')).toBe(56);
    expect(getTimelineTrackHeight('primary')).toBe(88);
  });

  it('uses theme-aware low-saturation item colors with readable foregrounds', () => {
    expect(getTimelineItemTone('image')).toEqual({
      background: 'var(--clash-timeline-item-image, #dec5bd)',
      foreground: 'var(--clash-timeline-item-image-foreground, #493530)',
    });
    expect(getTimelineItemTone('audio')).toEqual({
      background: 'var(--clash-timeline-item-audio, #294454)',
      foreground: 'var(--clash-timeline-item-audio-foreground, #f1f4f5)',
    });
    expect(getTimelineItemTone('text')).toEqual({
      background: 'var(--clash-timeline-item-text, #e4e2de)',
      foreground: 'var(--clash-timeline-item-text-foreground, #343434)',
    });
    expect(getTimelineItemTone('composition')).toEqual({
      background: 'var(--clash-timeline-item-effect, #d8d2dc)',
      foreground: 'var(--clash-timeline-item-effect-foreground, #403b44)',
    });
  });
});
