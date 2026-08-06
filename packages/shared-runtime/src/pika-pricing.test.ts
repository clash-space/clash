import { describe, expect, it } from "vitest";

import {
  fetchPikaCatalogQuote,
  pikaBillingBasis,
  quotePikaCatalogRequest,
} from "./pika-pricing.js";

describe("Pika catalog pricing", () => {
  it("quotes per-second output using the matching parameter tier", () => {
    expect(quotePikaCatalogRequest({
      operation: "pika/pika-2.5/text-to-video",
      input: { prompt: "paper garden", resolution: "720p", duration_s: 5 },
      catalog: {
        api_id: "pika/pika-2.5/text-to-video",
        display_pricing: {
          components: [{
            role: "output",
            unit: { type: "second", quantity: 1, included: 0 },
            price_tiers: [
              { spec: { resolution: "720p", duration_s: 5 }, micro_usd: 40_000 },
              { spec: { resolution: "1080p", duration_s: 5 }, micro_usd: 90_000 },
            ],
          }],
        },
      },
    })).toEqual({
      estimatedCostMicroUsd: 200_000,
      complete: true,
      currency: "USD",
      pricingSource: "pika-catalog",
      components: [{ unitType: "second", quantity: 5, unitMicroUsd: 40_000, subtotalMicroUsd: 200_000 }],
    });
  });

  it("marks a quote partial when reference-video duration is unavailable", () => {
    expect(quotePikaCatalogRequest({
      operation: "minimax/h3/reference-to-video",
      input: { prompt: "@Video1", duration: 5, resolution: "2K", video_urls: ["https://pika.test/ref.mp4"] },
      catalog: {
        api_id: "minimax/h3/reference-to-video",
        display_pricing: {
          components: [
            {
              role: "output",
              unit: { type: "second", quantity: 1, included: 0 },
              price_tiers: [{ spec: { resolution: "2K" }, micro_usd: 130_000 }],
            },
            {
              role: "input",
              unit: { type: "video_input_second", quantity: 1, included: 0 },
              price_tiers: [{ spec: { resolution: "2K" }, micro_usd: 130_000 }],
            },
          ],
        },
      },
    })).toMatchObject({
      estimatedCostMicroUsd: 650_000,
      complete: false,
      pricingSource: "pika-catalog",
    });
  });

  it("keeps only non-sensitive price inputs in the billing basis", () => {
    expect(pikaBillingBasis({
      prompt: "secret campaign brief",
      image_url: "https://signed.example/input.png?token=secret",
      video_urls: ["https://signed.example/a.mp4", "https://signed.example/b.mp4"],
      resolution: "2K",
      duration: 5,
      num_images: 2,
      seed: 42,
    })).toEqual({
      resolution: "2K",
      duration: 5,
      num_images: 2,
      video_urls_count: 2,
    });
  });

  it("fetches a public catalog entry and returns an unavailable quote without blocking on catalog errors", async () => {
    const successFetch = async () => new Response(JSON.stringify({
      api_id: "pika/pika-2.5/text-to-video",
      display_pricing: { components: [] },
    }), { headers: { "content-type": "application/json" } });
    await expect(fetchPikaCatalogQuote({
      operation: "pika/pika-2.5/text-to-video",
      input: { duration_s: 5 },
      fetch: successFetch as typeof fetch,
    })).resolves.toMatchObject({ pricingSource: "pika-catalog", complete: true });

    await expect(fetchPikaCatalogQuote({
      operation: "pika/pika-2.5/text-to-video",
      input: { duration_s: 5 },
      fetch: (async () => { throw new Error("offline"); }) as typeof fetch,
    })).resolves.toEqual({
      estimatedCostMicroUsd: undefined,
      complete: false,
      currency: "USD",
      pricingSource: "unavailable",
      components: [],
    });
  });
});
