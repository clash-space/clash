import { describe, expect, it } from 'vitest';
import { isCustomActionRuntimeOnline } from './useRuntimes';

describe('executable plugin runtime availability', () => {
    it('does not require a legacy registeredByRuntime for a Bridge-discovered plugin action', () => {
        expect(isCustomActionRuntimeOnline({
            runtime: 'local',
            pluginBinding: {
                pluginId: 'agent-caption-actions',
                version: '1.2.0',
                exportId: 'run-caption-helper',
                schemaHash: `sha256:${'c'.repeat(64)}`,
            },
        }, [])).toBe(true);
    });
});
