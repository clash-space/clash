import { afterEach, describe, it, expect, vi } from "vitest";
import { LoroDoc } from "loro-crdt";
import {
  ACTION_PROVIDER_PRESETS,
  buildPendingAssetNode,
  CustomActionDefinitionSchema,
  CustomActionParameterSchema,
  normalizeActionProviderId,
  NodeDataSchema,
  ACTION_TYPE,
  RF_NODE_TYPE,
  isCustomActionType,
  getCustomActionId,
} from "./canvas";
import { Canvas } from "./canvas-ops";

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

describe("Canvas.execute", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls crypto.randomUUID with the crypto receiver", () => {
    const doc = new LoroDoc();
    const canvas = new Canvas(doc, () => {});
    const fakeCrypto = {
      randomUUID() {
        if (this !== fakeCrypto) {
          throw new TypeError("randomUUID receiver lost");
        }
        return "12345678-1234-4234-8234-123456789abc";
      },
    };

    vi.stubGlobal("crypto", fakeCrypto);

    const result = canvas.createNode("img1", "image_gen", { label: "Img" });

    expect(result.error).toBeNull();
    expect(result.asset_id).toBe("12345678");
  });

  it("allows image-only custom actions to execute without a text prompt", () => {
    const doc = new LoroDoc();
    const canvas = new Canvas(doc, () => {});

    doc.getMap("customActions").set("grid-split", {
      id: "grid-split",
      name: "Grid Split",
      outputType: "image",
      promptModalities: ["image"],
      runtime: "local",
      parameters: [
        { id: "rows", label: "Rows", type: "number" },
        { id: "cols", label: "Columns", type: "number" },
      ],
    });

    canvas.insertNode(
      "source-image",
      RF_NODE_TYPE.Image,
      { assetId: "asset-grid", label: "Grid" },
      null,
      { x: 0, y: 0 },
    );
    canvas.insertNode(
      "split-action",
      RF_NODE_TYPE.ActionBadge,
      {
        actionType: "custom:grid-split",
        customActionId: "grid-split",
        customActionParams: { rows: 2, cols: 2 },
        referenceImageOrder: ["source-image"],
      },
      null,
      { x: 160, y: 0 },
    );
    canvas.insertEdge("source-image-split-action", "source-image", "split-action");

    const result = canvas.execute("split-action", () => "pending-split");

    expect(result.error).toBeNull();
    expect(result.kind).toBe("generation");
    expect(result.childNodeId).toBe("pending-split");

    const pending = canvas.readNode("pending-split");
    expect(pending?.type).toBe(RF_NODE_TYPE.Image);
    expect(pending?.data).toMatchObject({
      actionType: "custom:grid-split",
      customActionId: "grid-split",
      customActionParams: { rows: 2, cols: 2 },
      outputType: "image",
      prompt: "",
      referenceImageAssetIds: ["asset-grid"],
      status: "pending",
    });
  });

  it("carries actor attribution from action-badges into generated children", () => {
    const doc = new LoroDoc();
    const canvas = new Canvas(doc, () => {});

    doc.getMap("customActions").set("grid-split", {
      id: "grid-split",
      name: "Grid Split",
      outputType: "image",
      promptModalities: ["image"],
      runtime: "local",
      parameters: [],
    });

    canvas.insertNode(
      "source-image",
      RF_NODE_TYPE.Image,
      { assetId: "asset-grid", label: "Grid" },
      null,
      { x: 0, y: 0 },
    );
    canvas.insertNode(
      "split-action",
      RF_NODE_TYPE.ActionBadge,
      {
        actionType: "custom:grid-split",
        customActionId: "grid-split",
        actorType: "agent",
        actorUserId: "user-1",
        actorAgentId: "agent-1",
      },
      null,
      { x: 160, y: 0 },
    );
    canvas.insertEdge("source-image-split-action", "source-image", "split-action");

    const result = canvas.execute("split-action", () => "pending-split");

    expect(result.error).toBeNull();
    expect(canvas.readNode("pending-split")?.data).toMatchObject({
      actorType: "agent",
      actorUserId: "user-1",
      actorAgentId: "agent-1",
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

  it("normalizes common MaaS provider aliases and adds the provider key", () => {
    const def = CustomActionDefinitionSchema.parse({
      id: "replicate-upscale",
      name: "Replicate Upscale",
      outputType: "image",
      model: {
        provider: "replica",
        id: "nightmareai/real-esrgan",
      },
    });

    expect(def.model?.provider).toBe("replicate");
    expect(def.model?.id).toBe("nightmareai/real-esrgan");
    expect(def.secrets).toContainEqual({
      id: "REPLICATE_API_TOKEN",
      label: "Replicate API token",
      description: "API key used to call the Replicate model provider.",
      required: true,
    });
  });

  it("uses explicit model secret ids and de-duplicates existing secrets", () => {
    const def = CustomActionDefinitionSchema.parse({
      id: "official-openai-image",
      name: "Official OpenAI Image",
      outputType: "image",
      model: {
        provider: "official",
        id: "gpt-image-1",
        secretId: "OPENAI_API_KEY",
      },
      secrets: [
        { id: "OPENAI_API_KEY", label: "OpenAI key from manifest" },
      ],
    });

    expect(def.secrets).toEqual([
      { id: "OPENAI_API_KEY", label: "OpenAI key from manifest", required: true },
    ]);
  });

  it("allows custom provider model bindings for serverless function hosts", () => {
    const def = CustomActionDefinitionSchema.parse({
      id: "acme-render",
      name: "ACME Render",
      outputType: "video",
      runtime: "worker",
      workerUrl: "https://acme-render.example.com/generate",
      model: {
        provider: "acme-cloud",
        id: "acme/video-v1",
        name: "ACME Video v1",
        secretId: "ACME_API_KEY",
        apiShape: "serverless-function",
        endpoint: "/generate",
      },
    });

    expect(def.model).toMatchObject({
      provider: "acme-cloud",
      id: "acme/video-v1",
      apiShape: "serverless-function",
      endpoint: "/generate",
    });
    expect(def.secrets).toContainEqual({
      id: "ACME_API_KEY",
      label: "ACME Cloud API key",
      description: "API key used to call the ACME Cloud model provider.",
      required: true,
    });
  });

  it("exposes built-in provider presets for key configuration UI", () => {
    expect(normalizeActionProviderId("fal.ai")).toBe("fal");
    expect(ACTION_PROVIDER_PRESETS.fal.defaultSecretId).toBe("FAL_API_KEY");
    expect(ACTION_PROVIDER_PRESETS.replicate.defaultSecretId).toBe("REPLICATE_API_TOKEN");
    expect(ACTION_PROVIDER_PRESETS.kie.defaultSecretId).toBe("KIE_API_KEY");
    expect(ACTION_PROVIDER_PRESETS.official.defaultSecretId).toBe("OFFICIAL_API_KEY");
  });
});
