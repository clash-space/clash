import { describe, expect, it } from "vitest";
import * as shared from "./index.js";

function discoveryFunction(): (view?: "authoring" | "full") => any {
  const discovery = (shared as Record<string, unknown>).timelineDslDiscovery;
  expect(
    typeof discovery,
    "shared-types must expose the canonical Timeline discovery projection",
  ).toBe("function");
  return discovery as (view?: "authoring" | "full") => any;
}

describe("Timeline authoring discovery", () => {
  it("defaults to the compact reference-based authoring view", () => {
    const authoring = discoveryFunction()();

    expect(authoring).toMatchObject({
      view: "authoring",
      format: "clash.timeline.yaml",
      taxonomy: {
        trackCategoryOrder: ["effect", "text", "visual", "primary", "audio"],
      },
      references: {
        assetId: { target: "project-asset" },
        sourceNodeId: { target: "canvas-node" },
      },
      submission: {
        validation: "automatic",
        operations: ["timeline.create", "timeline.save", "timeline.apply"],
        diagnosticOperation: "timeline.validate",
        diagnosticRequired: false,
      },
    });
    expect(authoring).not.toHaveProperty("operationCatalog");
    expect(authoring).not.toHaveProperty("jsonSchema");
    expect(authoring.fields.itemBase.assetId).toMatchObject({
      required: false,
    });
    expect(authoring.fields.itemBase.assetId.description).toMatch(
      /Project Asset/i,
    );
    expect(authoring.fields.track.category.description).toMatch(
      /effect.*text.*visual.*primary.*audio/is,
    );
    expect(authoring.fields.track.role.description).toMatch(
      /subtitle.*structured.*cues.*wordRefs.*sourceToOutputMap.*plain title.*omit.*role/is,
    );
    expect(authoring.references.assetId.description).toMatch(
      /Stage revision.*capture receipt.*Project Asset.*assetId/is,
    );
    expect(authoring.references.sourceNodeId.description).toMatch(
      /Remotion.*sourceNodeId/is,
    );
    expect(authoring.fields.itemBase.assetId).not.toHaveProperty(
      "runtimeConsumers",
    );
    expect(authoring.fields.root).not.toHaveProperty("assetTranscripts");
    expect(authoring.fields.itemTypes.video).not.toHaveProperty("waveform");
  });

  it("ships one executable basic example that consumes Assets and Canvas nodes by reference", () => {
    const authoring = discoveryFunction()();
    const example = authoring.examples.basic;
    const validation = shared.validateTimelineDsl(example.state);
    const parsedYaml = shared.timelineDslFromYaml(example.yaml);

    expect(validation.ok).toBe(true);
    expect(parsedYaml.ok).toBe(true);
    const items = example.state.tracks.flatMap(
      (track: { items: Array<Record<string, unknown>> }) => track.items,
    );
    expect(items).toContainEqual(
      expect.objectContaining({
        type: "image",
        assetId: "project-asset-id",
      }),
    );
    expect(items).toContainEqual(
      expect.objectContaining({
        type: "composition",
        runtime: "remotion",
        sourceNodeId: "canvas-component-node-id",
      }),
    );
    const plainText = items.find((item: Record<string, unknown>) =>
      item.type === "text"
    );
    const plainTextTrack = example.state.tracks.find(
      (track: { items: Array<Record<string, unknown>> }) =>
        track.items.includes(plainText),
    );
    expect(plainTextTrack).not.toHaveProperty("role");
    expect(plainText).not.toHaveProperty("cues");
    expect(plainText).not.toHaveProperty("wordRefs");
    expect(plainText).not.toHaveProperty("sourceToOutputMap");
  });

  it("keeps the full view equal to the pre-existing complete definition", () => {
    expect(discoveryFunction()("full")).toEqual(
      shared.TIMELINE_DSL_DEFINITION,
    );
  });
});
