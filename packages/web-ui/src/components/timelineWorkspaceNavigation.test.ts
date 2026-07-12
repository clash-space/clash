import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const contextSource = readFileSync(new URL('./VideoEditorContext.tsx', import.meta.url), 'utf8');
const nodeSource = readFileSync(new URL('./nodes/VideoEditorNode.tsx', import.meta.url), 'utf8');

describe('Timeline workspace navigation', () => {
    it('routes a Canvas Timeline Action to its Project Timeline surface without a modal', () => {
        expect(contextSource).toContain('onOpenTimeline');
        expect(contextSource).not.toContain('EditorModalDialog');
        expect(nodeSource).toContain('openTimeline(timeline.id)');
        expect(nodeSource).not.toContain('openEditor(uniqueAssetsResolved');
    });
});
