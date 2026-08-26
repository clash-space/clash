/**
 * Which Tripo host to call, from what the account stored.
 *
 * Tripo answers on two hosts, and an account issued for one is not recognised by the other:
 * `openapi.tripo3d.ai` for the international service, `openapi.tripo3d.com` for the China
 * service. Region is a fact about the account -- who issued the key -- not a fact about a model
 * Card, so it lives here, in the Provider account/plugin-store layer, and this is the one place
 * that turns a stored `region` into a host for every request the executor makes (submit, file
 * upload, and poll alike). A wrong region must fail closed as a structured, non-retryable
 * rejection; it must never retry the other documented host with the same key.
 */

import { ProviderExecutionError } from "@clash/action-sdk";

export const TRIPO_REGION_ENDPOINTS = {
  international: "https://openapi.tripo3d.ai/v3",
  china: "https://openapi.tripo3d.com/v3",
} as const;

export type TripoRegion = keyof typeof TRIPO_REGION_ENDPOINTS;

export interface TripoBaseUrlInput {
  region?: string;
  /** Whether an illegal region is reported as a rejected submit or an accepted poll. */
  requestState: "rejected" | "accepted";
}

export function tripoBaseUrl(input: TripoBaseUrlInput): string {
  // "international" is the Provider declaration's visible default. The store only records a
  // value the operator supplied explicitly, so an omitted region must resolve the same way as
  // the rendered form instead of turning that declared default into a runtime error.
  const region = input.region?.trim() || "international";
  const endpoint = TRIPO_REGION_ENDPOINTS[region as TripoRegion];
  if (!endpoint) {
    // Guessing would send the request to a host this account's key is unknown to, and the
    // failure would arrive as an unrelated authentication error naming neither the region asked
    // for nor the host tried. Reject it here, structurally, before any request is built.
    throw new ProviderExecutionError({
      code: "invalid_request",
      message:
        `This Tripo account stored region ${JSON.stringify(region)}; expected `
        + `"international" or "china".`,
      retryable: false,
      requestState: input.requestState,
    });
  }
  return endpoint;
}
