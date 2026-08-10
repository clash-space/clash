import { describe, expect, it } from "vitest";

import {
  applyModelParameterChange,
  coerceModelParameterInput,
  normalizeModelParametersForCard,
  validateModelCardConfiguration,
} from "./model-constraints";
import { MODEL_CARDS, ModelCardSchema } from "./models";

function card(id: string) {
  const value = MODEL_CARDS.find((candidate) => candidate.id === id);
  if (!value) throw new Error(`Missing model card: ${id}`);
  return value;
}

describe("declarative model-card configuration constraints", () => {
  it("validates MiniMax Music 3 prompt and lyrics requirements from one card contract", () => {
    const model = card("minimax-music-3");

    expect(validateModelCardConfiguration(model, {
      prompt: "",
      lyrics: "",
      modelParams: { lyrics_optimizer: false, is_instrumental: false },
    })).toMatch(/lyrics.*required/i);

    expect(validateModelCardConfiguration(model, {
      prompt: "",
      lyrics: "",
      modelParams: { lyrics_optimizer: true, is_instrumental: false },
    })).toBeNull();

    expect(validateModelCardConfiguration(model, {
      prompt: "",
      lyrics: "",
      modelParams: { lyrics_optimizer: false, is_instrumental: true },
    })).toMatch(/prompt.*required/i);

    expect(validateModelCardConfiguration(model, {
      prompt: "Instrumental post-rock with a slow crescendo",
      lyrics: "",
      modelParams: { lyrics_optimizer: false, is_instrumental: true },
    })).toBeNull();
  });

  it("enforces user-visible string limits and parameter candidates", () => {
    const model = card("minimax-music-3");

    expect(validateModelCardConfiguration(model, {
      prompt: "P".repeat(2001),
      lyrics: "[Verse]\nHello",
      modelParams: { lyrics_optimizer: false, is_instrumental: false },
    })).toMatch(/prompt.*2000/i);
    expect(validateModelCardConfiguration(model, {
      prompt: "Dream pop",
      lyrics: "L".repeat(3501),
      modelParams: { lyrics_optimizer: false, is_instrumental: false },
    })).toMatch(/lyrics.*3500/i);
    expect(validateModelCardConfiguration(model, {
      prompt: "Dream pop",
      lyrics: "[Verse]\nHello",
      modelParams: {
        lyrics_optimizer: false,
        is_instrumental: false,
        sample_rate: 48_000,
      },
    })).toMatch(/sample rate.*candidate/i);
  });

  it("rejects model parameters that the Card does not declare", () => {
    const model = card("nano-banana-2-lite");

    expect(validateModelCardConfiguration(model, {
      prompt: "A paper city at night",
      modelParams: { aspect_ratio: "16:9", unsupported_knob: 1 },
    }, { rejectUnknownParameters: true })).toMatch(/unsupported_knob.*not declared/i);
  });

  it("coerces external values to the exact candidate type declared by each Card", () => {
    // Both directions matter. `safety_tolerance` genuinely declares string
    // candidates, while durations are numeric seconds in every card.
    expect(coerceModelParameterInput(card("flux-2-pro"), "safety_tolerance", 3)).toBe("3");
    expect(coerceModelParameterInput(card("kling-3"), "duration", "10")).toBe(10);
    expect(coerceModelParameterInput(card("veo-3.1-fast"), "duration", "6")).toBe(6);
    expect(coerceModelParameterInput(card("veo-3.1-fast"), "generate_audio", "false")).toBe(false);
  });

  it("normalizes mutually-exclusive booleans at edit time and rejects invalid external payloads", () => {
    const model = card("minimax-music-3");
    const next = applyModelParameterChange(model, {
      lyrics_optimizer: true,
      is_instrumental: false,
    }, "is_instrumental", true);

    expect(next).toMatchObject({ lyrics_optimizer: false, is_instrumental: true });
    expect(validateModelCardConfiguration(model, {
      prompt: "Ambient instrumental",
      lyrics: "",
      modelParams: { lyrics_optimizer: true, is_instrumental: true },
    })).toMatch(/cannot be enabled together/i);
  });

  it("falls back to card defaults when a provider switch invalidates stored candidates", () => {
    const model = {
      ...card("seedance-2-ref"),
      parameters: [
        {
          id: "duration",
          label: "Duration",
          type: "select" as const,
          required: false,
          options: [{ label: "5s", value: 5 }, { label: "6s", value: 6 }],
          defaultValue: 5,
        },
        {
          id: "resolution",
          label: "Resolution",
          type: "select" as const,
          required: false,
          options: [{ label: "720p", value: "720p" }],
          defaultValue: "720p",
        },
      ],
      defaultParams: { duration: 5, resolution: "720p" },
    };

    expect(normalizeModelParametersForCard(model, {
      duration: "auto",
      resolution: "4k",
      provider_id: "volcengine",
    })).toEqual({
      duration: 5,
      resolution: "720p",
      provider_id: "volcengine",
    });
  });

  it("keeps provider-fixed parameters visible but immutable", () => {
    const model = card("gemini-omni-flash");

    expect(validateModelCardConfiguration(model, {
      prompt: "A paper kite crosses the evening sky",
      modelParams: { resolution: "1080p" },
    })).toMatch(/resolution.*fixed/i);
    expect(applyModelParameterChange(model, model.defaultParams, "frame_rate", 30))
      .toMatchObject({ frame_rate: 24 });
    expect(normalizeModelParametersForCard(model, {
      ...model.defaultParams,
      native_audio: false,
    })).toMatchObject({ native_audio: true });
  });

  it("rejects malformed configurable candidates and dangling constraint fields when cards are built", () => {
    const template = card("gemini-omni-flash");
    const invalid = {
      ...template,
      parameters: [
        {
          id: "quality",
          label: "Quality",
          type: "select",
          options: [{ label: "High", value: "high" }],
          defaultValue: "ultra",
        },
        {
          id: "quality",
          label: "Duplicate quality",
          type: "select",
          options: [],
        },
      ],
      defaultParams: { quality: "medium" },
      constraints: [{
        type: "required",
        field: "modelParams.missing",
        when: [],
      }],
    };

    const parsed = ModelCardSchema.safeParse(invalid);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues.map((issue) => issue.message)).toEqual(expect.arrayContaining([
      expect.stringMatching(/parameter ids must be unique/i),
      expect.stringMatching(/select parameters require at least one candidate/i),
      expect.stringMatching(/default.*configured candidates/i),
      expect.stringMatching(/constraint.*declared parameter/i),
    ]));
  });
});
