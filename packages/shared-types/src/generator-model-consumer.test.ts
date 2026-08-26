import { describe, expect, it } from "vitest";

import { GeneratorActionDefinitionSchema } from "./generator-v2.js";

describe("Generator model consumer declaration", () => {
  it("declares provider-independent model shape and source slot without a product id", () => {
    expect(GeneratorActionDefinitionSchema.parse({
      id: "inspect",
      executorExportId: "execute",
      parametersSchema: { type: "object", properties: {}, additionalProperties: false },
      modelConsumer: {
        semanticShape: "dummy_analysis",
        sourceInputSlot: "media",
      },
      invocationInputs: [{
        slot: "media",
        accepts: [{ kind: "media", mediaKind: "video" }],
        cardinality: { minItems: 1, maxItems: 1 },
      }],
      outputs: [{
        slot: "result",
        assetType: { kind: "document", documentKind: "dummy.result", schemaVersion: 1 },
        cardinality: { minItems: 1, maxItems: 1 },
      }],
    })).toMatchObject({
      modelConsumer: { semanticShape: "dummy_analysis", sourceInputSlot: "media" },
    });
  });
});
