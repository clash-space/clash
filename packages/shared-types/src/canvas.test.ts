import { describe, it, expect } from "vitest";
import {
  buildPendingAssetNode,
  CustomActionDefinitionSchema,
  CustomActionParameterSchema,
  NodeDataSchema,
  ACTION_TYPE,
  isCustomActionType,
  getCustomActionId,
} from "./canvas";

describe("ACTION_TYPE", () => {
  it("has Custom type", () => {
    expect(ACTION_TYPE.Custom).toBe("custom");
  });

  it("has built-in audio and text generation types", () => {
    expect(ACTION_TYPE.AudioGen).toBe("audio-gen");
    expect(ACTION_TYPE.TextGen).toBe("text-gen");
  });
});

describe("isCustomActionType", () => {
  it("returns true for custom: prefix", () => {
    expect(isCustomActionType("custom:style-transfer")).toBe(true);
    expect(isCustomActionType("custom:bg-remove")).toBe(true);
  });

  it("returns false for built-in types", () => {
    expect(isCustomActionType("image-gen")).toBe(false);
    expect(isCustomActionType("video-gen")).toBe(false);
    expect(isCustomActionType("audio-gen")).toBe(false);
    expect(isCustomActionType("text-gen")).toBe(false);
  });
});

describe("getCustomActionId", () => {
  it("strips custom: prefix", () => {
    expect(getCustomActionId("custom:style-transfer")).toBe("style-transfer");
    expect(getCustomActionId("custom:bg-remove")).toBe("bg-remove");
  });
});

describe("NodeDataSchema", () => {
  it("accepts customActionId and customActionParams", () => {
    const data = NodeDataSchema.parse({
      actionType: "custom:style-transfer",
      customActionId: "style-transfer",
      customActionParams: { style: "oil", strength: 0.5 },
    });
    expect(data.customActionId).toBe("style-transfer");
    expect(data.customActionParams).toEqual({ style: "oil", strength: 0.5 });
  });

  it("accepts any string as actionType (not just enum)", () => {
    const data = NodeDataSchema.parse({
      actionType: "custom:my-action",
    });
    expect(data.actionType).toBe("custom:my-action");
  });

  it("still accepts built-in actionTypes", () => {
    const data = NodeDataSchema.parse({ actionType: "image-gen" });
    expect(data.actionType).toBe("image-gen");
  });
});

describe("buildPendingAssetNode", () => {
  it("builds a pending audio node for audio generation", () => {
    const node = buildPendingAssetNode({
      nodeId: "aud-1",
      prompt: "Read this line out loud",
      modelId: "minimax-tts",
      modelParams: { voice_id: "female-warm" },
      actionType: ACTION_TYPE.AudioGen,
    });

    expect(node.type).toBe("audio");
    expect(node.data).toMatchObject({
      label: "Read this line out loud",
      status: "pending",
      prompt: "Read this line out loud",
      model: "minimax-tts",
      modelId: "minimax-tts",
      modelParams: { voice_id: "female-warm" },
    });
  });

  it("builds a pending text node for text generation", () => {
    const node = buildPendingAssetNode({
      nodeId: "txt-1",
      prompt: "Write a tagline",
      modelId: "gpt-5.4",
      modelParams: {},
      actionType: ACTION_TYPE.TextGen,
    });

    expect(node.type).toBe("text");
    expect(node.data).toMatchObject({
      label: "Write a tagline",
      content: "",
      status: "pending",
      prompt: "Write a tagline",
      model: "gpt-5.4",
      modelId: "gpt-5.4",
    });
  });
});

describe("CustomActionParameterSchema", () => {
  it("parses a slider parameter", () => {
    const param = CustomActionParameterSchema.parse({
      id: "strength",
      label: "Strength",
      type: "slider",
      min: 0,
      max: 1,
      step: 0.1,
      defaultValue: 0.7,
    });
    expect(param.id).toBe("strength");
    expect(param.type).toBe("slider");
    expect(param.min).toBe(0);
  });

  it("parses a select parameter with options", () => {
    const param = CustomActionParameterSchema.parse({
      id: "style",
      label: "Style",
      type: "select",
      options: [
        { label: "Oil Painting", value: "oil" },
        { label: "Watercolor", value: "watercolor" },
      ],
    });
    expect(param.options).toHaveLength(2);
  });
});

describe("CustomActionDefinitionSchema", () => {
  it("parses a minimal action definition", () => {
    const def = CustomActionDefinitionSchema.parse({
      id: "echo",
      name: "Echo",
      outputType: "text",
    });
    expect(def.id).toBe("echo");
    expect(def.parameters).toEqual([]);
    expect(def.promptModalities).toEqual(["text"]);
    expect(def.runtime).toBe("local");
  });

  it("parses a full action definition with all fields", () => {
    const def = CustomActionDefinitionSchema.parse({
      id: "style-transfer",
      name: "Style Transfer",
      description: "Apply artistic style",
      outputType: "image",
      parameters: [
        { id: "style", label: "Style", type: "select" },
      ],
      icon: "🎨",
      color: "#8B5CF6",
      runtime: "worker",
      version: "1.0.0",
      author: "testuser",
      repository: "github:user/repo",
      workerUrl: "https://style.workers.dev",
      promptModalities: ["text", "image"],
      secrets: [{ id: "FAL_API_KEY", label: "FAL Key" }],
      tags: ["image", "style"],
    });
    expect(def.runtime).toBe("worker");
    expect(def.promptModalities).toEqual(["text", "image"]);
    expect(def.secrets).toHaveLength(1);
    expect(def.tags).toEqual(["image", "style"]);
  });

  it("defaults promptModalities to ['text']", () => {
    const def = CustomActionDefinitionSchema.parse({
      id: "test",
      name: "Test",
      outputType: "image",
    });
    expect(def.promptModalities).toEqual(["text"]);
  });
});
