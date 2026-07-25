import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

describe('Editor typography system', () => {
  it('uses one semantic rem-based type scale for the dense editing workspace', () => {
    const source = readSource('./editorTypography.ts');

    expect(source).toContain("caption: { size: '0.6875rem', lineHeight: '1rem' }");
    expect(source).toContain("control: { size: '0.75rem', lineHeight: '1.125rem' }");
    expect(source).toContain("item: { size: '0.8125rem', lineHeight: '1.25rem' }");
    expect(source).toContain("heading: { size: '0.875rem', lineHeight: '1.25rem' }");
    expect(source).toContain("metric: { size: '1.25rem', lineHeight: '1.5rem' }");
  });

  it('routes the visible side panels through semantic type roles instead of ad hoc sizes', () => {
    const editor = readSource('./Editor.tsx');
    const assets = readSource('./AssetPanel.tsx');
    const captions = readSource('./CaptionWorkspace.tsx');
    const inspector = readSource('./PropertiesPanel.tsx');

    expect(editor).toContain('style={editorTypographyVariables}');
    expect(assets).toContain('var(--clash-editor-text-control)');
    expect(assets).toContain('var(--clash-editor-text-item)');
    expect(assets).toContain('var(--clash-editor-text-caption)');
    expect(captions).toContain('var(--clash-editor-text-heading)');
    expect(captions).toContain('var(--clash-editor-text-control)');
    expect(captions).toContain('var(--clash-editor-text-item)');
    expect(captions).toContain('var(--clash-editor-text-caption)');
    expect(inspector).toContain('var(--clash-editor-text-heading)');
    expect(inspector).toContain('var(--clash-editor-text-control)');
    expect(inspector).toContain('var(--clash-editor-text-item)');
    expect(inspector).toContain('var(--clash-editor-text-metric)');

    expect(editor).not.toContain('text-[13px]');
    expect(assets).not.toMatch(/text-(?:xs|sm|2xl)|text-\[(?:10|11|12|13)px\]/);
    expect(captions).not.toMatch(/text-(?:xs|sm|2xl)|text-\[(?:10|11|12|13)px\]/);
    expect(inspector).not.toMatch(/text-(?:xs|sm|2xl)|text-\[(?:10|11|12|13)px\]/);
  });

  it('uses the existing Timeline type scale instead of 10px one-offs', () => {
    const controls = readSource('./timeline/TimelineControls.tsx');
    const tracks = readSource('./timeline/TimelineTracksContainer.tsx');

    expect(controls).not.toContain('fontSize: 10');
    expect(tracks).not.toContain('fontSize: 12');
    expect(tracks).not.toContain('fontSize: 14');
    expect(controls).toContain('typography.fontSize.xs');
    expect(tracks).toContain('typography.fontSize.sm');
    expect(tracks).toContain('typography.fontSize.lg');
  });
});
