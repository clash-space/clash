import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('PropertiesPanel primitives', () => {
  it('routes properties form controls through remotion-ui primitives', () => {
    const source = readFileSync(new URL('./PropertiesPanel.tsx', import.meta.url), 'utf8');

    expect(source).toContain('./ui/controls');
    expect(source).toContain('<RemotionButton');
    expect(source).toContain('<RemotionInput');
    expect(source).toContain('<RemotionSelect');
    expect(source).toContain('<RemotionTextarea');
    expect(source).not.toContain('<button');
    expect(source).not.toContain('<input');
    expect(source).not.toContain('<select');
    expect(source).not.toContain('<textarea');
  });

  it('does not present documentation-only rendering as a working editor action', () => {
    const source = readFileSync(new URL('./PropertiesPanel.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain('Render video');
    expect(source).not.toContain('Method 1: Command Line');
    expect(source).not.toContain('Remotion Studio (Recommended)');
    expect(source).not.toContain('showExportModal');
  });

  it('can omit its redundant heading inside the embedded editor side panel', () => {
    const source = readFileSync(new URL('./PropertiesPanel.tsx', import.meta.url), 'utf8');

    expect(source).toContain('showHeader?: boolean');
    expect(source).toContain('headerAction?: React.ReactNode');
    expect(source).toContain('{showHeader && (');
    expect(source).toContain('{headerAction}');
  });

  it('uses the Canvas surface tokens instead of a one-off warm white', () => {
    const source = readFileSync(new URL('./PropertiesPanel.tsx', import.meta.url), 'utf8');

    expect(source).toContain("bg-warm-surface");
    expect(source).toContain('border-warm-border');
    expect(source).not.toContain('bg-[#fffdfb]');
  });

  it('routes canvas aspect-ratio editing through the shared visual picker', () => {
    const source = readFileSync(new URL('./PropertiesPanel.tsx', import.meta.url), 'utf8');

    expect(source).toContain("import { AspectRatioPicker } from './AspectRatioPicker'");
    expect(source).toContain('<AspectRatioPicker');
    expect(source).toContain('ariaLabel="Canvas aspect ratio"');
  });
});
