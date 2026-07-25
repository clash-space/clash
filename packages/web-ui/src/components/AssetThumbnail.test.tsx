// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AssetThumbnail } from './AssetThumbnail';

afterEach(() => {
  cleanup();
  globalThis.__CLASH_RUNTIME_CONFIG__ = undefined;
});

describe('AssetThumbnail', () => {
  it('renders image and video media in the shared thumbnail frame', () => {
    const { rerender } = render(
      <AssetThumbnail type="image" src="/image.png" label="image.png" />,
    );

    expect(screen.getByRole('img', { name: 'image.png thumbnail' }).getAttribute('src')).toBe('/image.png');

    rerender(<AssetThumbnail type="video" src="/video.mp4" label="video.mp4" />);
    const video = screen.getByLabelText('video.mp4 thumbnail');
    expect(video.tagName).toBe('VIDEO');
    expect(video.getAttribute('preload')).toBe('metadata');
  });

  it('uses a stable fallback when media cannot load', () => {
    render(<AssetThumbnail type="image" src="/broken.png" label="broken.png" />);

    fireEvent.error(screen.getByRole('img', { name: 'broken.png thumbnail' }));

    expect(screen.getByLabelText('broken.png thumbnail unavailable')).toBeTruthy();
  });

  it('resolves local asset paths against the desktop API origin', () => {
    globalThis.__CLASH_RUNTIME_CONFIG__ = {
      mode: 'desktop',
      apiBaseUrl: 'http://127.0.0.1:49321',
    };

    render(<AssetThumbnail type="image" src="/assets/uploads/image.png" label="image.png" />);

    expect(screen.getByRole('img', { name: 'image.png thumbnail' }).getAttribute('src'))
      .toBe('http://127.0.0.1:49321/assets/uploads/image.png');
  });

  it('keeps audio as an icon instead of pretending it has a visual thumbnail', () => {
    render(<AssetThumbnail type="audio" src="/audio.wav" label="audio.wav" />);

    expect(screen.getByLabelText('audio.wav audio')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
  });
});
