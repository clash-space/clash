// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorProvider, type EditorState } from '@clash/remotion-core';

import { PropertiesPanel } from './PropertiesPanel';

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(document, 'startViewTransition');
});

describe('PropertiesPanel aspect ratio', () => {
  it('uses the shared picker and edits the canvas as a ratio', () => {
    const stateRef = { current: null as EditorState | null };
    render(
      <EditorProvider
        initialState={{
          compositionWidth: 1920,
          compositionHeight: 1080,
          tracks: [],
          selectedItemId: null,
        }}
        onStateChange={(state) => { stateRef.current = state; }}
      >
        <PropertiesPanel />
      </EditorProvider>,
    );

    expect(screen.getByRole('heading', { name: 'Aspect ratio' })).toBeTruthy();
    const picker = screen.getByLabelText('Canvas aspect ratio');
    expect(picker.getAttribute('data-aspect-ratio-density')).toBe('compact');
    const numerator = screen.getByRole('spinbutton', { name: 'Aspect ratio numerator' });
    const denominator = screen.getByRole('spinbutton', { name: 'Aspect ratio denominator' });
    expect(numerator.className).toContain('h-8');
    expect(numerator.getAttribute('value')).toBe('16');
    expect(denominator.getAttribute('value')).toBe('9');
    fireEvent.click(screen.getByRole('button', { name: '9:16' }));
    expect(stateRef.current?.compositionWidth).toBe(1080);
    expect(stateRef.current?.compositionHeight).toBe(1920);

    fireEvent.change(numerator, { target: { value: '3' } });
    fireEvent.change(denominator, { target: { value: '4' } });
    fireEvent.blur(denominator);
    expect(stateRef.current?.compositionWidth).toBe(1440);
    expect(stateRef.current?.compositionHeight).toBe(1920);
  });

  it('matches presets by ratio rather than by a fixed resolution', () => {
    render(
      <EditorProvider
        initialState={{
          compositionWidth: 3840,
          compositionHeight: 2160,
          tracks: [],
          selectedItemId: null,
        }}
      >
        <PropertiesPanel />
      </EditorProvider>,
    );

    expect(screen.getByRole('button', { name: '16:9' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('spinbutton', { name: 'Aspect ratio numerator' }).getAttribute('value')).toBe('16');
    expect(screen.getByRole('spinbutton', { name: 'Aspect ratio denominator' }).getAttribute('value')).toBe('9');
  });

  it('atomically swaps a ratio repaint without animating the Canvas', async () => {
    const stateRef = { current: null as EditorState | null };
    let commitTransition: (() => void) | undefined;
    const skipTransition = vi.fn();
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: (update: () => void) => {
        commitTransition = update;
        return {
          finished: Promise.resolve(),
          ready: Promise.resolve(),
          updateCallbackDone: Promise.resolve(),
          skipTransition,
        };
      },
    });

    render(
      <EditorProvider
        initialState={{
          compositionWidth: 1920,
          compositionHeight: 1080,
          tracks: [],
          selectedItemId: null,
        }}
        onStateChange={(state) => { stateRef.current = state; }}
      >
        <PropertiesPanel />
      </EditorProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: '9:16' }));

    expect(commitTransition).toBeTypeOf('function');
    expect(stateRef.current?.compositionWidth).toBe(1920);
    act(() => commitTransition?.());
    expect(stateRef.current?.compositionWidth).toBe(1080);
    expect(stateRef.current?.compositionHeight).toBe(1920);
    await act(async () => Promise.resolve());
    expect(skipTransition).toHaveBeenCalledOnce();
  });
});
