import { describe, expect, it } from "vitest";

import {
  ExecutablePluginManifestSchema,
  ExecutablePluginViewDocumentSchema,
  StoryboardViewStateSchema,
  validateExecutablePluginPackage,
} from "./executable-plugin.js";

const runtime = {
  kind: "local" as const,
  transport: "stdio" as const,
  language: "node" as const,
  entrypoint: "dist/stdio.mjs",
};

describe("plugin View contract", () => {
  it("accepts a declarative View-only plugin with no Generator or function export", () => {
    const manifest = ExecutablePluginManifestSchema.parse({
      apiVersion: "clash.plugin/v1",
      id: "community.storyboard",
      version: "1.0.0",
      name: "Storyboard",
      runtime,
      contributes: {
        views: [{
          id: "storyboard",
          kind: "view",
          path: "views/storyboard.json",
        }],
      },
    });
    const view = {
      apiVersion: "clash.view/v1",
      kind: "view",
      spec: {
        definitionId: "storyboard",
        name: "Storyboard",
        presentation: { type: "storyboard" },
        initialState: {
          keyElements: [],
          shots: [],
          audioLayers: [],
          uncategorized: [],
        },
      },
    };

    expect(manifest.contributes).toMatchObject({
      views: [{ id: "storyboard", kind: "view" }],
      generators: [],
      functions: [],
    });
    expect(ExecutablePluginViewDocumentSchema.parse(view)).toEqual(view);
    expect(validateExecutablePluginPackage(
      manifest,
      {},
      {},
      { views: { "views/storyboard.json": view } },
    ).views).toEqual({ "views/storyboard.json": view });
  });

  it("models trace-backed entities, material slots, candidates, and a selected result", () => {
    const state = StoryboardViewStateSchema.parse({
      keyElements: [{
        id: "Element_Protagonist_Player",
        description: [{ type: "text", text: "A weathered football player" }],
        materials: [{
          id: "Element_Protagonist_Player_img",
          mediaKind: "image",
          promptDraft: {
            id: "prompt-draft-player",
            text: "cinematic portrait",
          },
          candidates: [{
            id: "resource-player-1",
            projectAssetId: "asset-player-1",
            mediaKind: "image",
            modelName: "Nano Banana Pro",
            generatedBy: {
              generatorId: "image-generator",
              generatorRevisionId: "generator-revision-1",
              actionRunId: "action-run-1",
              outputCommitId: "output-commit-1",
            },
          }],
          selectedCandidateId: "resource-player-1",
        }],
      }],
      shots: [{
        id: "Shot_1_Tear_Reverse",
        durationSeconds: 3,
        description: [
          { type: "text", text: "Close-up of " },
          { type: "entity-reference", entityId: "Element_Protagonist_Player" },
        ],
        materials: [{
          id: "Shot_1_Tear_Reverse_video",
          mediaKind: "video",
          candidates: [],
        }],
      }],
      audioLayers: [],
      uncategorized: [],
    });

    expect(state.keyElements[0]?.materials[0]?.candidates).toHaveLength(1);
    expect(state.shots[0]?.description[1]).toEqual({
      type: "entity-reference",
      entityId: "Element_Protagonist_Player",
    });
  });

  it("rejects a final binding that does not name one of the slot candidates", () => {
    expect(StoryboardViewStateSchema.safeParse({
      keyElements: [{
        id: "Element_Stadium_Pitch",
        description: [],
        materials: [{
          id: "Element_Stadium_Pitch_img",
          mediaKind: "image",
          candidates: [],
          selectedCandidateId: "missing-resource",
        }],
      }],
      shots: [],
      audioLayers: [],
      uncategorized: [],
    }).success).toBe(false);
  });
});
