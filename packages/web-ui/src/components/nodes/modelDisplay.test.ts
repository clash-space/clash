import { describe, expect, it } from "vitest";
import type { ModelCard } from "@clash/shared-types";
import { getModelDropdownSecondaryText, getModelProviderDisplay } from "./modelDisplay";

describe("model display", () => {
  it("hides provider labels for built-in models", () => {
    const selectedModel = { provider: "fal.ai" } as ModelCard;

    expect(getModelProviderDisplay({ isCustom: false, selectedModel })).toBe("");
    expect(getModelDropdownSecondaryText(true)).toBeNull();
  });

  it("keeps the incompatible-ref warning in the model dropdown", () => {
    expect(getModelDropdownSecondaryText(false)).toBe("clears current refs");
  });
});
