import { describe, expect, it } from "vitest";

import {
  listModelUpstreamRoutes,
  resolveModelUpstreamRoute,
  type UpstreamAvailability,
} from "./model-routing";

describe("model upstream routing", () => {
  it("routes canonical Seedance model codes to fal-shaped mock endpoints", () => {
    const route = resolveModelUpstreamRoute({
      modelCode: "seedance-2-ref",
      kind: "video",
      allowMock: true,
      configuredUpstreams: [{ upstreamId: "mock", enabled: true }],
    });

    expect(route).toMatchObject({
      modelCode: "seedance-2-ref",
      upstreamId: "mock",
      upstreamModel: "bytedance/seedance-2.0/reference-to-video",
      apiShape: "fal",
    });
  });

  it("skips configured upstreams without required variables and falls back", () => {
    const upstreams: UpstreamAvailability[] = [
      { upstreamId: "fal", enabled: true, availableVariables: [] },
      { upstreamId: "google", enabled: true, availableVariables: ["GOOGLE_VERTEX"] },
    ];

    const route = resolveModelUpstreamRoute({
      modelCode: "gemini-flash-image-2",
      kind: "image",
      configuredUpstreams: upstreams,
    });

    expect(route).toMatchObject({
      upstreamId: "google",
      upstreamModel: "gemini-3.1-flash-image-preview",
    });
  });

  it("orders fallback candidates by user upstream order before route defaults", () => {
    const routes = listModelUpstreamRoutes({
      modelCode: "gemini-flash-image-2",
      kind: "image",
      configuredUpstreams: [
        { upstreamId: "fal", enabled: true, availableVariables: ["FAL_API_KEY"] },
        { upstreamId: "google", enabled: true, availableVariables: ["GOOGLE_VERTEX"] },
      ],
    });

    expect(routes.map((route) => route.upstreamId)).toEqual(["fal", "google"]);
  });

  it("keeps mock routes out of hosted resolution unless explicitly allowed", () => {
    const route = resolveModelUpstreamRoute({
      modelCode: "seedance-2-text",
      kind: "video",
      configuredUpstreams: [{ upstreamId: "mock", enabled: true }],
    });

    expect(route).toBeNull();
  });

  it("routes GPT Image 2 to the OpenAI image upstream with variables", () => {
    const route = resolveModelUpstreamRoute({
      modelCode: "gpt-image-2",
      kind: "image",
      configuredUpstreams: [
        { upstreamId: "openai", enabled: true, availableVariables: ["OPENAI_API_KEY"] },
      ],
    });

    expect(route).toMatchObject({
      modelCode: "gpt-image-2",
      upstreamId: "openai",
      upstreamModel: "gpt-image-2",
      apiShape: "openai-images",
      requiredVariables: ["OPENAI_API_KEY"],
    });
    expect(route).not.toHaveProperty("requiredSecretIds");
  });
});
