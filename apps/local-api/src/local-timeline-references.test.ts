import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LoroDoc } from "loro-crdt";
import {
  createProjectAsset,
  createProjectTimeline,
  listActionAssetBindingsForOwner,
  markActionAssetBindingAuthority,
  markProjectAssetAuthority,
  readProjectTimeline,
  requestTimelineRender,
  updateProjectTimelineState,
} from "@clash/shared-types";
import { afterEach, describe, expect, it } from "vitest";

import {
  createLocalAssetInspectionService,
  type LocalAssetInspector,
} from "./local-asset-inspections.js";
import { createLocalWorkflowProcessor } from "./local-processor.js";
import { createLocalPluginAssetStagingStore } from "./local-plugin-asset-staging.js";
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

function remotionCapture() {
  const binding = {
    pluginId: "clash.remotion",
    version: "0.1.0",
    exportId: "render-timeline",
    schemaHash: `sha256:${"a".repeat(64)}` as const,
  };
  const requests: Array<Record<string, any>> = [];
  const staging = createLocalPluginAssetStagingStore({ dataDir });
  return {
    requests,
    resolvePluginBinding: async () => binding,
    executablePluginAction: async (request: Record<string, any>) => {
      requests.push(structuredClone(request));
      const outputSlot = String(request.input.values.outputSlot);
      const invocationId = `${request.taskId}:remotion-reference-test`;
      const staged = await staging.stage({
        projectId: request.projectId,
        taskId: request.taskId,
        slot: outputSlot,
        pluginId: binding.pluginId,
        pluginVersion: binding.version,
        invocationId,
        kind: "video",
        mediaType: "video/mp4",
        bytes: new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]),
      });
      return {
        protocol: "clash.plugin.result/v1" as const,
        invocationId,
        status: "completed" as const,
        outputs: [
          {
            slot: outputSlot,
            kind: "asset" as const,
            asset: {
              assetId: staged.projectAssetId,
              uri: `clash-asset://${staged.projectAssetId}`,
              kind: "video" as const,
              mediaType: "video/mp4",
            },
          },
        ],
      };
    },
  };
}

afterEach(async () => {
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
  dataDir = "";
});

describe("local Timeline live references", () => {
  it("freezes media as a clash-asset reference without a Host URL or path", async () => {
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
    expect(
      createProjectTimeline(doc, {
        id: "timeline-1",
        name: "Voice cut",
        state: {
          fps: 30,
          durationInFrames: 60,
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
      }),
    ).toMatchObject({ ok: true });
    expect(
      requestTimelineRender(doc, {
        timelineId: "timeline-1",
        actorUserId: "user-1",
        generateId: () => "render-1",
      }),
    ).toMatchObject({ ok: true, renderNodeId: "render-1" });
    const remotion = remotionCapture();

    await createLocalWorkflowProcessor({
      dataDir,
      assetInspection,
      executablePluginAction: remotion.executablePluginAction,
      resolvePluginBinding: remotion.resolvePluginBinding,
    }).process({ doc, projectId: "project-1", checkpoint: async () => {} });

    expect(remotion.requests).toHaveLength(1);
    expect(remotion.requests[0]!.input).toMatchObject({
      values: {
        timeline: {
          name: "Voice cut",
          owner: { kind: "project" },
          state: {
            tracks: [
              {
                items: [
                  expect.objectContaining({
                    id: "voice",
                    assetId: "asset:voice",
                  }),
                ],
              },
            ],
          },
        },
      },
      references: [
        {
          slot: "timeline:item:voice",
          index: 0,
          asset: {
            assetId: "asset:voice",
            uri: "clash-asset://asset:voice",
            kind: "audio",
            mediaType: "audio/mpeg",
          },
        },
      ],
    });
    expect(JSON.stringify(remotion.requests)).not.toMatch(
      /(?:executorUrl|providerUrl|storageKey|127\.0\.0\.1|\/tmp\/|\/Users\/)/,
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
    const remotion = remotionCapture();

    await createLocalWorkflowProcessor({
      dataDir,
      assetInspection,
      executablePluginAction: remotion.executablePluginAction,
      resolvePluginBinding: remotion.resolvePluginBinding,
    }).process({ doc, projectId, checkpoint: async () => {} });

    expect(remotion.requests).toHaveLength(1);
    const renderedDsl = remotion.requests[0]!.input.values.timeline.state;
    expect(renderedDsl.tracks[0].items[0]).toMatchObject({
      id: "clip-1",
      assetId: "asset:original",
    });
    expect(renderedDsl.tracks[0].items[0]).not.toHaveProperty("src");
    expect(remotion.requests[0]!.input.references).toEqual([
      expect.objectContaining({
        slot: "timeline:item:clip-1",
        asset: expect.objectContaining({ assetId: "asset:original" }),
      }),
    ]);
    expect(JSON.stringify(remotion.requests[0])).not.toContain(
      "asset:replacement",
    );
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
    expect(markActionAssetBindingAuthority(doc)).toMatchObject({ ok: true });
    nodes.set("remotion-fixed", {
      type: "remotion-component",
      data: {
        componentId: "LiveCard",
        content:
          "export default function LiveCard(){ return <div>Before</div>; }",
      },
    });
    expect(
      createProjectTimeline(doc, {
        id: "timeline-1",
        name: "Live component",
        state: {
          fps: 30,
          durationInFrames: 60,
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
        },
      }),
    ).toMatchObject({ ok: true });
    expect(
      requestTimelineRender(doc, {
        timelineId: "timeline-1",
        actorUserId: "user-1",
        generateId: () => "render-before",
      }),
    ).toMatchObject({ ok: true });
    const remotion = remotionCapture();
    const processor = createLocalWorkflowProcessor({
      dataDir,
      assetInspection: testAssetInspection(),
      executablePluginAction: remotion.executablePluginAction,
      resolvePluginBinding: remotion.resolvePluginBinding,
    });
    await processor.process({
      doc,
      projectId: "project-1",
      checkpoint: async () => {},
    });

    nodes.set("remotion-fixed", {
      type: "remotion-component",
      data: {
        componentId: "LiveCard",
        content:
          "export default function LiveCard(){ return <div>After</div>; }",
      },
    });
    expect(
      requestTimelineRender(doc, {
        timelineId: "timeline-1",
        actorUserId: "user-1",
        generateId: () => "render-after",
      }),
    ).toMatchObject({ ok: true });
    await processor.process({
      doc,
      projectId: "project-1",
      checkpoint: async () => {},
    });

    expect(remotion.requests).toHaveLength(2);
    expect(
      remotion.requests[0]!.input.values.timeline.state.tracks[0].items[0],
    ).toMatchObject({
      sourceNodeId: "remotion-fixed",
      componentSource: expect.stringContaining("Before"),
    });
    expect(
      remotion.requests[1]!.input.values.timeline.state.tracks[0].items[0],
    ).toMatchObject({
      sourceNodeId: "remotion-fixed",
      componentSource: expect.stringContaining("After"),
    });
    expect(
      (readProjectTimeline(doc, "timeline-1")!.state as any).tracks[0].items[0],
    ).not.toHaveProperty("componentSource");
  });

  it("fails closed when a Remotion Timeline reference is not a component node", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "clash-remotion-reference-"));
    const doc = new LoroDoc();
    expect(markActionAssetBindingAuthority(doc)).toMatchObject({ ok: true });
    doc.getMap("nodes").set("wrong-node", {
      type: "text",
      data: { content: "Not executable TSX" },
    });
    expect(
      createProjectTimeline(doc, {
        id: "timeline-1",
        name: "Invalid component",
        state: {
          fps: 30,
          durationInFrames: 60,
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
    ).toMatchObject({ ok: true });
    expect(
      requestTimelineRender(doc, {
        timelineId: "timeline-1",
        actorUserId: "user-1",
        generateId: () => "render-invalid-component",
      }),
    ).toMatchObject({ ok: true });
    const remotion = remotionCapture();

    await createLocalWorkflowProcessor({
      dataDir,
      assetInspection: testAssetInspection(),
      executablePluginAction: remotion.executablePluginAction,
      resolvePluginBinding: remotion.resolvePluginBinding,
    }).process({ doc, projectId: "project-1", checkpoint: async () => {} });

    expect(remotion.requests).toEqual([]);
    expect(doc.getMap("nodes").get("render-invalid-component")).toMatchObject({
      data: {
        status: "failed",
        error: expect.stringMatching(
          /must reference a remotion-component Canvas node/,
        ),
      },
    });
  });
});
