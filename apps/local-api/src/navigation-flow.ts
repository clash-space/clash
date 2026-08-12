/**
 * Waiting for a vendor that hands the credential back through its own https page.
 *
 * Three callback shapes exist and they need different machinery. A `loopback` flow binds a port on
 * 127.0.0.1 and reads the request the browser makes to it. A `scheme` flow needs an OS-level
 * protocol handler, which only the desktop app has. This is the third: the vendor redirects to a
 * page on its own domain, so there is no port to bind and no scheme to register -- what is needed
 * is a browser under our control and a look at where it has navigated to.
 *
 * hrhrng.hub is the case. Its declaration claimed `custom-scheme: minimax-hub`, and opening the
 * real login page shows ordinary OAuth with `redirect_uri=https://hub.minimax.io/auth/callback`.
 * The wrong value survived because nothing tests it: a contract test checks what a plugin answers
 * when the host asks, and the external facts in a declaration -- an address, a callback shape -- are
 * only ever checked by running the thing.
 */

export interface WatchForCallbackOptions {
  /** The declared callback address. Matched on origin and path, never as a substring. */
  callbackUrl: string;
  /** Reads the controlled browser's current address. */
  currentUrl: () => Promise<string>;
  pollMs?: number;
  timeoutMs?: number;
}

export interface CallbackArrival {
  url: string;
  params: Record<string, string>;
}

function isCallback(current: string, callbackUrl: string): boolean {
  let currentParsed: URL;
  let expected: URL;
  try {
    currentParsed = new URL(current);
    expected = new URL(callbackUrl);
  } catch {
    return false;
  }
  // Origin and path, not `includes`. The authorization URL carries the callback as its
  // `redirect_uri`, so a substring match reports success on the page that merely announces where it
  // will eventually go -- before the user has logged in at all.
  return currentParsed.origin === expected.origin && currentParsed.pathname === expected.pathname;
}

export async function watchForCallback(
  options: WatchForCallbackOptions,
): Promise<CallbackArrival> {
  const pollMs = options.pollMs ?? 500;
  const timeoutMs = options.timeoutMs ?? 300_000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    let current: string | undefined;
    try {
      current = await options.currentUrl();
    } catch {
      // Reading the address mid-navigation can fail; the execution context is torn down and
      // rebuilt on every document. Treating that as fatal would abandon a login the user is in the
      // middle of completing.
      current = undefined;
    }

    if (current && isCallback(current, options.callbackUrl)) {
      const url = new URL(current);
      const params: Record<string, string> = {};
      for (const [key, value] of url.searchParams) params[key] = value;
      // Some vendors answer in the fragment rather than the query, and a fragment never reaches a
      // server -- which is part of why this shape needs a browser we can read rather than a
      // listening socket.
      for (const [key, value] of new URLSearchParams(url.hash.replace(/^#/, ""))) {
        params[key] ??= value;
      }
      return { url: current, params };
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  throw new Error(
    `Waiting for ${options.callbackUrl} timed out after ${timeoutMs}ms; the sign-in was not completed.`,
  );
}

export interface FlowCredentialSource {
  /** Where the vendor left it. */
  from: "cookie" | "query" | "fragment" | "localStorage";
  /** Its name there -- a cookie name, a parameter name, a storage key. */
  name: string;
  /** The store key to write it under. */
  storeAs: string;
}

export interface FlowPageState {
  url: string;
  cookies?: Record<string, string>;
  localStorage?: Record<string, string>;
}

/**
 * Read the credential the declaration names, out of the browser the host is driving.
 *
 * `watchForCallback` gets as far as knowing the sign-in finished. Without this, a person then reads
 * the token out with devtools, which is not a product.
 *
 * Four locations, because vendors use four. hrhrng.hub sets a `_token` cookie on hub.minimax.io and
 * puts nothing in the query string; an authorization code arrives as a query parameter; an implicit
 * grant arrives in the fragment, which never reaches a server and so is only readable from a
 * browser we control; some vendors write to local storage.
 *
 * The host learns nothing about meaning. `_token` is a cookie name and `accessToken` is a store
 * key -- that the value is a JWT, and what it authorises, remains the plugin's business.
 */
export async function readFlowCredential(
  source: FlowCredentialSource,
  page: FlowPageState,
): Promise<Record<string, string>> {
  let value: string | undefined;

  switch (source.from) {
    case "cookie":
      value = page.cookies?.[source.name];
      break;
    case "localStorage":
      value = page.localStorage?.[source.name];
      break;
    case "query":
    case "fragment": {
      let parsed: URL | undefined;
      try {
        parsed = new URL(page.url);
      } catch {
        parsed = undefined;
      }
      const params = source.from === "query"
        ? parsed?.searchParams
        : new URLSearchParams(parsed?.hash.replace(/^#/, "") ?? "");
      value = params?.get(source.name) ?? undefined;
      break;
    }
  }

  // No fallback to another location. Falling back would store some other vendor value under the
  // credential key, and the failure would surface much later as a request the vendor rejects for
  // reasons of its own. Storing "" is worse still: the account then looks connected.
  if (!value?.trim()) {
    throw new Error(
      `The sign-in finished but ${source.from} ${source.name} held nothing, so there is no credential to store.`,
    );
  }
  return { [source.storeAs]: value };
}
