import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Editor embedded layout', () => {
  it('combines Media and Inspector into one side panel in a project workspace', () => {
    const source = readFileSync(new URL('./Editor.tsx', import.meta.url), 'utf8');

    expect(source).toContain("layout?: 'standalone' | 'embedded'");
    expect(source).toContain('data-layout={layout}');
    expect(source).toContain('role="tablist"');
    expect(source).toContain('aria-label="Editor side panel"');
    expect(source).toContain('headerLeadingAction?: React.ReactNode');
    expect(source).toContain('{headerLeadingAction}');
    expect(source).toContain('showHeader={false}');
    expect(source).toContain('compact');
  });
});
