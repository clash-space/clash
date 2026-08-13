import { describe, expect, it } from "vitest";

import {
  ProviderExecutionError,
  providerHttpError,
  providerHttpFailure,
} from "./executable-failure.js";

describe("provider HTTP failure classification", () => {
  it("keeps a rejected rate limit retryable without claiming the submit was accepted", () => {
    expect(providerHttpFailure({
      status: 429,
      message: "too many requests",
      operation: "submit",
    })).toEqual({
      code: "rate_limited",
      message: "too many requests",
      retryable: true,
      requestState: "rejected",
      providerCode: "HTTP_429",
    });
  });

  it("marks a submit-side provider outage as ambiguous", () => {
    expect(providerHttpFailure({
      status: 503,
      message: "upstream unavailable",
      operation: "submit",
    })).toMatchObject({
      code: "provider_unavailable",
      retryable: true,
      requestState: "unknown",
    });
  });

  it("preserves accepted work when a poll task is missing", () => {
    expect(providerHttpFailure({
      status: 404,
      message: "task missing",
      operation: "poll",
    })).toMatchObject({
      code: "task_not_found",
      retryable: false,
      requestState: "accepted",
    });
  });

  it("wraps the classified failure for plugin adapters", () => {
    const error = providerHttpError({
      status: 401,
      message: "bad credential",
      operation: "submit",
      providerCode: "AUTH_17",
    });
    expect(error).toBeInstanceOf(ProviderExecutionError);
    expect(error.failure).toMatchObject({
      code: "authentication_failed",
      retryable: false,
      requestState: "rejected",
      providerCode: "AUTH_17",
    });
  });
});
