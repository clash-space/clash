import { describe, expect, it } from "vitest";

import { GeneratorActionOutputContractSchema } from "./generator-v2.js";

function output(slot: string, minItems: 0 | 1 = 0) {
  return {
    slot,
    assetType: {
      kind: "document" as const,
      documentKind: `media.analysis.${slot}`,
      schemaVersion: 1,
    },
    cardinality: { minItems, maxItems: 1 },
  };
}

describe("Generator multi-slot Document outputs", () => {
  it("accepts independent optional output slots", () => {
    expect(
      GeneratorActionOutputContractSchema.parse([
        output("description"),
        output("tags"),
      ]),
    ).toHaveLength(2);
  });

  it("retains required singular outputs for existing Generators", () => {
    expect(GeneratorActionOutputContractSchema.parse([output("transcript", 1)]))
      .toHaveLength(1);
  });

  it("rejects duplicate output slot declarations", () => {
    expect(() =>
      GeneratorActionOutputContractSchema.parse([
        output("description"),
        output("description"),
      ]),
    ).toThrow(/duplicate/i);
  });

  it("rejects collection outputs in the current Generator profile", () => {
    expect(() =>
      GeneratorActionOutputContractSchema.parse([
        {
          ...output("description"),
          cardinality: { minItems: 0, maxItems: 2 },
        },
      ]),
    ).toThrow(/0\.\.1|1\.\.1|singular/i);
  });
});
