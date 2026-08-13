import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LoroDoc } from "loro-crdt";
import {
  createProjectAsset,
  markActionAssetBindingAuthority,
  markProjectAssetAuthority,
} from "@clash/shared-types";
import { afterEach, describe, expect, it } from "vitest";

import { resolveLocalTimelineDslReferences } from "./local-processor.js";
import { createLocalProjectAssetService } from "./local-project-assets.js";

let dataDir = "";

afterEach(async () => {
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
  dataDir = "";
});

describe("local Timeline live references", () => {
  it("hydrates media through the canonical Host Asset resolver", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "clash-timeline-asset-resolver-"));
    const doc = new LoroDoc();
    const assets = createLocalProjectAssetService({
      dataDir,
      projectionOrigin: "http://127.0.0.1:49321",
    });
    const staged = await assets.stageOwned({
      kind: "audio",
      bytes: new TextEncoder().encode("timeline-audio"),
      contentType: "audio/mpeg",
      name: "voice.mp3",
    });
    expect(createProjectAsset(doc, {
      id: "asset:voice",
      kind: "audio",
      source: { kind: "owned", resourceId: staged.resource.id },
      lifecycle: { state: "active" },
      name: "voice.mp3",
      metadata: {
        bytes: staged.resource.byteLength,
        contentType: "audio/mpeg",
      },
    })).toMatchObject({ ok: true });
    expect(markProjectAssetAuthority(doc)).toMatchObject({ ok: true });
    expect(markActionAssetBindingAuthority(doc)).toMatchObject({ ok: true });

    const resolved = await resolveLocalTimelineDslReferences({
      dataDir,
      doc,
      projectId: "project-1",
      mediaBaseUrl: "http://127.0.0.1:49321",
      timelineDsl: {
        tracks: [{
          id: "audio",
          items: [{
            id: "voice",
            type: "audio",
            assetId: "asset:voice",
            from: 0,
            durationInFrames: 60,
          }],
        }],
      },
    });

    expect(resolved.tracks[0].items[0].src).toBe(
      "http://127.0.0.1:49321/api/v1/projects/project-1/assets/asset%3Avoice/media",
    );
  });

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
