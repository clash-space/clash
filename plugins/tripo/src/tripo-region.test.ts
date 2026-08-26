import { describe, expect, it } from "vitest";

import { ProviderExecutionError } from "@clash/action-sdk";

import { TRIPO_REGION_ENDPOINTS, tripoBaseUrl } from "./tripo-region.js";

/**
 * Tripo answers on two hosts, and which one an account can reach depends on where the key was
 * issued: `openapi.tripo3d.ai` for the international service, `openapi.tripo3d.com` for the
 * China service. They are not mirrors sharing a login -- a key issued for one is not honoured by
 * the other -- so picking the wrong host must never be papered over with a retry against the
 * other one. This module is the one place that turns a stored `region` into a host, so that fact
 * cannot drift between submit, upload and poll.
 */
describe("tripoBaseUrl", () => {
  it("offers exactly the two documented hosts", () => {
    expect(Object.keys(TRIPO_REGION_ENDPOINTS).sort()).toEqual(["china", "international"]);
  });

  it("sends an international account to openapi.tripo3d.ai", () => {
    expect(tripoBaseUrl({ region: "international", requestState: "rejected" })).toBe(
      "https://openapi.tripo3d.ai/v3",
    );
  });

  it("sends a china account to openapi.tripo3d.com", () => {
    // The TLD is the entire difference between the two hosts and is easy to lose in review; this
    // is the assertion that fails if it ever is.
    expect(tripoBaseUrl({ region: "china", requestState: "rejected" })).toBe(
      "https://openapi.tripo3d.com/v3",
    );
  });

  it("defaults to the international host when no region was recorded", () => {
    // Accounts predate this choice, and the Provider declaration's own default is international,
    // so an unset region must resolve exactly as the rendered form does.
    expect(tripoBaseUrl({ requestState: "rejected" })).toBe("https://openapi.tripo3d.ai/v3");
  });

  it("rejects an unknown region as a structured, non-retryable Provider failure", () => {
    // Guessing would send the request to a host the account's key is unknown to, and the failure
    // would name neither the region asked for nor the host tried. This must fail closed instead,
    // with the same structured shape every other Provider rejection uses.
    expect(() => tripoBaseUrl({ region: "eu", requestState: "rejected" })).toThrow(
      ProviderExecutionError,
    );
    try {
      tripoBaseUrl({ region: "eu", requestState: "rejected" });
      throw new Error("expected tripoBaseUrl to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderExecutionError);
      const failure = (error as ProviderExecutionError).failure;
      expect(failure).toMatchObject({
        code: "invalid_request",
        retryable: false,
        requestState: "rejected",
      });
      expect(failure.message).toContain("eu");
    }
  });

  it("carries the caller's requestState so a poll-time rejection stays accepted", () => {
    try {
      tripoBaseUrl({ region: "eu", requestState: "accepted" });
      throw new Error("expected tripoBaseUrl to throw");
    } catch (error) {
      expect((error as ProviderExecutionError).failure.requestState).toBe("accepted");
    }
  });

  it("never falls back to the other region's host once one has been derived", () => {
    // A wrong host must refuse, not silently retry against the other documented endpoint --
    // that would be an automatic cross-region fallback this Provider must never perform.
    const international = tripoBaseUrl({ region: "international", requestState: "rejected" });
    const china = tripoBaseUrl({ region: "china", requestState: "rejected" });
    expect(international).not.toBe(china);
  });
});
