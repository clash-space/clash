import { describe, expect, it } from "vitest";

import { googleModelPath } from "./model-path.js";

/**
 * The full address of a model, on either Google.
 *
 * `googleBaseUrl` already returns a host with its API version on it, and `modelPath` appended a
 * second one -- so an Agent Platform account asked for `/v1/v1/publishers/...` and Google answered
 * 404 with an empty body, which the plugin reported as "non-JSON response".
 *
 * They also do not share a path shape. AI Studio addresses a model globally. Agent Platform
 * addresses it inside a project and a location, so the project id -- which is in the service
 * account key, not in any form the user filled -- is part of the URL.
 */
describe("googleModelPath", () => {
  it("addresses an AI Studio model globally", () => {
    expect(
      googleModelPath({
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        model: "gemini-3.1-flash-image",
      }),
    ).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent",
    );
  });

  it("addresses an Agent Platform model inside its project and location", () => {
    expect(
      googleModelPath({
        baseUrl: "https://us-central1-aiplatform.googleapis.com/v1",
        model: "gemini-3.1-flash-image",
        projectId: "agentspit-494510",
        location: "us-central1",
      }),
    ).toBe(
      "https://us-central1-aiplatform.googleapis.com/v1/projects/agentspit-494510" +
        "/locations/us-central1/publishers/google/models/gemini-3.1-flash-image:generateContent",
    );
  });

  it("does not repeat the api version already on the base url", () => {
    // The 404. `/v1/v1/publishers/...` is a real address shape that simply does not exist.
    expect(
      googleModelPath({
        baseUrl: "https://aiplatform.googleapis.com/v1",
        model: "m",
        projectId: "p",
        location: "global",
      }),
    ).not.toMatch(/\/v1\/v1\//);
  });

  it("addresses Agent Platform Express without a project", () => {
    // Express mode authenticates with an API key and deliberately has no project segment.
    // Requiring the service-account project here made the declared API-key method unreachable.
    expect(
      googleModelPath({
        baseUrl: "https://aiplatform.googleapis.com/v1",
        model: "m",
        location: "global",
      }),
    ).toBe(
      "https://aiplatform.googleapis.com/v1/publishers/google/models/m:generateContent",
    );
  });
});
