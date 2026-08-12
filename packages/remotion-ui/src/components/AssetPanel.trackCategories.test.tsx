// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { EditorProvider } from '@clash/remotion-core';
import { afterEach, describe, expect, it } from 'vitest';
import { AssetPanel } from './AssetPanel';

afterEach(() => cleanup());

describe('AssetPanel compact media workflow', () => {
  it('starts with media import and omits the quick-create controls', () => {
    render(
      <EditorProvider>
        <AssetPanel
          showHeader={false}
          compact
          onRequestAsset={() => {}}
          headerTrailingAction={<span data-testid="panel-action" />}
        />
      </EditorProvider>,
    );

    expect(screen.queryByText('Create')).toBeNull();
    expect(screen.queryByRole('button', { name: '+ Text' })).toBeNull();
    expect(screen.queryByRole('button', { name: '+ Color' })).toBeNull();
    expect(screen.getByText('Media files')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Add media' })).not.toBeNull();
    expect(screen.getByTestId('panel-action')).not.toBeNull();
  });
});
