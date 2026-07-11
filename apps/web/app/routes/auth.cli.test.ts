import { describe, expect, it, vi } from "vitest";
import * as authCliModule from "./auth.cli";

type AuthorizationParams = {
  response_type: "code";
  client_id: "clash-cli";
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: "S256";
  state: string;
};

type AuthCliExports = {
  parseCliAuthorizationParams?: (
    params: URLSearchParams,
  ) => AuthorizationParams;
  requestCliAuthorization?: (
    params: AuthorizationParams,
    fetchImpl: typeof fetch,
  ) => Promise<string>;
};

const authCli = authCliModule as unknown as AuthCliExports;
const validQuery = new URLSearchParams({
  response_type: "code",
  client_id: "clash-cli",
  redirect_uri: "http://127.0.0.1:43123/callback",
  code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  code_challenge_method: "S256",
  state: "state_0123456789abcdefghijklmnopqrstuvwxyz",
});

describe("CLI browser authorization route", () => {
  it("parses only the first-party code plus PKCE request", () => {
    expect(authCli.parseCliAuthorizationParams).toBeTypeOf("function");
    if (!authCli.parseCliAuthorizationParams) return;

    expect(authCli.parseCliAuthorizationParams(validQuery)).toEqual({
      response_type: "code",
      client_id: "clash-cli",
      redirect_uri: "http://127.0.0.1:43123/callback",
      code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
      code_challenge_method: "S256",
      state: "state_0123456789abcdefghijklmnopqrstuvwxyz",
    });
  });

  it.each([
    [
      "external redirect",
      { redirect_uri: "https://attacker.example/callback" },
    ],
    [
      "lookalike redirect",
      { redirect_uri: "http://localhost.attacker.example:43123/callback" },
    ],
    ["missing state", { state: "" }],
    ["plain challenge", { code_challenge_method: "plain" }],
  ])("rejects %s before sign-in or API access", (_label, override) => {
    expect(authCli.parseCliAuthorizationParams).toBeTypeOf("function");
    if (!authCli.parseCliAuthorizationParams) return;
    const query = new URLSearchParams(validQuery);
    for (const [key, value] of Object.entries(override)) query.set(key, value);
    expect(() => authCli.parseCliAuthorizationParams!(query)).toThrow();
  });

  it("requests an authorization code and validates the returned callback", async () => {
    expect(authCli.parseCliAuthorizationParams).toBeTypeOf("function");
    expect(authCli.requestCliAuthorization).toBeTypeOf("function");
    if (
      !authCli.parseCliAuthorizationParams ||
      !authCli.requestCliAuthorization
    )
      return;
    const params = authCli.parseCliAuthorizationParams(validQuery);
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            redirect_uri: `${params.redirect_uri}?code=one_time_code&state=${encodeURIComponent(params.state)}`,
            expires_in: 300,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    ) as unknown as typeof fetch;

    const redirect = await authCli.requestCliAuthorization(params, fetchImpl);

    expect(redirect).toContain("code=one_time_code");
    expect(redirect).not.toContain("token=");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0];
    expect(url).toBe("/api/v1/cli-auth/authorize");
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin" });
    expect(JSON.parse(String(init?.body))).toEqual(params);
  });

  it("rejects an authorization response that tries to return an access token", async () => {
    expect(authCli.parseCliAuthorizationParams).toBeTypeOf("function");
    expect(authCli.requestCliAuthorization).toBeTypeOf("function");
    if (
      !authCli.parseCliAuthorizationParams ||
      !authCli.requestCliAuthorization
    )
      return;
    const params = authCli.parseCliAuthorizationParams(validQuery);
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            redirect_uri: `${params.redirect_uri}?token=clsh_unsafe&state=${encodeURIComponent(params.state)}`,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    ) as unknown as typeof fetch;

    await expect(
      authCli.requestCliAuthorization(params, fetchImpl),
    ).rejects.toThrow();
  });
});
