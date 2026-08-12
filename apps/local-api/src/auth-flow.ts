import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";

/**
 * The parts of OAuth that every vendor does identically.
 *
 * A plugin that had to implement `state` correctly would eventually implement it incorrectly, and
 * the failure is a silent CSRF rather than an error. The same holds for PKCE, for binding a
 * loopback port, and for giving up on one. What actually differs between vendors is which URL to
 * open and which extra parameters to send, so those come from the declaration and the rest is here.
 *
 * Google requires loopback for desktop clients: the out-of-band flow (`urn:ietf:wg:oauth:2.0:oob`)
 * was withdrawn in 2022, so there is no variant of this that avoids binding a port.
 */

export interface PkcePair {
  verifier: string;
  challenge: string;
  method: "S256";
}

/** RFC 7636. The floor is 43 characters; below it the challenge is brute-forceable. */
export async function createPkcePair(): Promise<PkcePair> {
  const verifier = base64Url(randomBytes(48));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge, method: "S256" };
}

function base64Url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface AuthorizationUrlInput {
  open: string;
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
  /** Vendor-specific: scope, access_type, prompt, audience. Whatever the declaration carries. */
  params?: Record<string, string>;
}

export function authorizationUrl(input: AuthorizationUrlInput): string {
  const url = new URL(input.open);
  // Declared parameters first, so the ones below always win. A declaration that set `state` would
  // be replacing the value the host is about to compare against, which turns the check into a
  // comparison of a constant with itself.
  for (const [key, value] of Object.entries(input.params ?? {})) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export interface LoopbackFlowOptions {
  open: (url: string) => void;
  timeoutMs?: number;
}

export interface LoopbackFlowStarted {
  redirectUri: string;
  state: string;
  port: number;
}

export interface LoopbackFlow {
  started: Promise<LoopbackFlowStarted>;
  result: Promise<Record<string, string>>;
  cancel: () => void;
}

/**
 * Bind 127.0.0.1 on a port the OS picks, and wait for one callback.
 *
 * One callback, then the port closes. A port left bound after the flow finishes is a port that
 * will answer the next callback, for a flow nobody started.
 */
export function runLoopbackFlow(options: LoopbackFlowOptions): LoopbackFlow {
  const state = base64Url(randomBytes(24));
  const timeoutMs = options.timeoutMs ?? 5 * 60_000;

  let server: Server | undefined;
  let settle: ((params: Record<string, string>) => void) | undefined;
  let fail: ((error: Error) => void) | undefined;
  let timer: NodeJS.Timeout | undefined;

  const close = () => {
    if (timer) clearTimeout(timer);
    server?.close();
    server = undefined;
  };

  const result = new Promise<Record<string, string>>((resolve, reject) => {
    settle = (params) => { close(); resolve(params); };
    fail = (error) => { close(); reject(error); };
  });

  const started = new Promise<LoopbackFlowStarted>((resolve, reject) => {
    server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const params = Object.fromEntries(url.searchParams.entries());

      if (!statesMatch(params.state, state)) {
        // The whole purpose of `state`. Without this an attacker can hand the user a link that
        // binds the attacker's account to the user's session.
        response.writeHead(400, { "content-type": "text/plain" });
        response.end("This sign-in did not come from a request made here.");
        return;
      }

      response.writeHead(200, { "content-type": "text/html" });
      response.end("<!doctype html><p>Signed in. You can close this window.</p>");
      settle?.(params);
    });

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = (server!.address() as AddressInfo).port;
      const redirectUri = `http://127.0.0.1:${port}/callback`;
      timer = setTimeout(() => {
        fail?.(new Error(`Sign-in timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
      timer.unref?.();
      resolve({ redirectUri, state, port });
    });
  });

  return {
    started,
    result,
    cancel: () => { fail?.(new Error("Sign-in was cancelled.")); },
  };
}

/** Constant-time, because a comparison that returns early leaks the prefix it matched. */
function statesMatch(received: string | undefined, expected: string): boolean {
  if (!received) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface OAuthToken {
  accessToken: string;
  refreshToken?: string;
  /** Absolute, because `expires_in` is relative to a response the host will no longer have. */
  expiresAt?: number;
  raw: Record<string, unknown>;
}

interface TokenRequest {
  tokenUrl: string;
  clientId: string;
  clientSecret?: string;
  fetch?: typeof globalThis.fetch;
}

export async function exchangeAuthorizationCode(
  input: TokenRequest & { code: string; verifier: string; redirectUri: string },
): Promise<OAuthToken> {
  return await postToken(input, {
    grant_type: "authorization_code",
    code: input.code,
    code_verifier: input.verifier,
    redirect_uri: input.redirectUri,
  });
}

export async function refreshAccessToken(
  input: TokenRequest & { refreshToken: string },
): Promise<OAuthToken> {
  const token = await postToken(input, {
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
  });
  // Google omits the refresh token on refresh. Overwriting with undefined loses the only credential
  // that can obtain another access token, and the account stops working at the next expiry with no
  // event to explain it.
  return { ...token, refreshToken: token.refreshToken ?? input.refreshToken };
}

async function postToken(
  input: TokenRequest,
  fields: Record<string, string>,
): Promise<OAuthToken> {
  const body = new URLSearchParams({ ...fields, client_id: input.clientId });
  if (input.clientSecret) body.set("client_secret", input.clientSecret);

  const fetchImpl = input.fetch ?? globalThis.fetch;
  const response = await fetchImpl(input.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const payload = await response.json() as Record<string, unknown>;

  if (!response.ok) {
    // `invalid_grant` and `invalid_client` need different fixes, and a caller told only "exchange
    // failed" has to read a log to tell them apart.
    const code = typeof payload.error === "string" ? payload.error : `HTTP ${response.status}`;
    const detail = typeof payload.error_description === "string" ? `: ${payload.error_description}` : "";
    throw new Error(`Token request failed (${code})${detail}`);
  }

  const accessToken = payload.access_token;
  if (typeof accessToken !== "string" || !accessToken) {
    throw new Error("Token response carried no access_token.");
  }

  return {
    accessToken,
    ...(typeof payload.refresh_token === "string"
      ? { refreshToken: payload.refresh_token }
      : {}),
    ...(typeof payload.expires_in === "number"
      ? { expiresAt: Date.now() + payload.expires_in * 1000 }
      : {}),
    raw: payload,
  };
}
