import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readSource(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('PresenceBar tooltip primitives', () => {
  it('uses Ariakit tooltip primitives instead of hand-written hover tooltip markup', () => {
    const source = readSource('packages/web-ui/src/components/PresenceBar.tsx');

    expect(source).toContain('@ariakit/react');
    expect(source).toContain('TooltipProvider');
    expect(source).toContain('TooltipAnchor');
    expect(source).toContain('Tooltip');
    expect(source).toContain('tabIndex={0}');
    expect(source).not.toContain('role="tooltip"');
    expect(source).not.toContain('group-hover:opacity-100');
  });
});
