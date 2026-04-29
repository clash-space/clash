// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { TransitionItem } from '@master-clash/remotion-core';
import { TransitionRenderer } from './TransitionRenderer';

afterEach(() => cleanup());

const makeItem = (over: Partial<TransitionItem> = {}): TransitionItem => ({
  id: 't1',
  type: 'transition',
  from: 100,
  durationInFrames: 30,
  transitionType: 'push-left',
  fromItemId: 'clip-A',
  toItemId: 'clip-B',
  ...over,
});

describe('TransitionRenderer (timeline lane visualization)', () => {
  it('renders the transition type as a label when wide enough', () => {
    render(<TransitionRenderer item={makeItem()} asset={null} width={200} height={40} pixelsPerFrame={2} />);
    expect(screen.getByText('push-left')).toBeTruthy();
  });

  it('hides the label when too narrow but keeps the icon', () => {
    const { container } = render(
      <TransitionRenderer item={makeItem({ transitionType: 'circle-wipe' })} asset={null} width={30} height={40} pixelsPerFrame={2} />,
    );
    expect(screen.queryByText('circle-wipe')).toBeNull();
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('hides the icon when very short height', () => {
    const { container } = render(
      <TransitionRenderer item={makeItem()} asset={null} width={200} height={20} pixelsPerFrame={2} />,
    );
    expect(container.querySelector('svg')).toBeNull();
    // Label still present at this width
    expect(screen.getByText('push-left')).toBeTruthy();
  });

  it('exposes a hover-tooltip describing the transition (type + from → to)', () => {
    const { container } = render(
      <TransitionRenderer
        item={makeItem({ transitionType: 'wipe-left', fromItemId: 'shot-A', toItemId: 'shot-B' })}
        asset={null}
        width={200}
        height={40}
        pixelsPerFrame={2}
      />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute('title')).toBe('Transition: wipe-left (shot-A → shot-B)');
  });

  it('uses the diagonal-stripe purple background (visual cue distinct from clips)', () => {
    const { container } = render(
      <TransitionRenderer item={makeItem()} asset={null} width={200} height={40} pixelsPerFrame={2} />,
    );
    const root = container.firstElementChild as HTMLElement;
    // background-image should be a repeating-linear-gradient (defensive substring check —
    // browsers may normalize the value, but the keyword survives).
    const bg = root.style.backgroundImage;
    expect(bg).toContain('repeating-linear-gradient');
  });

  it('renders distinct labels for each transitionType', () => {
    const types: TransitionItem['transitionType'][] = [
      'crossfade',
      'push-left',
      'push-right',
      'slide-up',
      'slide-down',
      'wipe-left',
      'wipe-right',
      'circle-wipe',
      'zoom-in',
    ];
    for (const t of types) {
      const { unmount } = render(
        <TransitionRenderer
          item={makeItem({ id: `t-${t}`, transitionType: t })}
          asset={null}
          width={200}
          height={40}
          pixelsPerFrame={2}
        />,
      );
      expect(screen.getByText(t)).toBeTruthy();
      unmount();
    }
  });

  it('handles missing fromItemId / toItemId by showing "?" in the tooltip', () => {
    const { container } = render(
      <TransitionRenderer
        item={makeItem({ fromItemId: undefined as unknown as string, toItemId: undefined as unknown as string })}
        asset={null}
        width={200}
        height={40}
        pixelsPerFrame={2}
      />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute('title')).toBe('Transition: push-left (? → ?)');
  });
});
