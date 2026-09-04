import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Timeline surface tokens', () => {
  const cssSource = readFileSync(join(process.cwd(), 'apps/web/app/globals.css'), 'utf8');
  const copilotSource = readFileSync(
    join(process.cwd(), 'packages/web-ui/src/components/ChatbotCopilot.tsx'),
    'utf8',
  );
  const editorSource = readFileSync(
    join(process.cwd(), 'packages/remotion-ui/src/components/Editor.tsx'),
    'utf8',
  );

  it('does not paint a container behind the Timeline navigation buttons', () => {
    expect(cssSource).not.toMatch(/\.clash-timeline-toolbar-surface\s*\{/);
  });

  it('uses a centered Timeline shadow without a directional bottom tail', () => {
    expect(cssSource).toMatch(
      /--clash-timeline-panel-shadow:\s*0 0 12px rgba\(35, 31, 25, 0\.045\),\s*inset 0 1px 0 rgba\(255, 255, 255, 0\.82\);/,
    );

    const rules = Array.from(
      cssSource.matchAll(/\.clash-timeline-panel-surface\s*\{[\s\S]*?\}/g),
      ([rule]) => rule,
    ).join('\n');
    expect(rules).toMatch(/box-shadow:\s*var\(--clash-timeline-panel-shadow\)/);
    expect(rules).not.toContain('var(--clash-floating-panel-shadow)');
  });

  it('uses one compact radius for Preview, Inspector, and Timeline surfaces', () => {
    expect(cssSource).toMatch(/--clash-workbench-surface-radius:\s*10px/);
    expect(cssSource).toMatch(
      /\.clash-timeline-preview-surface\s*\{[\s\S]*?border-radius:\s*var\(--clash-workbench-surface-radius\)/,
    );
    expect(cssSource).toMatch(
      /\.clash-canvas-overlay-panel,[\s\S]*?\.clash-timeline-panel-surface\s*\{[\s\S]*?border-radius:\s*var\(--clash-workbench-surface-radius\)/,
    );
    expect(editorSource).toContain(
      'clash-timeline-preview-surface clash-timeline-panel-surface h-full w-full overflow-hidden bg-warm-surface',
    );
    expect(editorSource).not.toContain(
      'h-full w-full overflow-hidden rounded-matrix',
    );
  });

  it('uses a shared control radius instead of the panel radius for toolbar buttons', () => {
    expect(cssSource).toMatch(/--clash-workbench-control-radius:\s*6px/);
    expect(cssSource).toMatch(
      /\.clash-workbench-control-button\s*\{[\s\S]*?border-radius:\s*var\(--clash-workbench-control-radius\)/,
    );
  });

  it('keeps the compact idle agent vector on a stable pixel grid', () => {
    const rule = cssSource.match(/\.clash-agent-motion--compact\.clash-agent-motion--idle[\s\S]*?\.clash-agent-motion__pen\s*\{[\s\S]*?\}/)?.[0] ?? '';
    expect(rule).toMatch(/animation:\s*none/);
    expect(rule).toMatch(/transform:\s*rotate\(26deg\)/);
  });

  it('uses the workbench page color behind Copilot content', () => {
    const rule = cssSource.match(/\.clash-copilot-panel-shell\s*\{[\s\S]*?\}/)?.[0] ?? '';
    expect(rule).toMatch(/background:\s*var\(--color-warm-page\)/);
    expect(rule).toMatch(/border-radius:\s*var\(--clash-workbench-surface-radius\)/);
    expect(copilotSource).toContain(
      'clash-copilot-panel-shell fixed z-50 flex flex-col overflow-hidden bg-warm-page',
    );
  });

  it('does not double-elevate the bordered Copilot panel with a wide shadow', () => {
    const rule = cssSource.match(/\.clash-copilot-panel-shell\s*\{[\s\S]*?\}/)?.[0] ?? '';
    expect(rule).toMatch(/border:\s*1px solid/);
    expect(rule).not.toMatch(
      /box-shadow:[\s\S]*?\b(?:1[6-9]|[2-9]\d+)px\b/,
    );
  });
});
