import { describe, expect, it } from "vitest";
import {
  ACTION_TYPE,
  AIGC_ACTION_KINDS,
  type AigcActionKind,
} from "@clash/shared-types";

import {
  GENERATION_ACTION_TYPE_BY_KIND,
  resolveBuiltInActionKind,
  resolveGenerationActionType,
} from "./generationActionKind";

describe("generation action kind mapping", () => {
  it("maps every shared AIGC kind to one built-in action type", () => {
    expect(Object.keys(GENERATION_ACTION_TYPE_BY_KIND).sort()).toEqual(
      [...AIGC_ACTION_KINDS].sort(),
    );
    expect(GENERATION_ACTION_TYPE_BY_KIND.model).toBe(ACTION_TYPE.ModelGen);
  });

  it("resolves model-gen as model and keeps the legacy image fallback", () => {
    expect(resolveBuiltInActionKind(ACTION_TYPE.ModelGen)).toBe("model");
    expect(resolveGenerationActionType(ACTION_TYPE.ModelGen)).toBe(
      ACTION_TYPE.ModelGen,
    );
    expect(resolveBuiltInActionKind("unknown-legacy-action")).toBe(
      "image" satisfies AigcActionKind,
    );
  });
});
