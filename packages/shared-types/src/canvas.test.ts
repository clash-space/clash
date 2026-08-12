import { afterEach, describe, it, expect, vi } from "vitest";
import { LoroDoc } from "loro-crdt";
import {
  ACTION_PROVIDER_PRESETS,
  buildGenerationPayload,
  buildPendingAssetNode,
  CustomActionDefinitionSchema,
  CustomActionParameterSchema,
  normalizeActionProviderId,
  NodeDataSchema,
  ACTION_TYPE,
  AGENT_NODE_TYPE_MAP,
  RF_NODE_TYPE,
  isCustomActionType,
  getCustomActionId,
} from "./canvas.js";
import { Canvas } from "./canvas-ops.js";
import { MODEL_CARDS, ModelCardSchema } from "./models.js";

describe("ACTION_TYPE", () => {
  it("has Custom type", () => {
    expect(ACTION_TYPE.Custom).toBe("custom");
  });

  it("has built-in audio and text generation types", () => {
    expect(ACTION_TYPE.AudioGen).toBe("audio-gen");
    expect(ACTION_TYPE.TextGen).toBe("text-gen");
  });
});

describe("Remotion component canvas node contract", () => {
  it("exposes a distinct agent and ReactFlow node type", () => {
    expect(RF_NODE_TYPE.RemotionComponent).toBe("remotion-component");
    expect(AGENT_NODE_TYPE_MAP.remotion).toEqual({
      rfType: "remotion-component",
    });
  });

  it("stores the editable TSX source and preview configuration on the node", () => {
    const parsed = NodeDataSchema.parse({
      label: "Greeting character",
      content: "export default function Greeting(){ return <div>Hello</div>; }",
      componentId: "greeting-character",
      compositionWidth: 720,
      compositionHeight: 1280,
      fps: 30,
      durationInFrames: 120,
    });

    expect(parsed.componentId).toBe("greeting-character");
    expect(parsed.compositionWidth).toBe(720);
    expect(parsed.compositionHeight).toBe(1280);
    expect(parsed.fps).toBe(30);
    expect(parsed.durationInFrames).toBe(120);
  });
});

describe("buildGenerationPayload", () => {
  it("rejects undeclared built-in model parameters before creating a pending asset", () => {
    const modelCard = MODEL_CARDS.find((card) => card.id === "nano-banana-2-lite");
    expect(modelCard).toBeDefined();

    const result = buildGenerationPayload({
      prompt: "A paper city at night",
      refNodes: [],
      configId: modelCard!.id,
      config: {
        kind: "model",
        modelCard,
        modelParams: { aspect_ratio: "16:9", unsupported_knob: 1 },
      },
      actionType: "image-gen",
    });

    expect(result.validationError).toMatch(/unsupported_knob.*not declared/i);
  });

  it("validates executable custom-action parameters and declarative constraints", () => {
    const customDef = CustomActionDefinitionSchema.parse({
      id: "custom-image",
      name: "Custom Image",
      outputType: "image",
      parameters: [{
        id: "quality",
        label: "Quality",
        type: "select",
        required: true,
        options: [{ label: "High", value: "high" }],
        defaultValue: "high",
      }],
      input: {
        requiresPrompt: true,
        inputMode: { images: { max: 1 } },
        promptModalities: ["text", "image"],
      },
      constraints: [{ type: "max-length", field: "prompt", max: 8, message: "Prompt too long." }],
    });

    const invalidCandidate = buildGenerationPayload({
      prompt: "short",
      refNodes: [],
      configId: customDef.id,
      config: { kind: "custom", customDef, customActionParams: { quality: "draft" } },
      actionType: "custom:custom-image",
    });
    const invalidConstraint = buildGenerationPayload({
      prompt: "longer than eight",
      refNodes: [],
      configId: customDef.id,
      config: { kind: "custom", customDef, customActionParams: { quality: "high" } },
      actionType: "custom:custom-image",
    });

    expect(invalidCandidate.validationError).toMatch(/configured candidates/i);
    expect(invalidConstraint.validationError).toBe("Prompt too long.");
  });

  it("preserves authored inline reference order in the pending prompt", () => {
    const modelCard = MODEL_CARDS.find((card) => card.id === "gpt-5.4");
    expect(modelCard).toBeDefined();
    const authoredPrompt = "Compare @[First](node:image-a), then explain @[Second](node:image-b).";

    const result = buildGenerationPayload({
      prompt: authoredPrompt,
      refNodes: [
        { type: "image", data: { assetId: "asset-a" } },
        { type: "image", data: { assetId: "asset-b" } },
      ],
      configId: modelCard!.id,
      config: { kind: "model", modelCard, modelParams: {} },
      actionType: "text-gen",
    });

    expect(result.cleanedPrompt).toBe("Compare First, then explain Second.");
    expect(result.pendingInput.prompt).toBe(authoredPrompt);
    expect(result.pendingInput.referenceImageAssetIds).toEqual(["asset-a", "asset-b"]);
  });

  it("ignores legacy lyrics references and only sends directly entered Lyrics", () => {
    const modelCard = MODEL_CARDS.find((card) => card.id === "minimax-music-3");
    expect(modelCard).toBeDefined();

    const result = buildGenerationPayload({
      prompt: "Dreamy synth pop with a restrained vocal",
      refNodes: [{
        type: "text",
        data: { content: "Keep the production intimate" },
      }],
      lyrics: "[Verse]\nNeon rain on the window",
      lyricsRefNodes: [{
        type: "text",
        data: { content: "[Chorus]\nStay until the morning" },
      }],
      configId: modelCard!.id,
      config: {
        kind: "model",
        modelCard,
        modelParams: { lyrics_optimizer: false, is_instrumental: false },
      },
      actionType: "audio-gen",
    } as any);

    expect(result.validationError).toBeNull();
    expect(result.cleanedPrompt).toBe(
      "Dreamy synth pop with a restrained vocal\n\nKeep the production intimate",
    );
    expect(result.pendingInput.prompt).toBe(result.cleanedPrompt);
    expect(result.pendingInput.modelParams).toMatchObject({
      lyrics: "[Verse]\nNeon rain on the window",
      lyrics_optimizer: false,
      is_instrumental: false,
    });
  });

  it("validates the MiniMax Music 3 lyrics limit on connected Text nodes", () => {
    const modelCard = MODEL_CARDS.find((card) => card.id === "minimax-music-3");
    expect(modelCard).toBeDefined();

    const result = buildGenerationPayload({
      prompt: "Dreamy synth pop",
      refNodes: [],
      lyrics: "L".repeat(3501),
      configId: modelCard!.id,
      config: { kind: "model", modelCard, modelParams: {} },
      actionType: "audio-gen",
    });

    expect(result.validationError).toBe("Lyrics accept at most 3500 characters.");
  });

  it("maps Suno text references into custom-mode lyrics while using the prompt as style", () => {
    const modelCard = MODEL_CARDS.find((card) => card.id === "suno-v5.5");
    expect(modelCard).toBeDefined();

    const result = buildGenerationPayload({
      prompt: "Nocturnal synth-pop with warm analog pads",
      refNodes: [],
      lyrics: "[Verse]\nLast train through the rain",
      configId: modelCard!.id,
      config: {
        kind: "model",
        modelCard,
        modelParams: { instrumental: false },
      },
      actionType: "audio-gen",
      label: "Night Train",
    });

    expect(result.validationError).toBeNull();
    expect(result.cleanedPrompt).toBe("[Verse]\nLast train through the rain");
    expect(result.pendingInput.modelParams).toMatchObject({
      style: "Nocturnal synth-pop with warm analog pads",
      title: "Night Train",
      instrumental: false,
    });
  });

  it("supports fal-style prompt plus dedicated lyrics through the declarative music shape", () => {
    const modelCard = ModelCardSchema.parse({
      id: "test-fal-music",
      name: "Test fal Music",
      provider: "fal.ai",
      kind: "audio",
      task: "music-generation",
      parameters: [],
      defaultParams: {},
      defaultAspectRatio: "1:1",
      input: { requiresPrompt: true, inputMode: {}, promptModalities: ["text"] },
      musicInput: {
        lyricsTarget: "modelParam",
        lyricsParam: "lyrics",
      },
    });

    const result = buildGenerationPayload({
      prompt: "lofi, jazz, warm vinyl",
      refNodes: [],
      lyrics: "[chorus]\nStay awhile",
      configId: modelCard.id,
      config: { kind: "model", modelCard, modelParams: {} },
      actionType: "audio-gen",
    });

    expect(result.cleanedPrompt).toBe("lofi, jazz, warm vinyl");
    expect(result.pendingInput.modelParams).toMatchObject({
      lyrics: "[chorus]\nStay awhile",
    });
  });

  it("rejects attached modalities before partitioning unsupported refs away", () => {
    const modelCard = MODEL_CARDS.find((card) => card.id === "gemini-3.1-flash-tts");
    expect(modelCard).toBeDefined();

    const result = buildGenerationPayload({
      prompt: "Read this line",
      refNodes: [{ type: "image", data: { assetId: "source-image" } }],
      configId: modelCard!.id,
      config: { kind: "model", modelCard, modelParams: {} },
      actionType: "audio-gen",
    });

    expect(result.validationError).toBe("Selected model does not accept reference images.");
  });

  it("passes an exported Director Stage video to a downstream reference-video model", () => {
    const modelCard = MODEL_CARDS.find((card) => card.id === "seedance-2-ref");
    expect(modelCard).toBeDefined();

    const result = buildGenerationPayload({
      prompt: "Keep the blocking and camera language from the reference",
      refNodes: [{
        type: "director-stage",
        data: {
          stageId: "stage-1",
          outputVideoAssetId: "director-reference-video-1",
        },
      }],
      configId: modelCard!.id,
      config: { kind: "model", modelCard, modelParams: {} },
      actionType: "video-gen",
    });

    expect(result.validationError).toBeNull();
    expect(result.partition.videoAssetIds).toEqual(["director-reference-video-1"]);
    expect(result.pendingInput.referenceVideoAssetIds).toEqual([
      "director-reference-video-1",
    ]);
  });

  it("blocks generation until the connected Director Stage has exported a reference video", () => {
    const modelCard = MODEL_CARDS.find((card) => card.id === "seedance-2-ref");
    expect(modelCard).toBeDefined();

    const result = buildGenerationPayload({
      prompt: "Continue this shot",
      refNodes: [{
        type: "director-stage",
        data: { stageId: "stage-without-export" },
      }],
      configId: modelCard!.id,
      config: { kind: "model", modelCard, modelParams: {} },
      actionType: "video-gen",
    });

    expect(result.validationError).toBe(
      "Director Stage has no reference video yet. Export the shot before running generation.",
    );
    expect(result.pendingInput.referenceVideoAssetIds).toBeUndefined();
  });

  it("prefers the Director reference packet video for a video-reference model", () => {
    const modelCard = MODEL_CARDS.find((card) => card.id === "seedance-2-ref");
    expect(modelCard).toBeDefined();

    const result = buildGenerationPayload({
      prompt: "Preserve the staged performance and camera plan",
      refNodes: [{
        type: "director-stage",
        data: {
          stageId: "stage-1",
          directorReferencePacket: {
            schemaVersion: 1,
            stageId: "stage-1",
            stageRevisionId: "stage-revision-1",
            exportedAt: "2026-07-24T00:00:00.000Z",
            aspectRatio: "16:9",
            durationSeconds: 6,
            fps: 30,
            cameraIds: ["camera-a"],
            referenceVideo: {
              assetId: "director-reference-video-1",
              mimeType: "video/webm",
            },
            referenceStills: [{
              assetId: "director-reference-still-1",
              cameraId: "camera-a",
              shotId: "shot-a",
              aspectRatio: "16:9",
              stageRevisionId: "stage-revision-1",
              timeSeconds: 0,
            }],
            shotSpec: { shots: [] },
          },
        },
      }],
      configId: modelCard!.id,
      config: { kind: "model", modelCard, modelParams: {} },
      actionType: "video-gen",
    });

    expect(result.validationError).toBeNull();
    expect(result.pendingInput.referenceVideoAssetIds).toEqual([
      "director-reference-video-1",
    ]);
    expect(result.pendingInput.referenceImageAssetIds).toBeUndefined();
  });

  it("adds an exported Director shot plan to text-capable generation prompts", () => {
    const modelCard = MODEL_CARDS.find((card) => card.id === "seedance-2-ref");
    expect(modelCard).toBeDefined();

    const result = buildGenerationPayload({
      prompt: "Keep the actors grounded and natural.",
      refNodes: [{
        type: "director-stage",
        data: {
          directorReferencePacket: {
            schemaVersion: 1,
            stageId: "stage-1",
            stageRevisionId: "stage-revision-8",
            exportedAt: "2026-07-24T00:00:00.000Z",
            aspectRatio: "16:9",
            durationSeconds: 6,
            fps: 30,
            cameraIds: ["camera-wide", "camera-close"],
            referenceVideo: {
              assetId: "director-reference-video-1",
              mimeType: "video/webm",
            },
            referenceStills: [],
            shotSpec: {
              shots: [{
                id: "shot-wide",
                name: "Opening wide",
                cameraId: "camera-wide",
                startTime: 0,
                durationSeconds: 3,
                aspectRatio: "16:9",
                transition: "cut",
                cameraMove: { preset: "push-in", easing: "ease-in-out" },
              }, {
                id: "shot-close",
                name: "Reaction close-up",
                cameraId: "camera-close",
                startTime: 3,
                durationSeconds: 3,
                aspectRatio: "16:9",
                transition: "dissolve",
              }],
            },
          },
        },
      }],
      configId: modelCard!.id,
      config: { kind: "model", modelCard, modelParams: {} },
      actionType: "video-gen",
    });

    expect(result.validationError).toBeNull();
    expect(result.cleanedPrompt).toContain("Keep the actors grounded and natural.");
    expect(result.cleanedPrompt).toContain("Director shot plan");
    expect(result.cleanedPrompt).toContain("Opening wide · 0.00–3.00s · Cut · push-in / ease-in-out");
    expect(result.cleanedPrompt).toContain("Reaction close-up · 3.00–6.00s · Dissolve");
    expect(result.cleanedPrompt).toContain("Stage revision: stage-revision-8");
    expect(result.pendingInput.prompt).toBe(result.cleanedPrompt);
  });

  it("falls back to Director keyframe stills for an image-reference video model", () => {
    const modelCard = MODEL_CARDS.find((card) => card.id === "seedance-2-startend");
    expect(modelCard).toBeDefined();

    const result = buildGenerationPayload({
      prompt: "Generate from the staged opening and closing frames",
      refNodes: [{
        type: "director-stage",
        data: {
          stageId: "stage-1",
          directorReferencePacket: {
            schemaVersion: 1,
            stageId: "stage-1",
            stageRevisionId: "stage-revision-1",
            exportedAt: "2026-07-24T00:00:00.000Z",
            aspectRatio: "16:9",
            durationSeconds: 6,
            fps: 30,
            cameraIds: ["camera-a"],
            referenceVideo: {
              assetId: "director-reference-video-1",
              mimeType: "video/webm",
            },
            referenceStills: [
              {
                assetId: "director-reference-still-start",
                cameraId: "camera-a",
                shotId: "shot-a",
                aspectRatio: "16:9",
                stageRevisionId: "stage-revision-1",
                timeSeconds: 0,
              },
              {
                assetId: "director-reference-still-middle",
                cameraId: "camera-a",
                shotId: "shot-middle",
                aspectRatio: "16:9",
                stageRevisionId: "stage-revision-1",
                timeSeconds: 3,
              },
              {
                assetId: "director-reference-still-end",
                cameraId: "camera-a",
                shotId: "shot-b",
                aspectRatio: "16:9",
                stageRevisionId: "stage-revision-1",
                timeSeconds: 6,
              },
            ],
            shotSpec: { shots: [] },
          },
        },
      }],
      configId: modelCard!.id,
      config: { kind: "model", modelCard, modelParams: {} },
      actionType: "video-gen",
    });

    expect(result.validationError).toBeNull();
    expect(result.pendingInput.referenceVideoAssetIds).toBeUndefined();
    expect(result.pendingInput.referenceImageAssetIds).toEqual([
      "director-reference-still-start",
      "director-reference-still-end",
    ]);
  });
});

describe("Director reference packet node data", () => {
  it("persists the structured packet instead of reducing lineage to a video id", () => {
    expect("stageId" in NodeDataSchema.shape).toBe(true);
    const data = NodeDataSchema.parse({
      stageId: "stage-1",
      directorReferencePacket: {
        schemaVersion: 1,
        stageId: "stage-1",
        stageRevisionId: "stage-revision-1",
        exportedAt: "2026-07-24T00:00:00.000Z",
        aspectRatio: "16:9",
        durationSeconds: 6,
        fps: 30,
        cameraIds: ["camera-a"],
        referenceVideo: {
          assetId: "director-reference-video-1",
          mimeType: "video/webm",
        },
        referenceStills: [],
        shotSpec: { shots: [] },
      },
    });

    expect(data.directorReferencePacket).toMatchObject({
      stageId: "stage-1",
      stageRevisionId: "stage-revision-1",
      referenceVideo: { assetId: "director-reference-video-1" },
    });
    expect(data.stageId).toBe("stage-1");
  });

  it("persists an ordered set of selected-Shot packets as first-class node data", () => {
    expect("directorShotReferencePackets" in NodeDataSchema.shape).toBe(true);
    expect("selectedDirectorShotIds" in NodeDataSchema.shape).toBe(true);
    expect("sourceDirectorStageId" in NodeDataSchema.shape).toBe(true);
    expect("sourceDirectorStageRevisionId" in NodeDataSchema.shape).toBe(true);
    expect("sourceDirectorStageShotId" in NodeDataSchema.shape).toBe(true);
    expect("directorShotGroupId" in NodeDataSchema.shape).toBe(true);
    const packet = {
      schemaVersion: 1,
      stageId: "stage-1",
      stageRevisionId: "stage-revision-1",
      exportedAt: "2026-07-24T00:00:00.000Z",
      aspectRatio: "16:9",
      durationSeconds: 2,
      fps: 30,
      scope: { kind: "shot", selectedShotIds: ["shot-a"] },
      cameraIds: ["camera-a"],
      referenceVideo: {
        assetId: "director-shot-video-a",
        mimeType: "video/webm",
      },
      referenceStills: [],
      shotSpec: { shots: [] },
    };
    const data = NodeDataSchema.parse({
      stageId: "stage-1",
      selectedDirectorShotIds: ["shot-a"],
      directorShotReferencePackets: [packet],
      sourceDirectorStageId: "stage-1",
      sourceDirectorStageRevisionId: "stage-revision-1",
      sourceDirectorStageShotId: "shot-a",
      directorShotGroupId: "director-shot-group-1",
    });

    expect(data.selectedDirectorShotIds).toEqual(["shot-a"]);
    expect(data.directorShotReferencePackets).toEqual([packet]);
    expect(data).toMatchObject({
      sourceDirectorStageId: "stage-1",
      sourceDirectorStageRevisionId: "stage-revision-1",
      sourceDirectorStageShotId: "shot-a",
      directorShotGroupId: "director-shot-group-1",
    });
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

  it("persists an exact Executable Plugin binding", () => {
    const pluginBinding = {
      pluginId: "clash.minimax",
      version: "1.2.0",
      exportId: "minimax-execute",
      schemaHash: `sha256:${"c".repeat(64)}`,
    };
    expect(NodeDataSchema.parse({ pluginBinding }).pluginBinding).toEqual(pluginBinding);
    expect(NodeDataSchema.safeParse({
      pluginBinding: { ...pluginBinding, version: "latest" },
    }).success).toBe(false);
  });
});

describe("buildPendingAssetNode", () => {
  it("copies the exact plugin binding onto the pending child", () => {
    const pluginBinding = {
      pluginId: "clash.minimax",
      version: "1.2.0",
      exportId: "minimax-execute",
      schemaHash: `sha256:${"c".repeat(64)}`,
    };
    const node = (buildPendingAssetNode as (input: any) => any)({
      nodeId: "vid-plugin-1",
      prompt: "Turn around",
      modelId: "minimax-h3",
      modelParams: {},
      actionType: ACTION_TYPE.VideoGen,
      pluginBinding,
    });

    expect(node.data.pluginBinding).toEqual(pluginBinding);
  });

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

  it("keeps Prompt and Lyrics Text references separate during Canvas execution", () => {
    const doc = new LoroDoc();
    const canvas = new Canvas(doc, () => {});

    canvas.insertNode(
      "style-notes",
      RF_NODE_TYPE.Text,
      { label: "Style notes", content: "Keep the production intimate" },
      null,
      { x: 0, y: 0 },
    );
    canvas.insertNode(
      "chorus-draft",
      RF_NODE_TYPE.Text,
      { label: "Chorus draft", content: "[Chorus]\nStay until morning" },
      null,
      { x: 0, y: 120 },
    );
    canvas.insertNode(
      "music-action",
      RF_NODE_TYPE.ActionBadge,
      {
        actionType: ACTION_TYPE.AudioGen,
        modelId: "minimax-music-3",
        content: "Dreamy synth pop",
        lyrics: "[Verse]\nNeon rain",
        referenceImageOrder: ["style-notes", "chorus-draft"],
      },
      null,
      { x: 160, y: 0 },
    );
    canvas.insertEdge("style-notes-music-action", "style-notes", "music-action");
    canvas.insertEdge("chorus-draft-music-action", "chorus-draft", "music-action");

    const result = canvas.execute("music-action", () => "pending-song");

    expect(result.error).toBeNull();
    const pending = canvas.readNode("pending-song");
    expect(pending?.data.prompt).toBe(
      "Dreamy synth pop\n\nKeep the production intimate\n\n[Chorus]\nStay until morning",
    );
    expect(pending?.data.modelParams).toMatchObject({
      lyrics: "[Verse]\nNeon rain",
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

describe("Canvas.moveNode", () => {
  it("updates spatial position without changing node data", () => {
    const doc = new LoroDoc();
    const canvas = new Canvas(doc, () => {});
    canvas.insertNode(
      "note-1",
      RF_NODE_TYPE.Text,
      { label: "Opening beat", content: "Rain on glass" },
      null,
      { x: 40, y: 60 },
    );

    expect(canvas.moveNode("note-1", { x: 320, y: 180 })).toBe(true);
    expect(canvas.readNode("note-1")).toMatchObject({
      position: { x: 320, y: 180 },
      data: { label: "Opening beat", content: "Rain on glass" },
    });
  });

  it("returns false when the target node is outside the selected canvas", () => {
    const doc = new LoroDoc();
    const main = new Canvas(doc, () => {}, "main");
    const selects = new Canvas(doc, () => {}, "selects");
    main.insertNode("main-note", RF_NODE_TYPE.Text, { label: "Main" }, null, { x: 0, y: 0 });

    expect(selects.moveNode("main-note", { x: 10, y: 20 })).toBe(false);
    expect(main.readNode("main-note")?.position).toEqual({ x: 0, y: 0 });
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
      input: {
        requiresPrompt: true,
        inputMode: { images: { min: 1, max: 2 } },
        promptModalities: ["text", "image"],
      },
      constraints: [{ type: "max-length", field: "prompt", max: 500 }],
      maxRuntimeMs: 120_000,
      secrets: [{ id: "FAL_API_KEY", label: "FAL Key" }],
      tags: ["image", "style"],
    });
    expect(def.runtime).toBe("worker");
    expect(def.promptModalities).toEqual(["text", "image"]);
    expect(def.secrets).toHaveLength(1);
    expect(def.tags).toEqual(["image", "style"]);
    expect(def.input.inputMode.images).toMatchObject({ min: 1, max: 2 });
    expect(def.constraints).toEqual([{ type: "max-length", field: "prompt", max: 500 }]);
    expect(def.maxRuntimeMs).toBe(120_000);
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
    expect(ACTION_PROVIDER_PRESETS.official.defaultSecretId).toBe("OFFICIAL_API_KEY");
    expect(normalizeActionProviderId("google")).toBeNull();
    expect(normalizeActionProviderId("google-ai-studio")).toBe("google-ai-studio");
    expect(normalizeActionProviderId("google-agent-platform")).toBe("google-agent-platform");
    expect(ACTION_PROVIDER_PRESETS["google-ai-studio"].defaultSecretId).toBe("GOOGLE_AI_STUDIO_API_KEY");
    expect(ACTION_PROVIDER_PRESETS["google-agent-platform"].defaultSecretId).toBe("GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON");
  });
});
