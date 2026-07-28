import { describe, expect, it } from 'vitest';
import type { AcpSessionConfigOption } from '../hooks/useClashRuntime';
import {
    buildComposerConfigOptions,
    buildRunMenuConfigOptions,
    configModeOptionPresentation,
    isFastSessionConfigOption,
    sessionConfigOptionEnabled,
    withSessionStateCommands,
} from './sessionConfigOptions';

const collaborationMode: AcpSessionConfigOption = {
    id: 'collaboration_mode',
    name: 'Collaboration mode',
    type: 'select',
    currentValue: 'default',
    options: [
        { value: 'default', name: 'Default' },
        { value: 'plan', name: 'Plan' },
    ],
};

describe('ACP session config product presentation', () => {
    it('keeps Claude-style model_config options in the run menu without coupling to Claude', () => {
        const fastBoolean: AcpSessionConfigOption = {
            id: 'fast',
            name: 'Fast mode',
            description: 'Faster responses with increased usage',
            category: 'model_config',
            type: 'boolean',
            currentValue: true,
        };
        const fastSelect: AcpSessionConfigOption = {
            ...fastBoolean,
            type: 'select',
            currentValue: 'on',
            options: [
                { value: 'on', name: 'On' },
                { value: 'off', name: 'Off' },
            ],
        };

        expect(buildRunMenuConfigOptions([fastBoolean])).toEqual([fastBoolean]);
        expect(buildComposerConfigOptions([fastBoolean])).toEqual([]);
        expect(isFastSessionConfigOption(fastBoolean)).toBe(true);
        expect(sessionConfigOptionEnabled(fastBoolean)).toBe(true);
        expect(sessionConfigOptionEnabled(fastSelect)).toBe(true);
        expect(sessionConfigOptionEnabled({ ...fastSelect, currentValue: 'off' })).toBe(false);
    });

    it('derives session commands from advertised capabilities, not a harness id', () => {
        expect(
            withSessionStateCommands([], [collaborationMode]),
        ).toEqual([
            {
                name: 'plan',
                description: 'Enter plan mode for this session',
                kind: 'session-state',
                _meta: {
                    commandAction: {
                        kind: 'setConfigOption',
                        configId: 'collaboration_mode',
                        value: 'plan',
                        resetValue: 'default',
                        presentation: 'state',
                    },
                },
            },
        ]);
    });

    it('restores a state action when a session command update omits inventory metadata', () => {
        expect(
            withSessionStateCommands([
                {
                    name: 'plan',
                    description: 'Turn plan mode on.',
                    input: null,
                },
            ], [collaborationMode]),
        ).toEqual([
            {
                name: 'plan',
                description: 'Turn plan mode on.',
                input: null,
                _meta: {
                    commandAction: {
                        kind: 'setConfigOption',
                        configId: 'collaboration_mode',
                        value: 'plan',
                        resetValue: 'default',
                        presentation: 'state',
                    },
                },
            },
        ]);
    });

    it('presents standard permission values consistently for any harness', () => {
        expect(configModeOptionPresentation({
            value: 'agent',
            name: 'Agent',
        })).toMatchObject({
            label: 'Approve for me',
        });
        expect(configModeOptionPresentation({
            value: 'custom-mode',
            name: 'Custom mode',
            description: 'Owned by the harness',
        })).toEqual({
            label: 'Custom mode',
            description: 'Owned by the harness',
        });
    });
});
