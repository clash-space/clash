import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LoroDoc } from "loro-crdt";
import {
  createActionAssetBinding,
  createProjectAsset,
  createProjectTimeline,
  listActionAssetBindingsForOwner,
  markActionAssetBindingAuthority,
  markProjectAssetAuthority,
  readProjectTimeline,
  requestTimelineRender,
  updateProjectTimelineState,
} from "@clash/shared-types";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createLocalAssetInspectionService,
  type LocalAssetInspector,
} from "./local-asset-inspections.js";
import {
  createLocalWorkflowProcessor,
  resolveLocalTimelineDslReferences,
} from "./local-processor.js";
import { createLocalProjectAssetService } from "./local-project-assets.js";

let dataDir = "";

const inspectTestMedia: LocalAssetInspector = async ({ resource }) => {
  const contentType = resource.contentType
    ? { contentType: resource.contentType }
    : {};
  if (resource.kind === "video") {
    return {
      ...contentType,
      width: 1920,
      height: 1080,
      rotationDegrees: 0,
      durationMs: 2_000,
      frameRate: 30,
      videoCodec: "h264",
      hasAudio: false,
    };
  }
  if (resource.kind === "audio") {
    return {
      ...contentType,
      durationMs: 2_000,
      hasAudio: true,
      audioCodec: resource.contentType === "audio/wav" ? "pcm_s16le" : "mp3",
      sampleRate: 48_000,
      channelCount: 2,
      channelLayout: "stereo",
    };
  }
  if (resource.kind === "image") {
    return {
      ...contentType,
      width: 1920,
      height: 1080,
      rotationDegrees: 0,
    };
  }
  return contentType;
};

function testAssetInspection() {
  return createLocalAssetInspectionService({
    dataDir,
    inspectResource: inspectTestMedia,
  });
}

afterEach(async () => {
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
  dataDir = "";
});

describe("local Timeline live references", () => {
  it("hydrates media through the canonical Host Asset resolver", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "clash-timeline-asset-resolver-"));
    const doc = new LoroDoc();
    const assetInspection = testAssetInspection();
    const assets = createLocalProjectAssetService({
      dataDir,
      projectionOrigin: "http://127.0.0.1:49321",
      assetInspection,
    });
    const staged = await assets.stageOwned({
      kind: "audio",
      bytes: new TextEncoder().encode("timeline-audio"),
      contentType: "audio/mpeg",
      name: "voice.mp3",
    });
    const entry = await assets.prepareStagedOwnedEntry({
      projectAssetId: "asset:voice",
      kind: "audio",
      resourceId: staged.resourceId,
      name: "voice.mp3",
      metadata: {
        bytes: staged.byteLength,
        contentType: "audio/mpeg",
      },
    });
    expect(createProjectAsset(doc, entry)).toMatchObject({ ok: true });
    expect(markProjectAssetAuthority(doc)).toMatchObject({ ok: true });
    expect(markActionAssetBindingAuthority(doc)).toMatchObject({ ok: true });
    const inputOwner = {
      kind: "run" as const,
      actionId: "timeline:timeline-1",
      actionRevisionId: "revision-1",
      actionRunId: "timeline-render:render-1",
    };
    expect(
      createActionAssetBinding(doc, {
        id: "action-asset:run:render-1:voice",
        owner: inputOwner,
        direction: "input",
        slot: "timeline:item:voice",
        projectAssetId: "asset:voice",
        role: "source",
      }),
    ).toMatchObject({ ok: true });

    const resolved = await resolveLocalTimelineDslReferences({
      dataDir,
      doc,
      projectId: "project-1",
      mediaBaseUrl: "http://127.0.0.1:49321",
      inputOwner,
      timelineDsl: {
        tracks: [
          {
            id: "audio",
            items: [
              {
                id: "voice",
                type: "audio",
                assetId: "asset:voice",
                from: 0,
                durationInFrames: 60,
              },
            ],
          },
        ],
      },
    });

    expect(resolved.tracks[0].items[0].src).toBe(
      "http://127.0.0.1:49321/api/v1/projects/project-1/assets/asset%3Avoice/media",
    );
  });

  it("renders from the frozen run binding after the editable Timeline DSL is rewired", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "clash-timeline-frozen-input-"));
    const projectId = "project-1";
    const doc = new LoroDoc();
    const assetInspection = testAssetInspection();
    const assets = createLocalProjectAssetService({
      dataDir,
      projectionOrigin: "http://127.0.0.1:49321",
      assetInspection,
    });
    const original = await assets.stageOwned({
      kind: "video",
      bytes: new TextEncoder().encode("original timeline video"),
      contentType: "video/mp4",
      name: "original.mp4",
    });
    const replacement = await assets.stageOwned({
      kind: "video",
      bytes: new TextEncoder().encode("replacement timeline video"),
      contentType: "video/mp4",
      name: "replacement.mp4",
    });
    for (const input of [
      { id: "asset:original", name: "original.mp4", staged: original },
      {
        id: "asset:replacement",
        name: "replacement.mp4",
        staged: replacement,
      },
    ]) {
      const entry = await assets.prepareStagedOwnedEntry({
        projectAssetId: input.id,
        kind: "video",
        resourceId: input.staged.resourceId,
        name: input.name,
        metadata: {
          bytes: input.staged.byteLength,
          contentType: "video/mp4",
        },
      });
      expect(createProjectAsset(doc, entry)).toMatchObject({ ok: true });
    }
    expect(markProjectAssetAuthority(doc)).toMatchObject({ ok: true });
    expect(markActionAssetBindingAuthority(doc)).toMatchObject({ ok: true });
    const originalState = {
      fps: 30,
      durationInFrames: 60,
      tracks: [
        {
          id: "video",
          items: [
            {
              id: "clip-1",
              type: "video",
              assetId: "asset:original",
              from: 0,
              durationInFrames: 60,
            },
          ],
        },
      ],
    };
    expect(
      createProjectTimeline(doc, {
        id: "timeline-1",
        name: "Cut",
        state: originalState,
      }),
    ).toMatchObject({ ok: true });
    const submittedRevisionId = readProjectTimeline(
      doc,
      "timeline-1",
    )!.revisionId;
    expect(
      requestTimelineRender(doc, {
        timelineId: "timeline-1",
        actorUserId: "user-1",
        generateId: () => "render-1",
      }),
    ).toMatchObject({ ok: true, renderNodeId: "render-1" });

    const rewiredState = {
      ...originalState,
      tracks: [
        {
          ...originalState.tracks[0],
          items: [
            {
              ...originalState.tracks[0]!.items[0],
              assetId: "asset:replacement",
            },
          ],
        },
      ],
    };
    expect(
      updateProjectTimelineState(doc, "timeline-1", rewiredState),
    ).toMatchObject({ ok: true });
    const renderNode = doc.getMap("nodes").get("render-1") as Record<
      string,
      any
    >;
    doc.getMap("nodes").set("render-1", {
      ...renderNode,
      data: {
        ...renderNode.data,
        // Simulate a mutable DSL projection drifting after submit. The frozen
        // run binding, not this field, is the renderer's media authority.
        timelineDsl: rewiredState,
      },
    });
    const render = vi.fn(
      async (_input: {
        projectId: string;
        taskId: string;
        timelineDsl: Record<string, any>;
      }) => ({
        bytes: new TextEncoder().encode("rendered timeline"),
        contentType: "video/mp4",
        width: 1920,
        height: 1080,
        durationMs: 2_000,
      }),
    );

    await createLocalWorkflowProcessor({
      dataDir,
      mediaBaseUrl: "http://127.0.0.1:49321",
      assetInspection,
      timelineRenderer: { render },
    }).process({ doc, projectId });

    expect(render).toHaveBeenCalledOnce();
    const renderedDsl = render.mock.calls[0]![0].timelineDsl;
    expect(renderedDsl.tracks[0].items[0]).toMatchObject({
      id: "clip-1",
      assetId: "asset:original",
      src: "http://127.0.0.1:49321/api/v1/projects/project-1/assets/asset%3Aoriginal/media",
    });
    expect(JSON.stringify(renderedDsl)).not.toContain("asset%3Areplacement");
    expect(readProjectTimeline(doc, "timeline-1")?.state).toMatchObject({
      tracks: [
        {
          items: [{ id: "clip-1", assetId: "asset:replacement" }],
        },
      ],
    });
    const runOwner = {
      kind: "run" as const,
      actionId: "timeline:timeline-1",
      actionRevisionId: submittedRevisionId,
      actionRunId: "timeline-render:render-1",
    };
    expect(listActionAssetBindingsForOwner(doc, runOwner)).toEqual([
      expect.objectContaining({
        direction: "input",
        slot: "timeline:item:clip-1",
        projectAssetId: "asset:original",
      }),
      expect.objectContaining({
        direction: "output",
        slot: "render:output",
      }),
    ]);
  });

  it("resolves the latest TSX from the same Remotion Canvas node at each render start", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "clash-remotion-reference-"));
    const doc = new LoroDoc();
    const nodes = doc.getMap("nodes");
    const timelineDsl = {
      tracks: [
        {
          id: "overlays",
          items: [
            {
              id: "live-card",
              type: "composition",
              runtime: "remotion",
              compositionKind: "custom",
              compositionId: "LiveCard",
              sourcePath: "components/remotion-fixed.tsx",
              sourceNodeId: "remotion-fixed",
              from: 0,
              durationInFrames: 60,
            },
          ],
        },
      ],
    };
    nodes.set("remotion-fixed", {
      type: "remotion-component",
      data: {
        componentId: "LiveCard",
        content:
          "export default function LiveCard(){ return <div>Before</div>; }",
      },
    });

    const before = await resolveLocalTimelineDslReferences({
      dataDir,
      doc,
      projectId: "project-1",
      inputOwner: {
        kind: "run",
        actionId: "timeline:timeline-1",
        actionRevisionId: "revision-1",
        actionRunId: "timeline-render:render-1",
      },
      timelineDsl,
    });

    nodes.set("remotion-fixed", {
      type: "remotion-component",
      data: {
        componentId: "LiveCard",
        content:
          "export default function LiveCard(){ return <div>After</div>; }",
      },
    });
    const after = await resolveLocalTimelineDslReferences({
      dataDir,
      doc,
      projectId: "project-1",
      inputOwner: {
        kind: "run",
        actionId: "timeline:timeline-1",
        actionRevisionId: "revision-1",
        actionRunId: "timeline-render:render-1",
      },
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
    expect(timelineDsl.tracks[0].items[0]).not.toHaveProperty(
      "componentSource",
    );
  });

  it("fails closed when a Remotion Timeline reference is not a component node", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "clash-remotion-reference-"));
    const doc = new LoroDoc();
    doc.getMap("nodes").set("wrong-node", {
      type: "text",
      data: { content: "Not executable TSX" },
    });

    await expect(
      resolveLocalTimelineDslReferences({
        dataDir,
        doc,
        projectId: "project-1",
        inputOwner: {
          kind: "run",
          actionId: "timeline:timeline-1",
          actionRevisionId: "revision-1",
          actionRunId: "timeline-render:render-1",
        },
        timelineDsl: {
          tracks: [
            {
              id: "overlays",
              items: [
                {
                  id: "live-card",
                  type: "composition",
                  runtime: "remotion",
                  compositionKind: "custom",
                  compositionId: "LiveCard",
                  sourcePath: "components/wrong-node.tsx",
                  sourceNodeId: "wrong-node",
                  from: 0,
                  durationInFrames: 60,
                },
              ],
            },
          ],
        },
      }),
    ).rejects.toThrow(/must reference a remotion-component Canvas node/);
  });
});
