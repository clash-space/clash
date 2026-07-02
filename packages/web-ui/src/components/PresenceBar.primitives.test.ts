import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readSource(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('PresenceBar tooltip primitives', () => {
  it('uses the shared tooltip primitive instead of local Ariakit tooltip plumbing', () => {
    const source = readSource('packages/web-ui/src/components/PresenceBar.tsx');
    const tooltipSource = readSource('packages/web-ui/src/components/ui/tooltip.tsx');

    expect(tooltipSource).toContain('@ariakit/react');
    expect(tooltipSource).toContain('TooltipProvider');
    expect(tooltipSource).toContain('TooltipAnchor');
    expect(source).toContain('./ui/tooltip');
    expect(source).toContain('<Tooltip label={client.name}>');
    expect(source).toContain("Avatar as AvatarPrimitive");
    expect(source).toContain("AvatarPrimitive.Root");
    expect(source).toContain("AvatarPrimitive.Image");
    expect(source).toContain("AvatarPrimitive.Fallback");
    expect(source).not.toContain('@ariakit/react');
    expect(source).not.toContain('TooltipProvider');
    expect(source).not.toContain('TooltipAnchor');
    expect(source).not.toContain('tabIndex={0}');
    expect(source).not.toContain('<img');
    expect(source).not.toContain('role="tooltip"');
    expect(source).not.toContain('group-hover:opacity-100');
  });
});
