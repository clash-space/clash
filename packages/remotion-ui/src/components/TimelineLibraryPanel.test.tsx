// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EditorProvider, useEditor, type EditorState } from '@clash/remotion-core';
import { TimelineLibraryPanel } from './TimelineLibraryPanel';
import { TIMELINE_NOTICE_EVENT } from './timeline/timelineNotice';
import { Timeline } from './Timeline';

const StateProbe = ({ onState }: { onState: (state: EditorState) => void }) => {
  const { state } = useEditor();
  onState(state);
  return null;
};

afterEach(() => cleanup());

describe('TimelineLibraryPanel', () => {
  it('can embed its content without drawing a second panel surface', () => {
    const { container } = render(
      <EditorProvider>
        <TimelineLibraryPanel embedded />
      </EditorProvider>,
    );

    const panel = container.querySelector('[data-timeline-library-panel]');
    expect(panel?.getAttribute('data-embedded')).toBe('true');
    expect(panel?.className).not.toContain('clash-timeline-panel-surface');
    expect(panel?.className).not.toContain('rounded-matrix');
  });

  it('keeps the panel collapse action beside the library search', () => {
    render(
      <EditorProvider>
        <TimelineLibraryPanel
          headerTrailingAction={<span data-testid="library-panel-action" />}
        />
      </EditorProvider>,
    );

    expect(screen.getByTestId('library-panel-action')).toBeTruthy();
  });

  it('searches the catalog and applies a real preset to editor state', async () => {
    let latest: EditorState | null = null;
    render(
      <EditorProvider>
        <TimelineLibraryPanel />
        <StateProbe onState={(state) => { latest = state; }} />
      </EditorProvider>,
    );

    fireEvent.change(screen.getByLabelText('Search creative assets'), {
      target: { value: 'Editorial Title' },
    });

    expect(document.querySelectorAll('[data-library-card="true"]')).toHaveLength(1);
    fireEvent.click(screen.getByLabelText('Apply Editorial Title'));

    expect(latest!.tracks.flatMap((track) => track.items)).toEqual([
      expect.objectContaining({ type: 'text', text: 'YOUR STORY' }),
    ]);
    expect(latest!.tracks.some((track) => track.category === 'primary')).toBe(true);
  });

  it('exposes all requested category filters and reports an incompatible transition edit point', async () => {
    let notice = '';
    const handleNotice = (event: Event) => {
      notice = (event as CustomEvent<string>).detail;
    };
    window.addEventListener(TIMELINE_NOTICE_EVENT, handleNotice);
    render(
      <EditorProvider>
        <TimelineLibraryPanel />
      </EditorProvider>,
    );
    for (const category of ['Text', 'Stickers', 'Motion graphics', 'Sound effects', 'Transitions', 'FX', 'Zoom', 'LUTs', 'Audio FX', 'Captions', 'Filters', 'Adjustments', 'Templates']) {
      expect(screen.getByLabelText(`Filter ${category}`)).toBeTruthy();
    }

    fireEvent.click(screen.getByLabelText('Filter Transitions'));
    const apply = document.querySelector('[data-library-apply="true"]') as HTMLButtonElement;
    expect(apply.disabled).toBe(false);
    expect(apply.getAttribute('aria-disabled')).toBe('true');
    expect(apply.title).toMatch(/continuous clips/i);
    fireEvent.click(apply);
    expect(notice).toMatch(/continuous clips/i);
    window.removeEventListener(TIMELINE_NOTICE_EVENT, handleNotice);
  });

  it('accepts the category selected by the editor top-level tool rail', () => {
    let nextCategory = '';
    render(
      <EditorProvider>
        <TimelineLibraryPanel
          selectedCategory="fx"
          onSelectedCategoryChange={(category) => { nextCategory = category ?? ''; }}
        />
      </EditorProvider>,
    );

    expect(screen.getByLabelText('Filter FX').className).toContain('text-brand');
    expect(screen.queryByLabelText('Apply Editorial Title')).toBeNull();

    fireEvent.click(screen.getByLabelText('Filter Zoom'));
    expect(nextCategory).toBe('zoom');
  });

  it('surfaces an invalid transition edit point through the Timeline notice', () => {
    const { container } = render(
      <EditorProvider>
        <TimelineLibraryPanel selectedCategory="transitions" />
        <div style={{ width: 900, height: 300 }}>
          <Timeline />
        </div>
      </EditorProvider>,
    );

    fireEvent.click(screen.getByLabelText('Apply Circle Wipe'));

    expect(container.querySelector('[data-timeline-notice]')?.textContent)
      .toMatch(/No continuous clips at this position/i);
  });
});
