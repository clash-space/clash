import { describe, expect, it } from "vitest";

import * as sharedTypes from "./index.js";

const MediaAnalysisDocumentSchemas = (
  sharedTypes as unknown as {
    MediaAnalysisDocumentSchemas: Record<
      string,
      { parse(value: unknown): unknown }
    >;
  }
).MediaAnalysisDocumentSchemas;
const mediaAnalysisDocumentSchema = (
  sharedTypes as unknown as {
    mediaAnalysisDocumentSchema(
      kind: string,
      schemaVersion: number,
    ): { parse(value: unknown): unknown };
  }
).mediaAnalysisDocumentSchema;

const lineage = {
  schemaVersion: 1 as const,
  source: {
    projectAssetId: "asset-1",
    resourceHash: `sha256:${"a".repeat(64)}`,
    kind: "video" as const,
  },
  modelId: "configured-model",
  provider: "configured-provider",
  route: "configured-route",
  underlyingModel: "configured-model",
  category: "description",
  promptVersion: "media-analysis/v1",
  generatorRevisionId: "generator-revision-1",
  actionRunId: "action-run-1",
  resultHash: `sha256:${"b".repeat(64)}`,
  bodyHash: `sha256:${"c".repeat(64)}`,
};

describe("media analysis Document bodies", () => {
  it("validates every declared category with the shared lineage envelope", () => {
    for (const [category, schema] of Object.entries(
      MediaAnalysisDocumentSchemas,
    )) {
      const result =
        category === "description"
          ? { text: "A person walks through a station." }
          : category === "tags"
            ? { tags: ["person", "station"] }
            : category === "subjects"
              ? { items: [{ type: "person", name: "traveler" }] }
              : category === "actions-events"
                ? { items: [{ label: "walking" }] }
                : category === "scene-shot"
                  ? { scenes: [{ description: "Wide station interior" }] }
                  : category === "style"
                    ? { summary: "Muted documentary framing" }
                    : category === "ocr"
                      ? { items: [{ text: "Platform 2" }] }
                      : { summary: "Footsteps and station ambience" };
      expect(
        schema.parse({
          ...lineage,
          category,
          result,
        }),
      ).toMatchObject({ category, result });
    }
  });

  it("rejects a body whose category does not match its declared Document kind", () => {
    expect(() =>
      mediaAnalysisDocumentSchema("media.analysis.tags", 1).parse({
        ...lineage,
        category: "description",
        result: { tags: ["station"] },
      }),
    ).toThrow();
  });

  it("does not define a verbatim transcript category", () => {
    expect(
      Object.keys(MediaAnalysisDocumentSchemas).some((category) =>
        /transcript/i.test(category),
      ),
    ).toBe(false);
  });
});
