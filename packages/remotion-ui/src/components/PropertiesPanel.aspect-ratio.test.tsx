// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EditorProvider, type EditorState } from '@master-clash/remotion-core';

import { PropertiesPanel } from './PropertiesPanel';

afterEach(cleanup);

describe('PropertiesPanel aspect ratio', () => {
  it('uses the shared picker for presets and custom canvas dimensions', () => {
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

    expect(screen.getByLabelText('Canvas aspect ratio')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '9:16' }));
    expect(stateRef.current?.compositionWidth).toBe(1080);
    expect(stateRef.current?.compositionHeight).toBe(1920);

    fireEvent.change(screen.getByRole('spinbutton', { name: 'Aspect ratio width' }), {
      target: { value: '1440' },
    });
    expect(stateRef.current?.compositionWidth).toBe(1440);
    expect(stateRef.current?.compositionHeight).toBe(1920);
  });
});
