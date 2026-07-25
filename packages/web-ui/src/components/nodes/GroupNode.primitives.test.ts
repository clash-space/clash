import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readSource(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('GroupNode action primitives', () => {
  it('uses the shared tooltip primitive for selected-group actions instead of browser title attributes', () => {
    const source = readSource('packages/web-ui/src/components/nodes/GroupNode.tsx');
    const tooltipSource = readSource('packages/web-ui/src/components/ui/tooltip.tsx');

    expect(tooltipSource).toContain('@ariakit/react');
    expect(source).toContain('../ui/tooltip');
    expect(source).toContain('<Tooltip label="Ungroup (release children to parent)">');
    expect(source).toContain('<Tooltip label="Relayout inside group">');
    expect(source).not.toContain('title="Ungroup (release children to parent)"');
    expect(source).not.toContain('title="Relayout inside group"');
    expect(source).not.toContain('TooltipProvider');
    expect(source).not.toContain('TooltipAnchor');
  });

  it('uses shared Button primitives for selected-group actions', () => {
    const source = readSource('packages/web-ui/src/components/nodes/GroupNode.tsx');

    expect(source).toContain('../ui/button');
    expect(source).toMatch(/<Button[\s\S]*onClick=\{\(\) => ungroup\(id\)\}/);
    expect(source).toMatch(/<Button[\s\S]*onClick=\{\(\) => relayoutParent\(id\)\}/);
    expect(source).not.toMatch(/<button[\s\S]*onClick=\{\(\) => ungroup\(id\)\}/);
    expect(source).not.toMatch(/<button[\s\S]*onClick=\{\(\) => relayoutParent\(id\)\}/);
  });

  it('uses ReactFlow node interaction boundary classes for selected-group actions', () => {
    const source = readSource('packages/web-ui/src/components/nodes/GroupNode.tsx');

    expect(source).toContain('nodrag');
    expect(source).toContain('nopan');
    expect(source).not.toContain('onMouseDown={(e) => e.stopPropagation()}');
  });

  it('subscribes only to the group parent chain instead of every node object', () => {
    const source = readSource('packages/web-ui/src/components/nodes/GroupNode.tsx');

    expect(source).toContain('useStore');
    expect(source).not.toContain('useNodes()');
  });
});
