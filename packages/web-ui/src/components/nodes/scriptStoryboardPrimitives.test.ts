import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const readNodeSource = (file: string) =>
  readFileSync(join(process.cwd(), 'packages/web-ui/src/components/nodes', file), 'utf8');

describe('script and storyboard node action primitives', () => {
  it('uses the shared Button primitive for the ScriptNode add-scene action', () => {
    const source = readNodeSource('ScriptNode.tsx');

    expect(source).toContain("../ui/button");
    expect(source).toMatch(/<Button[\s\S]*onClick=\{addShot\}[\s\S]*Add Scene/);
    expect(source).not.toMatch(/<button[\s\S]*onClick=\{addShot\}/);
  });

  it('does not render a storyboard AI enhance control without behavior', () => {
    const source = readNodeSource('StoryboardNode.tsx');

    expect(source).not.toContain('AI Enhance');
    expect(source).not.toMatch(/<button[\s\S]*MagicWand/);
  });
});
