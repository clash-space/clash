import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Timeline icon button interactions', () => {
  it('gives every Timeline icon button hover, active, focus, and disabled feedback', () => {
    const source = readFileSync(new URL('./controls.tsx', import.meta.url), 'utf8');

    expect(source).toContain('TIMELINE_ICON_BUTTON_INTERACTION_CLASS');
    expect(source).toContain('hover:brightness-95');
    expect(source).toContain('active:brightness-90');
    expect(source).toContain('focus-visible:ring-2');
    expect(source).toContain('disabled:hover:brightness-100');
    expect(source).toContain('[className, TIMELINE_ICON_BUTTON_INTERACTION_CLASS]');
  });
});
