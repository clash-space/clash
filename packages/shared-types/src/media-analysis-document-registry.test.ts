import { describe, expect, it } from "vitest";

import {
  getDocumentKindDefinition,
  parseDocumentBody,
} from "./document-kind-registry.js";
import {
  MEDIA_ANALYSIS_DOCUMENT_KIND_BY_CATEGORY,
  MediaAnalysisCategorySchema,
} from "./media-analysis-documents.js";

const body = {
  schemaVersion: 1 as const,
  source: {
    projectAssetId: "asset-1",
    resourceHash: `sha256:${"a".repeat(64)}`,
    kind: "image" as const,
  },
  modelId: "model-1",
  provider: "provider-1",
  route: "route-1",
  underlyingModel: "provider-managed",
  promptVersion: "media-analysis/v1",
  generatorRevisionId: "revision-1",
  actionRunId: "run-1",
  resultHash: `sha256:${"b".repeat(64)}`,
  bodyHash: `sha256:${"c".repeat(64)}`,
};

describe("media analysis Document registry", () => {
  it("registers every plugin-declared category as a project-asset attachable Document", () => {
    for (const category of MediaAnalysisCategorySchema.options) {
      const definition = getDocumentKindDefinition(
        MEDIA_ANALYSIS_DOCUMENT_KIND_BY_CATEGORY[category],
        1,
      );
      expect(definition).toMatchObject({
        schemaVersion: 1,
        mutability: "versioned",
        allowedAttachmentTargets: expect.arrayContaining(["project-asset"]),
      });
    }
  });

  it("validates a category body through the general Document body parser", () => {
    expect(
      parseDocumentBody(
        MEDIA_ANALYSIS_DOCUMENT_KIND_BY_CATEGORY.description,
        1,
        {
          ...body,
          category: "description",
          result: { text: "A red train enters the station." },
        },
      ),
    ).toMatchObject({
      category: "description",
      result: { text: "A red train enters the station." },
    });
  });
});
