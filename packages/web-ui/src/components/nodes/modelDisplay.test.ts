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

  it("shows custom provider ids when no built-in preset exists", () => {
    expect(getModelProviderDisplay({
      isCustom: true,
      customDef: {
        id: "acme-render",
        name: "ACME Render",
        outputType: "video",
        parameters: [],
        runtime: "worker",
        secrets: [],
        promptModalities: ["text"],
        attachedProjects: ["*"],
        model: {
          provider: "acme-cloud",
          id: "acme/video-v1",
        },
      },
    })).toBe("acme-cloud");
  });
});
