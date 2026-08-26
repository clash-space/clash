import { describe, expect, it } from "vitest";
import { CustomActionDefinitionSchema, ModelCardSchema, MODEL_CARDS } from "@clash/shared-types";

import {
  generationChoiceDefaults,
  listGenerationActionChoices,
} from "./generationActionChoices";

describe("Image Gen action-bar choices", () => {
  const builtIn = ModelCardSchema.parse({
    id: "built-in-image",
    name: "Built-in Image",
    provider: "Clash",
    kind: "image",
    parameters: [],
    defaultParams: {},
    defaultAspectRatio: "1:1",
    input: { requiresPrompt: true, inputMode: {}, promptModalities: ["text"] },
  });
  const codex = CustomActionDefinitionSchema.parse({
    id: "codex-imagegen",
    name: "Codex ImageGen",
    outputType: "image",
    parameters: [{
      id: "aspect_ratio",
      label: "Aspect Ratio",
      type: "select",
      options: [{ label: "Square", value: "1:1" }],
      defaultValue: "1:1",
    }],
    input: {
      requiresPrompt: true,
      inputMode: { images: { max: 5 } },
      promptModalities: ["text", "image"],
    },
  });
  const videoAction = CustomActionDefinitionSchema.parse({
    id: "custom-video",
    name: "Custom Video",
    outputType: "video",
  });

  it("embeds compatible image-output custom actions beside image models", () => {
    const choices = listGenerationActionChoices({
      outputKind: "image",
      models: [builtIn],
      customActions: [codex, videoAction],
      referenceCounts: { image: 1 },
    });

    expect(choices.map((choice) => choice.value)).toEqual([
      "model:built-in-image",
      "action:codex-imagegen",
    ]);
    expect(choices[1]).toMatchObject({ label: "Codex ImageGen", kind: "action" });
  });

  it("excludes a custom action when attached references exceed its Action Card contract", () => {
    expect(listGenerationActionChoices({
      outputKind: "image",
      models: [builtIn],
      customActions: [codex],
      referenceCounts: { image: 6 },
    }).map((choice) => choice.value)).toEqual(["model:built-in-image"]);
  });

  it("derives custom-action parameter defaults for a newly selected entry", () => {
    expect(generationChoiceDefaults(codex)).toEqual({ aspect_ratio: "1:1" });
  });

  it("keeps dialog and workspace actions hidden until the host has a renderer for them", () => {
    const dialogAction = CustomActionDefinitionSchema.parse({
      id: "dialog-image",
      name: "Dialog Image",
      outputType: "image",
      presentation: { type: "dialog", size: "lg" },
    });
    const workspaceAction = CustomActionDefinitionSchema.parse({
      id: "workspace-image",
      name: "Workspace Image",
      outputType: "image",
      presentation: {
        type: "workspace",
        resourceUri: "ui://acme/workspace-image",
      },
    });

    expect(listGenerationActionChoices({
      outputKind: "image",
      models: [builtIn],
      customActions: [codex, dialogAction, workspaceAction],
    }).map((choice) => choice.value)).toEqual([
      "model:built-in-image",
      "action:codex-imagegen",
    ]);
  });

  it("shows every FLUX 3 model card as an independent choice", () => {
    const fluxCards = MODEL_CARDS.filter((model) => model.id.startsWith("flux-3-video"));
    const choices = listGenerationActionChoices({
      outputKind: "video",
      models: fluxCards,
      customActions: [],
    });

    expect(choices.map((choice) => choice.value)).toEqual([
      "model:flux-3-video",
      "model:flux-3-video-keyframes",
      "model:flux-3-video-continue",
    ]);
    expect(choices.map((choice) => choice.label)).toEqual([
      "FLUX 3 Video",
      "FLUX 3 Video (Keyframes)",
      "FLUX 3 Video (Continue)",
    ]);
  });

  it("lists 3D model cards through the same model choice contract", () => {
    const modelCard = MODEL_CARDS.find((model) => model.kind === "model");
    expect(modelCard).toBeDefined();

    const choices = listGenerationActionChoices({
      outputKind: "model",
      models: [modelCard!],
      customActions: [],
    });

    expect(choices).toEqual([
      expect.objectContaining({
        kind: "model",
        value: `model:${modelCard!.id}`,
        model: modelCard,
      }),
    ]);
  });
});
