/**
 * Where MiniMax answers.
 *
 * Two hosts, not two mirrors: an account issued for the international service is not recognised by
 * the domestic one, and the other way round. Picking the wrong host does not degrade the result, it
 * refuses the request — and refuses it as an authentication failure, which sends whoever is reading
 * the error to look at their key.
 *
 * Only `minimax.io` was ever written down, in four separate files, and `minimaxi.com` appeared
 * nowhere. That is not a default anyone chose.
 */
export const MINIMAX_ENDPOINTS = {
  global: 'https://api.minimax.io',
  cn: 'https://api.minimaxi.com',
} as const;

export type MinimaxRegion = keyof typeof MINIMAX_ENDPOINTS;

/**
 * The host to call for one account.
 *
 * An explicit `baseUrl` still wins, because that is how a proxy, a gateway or a self-hosted relay is
 * expressed, and none of those are a region.
 *
 * An unrecorded region resolves to the international host. Accounts predate this choice, and moving
 * them somewhere their credentials are unknown — without anyone asking — would break the ones that
 * work today.
 */
export function minimaxBaseUrl(region: string | undefined, baseUrl?: string): string {
  if (baseUrl && baseUrl.trim()) return baseUrl.trim().replace(/\/+$/, '');
  if (region === undefined || region === '') return MINIMAX_ENDPOINTS.global;
  const endpoint = MINIMAX_ENDPOINTS[region as MinimaxRegion];
  if (!endpoint) {
    // Guessing would send the request to a host that does not know this account, and the failure
    // would name neither the region asked for nor the host tried.
    throw new Error(
      `MiniMax has no endpoint for region "${region}". Known regions: `
      + `${Object.keys(MINIMAX_ENDPOINTS).join(', ')}.`,
    );
  }
  return endpoint;
}
