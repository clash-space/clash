import { describe, expect, it } from "vitest";

import {
  CopilotProjectAssetReferenceSchema,
  CopilotProjectAssetSubmissionSchema,
  copilotProjectAssetDraftInputs,
} from "./index.js";

describe("Copilot Project Asset references", () => {
  it("accepts only storage-neutral Project Asset identity and presentation facts", () => {
    expect(
      CopilotProjectAssetReferenceSchema.parse({
        projectAssetId: "asset-logo",
        kind: "image",
        label: "Logo master",
      }),
    ).toEqual({
      projectAssetId: "asset-logo",
      kind: "image",
      label: "Logo master",
    });

    for (const forbidden of ["url", "path", "storageKey", "resourceId"]) {
      expect(() =>
        CopilotProjectAssetReferenceSchema.parse({
          projectAssetId: "asset-logo",
          kind: "image",
          label: "Logo master",
          [forbidden]: "must-not-persist",
        }),
      ).toThrow();
    }
  });

  it("requires an explicit draft Action owner for a submitted reference set", () => {
    expect(
      CopilotProjectAssetSubmissionSchema.parse({
        actionId: "copilot:session-7:turn-2",
        assets: [
          {
            projectAssetId: "asset-audio",
            kind: "audio",
            label: "Narration",
          },
        ],
      }),
    ).toEqual({
      actionId: "copilot:session-7:turn-2",
      assets: [
        {
          projectAssetId: "asset-audio",
          kind: "audio",
          label: "Narration",
        },
      ],
    });

    expect(() =>
      CopilotProjectAssetSubmissionSchema.parse({
        actionId: "",
        assets: [],
      }),
    ).toThrow();
  });

  it("maps ordered message references onto stable draft Action input slots", () => {
    expect(
      copilotProjectAssetDraftInputs({
        actionId: "copilot:session-7:turn-2",
        assets: [
          { projectAssetId: "asset-video", kind: "video", label: "B-roll" },
          { projectAssetId: "asset-audio", kind: "audio", label: "VO" },
        ],
      }),
    ).toEqual([
      {
        slot: "attachment:0",
        projectAssetId: "asset-video",
        role: "reference",
      },
      {
        slot: "attachment:1",
        projectAssetId: "asset-audio",
        role: "reference",
      },
    ]);
  });
});
