import {
  DirectorStageStateSchema,
  createDefaultDirectorStageState,
} from "@clash/shared-types";
import { describe, expect, it } from "vitest";

import { directorStageArtifactState } from "./evaluator";

const state = createDefaultDirectorStageState();
const publicStage = {
  id: "stage-main",
  name: "Main Stage",
  owner: { kind: "project" as const },
  revisionId: "director-stage-revision-v1:adf3f68073b45110",
  state,
};

describe("Director Stage artifact projection", () => {
  it("projects the public director.get wrapper to its Stage state", () => {
    const parsed = DirectorStageStateSchema.safeParse(
      directorStageArtifactState({ stage: publicStage }),
    );

    expect(parsed).toMatchObject({ success: true });
    if (parsed.success) expect(parsed.data).toEqual(state);
  });

  it("does not accept a malformed public director.get wrapper", () => {
    const parsed = DirectorStageStateSchema.safeParse(
      directorStageArtifactState({
        stage: { ...publicStage, revisionId: 42 },
      }),
    );

    expect(parsed.success).toBe(false);
  });
});
