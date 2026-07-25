import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('session ACP update completion motion', () => {
  it('holds long enough to read and then fades out without decorative motion', () => {
    const runtimeSource = readSource('packages/web-ui/src/lib/sessionRuntime.ts');
    const hookSource = readSource('packages/web-ui/src/hooks/useClashRuntime.ts');
    const bannerSource = readSource(
      'packages/web-ui/src/components/copilot/SessionHarnessUpdateBanner.tsx',
    );
    const controlSource = readSource(
      'packages/web-ui/src/components/copilot/SessionHarnessUpdateControl.tsx',
    );

    expect(runtimeSource).toContain('SESSION_RESTART_COMPLETE_VISIBLE_MS = 2_400');
    expect(hookSource).toContain('SESSION_RESTART_COMPLETE_VISIBLE_MS');
    expect(hookSource).not.toContain('}, 1_800);');
    expect(bannerSource).not.toContain('data-session-update-lifetime');
    expect(bannerSource).toContain('opacity: [1, 1, 0]');
    expect(bannerSource).toContain('SESSION_RESTART_COMPLETE_VISIBLE_MS / 1000');
    expect(controlSource).toContain('data-session-update-motion="fade-out"');
    expect(controlSource).toContain('opacity: [0, 1, 1, 0]');
    expect(controlSource).not.toContain('rotate:');
    expect(controlSource).not.toContain('scale:');
  });
});
