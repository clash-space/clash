import { describe, expect, it } from 'vitest';

import type { PluginAuthDeclaration } from '@clash/shared-types';

import { authFormControls } from '@clash/shared-types';

/**
 * The declaration as the MiniMax Provider ships it.
 *
 * Copied rather than imported: the settings screen must not reach into a plugin's source, because a
 * third-party Provider is not in this repository at all and the form has to work the same for it.
 * `plugins/first-party-media/src/auth-poc.test.ts` holds the plugin side of the same fact.
 */
const MINIMAX_AUTH: PluginAuthDeclaration = {
    methods: [{
        id: 'api-key',
        label: 'API key',
        form: [
            { kind: 'field' as const, key: 'apiKey', label: 'API key', secret: true },
            {
                kind: 'choice' as const,
                key: 'service',
                label: 'Region',
                options: [
                    { value: 'international', label: 'International (api.minimax.io)' },
                    { value: 'domestic', label: 'China (api.minimaxi.com)' },
                ],
                default: 'international',
            },
        ],
    }],
};

/**
 * A MiniMax account works on exactly one of two hosts, and only the account holder knows which.
 *
 * `api.minimax.io` serves the international service and `api.minimaxi.com` the domestic one. They
 * do not share a login, so the wrong host does not answer worse -- it refuses, as an authentication
 * error that names neither the host nor the region, sending whoever reads it to check a key that
 * was never wrong.
 *
 * This used to be asserted by matching `providerId === 'minimax'` against the text of
 * SettingsClient.tsx. That held while the options were spelled out in the settings screen, and it
 * stopped meaning anything the moment the Provider began declaring its own form -- the strings
 * moved, the regex failed, and nothing about MiniMax had changed. What is asserted now is that the
 * choice reaches the form, wherever it is declared.
 */
describe('a MiniMax account records which service it belongs to', () => {
    it('offers the choice on the account form', () => {
        const control = authFormControls(MINIMAX_AUTH).find(
            (candidate) => 'key' in candidate && candidate.key === 'service',
        );
        expect(control).toMatchObject({ control: 'select' });
    });

    it('offers both hosts, because an account is on one or the other', () => {
        const control = authFormControls(MINIMAX_AUTH).find(
            (candidate) => 'key' in candidate && candidate.key === 'service',
        ) as { options: { value: string }[] };
        expect(control.options.map((option) => option.value).sort())
            .toEqual(['domestic', 'international']);
    });

    it('defaults to one, so an account is never left with no host at all', () => {
        // A choice with no default would be required, and an account saved without it would fail
        // its first generation on a field the user did not know to fill in.
        const control = authFormControls(MINIMAX_AUTH).find(
            (candidate) => 'key' in candidate && candidate.key === 'service',
        );
        expect(control).toMatchObject({ required: false, value: 'international' });
    });
});
