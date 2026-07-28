// @vitest-environment jsdom
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

afterEach(cleanup);

describe('preview audio meter', () => {
  it('converts live time-domain samples into dB levels', async () => {
    const meter = await import('./previewAudioMeter').catch(() => null);
    expect(meter).not.toBeNull();

    const rms = meter!.calculateRms(Float32Array.from([0.5, -0.5, 0.5, -0.5]));
    expect(rms).toBeCloseTo(0.5, 5);
    expect(meter!.amplitudeToDecibels(rms)).toBeCloseTo(-6.0206, 3);
    expect(meter!.amplitudeToDecibels(0)).toBe(Number.NEGATIVE_INFINITY);
  });

  it('renders read-only left and right meters without adjustment controls', async () => {
    const meter = await import('./previewAudioMeter').catch(() => null);
    expect(meter).not.toBeNull();

    const store = meter!.createPreviewAudioMeterStore();
    store.setLevels({ left: 0.5, right: 0.25 });
    const PreviewAudioMeter = meter!.PreviewAudioMeter;
    render(<PreviewAudioMeter store={store} />);

    expect(screen.getByRole('meter', { name: 'Left audio level' }).getAttribute('aria-valuenow')).toBe('-6');
    expect(screen.getByRole('meter', { name: 'Right audio level' }).getAttribute('aria-valuenow')).toBe('-12');
    expect(screen.queryByRole('slider')).toBeNull();
  });

  it('uses theme surfaces and the custom accent instead of light and green literals', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'packages/remotion-ui/src/components/previewAudioMeter.tsx'),
      'utf8',
    );

    expect(source).toContain("backgroundColor: 'var(--clash-warm-muted");
    expect(source).toContain("var(--clash-accent, #ff6b50)");
    expect(source).not.toContain("#ece9e3");
    expect(source).not.toContain("#16a34a");
    expect(source).not.toContain("#22c55e");
  });
});
