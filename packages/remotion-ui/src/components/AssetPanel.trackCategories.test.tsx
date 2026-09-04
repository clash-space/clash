// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EditorProvider, useEditorStaticState } from '@clash/remotion-core';
import { afterEach, describe, expect, it } from 'vitest';
import { AssetPanel } from './AssetPanel';

afterEach(() => cleanup());

const AssetCountProbe = () => {
  const { assets } = useEditorStaticState();
  return <output aria-label="Timeline media count">{assets.length}</output>;
};

describe('AssetPanel compact media workflow', () => {
  it('starts with media import and omits the quick-create controls', () => {
    const { container } = render(
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
    const panelBody = container.querySelector('[data-asset-panel-body]');
    expect(panelBody?.className).toContain('clash-timeline-panel-surface');
    expect(panelBody?.className).toContain('rounded-matrix');
  });

  it('removes a Project-backed asset from this Timeline media list', async () => {
    render(
      <EditorProvider
        initialState={{
          assets: [
            {
              id: 'project-asset',
              name: 'Project source',
              type: 'image',
              src: 'project-source.png',
              createdAt: 1,
              readOnly: true,
            },
          ],
        }}
      >
        <AssetPanel showHeader={false} compact />
        <AssetCountProbe />
      </EditorProvider>,
    );

    const remove = screen.getByRole('button', {
      name: 'Remove Project source from Timeline media',
    });
    expect(remove.className).not.toContain('opacity-0');
    fireEvent.click(remove);

    await waitFor(() => {
      expect(screen.getByLabelText('Timeline media count').textContent).toBe('0');
    });
    expect(screen.getByText('No media in this edit')).not.toBeNull();
  });
});
