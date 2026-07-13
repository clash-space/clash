import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./ProjectEditor.tsx', import.meta.url), 'utf8');

describe('ProjectEditor workspace model', () => {
    it('projects one Project Loro replica into a selected concrete Canvas', () => {
        expect(source).toMatch(/useState\(['"]main['"]\)/);
        expect(source).toMatch(/useLoroSync\(\{[\s\S]*canvasId: activeCanvasId/);
        expect(source).toContain('<ProjectWorkspaceNavigator');
        expect(source).toContain('<ProjectAssetSurface');
        expect(source).toContain('<ProjectTimelineEditorSurface');
        expect(source).not.toContain('<StandaloneTimelineSurface');
        expect(source).toContain('id="project-workspace-shell"');
        expect(source).toContain('grid-cols-[12rem_minmax(0,1fr)]');
        expect(source).toContain('header={');
        expect(source).toContain('footer={<UserControls compact />}');
        expect(source).not.toContain('id="project-top-actions"');
        expect(source).not.toContain('topActionsRight');
        expect(source).toContain('clash-project-sidebar-header');
        expect(source).not.toContain('className={`absolute bottom-0 left-52');
    });

    it('persists a fully collapsible project navigator with one workspace-owned toggle', () => {
        expect(source).toContain("localStorage.getItem('project-navigator-collapsed')");
        expect(source).toContain("localStorage.setItem('project-navigator-collapsed'");
        expect(source).toContain('data-project-navigator-collapsed={isProjectNavigatorCollapsed}');
        expect(source).toContain('data-[project-navigator-collapsed=true]:grid-cols-[0_minmax(0,1fr)]');
        expect(source).toContain('collapsed={isProjectNavigatorCollapsed}');
        expect(source).not.toContain('onCollapsedChange={setIsProjectNavigatorCollapsed}');
        expect(source).not.toContain('clash-project-sidebar-toggle-button');
        expect(source).toContain('PROJECT_NAVIGATOR_VISIBILITY_EVENT');
        expect(source).toContain('setIsProjectNavigatorCollapsed(detail.collapsed)');
        expect(source).toContain('data-project-workspace-toolbar');
    });

    it('does not reconstruct Canvas ownership from the Project asset list', () => {
        expect(source).not.toContain('buildFallbackCanvasFromAssets');
        expect(source).not.toContain('recoveredFromAssetRef');
    });

    it('creates Timeline Actions through Timeline ownership primitives', () => {
        expect(source).toMatch(/type === 'video-editor'[\s\S]*createTimeline\([\s\S]*attachTimeline\(/);
    });

    it('opens a Timeline as an editor document instead of an information surface', () => {
        expect(source).toContain('timelines={loroSync.timelines}');
        expect(source).toContain('applyTimelineState');
        expect(source).toContain('onOpenTimeline={openTimelineFromCanvasAction}');
        expect(source).toContain('onOpenCanvas={selectCanvasFromNavigator}');
        expect(source).not.toContain('onExit={exitTimelineEditor}');
        expect(source).not.toContain('standaloneTimelines={loroSync.standaloneTimelines}');
    });

    it('keeps one project chat mounted while fixed workspace surfaces dock beside it', () => {
        expect(source).toContain('const isCopilotDocked = workspaceSurface.kind !== "canvas" && !isSidebarCollapsed;');
        expect(source).toContain('data-copilot-layout={isCopilotDocked ? "docked" : "overlay"}');
        expect(source).toContain('right: isCopilotDocked ? sidebarWidth : 0');
        expect(source).toContain('layoutMode={workspaceSurface.kind === "canvas" ? "floating" : "docked"}');
        expect(source.match(/<ChatbotCopilot/g)).toHaveLength(1);

        const copilotKey = source.match(/<ChatbotCopilot[\s\S]*?key=\{([^}]+)\}/)?.[1] ?? '';
        expect(copilotKey).not.toContain('workspaceSurface');
    });

    it('selects one project asset at a time and accepts sidebar asset drops on Canvas', () => {
        expect(source).toContain('onSelectAsset={(assetId) =>');
        expect(source).toContain('workspaceSurface.kind === "asset"');
        expect(source).toContain('onDragEnterCapture={handleCanvasAssetDragEnter}');
        expect(source).toContain('onDragOverCapture={handleCanvasAssetDragOver}');
        expect(source).toContain('onDragLeaveCapture={handleCanvasAssetDragLeave}');
        expect(source).toContain('onDropCapture={handleCanvasAssetDrop}');
        expect(source).toContain('data-testid="canvas-asset-drop-target"');
        expect(source).toContain('onDragEndCapture={clearCanvasAssetDropTarget}');
        expect(source).not.toContain('<ProjectAssetsSurface');
    });
});
