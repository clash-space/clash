import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sourceMatches } from '../test-support/source-match';

describe('ProjectTimelineEditorSurface NLE handoff', () => {
  it('uses a hash-style Canvas icon for the persistent parent Canvas action', () => {
    const source = readFileSync(new URL('./ProjectWorkspaceSurfaces.tsx', import.meta.url), 'utf8');
    expect(
      sourceMatches(
        source,
        /import\s+\{\s*CanvasIcon\s*\}\s+from\s+["']\.\/ProjectSurfaceIcon["'];?/,
      ),
    ).toBe(true);
    expect(source).toContain('icon={<CanvasIcon className="h-4 w-4" weight="regular" />}');
    expect(source).not.toContain('icon={<SquaresFour className="h-4 w-4" weight="regular" />}');
  });

  it('only exposes Open in when the desktop bridge supports it', () => {
    const source = readFileSync(new URL('./ProjectWorkspaceSurfaces.tsx', import.meta.url), 'utf8');
    expect(
      sourceMatches(
        source,
        /onOpenInNle=\{\s*globalThis\.__CLASH_DESKTOP__\?\.openInNle\s*\?\s*openInNle\s*:\s*undefined\s*\}/,
      ),
    ).toBe(true);
    expect(source).toContain('desktop.getNleAvailability()');
    expect(source).toContain('nleAvailabilityError');
    expect(source).toContain('nleAvailability={nleAvailability}');
    expect(source).toContain('onRefreshNleAvailability={refreshNleAvailability}');
  });

  it('routes Timeline export through the project backend callback', () => {
    const source = readFileSync(new URL('./ProjectWorkspaceSurfaces.tsx', import.meta.url), 'utf8');
    expect(source).toContain('await onExport(timeline.id)');
    expect(source).toContain('onExport={onExport ? exportTimelineVideo : undefined}');
    expect(source).not.toContain('desktop.exportTimelineVideo');
  });

  it('reserves one compact command-bar slot for the collapsed Copilot avatar', () => {
    const source = readFileSync(new URL('./ProjectWorkspaceSurfaces.tsx', import.meta.url), 'utf8');
    expect(source).toContain('headerEndInset?: number');
    expect(source).toContain('headerEndInset={headerEndInset}');
  });

  it('keeps the loading shell structurally and chromatically aligned with the live Timeline editor', () => {
    const source = readFileSync(new URL('./ProjectWorkspaceSurfaces.tsx', import.meta.url), 'utf8');
    const loadingShell = source.slice(
      source.indexOf('function TimelineEditorLoadingShell()'),
      source.indexOf('type ProjectTimelineEditorState'),
    );
    expect(source).toContain('data-timeline-loading-shell=""');
    expect(loadingShell).toContain('[grid-template-columns:minmax(min(12rem,25%),300px)_minmax(min(21rem,42%),1fr)_minmax(min(13rem,28%),clamp(280px,22%,340px))]');
    expect(loadingShell).toContain('[grid-template-rows:var(--clash-project-sidebar-header-height,2.5rem)_minmax(0,1fr)_280px]');
    expect(loadingShell).toContain('gap-[var(--clash-timeline-gutter)] overflow-hidden bg-warm-page');
    expect(loadingShell).toContain('pb-[var(--clash-timeline-gutter)] pl-[var(--clash-timeline-gutter)]');
    expect(loadingShell).not.toContain('pt-[var(--clash-timeline-gutter)]');
    expect(loadingShell).toContain('[--clash-timeline-gutter:var(--clash-project-chrome-gutter,0.5rem)]');
    expect(loadingShell).toContain('[--clash-timeline-control-gap:var(--clash-control-gap,0.25rem)]');
    expect(loadingShell).toContain('data-loading-region="command-bar"');
    expect(loadingShell).toContain('data-loading-command-bar-content=""');
    expect(loadingShell).toContain('clash-project-chrome-header-content');
    expect(loadingShell).toContain('[grid-column:1/4] [grid-row:1]');
    expect(loadingShell).toContain('data-loading-region="media"');
    expect(loadingShell).toContain('[grid-column:1] [grid-row:2]');
    expect(loadingShell).toContain('data-loading-region="preview"');
    expect(loadingShell).toContain('[grid-column:2] [grid-row:2]');
    expect(loadingShell).toContain('data-loading-region="inspector"');
    expect(loadingShell).toContain('[grid-column:3] [grid-row:2]');
    expect(loadingShell).toContain('data-loading-region="timeline"');
    expect(loadingShell).toContain('[grid-column:1/4] [grid-row:3]');
    expect(loadingShell).toContain('data-loading-asset-panel=""');
    expect(loadingShell).toContain('data-loading-inspector-panel=""');
    expect(loadingShell).toContain('data-loading-timeline-canvas=""');
    expect(loadingShell).toContain('bg-warm-surface');
    expect(loadingShell).toContain('bg-warm-muted');
    expect(loadingShell).toContain('bg-brand/[0.09]');
    expect(loadingShell).not.toContain('animate-pulse');
    expect(loadingShell).not.toContain('bg-stone-200');
    expect(loadingShell).not.toContain('bg-slate-950');
    expect(source).toContain('className="absolute inset-0 z-10 min-h-0 overflow-hidden bg-warm-page"');
    expect(source).not.toContain('className="absolute inset-0 z-10 min-h-0 overflow-hidden bg-[#f7f4f1]"');
  });
});
