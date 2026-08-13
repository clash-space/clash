import { describe, expect, it } from "vitest";

import {
  applyModelProviderImplementation,
  type ModelUpstreamRoute,
} from "./model-routing.js";
import { MODEL_CARDS } from "./models.js";

function card(id: string) {
  const model = MODEL_CARDS.find((candidate) => candidate.id === id);
  if (!model) throw new Error(`Missing model card ${id}`);
  return model;
}

function pikaCard(id: string) {
  const model = card(id);
  const route = model.providerImplementations?.find(
    (candidate) => candidate.providerId === "pika",
  );
  if (!route) throw new Error(`Missing Pika route for ${id}`);
  return applyModelProviderImplementation(model, route as ModelUpstreamRoute);
}

function selectValues(modelId: string, parameterId: string) {
  return parameter(modelId, parameterId).options?.map((option) => option.value);
}

function parameter(modelId: string, parameterId: string) {
  const found = pikaCard(modelId).parameters.find(
    (candidate) => candidate.id === parameterId,
  );
  if (!found) throw new Error(`Missing Pika ${modelId}.${parameterId}`);
  return found;
}

describe("Pika live catalog model parameters", () => {
  // Parameter literals below were checked against the public
  // https://api.dev.pika.art/catalog/apis/{api_id}?expand=inputs schemas on
  // 2026-08-13. They are upstream facts, not values copied from models.ts.
  it("declares URL-first media delivery with a byte fallback", () => {
    const routes = MODEL_CARDS.flatMap(
      (model) => model.providerImplementations ?? [],
    ).filter((route) => route.providerId === "pika");
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) {
      expect(route.assetInputs).toContainEqual({
        match: { kinds: ["image", "video", "audio"] },
        representations: ["provider-url", "bytes"],
      });
    }
  });

  it("uses Pika's literal Nano Banana 2 resolution names and single-image count", () => {
    expect(selectValues("nano-banana-2", "resolution")).toEqual([
      "512",
      "1K",
      "2K",
      "4K",
    ]);
    expect(
      pikaCard("nano-banana-2").parameters.find(
        (parameter) => parameter.id === "count",
      ),
    ).toMatchObject({ min: 1, max: 1, defaultValue: 1 });
  });

  it("uses Seedream 5 Pro's size field and current 1K/2K menu", () => {
    expect(selectValues("seedream-5-pro", "size")).toEqual(["1K", "2K"]);
    expect(
      pikaCard("seedream-5-pro").parameters.some(
        (parameter) => parameter.id === "resolution",
      ),
    ).toBe(false);
  });

  it("uses Pika 2.5's endpoint-specific duration union and catalog resolution default", () => {
    expect(selectValues("pika-2.5", "duration")).toEqual([5, 10]);
    expect(parameter("pika-2.5", "resolution")).toMatchObject({
      options: [
        { label: "720p", value: "720p" },
        { label: "1080p", value: "1080p" },
      ],
      defaultValue: "1080p",
    });
  });

  it("uses GPT Image 2's Pika-specific domains and hides absent parameters", () => {
    expect(selectValues("gpt-image-2", "aspect_ratio")).toEqual([
      "1:1",
      "2:3",
      "3:2",
      "3:4",
      "4:3",
      "4:5",
      "5:4",
      "9:16",
      "16:9",
      "21:9",
    ]);
    expect(selectValues("gpt-image-2", "resolution")).toEqual([
      "1K",
      "2K",
      "4K",
    ]);
    expect(parameter("gpt-image-2", "resolution").defaultValue).toBe("1K");
    expect(parameter("gpt-image-2", "quality").defaultValue).toBe("medium");
    expect(selectValues("gpt-image-2", "background")).toEqual([
      "auto",
      "opaque",
      "transparent",
    ]);
    expect(parameter("gpt-image-2", "count")).toMatchObject({
      min: 1,
      max: 10,
      defaultValue: 1,
    });
    expect(
      pikaCard("gpt-image-2").parameters.some(
        (parameter) => parameter.id === "moderation",
      ),
    ).toBe(false);
  });

  it("exposes Grok Imagine's current resolution, count, and reference limits", () => {
    expect(selectValues("grok-imagine-quality", "resolution")).toEqual([
      "1K",
      "2K",
    ]);
    expect(
      pikaCard("grok-imagine-quality").parameters.find(
        (parameter) => parameter.id === "count",
      ),
    ).toMatchObject({ min: 1, max: 10, defaultValue: 1 });
    expect(pikaCard("grok-imagine-quality").input.inputMode.images?.max).toBe(
      3,
    );
  });

  it("models Grok Imagine Video 1.5 as one required image with the catalog range", () => {
    expect(parameter("grok-imagine-video-1.5", "duration")).toMatchObject({
      type: "number",
      min: 1,
      max: 15,
      step: 1,
      defaultValue: 6,
    });
    expect(parameter("grok-imagine-video-1.5", "resolution")).toMatchObject({
      options: [
        { label: "480p", value: "480p" },
        { label: "720p", value: "720p" },
      ],
      defaultValue: "720p",
    });
    expect(pikaCard("grok-imagine-video-1.5").input.inputMode).toEqual({
      images: { min: 1, max: 1 },
    });
  });

  it("uses Pika's complete Seedance 2.0 duration and resolution domains", () => {
    expect(selectValues("seedance-2-startend", "duration")).toEqual([
      "auto",
      4,
      5,
      6,
      7,
      8,
      9,
      10,
      11,
      12,
      13,
      14,
      15,
    ]);
    expect(selectValues("seedance-2-startend", "resolution")).toEqual([
      "480p",
      "720p",
      "1080p",
      "4k",
    ]);
    expect(selectValues("seedance-2-ref", "aspect_ratio")).toEqual([
      "adaptive",
      "21:9",
      "16:9",
      "4:3",
      "1:1",
      "3:4",
      "9:16",
    ]);
  });

  it("does not offer FLUX controls absent from Pika and defaults Kling audio off", () => {
    expect(
      pikaCard("flux-3-video").parameters.some(
        (candidate) => candidate.id === "safety_tolerance",
      ),
    ).toBe(false);
    expect(pikaCard("kling-3").defaultParams.generate_audio).toBe(false);
  });

  it("requires a caller-selected MiniMax Speech voice instead of inventing one", () => {
    expect(parameter("minimax-speech-2.8-hd", "voice_id")).toMatchObject({
      type: "text",
      required: true,
    });
    expect(
      parameter("minimax-speech-2.8-hd", "voice_id").defaultValue,
    ).toBeUndefined();
  });

  it("does not expose a duration control unsupported by Lyria's endpoint", () => {
    expect(pikaCard("lyria-3-pro").parameters).toEqual([]);
  });
});
