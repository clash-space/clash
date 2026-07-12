// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VideoEditorProvider, useVideoEditor } from './VideoEditorContext';

afterEach(cleanup);

function Harness() {
    const { openTimeline } = useVideoEditor();
    return (
        <button type="button" onClick={() => openTimeline('timeline-1')}>
            Open Timeline
        </button>
    );
}

describe('VideoEditorProvider', () => {
    it('routes Timeline Actions into the Project workspace without mounting a dialog', () => {
        const onOpenTimeline = vi.fn();
        render(
            <VideoEditorProvider onOpenTimeline={onOpenTimeline}>
                <Harness />
            </VideoEditorProvider>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Open Timeline' }));

        expect(onOpenTimeline).toHaveBeenCalledWith('timeline-1');
        expect(screen.queryByRole('dialog')).toBeNull();
    });
});
