import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LoroDoc } from "loro-crdt";
import { afterEach, describe, expect, it } from "vitest";

import { resolveLocalTimelineDslReferences } from "./local-processor.js";

let dataDir = "";

afterEach(async () => {
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
  dataDir = "";
});

describe("local Timeline live references", () => {
  it("resolves the latest TSX from the same Remotion Canvas node at each render start", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "clash-remotion-reference-"));
    const doc = new LoroDoc();
    const nodes = doc.getMap("nodes");
    const timelineDsl = {
      tracks: [{
        id: "overlays",
        items: [{
          id: "live-card",
          type: "composition",
          runtime: "remotion",
          compositionKind: "custom",
          compositionId: "LiveCard",
          sourcePath: "components/remotion-fixed.tsx",
          sourceNodeId: "remotion-fixed",
          from: 0,
          durationInFrames: 60,
        }],
      }],
    };
    nodes.set("remotion-fixed", {
      type: "remotion-component",
      data: {
        componentId: "LiveCard",
        content: "export default function LiveCard(){ return <div>Before</div>; }",
      },
    });

    const before = await resolveLocalTimelineDslReferences({
      dataDir,
      doc,
      projectId: "project-1",
      timelineDsl,
    });

    nodes.set("remotion-fixed", {
      type: "remotion-component",
      data: {
        componentId: "LiveCard",
        content: "export default function LiveCard(){ return <div>After</div>; }",
      },
    });
    const after = await resolveLocalTimelineDslReferences({
      dataDir,
      doc,
      projectId: "project-1",
      timelineDsl,
    });

    expect(before.tracks[0].items[0]).toMatchObject({
      sourceNodeId: "remotion-fixed",
      componentSource: expect.stringContaining("Before"),
    });
    expect(after.tracks[0].items[0]).toMatchObject({
      sourceNodeId: "remotion-fixed",
      componentSource: expect.stringContaining("After"),
    });
    expect(timelineDsl.tracks[0].items[0]).not.toHaveProperty("componentSource");
  });

  it("fails closed when a Remotion Timeline reference is not a component node", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "clash-remotion-reference-"));
    const doc = new LoroDoc();
    doc.getMap("nodes").set("wrong-node", {
      type: "text",
      data: { content: "Not executable TSX" },
    });

    await expect(resolveLocalTimelineDslReferences({
      dataDir,
      doc,
      projectId: "project-1",
      timelineDsl: {
        tracks: [{
          id: "overlays",
          items: [{
            id: "live-card",
            type: "composition",
            runtime: "remotion",
            compositionKind: "custom",
            compositionId: "LiveCard",
            sourcePath: "components/wrong-node.tsx",
            sourceNodeId: "wrong-node",
            from: 0,
            durationInFrames: 60,
          }],
        }],
      },
    })).rejects.toThrow(/must reference a remotion-component Canvas node/);
  });
});
