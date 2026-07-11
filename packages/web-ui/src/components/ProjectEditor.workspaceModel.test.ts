import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./ProjectEditor.tsx', import.meta.url), 'utf8');

describe('ProjectEditor workspace model', () => {
    it('projects one Project Loro replica into a selected concrete Canvas', () => {
        expect(source).toMatch(/useState\(['"]main['"]\)/);
        expect(source).toMatch(/useLoroSync\(\{[\s\S]*canvasId: activeCanvasId/);
        expect(source).toContain('<ProjectWorkspaceNavigator');
        expect(source).toContain('<ProjectAssetsSurface');
        expect(source).toContain('<StandaloneTimelineSurface');
        expect(source).toContain('id="project-workspace-shell"');
        expect(source).toContain('grid-cols-[12rem_minmax(0,1fr)]');
        expect(source).toContain('header={');
        expect(source).toContain('clash-project-sidebar-header');
        expect(source).not.toContain('className={`absolute bottom-0 left-52');
    });

    it('does not reconstruct Canvas ownership from the Project asset list', () => {
        expect(source).not.toContain('buildFallbackCanvasFromAssets');
        expect(source).not.toContain('recoveredFromAssetRef');
    });

    it('creates Timeline Actions through Timeline ownership primitives', () => {
        expect(source).toMatch(/type === 'video-editor'[\s\S]*createTimeline\([\s\S]*attachTimeline\(/);
    });
});
