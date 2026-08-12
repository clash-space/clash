import { describe, expect, it } from "vitest";

import {
  authorizationUrl,
  createPkcePair,
  exchangeAuthorizationCode,
  refreshAccessToken,
  runLoopbackFlow,
} from "./auth-flow.js";

/**
 * The parts of OAuth every vendor does identically.
 *
 * A plugin that had to implement `state` correctly would eventually implement it incorrectly, and
 * the failure is a silent CSRF rather than an error. The same is true of PKCE, of the loopback
 * port, and of the timeout. What differs between vendors is which URL to open and which parameters
 * to send -- so those come from the declaration, and everything else is here.
 */
describe("PKCE", () => {
  it("derives the challenge from the verifier by S256", async () => {
    const pair = await createPkcePair();
    // RFC 7636: the challenge is the base64url SHA-256 of the verifier. A plugin computing this
    // itself is a plugin that can get it subtly wrong and see only "invalid_grant".
    expect(pair.method).toBe("S256");
    expect(pair.challenge).not.toBe(pair.verifier);
    expect(pair.challenge).not.toMatch(/[+/=]/);
  });

  it("makes a different verifier each time", async () => {
    // A fixed verifier would let anyone who saw one authorization exchange replay the next.
    const [first, second] = await Promise.all([createPkcePair(), createPkcePair()]);
    expect(first.verifier).not.toBe(second.verifier);
  });

  it("uses a verifier long enough to be worth having", async () => {
    // RFC 7636 puts the floor at 43 characters; below it the challenge is brute-forceable.
    const pair = await createPkcePair();
    expect(pair.verifier.length).toBeGreaterThanOrEqual(43);
  });
});

describe("authorization url", () => {
  it("carries the parameters the standard requires, and the ones the plugin declared", () => {
    const url = new URL(authorizationUrl({
      open: "https://accounts.google.com/o/oauth2/v2/auth",
      clientId: "client-1",
      redirectUri: "http://127.0.0.1:5555/callback",
      state: "state-1",
      challenge: "challenge-1",
      params: { scope: "https://www.googleapis.com/auth/cloud-platform", access_type: "offline" },
    }));
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe("state-1");
    expect(url.searchParams.get("access_type")).toBe("offline");
  });

  it("does not let declared parameters overwrite the security ones", () => {
    // A declaration that set `state` would be replacing the value the host is about to check
    // against, which turns the check into a comparison of a constant with itself.
    const url = new URL(authorizationUrl({
      open: "https://accounts.google.com/o/oauth2/v2/auth",
      clientId: "client-1",
      redirectUri: "http://127.0.0.1:5555/callback",
      state: "host-state",
      challenge: "challenge-1",
      params: { state: "plugin-state", code_challenge: "plugin-challenge" },
    }));
    expect(url.searchParams.get("state")).toBe("host-state");
    expect(url.searchParams.get("code_challenge")).toBe("challenge-1");
  });
});

describe("the loopback callback", () => {
  it("refuses a callback whose state does not match", async () => {
    // The whole purpose of `state`. Without this comparison an attacker can hand the user a link
    // that binds the attacker's account to the user's session.
    const flow = runLoopbackFlow({ open: (url) => void url, timeoutMs: 2000 });
    const started = await flow.started;
    const response = await fetch(`${started.redirectUri}?code=abc&state=wrong`);
    expect(response.status).toBe(400);
    flow.cancel();
  });

  it("hands back the parameters when the state matches", async () => {
    let opened = "";
    const flow = runLoopbackFlow({ open: (url) => { opened = url; }, timeoutMs: 5000 });
    const started = await flow.started;
    await fetch(`${started.redirectUri}?code=abc&state=${encodeURIComponent(started.state)}`);
    await expect(flow.result).resolves.toMatchObject({ code: "abc" });
    expect(opened).toBe("");
  });

  it("stops listening once it has an answer", async () => {
    // A port left bound after the flow finishes is a port that will answer the next callback, for
    // a flow nobody started.
    const flow = runLoopbackFlow({ open: () => {}, timeoutMs: 5000 });
    const started = await flow.started;
    await fetch(`${started.redirectUri}?code=abc&state=${encodeURIComponent(started.state)}`);
    await flow.result;
    await expect(fetch(started.redirectUri)).rejects.toThrow();
  });

  it("gives up rather than holding the port forever", async () => {
    const flow = runLoopbackFlow({ open: () => {}, timeoutMs: 300 });
    await flow.started;
    await expect(flow.result).rejects.toThrow(/timed out|timeout/i);
  });
});

describe("token exchange", () => {
  it("posts the verifier, which is what proves this is the same client", async () => {
    let body = "";
    await exchangeAuthorizationCode({
      tokenUrl: "https://oauth2.googleapis.com/token",
      clientId: "client-1",
      code: "abc",
      verifier: "verifier-1",
      redirectUri: "http://127.0.0.1:5555/callback",
      fetch: (async (_url: string, init: { body: string }) => {
        body = init.body;
        return { ok: true, status: 200, json: async () => ({ access_token: "at", expires_in: 3600 }) };
      }) as never,
    });
    expect(new URLSearchParams(body).get("code_verifier")).toBe("verifier-1");
    expect(new URLSearchParams(body).get("grant_type")).toBe("authorization_code");
  });

  it("turns expires_in into an absolute time the store can hold", async () => {
    // `expires_in` is relative to a response the host will not have when it later decides whether
    // to renew. Storing it as-is means recomputing an elapsed time nobody recorded.
    const before = Date.now();
    const token = await exchangeAuthorizationCode({
      tokenUrl: "https://oauth2.googleapis.com/token",
      clientId: "client-1",
      code: "abc",
      verifier: "v",
      redirectUri: "http://127.0.0.1:5555/callback",
      fetch: (async () => ({
        ok: true, status: 200, json: async () => ({ access_token: "at", expires_in: 3600 }),
      })) as never,
    });
    expect(token.expiresAt!).toBeGreaterThanOrEqual(before + 3_600_000 - 5_000);
  });

  it("reports the vendor's error rather than a generic failure", async () => {
    // `invalid_grant` and `invalid_client` need different fixes, and a caller told only "exchange
    // failed" has to go and read a log to tell them apart.
    await expect(exchangeAuthorizationCode({
      tokenUrl: "https://oauth2.googleapis.com/token",
      clientId: "client-1",
      code: "abc",
      verifier: "v",
      redirectUri: "http://127.0.0.1:5555/callback",
      fetch: (async () => ({
        ok: false,
        status: 400,
        json: async () => ({ error: "invalid_grant", error_description: "Bad code" }),
      })) as never,
    })).rejects.toThrow(/invalid_grant/);
  });

  it("keeps the old refresh token when a refresh does not return one", async () => {
    // Google omits it on refresh. Overwriting with undefined loses the only credential that can
    // obtain another access token, and the account silently stops working at the next expiry.
    const token = await refreshAccessToken({
      tokenUrl: "https://oauth2.googleapis.com/token",
      clientId: "client-1",
      refreshToken: "rt-original",
      fetch: (async () => ({
        ok: true, status: 200, json: async () => ({ access_token: "at-2", expires_in: 3600 }),
      })) as never,
    });
    expect(token.refreshToken).toBe("rt-original");
  });
});
