import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('OpenInMenu primitives', () => {
  it('uses Ariakit menu primitives for the NLE target picker', () => {
    const source = readFileSync(
      new URL('./OpenInMenu.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain("from '@ariakit/react'");
    expect(source).toContain('<Ariakit.MenuProvider>');
    expect(source).toContain('<Ariakit.MenuButton');
    expect(source).toContain('<Ariakit.Menu');
    expect(source).toContain('portal');
    expect(source).toContain('<Ariakit.MenuItem');
    expect(source).toContain('<Ariakit.MenuSeparator');
    expect(source).toContain('onExport?: () => Promise<void>');
    expect(source).toContain('Export video');
    expect(source).toContain("opening ? 'Opening…' : 'Export'");
    expect(source).toContain('Adobe Premiere Pro');
    expect(source).toContain('Final Cut Pro');
    expect(source).toContain('DaVinci Resolve');
    expect(source).toContain('function NleIcon');
    expect(source).toContain('<NleIcon target={target.id} />');
    expect(source).toContain('data-nle-icon={target}');
    expect(source).toContain('border-overlay-border');
    expect(source).toContain('bg-overlay-surface');
    expect(source).toContain('shadow-overlay');
    expect(source).toContain('text-content-primary');
    expect(source).toContain('text-content-secondary');
    expect(source).toContain('text-content-muted');
    expect(source).toContain('text-content-disabled');
    expect(source).not.toContain('bg-[#fbfaf8]');
    expect(source).not.toContain('border-stone-200');
    expect(source).not.toContain('text-slate-700');
    expect(source).not.toContain('text-stone-400');
    expect(source).not.toContain('text-emerald-700');
    expect(source).toContain('flex min-w-0 items-center gap-2');
    expect(source).toContain('availability: NleAvailability[] | null');
    expect(source).toContain("'Not installed'");
    expect(source).toContain("'Installed'");
    expect(source).toContain('onRefreshAvailability');
    expect(source).toContain('Checking installed editors…');
    expect(source).toContain('Could not check installed editors.');
    expect(source).toContain('disabled={!entry.installed || opening !== null}');
    expect(source).not.toContain('document.addEventListener');
  });
});
