import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./VideoEditorNode.tsx', import.meta.url), 'utf8');

describe('VideoEditorNode render feedback', () => {
    it('uses non-blocking in-product feedback instead of a native alert', () => {
        expect(source).not.toContain("alert('Please open the editor");
        expect(source).toContain('setRenderError(');
        expect(source).toContain('<InlineAlert');
        expect(source).toContain('tone="warning"');
        expect(source).not.toContain('border-amber-500/25');
        expect(source).toContain('Open the editor and add content before rendering.');
    });

    it('uses compact theme-aware canvas chrome instead of a bright blue card', () => {
        expect(source).toContain('w-[320px]');
        expect(source).toContain('bg-warm-muted');
        expect(source).toContain('text-brand');
        expect(source).not.toContain('bg-stone-100');
        expect(source).not.toContain('text-video');
        expect(source).not.toContain('bg-video-light');
        expect(source).not.toContain('hover:!bg-video');
        expect(source).not.toContain('!border-white');
    });
});
