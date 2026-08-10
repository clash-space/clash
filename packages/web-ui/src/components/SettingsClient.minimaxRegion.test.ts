import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, 'SettingsClient.tsx'), 'utf8');

/**
 * A MiniMax account works on exactly one of two hosts, and only the account holder knows which.
 *
 * `api.minimax.io` serves the international service and `api.minimaxi.com` the domestic one. They
 * do not share a login, so the wrong host does not answer worse — it refuses, as an authentication
 * error that names neither the host nor the region, sending whoever reads it to check a key that
 * was never wrong.
 *
 * Only the international host existed anywhere in this repository, which left domestic accounts
 * with no way to be used at all.
 */
describe('a MiniMax account records which service it belongs to', () => {
    it('offers the choice on the account form', () => {
        expect(source).toMatch(/providerId === 'minimax'[\s\S]{0,900}?key: 'region'/);
    });

    it('presents it as a choice between the two services, not a URL to type', () => {
        // The set is closed and known. Asking for a host invites a typo in the one letter that
        // separates them, and offers no hint that a second service exists.
        expect(source).toMatch(/options:\s*\[[\s\S]{0,300}?'global'[\s\S]{0,300}?'cn'/);
    });

    it('names them the way an account holder would recognise them', () => {
        // "global" and "cn" are our identifiers; someone picking their account reads the service.
        expect(source).toMatch(/minimax\.io/);
        expect(source).toMatch(/minimaxi\.com/);
    });
});
