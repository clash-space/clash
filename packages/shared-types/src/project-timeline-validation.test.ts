import { LoroDoc } from "loro-crdt";
import { describe, expect, it } from "vitest";
import {
  createProjectTimeline,
  readProjectTimeline,
  updateProjectTimelineState,
} from "./project-workspace.js";

describe("Project Timeline mutation validation", () => {
  it("rejects invalid Timeline DSL before creating Project state", () => {
    const doc = new LoroDoc();

    const result = createProjectTimeline(doc, {
      id: "timeline-invalid",
      name: "Invalid Timeline",
      state: { tracks: "not-an-array" },
    });

    expect(result).toMatchObject({
      ok: false,
      code: "INVALID_TIMELINE_DSL",
      issues: [
        {
          ruleId: "timeline.dsl.structure",
          code: "invalid_type",
          path: ["tracks"],
          message: expect.any(String),
        },
      ],
    });
    expect(readProjectTimeline(doc, "timeline-invalid")).toBeNull();
  });

  it("rejects invalid Timeline DSL without advancing existing Project state", () => {
    const doc = new LoroDoc();
    const created = createProjectTimeline(doc, {
      id: "timeline-existing",
      name: "Existing Timeline",
      state: { tracks: [] },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error);

    const result = updateProjectTimelineState(doc, "timeline-existing", {
      tracks: null,
    });

    expect(result).toMatchObject({
      ok: false,
      code: "INVALID_TIMELINE_DSL",
      issues: [
        {
          ruleId: "timeline.dsl.structure",
          code: "invalid_type",
          path: ["tracks"],
          message: expect.any(String),
        },
      ],
    });
    expect(readProjectTimeline(doc, "timeline-existing")).toEqual(
      created.timeline,
    );
  });
});
