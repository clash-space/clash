import { describe, expect, it } from "vitest";

import { MODEL_UPSTREAM_ROUTES } from "./model-routing.js";

/**
 * A Google account is configured if it holds any one of the credentials Google accepts.
 *
 * The Provider declares three methods -- `ai-studio` takes an API key, `agent-platform-key` a key
 * and a region, `service-account` a JSON key -- and holding any one of them is a working account.
 *
 * `requiredCredentials` means *all* of these, so it cannot express the choice on its own. The
 * routing table already had the concept: `credentialRequirements.anyOf` lists credential sets, and
 * readiness passes when any one set is satisfied. Duplicating the route per credential expresses
 * the same thing and breaks something else -- one model then matches two conformance targets, and
 * the ambiguity check is right to refuse that.
 *
 * The eleven `google-agent-platform` routes this replaces invented a second upstream to carry the
 * second credential list, and carried no executor: a request that matched one found nothing to run,
 * our own gate demanded a service account, found none, and hilo-hub answered instead. The asset
 * looked exactly like a successful Google generation.
 */
const googleRoutes = (modelId: string) => MODEL_UPSTREAM_ROUTES
  .filter((route) => route.modelCode === modelId && route.upstreamId === "google-ai-studio");

describe("Google model routes", () => {
  it("states one route per model, so a model names one conformance target", () => {
    expect(googleRoutes("nano-banana-2")).toHaveLength(1);
  });

  it("accepts a service account as well as an api key", () => {
    const [route] = googleRoutes("nano-banana-2");
    expect(route?.credentialRequirements?.anyOf)
      .toEqual([["apiKey"], ["serviceAccountKey"]]);
  });

  it("points that route at the executor that runs it", () => {
    // A route with no executor is the failure mode this replaces: it matches, finds nothing to run,
    // and the request falls through to whatever else claims the model.
    const [route] = googleRoutes("nano-banana-2");
    expect(route?.executorPluginId).toBe("clash.google");
    expect(route?.executorExportId).toBe("google-execute");
  });

  it("routes Gemini Omni through the same executable Google provider", () => {
    const [route] = googleRoutes("gemini-omni-flash");
    expect(route?.executorPluginId).toBe("clash.google");
    expect(route?.executorExportId).toBe("google-execute");
  });
});
