import { describe, expect, it, vi } from 'vitest';
import { loadExecutablePluginActions } from './useExecutablePluginActions';

describe('loadExecutablePluginActions', () => {
    it('loads and validates activated plugin action Cards from the local Kernel', async () => {
        const fetch = vi.fn(async () => Response.json({
            actions: [{
                id: 'caption-helper',
                name: 'Caption Helper',
                outputType: 'text',
                runtime: 'local',
                parameters: [],
                pluginBinding: {
                    pluginId: 'agent-caption-actions',
                    version: '1.2.0',
                    exportId: 'run-caption-helper',
                    schemaHash: `sha256:${'c'.repeat(64)}`,
                },
                pluginPermissions: { assets: ['read', 'write'] },
            }],
        }));

        const actions = await loadExecutablePluginActions(fetch as typeof globalThis.fetch);

        expect(fetch).toHaveBeenCalledWith('/api/v1/plugin-actions', expect.objectContaining({
            credentials: 'include',
        }));
        expect(actions).toHaveLength(1);
        expect(actions[0]).toMatchObject({
            id: 'caption-helper',
            pluginBinding: { pluginId: 'agent-caption-actions', version: '1.2.0' },
            pluginPermissions: { assets: ['read', 'write'] },
        });
    });

    it('rejects malformed action catalogs instead of exposing unvalidated plugins', async () => {
        const fetch = vi.fn(async () => Response.json({ actions: [{ id: 'broken' }] }));
        await expect(loadExecutablePluginActions(fetch as typeof globalThis.fetch))
            .rejects.toThrow(/invalid plugin action catalog/i);
    });
});
