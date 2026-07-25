import { describe, expect, it } from "vitest";

import { parseUserMessageContent } from "./userMessageContent";

describe("parseUserMessageContent", () => {
  it("keeps agent protocol comments out of the visible bubble and extracts annotations", () => {
    const result = parseUserMessageContent(
      [
        '<!-- clash-workspace-context {"version":1,"projectId":"project-1"} -->',
        '<!-- clash-agent-annotations {"version":1,"kind":"clash-agent-annotations","annotations":[{"id":"annotation-1","kind":"agent-annotation","note":"Move this earlier.","target":{"projectId":"project-1","surface":"canvas","surfaceId":"main","surfaceLabel":"Main","objectId":"node-1","objectType":"canvas-image","objectLabel":"Hero still","objectPath":"canvases/main/nodes/node-1","capabilities":["read","modify"]}}]} -->',
        "Make this feel more cinematic.",
      ].join("\n"),
    );

    expect(result.text).toBe("Make this feel more cinematic.");
    expect(result.text).not.toContain("clash-agent-annotations");
    expect(result.text).not.toContain("clash-workspace-context");
    expect(result.annotations).toEqual([
      expect.objectContaining({
        id: "annotation-1",
        note: "Move this earlier.",
        target: expect.objectContaining({ objectType: "canvas-image" }),
      }),
    ]);
  });
});
