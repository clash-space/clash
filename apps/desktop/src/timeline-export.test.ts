import { describe, expect, it, vi } from 'vitest';
import {
  renderTimelineVideo,
  safeVideoExportName,
  timelineRenderInput,
} from './timeline-export';

describe('desktop Timeline video export', () => {
  it('creates a safe MP4 filename from the Timeline name', () => {
    expect(safeVideoExportName('  Launch / Cut  ')).toBe('Launch-Cut.mp4');
    expect(safeVideoExportName('***')).toBe('timeline.mp4');
  });

  it('validates and forwards composition metadata as Remotion input props', () => {
    expect(timelineRenderInput({
      tracks: [],
      compositionWidth: 1080,
      compositionHeight: 1920,
      fps: 30,
      durationInFrames: 90,
    })).toEqual({
      tracks: [],
      compositionWidth: 1080,
      compositionHeight: 1920,
      fps: 30,
      durationInFrames: 90,
    });
    expect(() => timelineRenderInput({ tracks: [], fps: 0 })).toThrow(/positive fps/i);
  });

  it('selects VideoComposition and renders H.264 to the chosen path', async () => {
    const selectComposition = vi.fn(async () => ({ id: 'VideoComposition' }));
    const renderMedia = vi.fn(async () => undefined);
    await renderTimelineVideo({
      timeline: {
        tracks: [],
        compositionWidth: 1920,
        compositionHeight: 1080,
        fps: 30,
        durationInFrames: 60,
      },
      outputPath: '/tmp/export.mp4',
      serveUrl: '/tmp/remotion-bundle',
      renderer: { selectComposition, renderMedia },
    });

    expect(selectComposition).toHaveBeenCalledWith(expect.objectContaining({
      serveUrl: '/tmp/remotion-bundle',
      id: 'VideoComposition',
    }));
    expect(renderMedia).toHaveBeenCalledWith(expect.objectContaining({
      codec: 'h264',
      outputLocation: '/tmp/export.mp4',
    }));
  });
});
