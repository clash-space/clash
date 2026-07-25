import { describe, expect, it } from 'vitest';
import { createAudioFadeEnvelopeGeometry } from './AudioFadeEnvelope';

describe('audio fade envelope geometry', () => {
  it('anchors the mask to the waveform boundary instead of the whole clip edge', () => {
    expect(createAudioFadeEnvelopeGeometry({
      width: 360,
      boundaryY: 24,
      bottomY: 38,
      fadeInWidth: 60,
      fadeOutWidth: 48,
    })).toEqual({
      boundaryY: 24,
      bottomY: 38,
      fadeInCurve: 'M 0 38 Q 30 23 60 24',
      fadeInMask: 'M 0 38 Q 30 23 60 24 L 0 24 Z',
      fadeOutCurve: 'M 360 38 Q 336 23 312 24',
      fadeOutMask: 'M 360 38 Q 336 23 312 24 L 360 24 Z',
    });
  });
});
