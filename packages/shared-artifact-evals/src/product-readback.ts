import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createProjectAssetHttpClient } from "@clash/asset-sdk";
import type { ProjectHostResponse } from "@clash/shared-runtime/project-host-client";
import {
  PROJECT_ASSET_RENDER_CANVAS_ID,
  TimelineDslSchema,
  canvasNodeReadToken,
  projectTimelineReadToken,
  type ProjectTimeline,
} from "@clash/shared-types";
import { parse as parseYaml } from "yaml";

import { loadSubmission } from "./artifacts";
import {
  assertProjectHostReady,
  assertWorkspaceProject,
  productHostContext,
  requestProjectHost,
  type ProductHostContext,
  type ProductHostReady,
} from "./project-host";
import type { ArtifactBenchmarkCase } from "./types";

export type { ProductHostReady } from "./project-host";

export type RemotionProductReadbackReport = {
  schemaVersion: 1;
  status: "pass" | "fail";
  projectId: string | null;
  matchedArtifactIds: string[];
  timelines: Array<{
    id: string;
    name: string;
    revisionId: string;
    readToken: string;
    hostReceipt: string;
    stateSha256: string;
  }>;
  sourceNodes: Array<{
    id: string;
    type: "remotion-component";
    version: string;
    readToken: string;
    sourceSha256: string;
  }>;
  matches: Array<{
    timelineId: string;
    timelineRevisionId: string;
    compositionId: string;
    sourceNodeId: string;
    componentArtifactId: string;
    componentSha256: string;
    timelineArtifactId: string;
    timelineSha256: string;
    videoArtifactId: string;
    videoSha256: string;
    renderNodeId: string;
    renderNodeVersion: string;
    renderNodeReadToken: string;
    renderAssetId: string;
    renderAssetSha256: string;
  }>;
  detail: string;
};

export type TimelineProductReadbackReport = {
  schemaVersion: 1;
  status: "pass" | "fail";
  projectId: string | null;
  matchedArtifactIds: string[];
  timelines: RemotionProductReadbackReport["timelines"];
  matches: Array<{
    timelineId: string;
    timelineRevisionId: string;
    timelineArtifactId: string;
    timelineSha256: string;
    videoArtifactId: string;
    videoSha256: string;
    renderNodeId: string;
    renderNodeVersion: string;
    renderNodeReadToken: string;
    renderAssetId: string;
    renderAssetSha256: string;
  }>;
  detail: string;
};

function stableJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean")
    return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((item) => stableJson(item ?? null)).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return "null";
}

function sha256Json(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function timelineStateFromArtifact(
  timeline: Record<string, unknown>,
): Record<string, unknown> {
  const state = { ...timeline };
  delete state.id;
  delete state.name;
  return state;
}


function parseProjectTimeline(value: unknown): ProjectTimeline {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Remotion readback Timeline must be an object");
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || !raw.id.trim())
    throw new Error("Remotion readback Timeline id is required");
  if (typeof raw.name !== "string" || !raw.name.trim())
    throw new Error(`Timeline ${raw.id} name is required`);
  if (typeof raw.revisionId !== "string" || !raw.revisionId.trim()) {
    throw new Error(`Timeline ${raw.id} revisionId is required`);
  }
  if (!raw.owner || typeof raw.owner !== "object" || Array.isArray(raw.owner)) {
    throw new Error(`Timeline ${raw.id} owner is invalid`);
  }
  const owner = raw.owner as Record<string, unknown>;
  const parsedOwner: ProjectTimeline["owner"] =
    owner.kind === "project"
      ? { kind: "project" }
      : owner.kind === "canvas-action" &&
          typeof owner.canvasId === "string" &&
          typeof owner.actionNodeId === "string"
        ? {
            kind: "canvas-action",
            canvasId: owner.canvasId,
            actionNodeId: owner.actionNodeId,
          }
        : (() => {
            throw new Error(`Timeline ${raw.id} owner is invalid`);
          })();
  if (!raw.state || typeof raw.state !== "object" || Array.isArray(raw.state)) {
    throw new Error(`Timeline ${raw.id} state is invalid`);
  }
  return {
    id: raw.id,
    name: raw.name,
    revisionId: raw.revisionId,
    owner: parsedOwner,
    state: raw.state,
  };
}

function normalizeSource(source: string): string {
  return source.replaceAll("\r\n", "\n").trimEnd();
}

function sha256Source(source: string): string {
  return createHash("sha256").update(normalizeSource(source)).digest("hex");
}

async function readRenderedAssetSha256(input: {
  apiUrl: string;
  projectId: string;
  assetId: string;
  expectedSha256: string;
}): Promise<string> {
  const client = createProjectAssetHttpClient({
    endpoint: input.apiUrl,
    fetch: (request, init) =>
      fetch(request, { ...init, signal: AbortSignal.timeout(15_000) }),
  });
  const asset = (
    await client.get({
      projectId: input.projectId,
      assetId: input.assetId,
    })
  ).value;
  if (asset.id !== input.assetId || asset.status !== "ready" || !asset.url) {
    throw new Error(
      `Rendered Asset ${input.assetId} is not a ready ResolvedAsset with playable media`,
    );
  }
  const mediaResponse = await fetch(asset.url, {
    signal: AbortSignal.timeout(60_000),
  });
  if (!mediaResponse.ok) {
    throw new Error(
      `Rendered Asset ${input.assetId} media readback failed with HTTP ${mediaResponse.status}`,
    );
  }
  const sha256 = createHash("sha256")
    .update(new Uint8Array(await mediaResponse.arrayBuffer()))
    .digest("hex");
  if (sha256 !== input.expectedSha256) {
    throw new Error(
      `Submitted video does not match rendered Asset ${input.assetId}`,
    );
  }
  return sha256;
}

function compositionItems(
  timeline: ProjectTimeline,
): Array<Record<string, unknown>> {
  const tracks = (timeline.state as { tracks?: unknown }).tracks;
  if (!Array.isArray(tracks)) return [];
  return tracks
    .flatMap((track) => {
      if (!track || typeof track !== "object" || Array.isArray(track))
        return [];
      const items = (track as { items?: unknown }).items;
      return Array.isArray(items)
        ? items.filter(
            (item): item is Record<string, unknown> =>
              Boolean(item) && typeof item === "object" && !Array.isArray(item),
          )
        : [];
    })
    .filter(
      (item) =>
        item.type === "composition" &&
        item.runtime === "remotion" &&
        typeof item.sourceNodeId === "string" &&
        item.sourceNodeId.length > 0,
    );
}

type HostNode = {
  id: string;
  type: string;
  data?: Record<string, unknown>;
  canvas_id?: string;
  [key: string]: unknown;
};

type TrustedTimelineRender = {
  node: HostNode;
  lineage: {
    sourceTimelineId: string;
    sourceTimelineRevisionId: string;
  };
  version: string;
  readToken: string;
};

async function listTimelineRenders(
  input: ProductHostContext,
): Promise<TrustedTimelineRender[]> {
  const response = await requestProjectHost<
    ProjectHostResponse & {
      canvasId?: unknown;
      status?: unknown;
      renders?: unknown;
    }
  >({
    ...input,
    command: { action: "list_timeline_renders", status: "completed" },
  });
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    throw new Error("Timeline render host readback response must be an object");
  }
  const raw = response as {
    canvasId?: unknown;
    status?: unknown;
    renders?: unknown;
    error?: unknown;
  };
  if (typeof raw.error === "string" && raw.error) throw new Error(raw.error);
  if (
    raw.canvasId !== PROJECT_ASSET_RENDER_CANVAS_ID ||
    raw.status !== "completed" ||
    !Array.isArray(raw.renders)
  ) {
    throw new Error(
      "Timeline render host readback response is missing the internal render scope or completed renders",
    );
  }
  return raw.renders.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(
        `Timeline render readback entry ${index} must be an object`,
      );
    }
    const render = value as {
      node?: unknown;
      lineage?: unknown;
      version?: unknown;
      readToken?: unknown;
    };
    if (
      !render.node ||
      typeof render.node !== "object" ||
      Array.isArray(render.node)
    ) {
      throw new Error(
        `Timeline render readback entry ${index} is missing its node`,
      );
    }
    const node = render.node as HostNode;
    if (
      typeof node.id !== "string" ||
      node.type !== "video" ||
      node.canvas_id !== PROJECT_ASSET_RENDER_CANVAS_ID ||
      !node.data ||
      typeof node.data !== "object"
    ) {
      throw new Error(
        `Timeline render readback entry ${index} has an invalid node`,
      );
    }
    if (
      !render.lineage ||
      typeof render.lineage !== "object" ||
      Array.isArray(render.lineage)
    ) {
      throw new Error(
        `Timeline render readback entry ${index} is missing lineage`,
      );
    }
    const lineage = render.lineage as Record<string, unknown>;
    if (
      typeof lineage.sourceTimelineId !== "string" ||
      lineage.sourceTimelineId !== node.data.sourceTimelineId ||
      typeof lineage.sourceTimelineRevisionId !== "string" ||
      lineage.sourceTimelineRevisionId !== node.data.sourceTimelineRevisionId
    ) {
      throw new Error(
        `Timeline render readback entry ${index} has invalid lineage`,
      );
    }
    const version = canvasNodeReadToken(node);
    const receiptPrefix = `${version}:receipt:`;
    if (
      render.version !== version ||
      typeof render.readToken !== "string" ||
      !render.readToken.startsWith(receiptPrefix) ||
      !/^[A-Za-z0-9._~-]{1,256}$/u.test(
        render.readToken.slice(receiptPrefix.length),
      )
    ) {
      throw new Error(
        `Timeline render ${node.id} is missing a live Host read receipt`,
      );
    }
    return {
      node,
      lineage: {
        sourceTimelineId: lineage.sourceTimelineId,
        sourceTimelineRevisionId: lineage.sourceTimelineRevisionId,
      },
      version,
      readToken: render.readToken,
    };
  });
}

async function readCanvasNode(
  input: ProductHostContext,
  canvasIds: string[],
  nodeId: string,
): Promise<{ node: HostNode; version: string; readToken: string } | null> {
  for (const canvasId of canvasIds) {
    const requested = await input.client.request<ProjectHostResponse & {
      node?: unknown;
      version?: unknown;
      readToken?: unknown;
    }>({
      cwd: input.workspace,
      projectId: input.ready.projectId,
      command: { action: "get", canvasId, nodeId },
    });
    if (requested.projectId !== input.ready.projectId) {
      throw new Error("Project Host readback resolved a different Project");
    }
    const response = requested.value;
    if (response.error) continue;
    if (!response || typeof response !== "object" || Array.isArray(response))
      continue;
    const raw = response as {
      node?: unknown;
      version?: unknown;
      readToken?: unknown;
      error?: unknown;
    };
    if (
      raw.node &&
      typeof raw.node === "object" &&
      !Array.isArray(raw.node) &&
      typeof (raw.node as { id?: unknown }).id === "string" &&
      typeof (raw.node as { type?: unknown }).type === "string" &&
      typeof raw.version === "string" &&
      typeof raw.readToken === "string" &&
      raw.readToken.startsWith(`${raw.version}:receipt:`)
    ) {
      return {
        node: raw.node as HostNode,
        version: raw.version,
        readToken: raw.readToken,
      };
    }
  }
  return null;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function captureRemotionProductReadback(input: {
  benchmark: ArtifactBenchmarkCase;
  workspace: string;
  caseRoot: string;
  ready?: ProductHostReady;
}): Promise<RemotionProductReadbackReport> {
  const reportPath = join(input.caseRoot, "remotion-readback.json");
  const matchedArtifactIds: string[] = [];
  const timelines: RemotionProductReadbackReport["timelines"] = [];
  const sourceNodes: RemotionProductReadbackReport["sourceNodes"] = [];
  const matches: RemotionProductReadbackReport["matches"] = [];
  try {
    if (!input.ready)
      throw new Error("Clash Project Host did not become ready");
    const host = productHostContext({
      ready: input.ready,
      workspace: input.workspace,
    });
    await assertProjectHostReady(host);
    await assertWorkspaceProject(input.workspace, input.ready.projectId);

    const response = await requestProjectHost<ProjectHostResponse & {
      timelines?: unknown;
      versions?: unknown;
    }>({
      ...host,
      command: { action: "list_timelines" },
    });
    if (!response || typeof response !== "object" || Array.isArray(response)) {
      throw new Error("Remotion host readback response must be an object");
    }
    const raw = response as {
      error?: unknown;
      timelines?: unknown;
      versions?: unknown;
    };
    if (typeof raw.error === "string" && raw.error) throw new Error(raw.error);
    if (
      !Array.isArray(raw.timelines) ||
      !raw.versions ||
      typeof raw.versions !== "object" ||
      Array.isArray(raw.versions)
    ) {
      throw new Error(
        "Remotion host readback response is missing Timelines or receipts",
      );
    }
    const versions = raw.versions as Record<string, unknown>;
    const parsedTimelines = raw.timelines.map(parseProjectTimeline);
    for (const timeline of parsedTimelines) {
      const readToken = projectTimelineReadToken(timeline);
      const hostReceipt = versions[timeline.id];
      const prefix = `${readToken}:receipt:`;
      if (
        typeof hostReceipt !== "string" ||
        !hostReceipt.startsWith(prefix) ||
        !/^[A-Za-z0-9._~-]{1,256}$/u.test(hostReceipt.slice(prefix.length))
      ) {
        throw new Error(
          `Timeline ${timeline.id} is missing a live Host read receipt`,
        );
      }
      timelines.push({
        id: timeline.id,
        name: timeline.name,
        revisionId: timeline.revisionId,
        readToken,
        hostReceipt,
        stateSha256: sha256Json(timeline.state),
      });
    }

    const canvasesResponse = await requestProjectHost<ProjectHostResponse & {
      canvases?: unknown;
    }>({
      ...host,
      command: { action: "list_canvases" },
    });
    const canvasIds = [
      "main",
      ...(canvasesResponse &&
      typeof canvasesResponse === "object" &&
      !Array.isArray(canvasesResponse) &&
      Array.isArray((canvasesResponse as { canvases?: unknown }).canvases)
        ? (canvasesResponse as { canvases: Array<{ id?: unknown }> }).canvases
            .map((canvas) => canvas.id)
            .filter(
              (id): id is string => typeof id === "string" && id.length > 0,
            )
        : []),
    ];
    const expectedIds =
      input.benchmark.execution?.productReadback?.artifactIds ?? [];
    const submission = await loadSubmission(input.workspace);
    if (submission.error) throw new Error(submission.error);
    const artifacts = expectedIds.map((artifactId) => {
      const artifact = submission.artifacts.find(
        (candidate) => candidate.descriptor.id === artifactId,
      );
      if (
        !artifact ||
        artifact.error ||
        !artifact.evidence ||
        !artifact.absolutePath
      ) {
        throw new Error(
          `Remotion artifact '${artifactId}' is unavailable for product readback matching`,
        );
      }
      return artifact;
    });
    const componentArtifact = artifacts.find(
      (artifact) => artifact.descriptor.kind === "remotion-component",
    );
    const timelineArtifact = artifacts.find(
      (artifact) => artifact.descriptor.kind === "timeline",
    );
    const videoArtifact = artifacts.find(
      (artifact) => artifact.descriptor.kind === "video",
    );
    if (!componentArtifact?.content) {
      throw new Error(
        "Remotion product readback requires one readable remotion-component artifact",
      );
    }
    if (!timelineArtifact?.content)
      throw new Error(
        "Remotion product readback requires one readable Timeline artifact",
      );
    if (!videoArtifact?.evidence)
      throw new Error(
        "Remotion product readback requires one rendered video artifact",
      );
    let timelineValue: unknown;
    try {
      timelineValue = parseYaml(
        timelineArtifact.content.toString("utf8"),
      ) as unknown;
    } catch (error) {
      throw new Error(
        `Timeline artifact is not YAML: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const parsedTimeline = TimelineDslSchema.safeParse(timelineValue);
    if (!parsedTimeline.success)
      throw new Error("Timeline artifact does not satisfy TimelineDslSchema");
    const timelineSha256 = sha256Json(
      timelineStateFromArtifact(parsedTimeline.data),
    );
    const componentSha256 = sha256Source(
      componentArtifact.content.toString("utf8"),
    );
    const renderNodes = await listTimelineRenders(host);

    for (const timeline of parsedTimelines) {
      if (sha256Json(timeline.state) !== timelineSha256) continue;
      const renderNode = renderNodes.find((render) => {
        const data = render.node.data ?? {};
        return (
          data.status === "completed" &&
          render.lineage.sourceTimelineId === timeline.id &&
          render.lineage.sourceTimelineRevisionId === timeline.revisionId &&
          typeof data.assetId === "string" &&
          data.assetId.length > 0
        );
      });
      if (!renderNode) continue;
      const renderAssetId = String(renderNode.node.data!.assetId);
      const renderAssetSha256 = await readRenderedAssetSha256({
        apiUrl: input.ready.apiUrl,
        projectId: input.ready.projectId,
        assetId: renderAssetId,
        expectedSha256: videoArtifact.evidence.sha256,
      });
      for (const item of compositionItems(timeline)) {
        const sourceNodeId = String(item.sourceNodeId);
        const source = await readCanvasNode(
          host,
          canvasIds,
          sourceNodeId,
        );
        const sourceData = source?.node.data ?? {};
        if (!source || source.node.type !== "remotion-component") continue;
        if (
          typeof sourceData.content !== "string" ||
          sha256Source(sourceData.content) !== componentSha256
        )
          continue;
        if (!sourceNodes.some((node) => node.id === sourceNodeId)) {
          sourceNodes.push({
            id: sourceNodeId,
            type: "remotion-component",
            version: source.version,
            readToken: source.readToken,
            sourceSha256: componentSha256,
          });
        }
        matches.push({
          timelineId: timeline.id,
          timelineRevisionId: timeline.revisionId,
          compositionId: String(item.compositionId ?? sourceNodeId),
          sourceNodeId,
          componentArtifactId: componentArtifact.descriptor.id,
          componentSha256,
          timelineArtifactId: timelineArtifact.descriptor.id,
          timelineSha256,
          videoArtifactId: videoArtifact.descriptor.id,
          videoSha256: videoArtifact.evidence.sha256,
          renderNodeId: renderNode.node.id,
          renderNodeVersion: renderNode.version,
          renderNodeReadToken: renderNode.readToken,
          renderAssetId,
          renderAssetSha256,
        });
      }
    }
    if (matches.length === 0) {
      throw new Error(
        "The submitted Remotion source, Timeline, and render do not match live product state",
      );
    }
    matchedArtifactIds.push(
      componentArtifact.descriptor.id,
      timelineArtifact.descriptor.id,
      videoArtifact.descriptor.id,
    );
    const report: RemotionProductReadbackReport = {
      schemaVersion: 1,
      status: "pass",
      projectId: input.ready.projectId,
      matchedArtifactIds,
      timelines,
      sourceNodes,
      matches,
      detail: `Matched Remotion source, Timeline revision, and completed product render for ${matches.length} live composition(s) with Host receipts.`,
    };
    await writeJson(reportPath, report);
    return report;
  } catch (error) {
    const report: RemotionProductReadbackReport = {
      schemaVersion: 1,
      status: "fail",
      projectId: input.ready?.projectId ?? null,
      matchedArtifactIds,
      timelines,
      sourceNodes,
      matches,
      detail: error instanceof Error ? error.message : String(error),
    };
    await writeJson(reportPath, report);
    return report;
  }
}

export async function captureTimelineProductReadback(input: {
  benchmark: ArtifactBenchmarkCase;
  workspace: string;
  caseRoot: string;
  ready?: ProductHostReady;
}): Promise<TimelineProductReadbackReport> {
  const reportPath = join(input.caseRoot, "timeline-readback.json");
  const matchedArtifactIds: string[] = [];
  const timelines: TimelineProductReadbackReport["timelines"] = [];
  const matches: TimelineProductReadbackReport["matches"] = [];
  try {
    if (!input.ready)
      throw new Error("Clash Project Host did not become ready");
    const host = productHostContext({
      ready: input.ready,
      workspace: input.workspace,
    });
    await assertProjectHostReady(host);
    await assertWorkspaceProject(input.workspace, input.ready.projectId);

    const response = await requestProjectHost<ProjectHostResponse & {
      timelines?: unknown;
      versions?: unknown;
    }>({
      ...host,
      command: { action: "list_timelines" },
    });
    if (!response || typeof response !== "object" || Array.isArray(response)) {
      throw new Error("Timeline host readback response must be an object");
    }
    const raw = response as {
      error?: unknown;
      timelines?: unknown;
      versions?: unknown;
    };
    if (typeof raw.error === "string" && raw.error) throw new Error(raw.error);
    if (
      !Array.isArray(raw.timelines) ||
      !raw.versions ||
      typeof raw.versions !== "object" ||
      Array.isArray(raw.versions)
    ) {
      throw new Error(
        "Timeline host readback response is missing Timelines or receipts",
      );
    }
    const versions = raw.versions as Record<string, unknown>;
    const parsedTimelines = raw.timelines.map(parseProjectTimeline);
    for (const timeline of parsedTimelines) {
      const readToken = projectTimelineReadToken(timeline);
      const hostReceipt = versions[timeline.id];
      const prefix = `${readToken}:receipt:`;
      if (
        typeof hostReceipt !== "string" ||
        !hostReceipt.startsWith(prefix) ||
        !/^[A-Za-z0-9._~-]{1,256}$/u.test(hostReceipt.slice(prefix.length))
      ) {
        throw new Error(
          `Timeline ${timeline.id} is missing a live Host read receipt`,
        );
      }
      timelines.push({
        id: timeline.id,
        name: timeline.name,
        revisionId: timeline.revisionId,
        readToken,
        hostReceipt,
        stateSha256: sha256Json(timeline.state),
      });
    }

    const expectedIds =
      input.benchmark.execution?.productReadback?.artifactIds ?? [];
    const submission = await loadSubmission(input.workspace);
    if (submission.error) throw new Error(submission.error);
    const artifacts = expectedIds.map((artifactId) => {
      const artifact = submission.artifacts.find(
        (candidate) => candidate.descriptor.id === artifactId,
      );
      if (
        !artifact ||
        artifact.error ||
        !artifact.evidence ||
        !artifact.absolutePath
      ) {
        throw new Error(
          `Timeline artifact '${artifactId}' is unavailable for product readback matching`,
        );
      }
      return artifact;
    });
    const timelineArtifact = artifacts.find(
      (artifact) => artifact.descriptor.kind === "timeline",
    );
    const videoArtifact = artifacts.find(
      (artifact) => artifact.descriptor.kind === "video",
    );
    if (!timelineArtifact?.content)
      throw new Error(
        "Timeline product readback requires one readable Timeline artifact",
      );
    if (!videoArtifact?.evidence)
      throw new Error(
        "Timeline product readback requires one rendered video artifact",
      );
    let timelineValue: unknown;
    try {
      timelineValue = parseYaml(
        timelineArtifact.content.toString("utf8"),
      ) as unknown;
    } catch (error) {
      throw new Error(
        `Timeline artifact is not YAML: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const parsedTimeline = TimelineDslSchema.safeParse(timelineValue);
    if (!parsedTimeline.success)
      throw new Error("Timeline artifact does not satisfy TimelineDslSchema");
    const timelineSha256 = sha256Json(
      timelineStateFromArtifact(parsedTimeline.data),
    );
    const renderNodes = await listTimelineRenders(host);

    for (const timeline of parsedTimelines) {
      if (sha256Json(timeline.state) !== timelineSha256) continue;
      const renderNode = renderNodes.find((render) => {
        const data = render.node.data ?? {};
        return (
          data.status === "completed" &&
          render.lineage.sourceTimelineId === timeline.id &&
          render.lineage.sourceTimelineRevisionId === timeline.revisionId &&
          typeof data.assetId === "string" &&
          data.assetId.length > 0
        );
      });
      if (!renderNode) continue;
      const renderAssetId = String(renderNode.node.data!.assetId);
      const renderAssetSha256 = await readRenderedAssetSha256({
        apiUrl: input.ready.apiUrl,
        projectId: input.ready.projectId,
        assetId: renderAssetId,
        expectedSha256: videoArtifact.evidence.sha256,
      });
      matches.push({
        timelineId: timeline.id,
        timelineRevisionId: timeline.revisionId,
        timelineArtifactId: timelineArtifact.descriptor.id,
        timelineSha256,
        videoArtifactId: videoArtifact.descriptor.id,
        videoSha256: videoArtifact.evidence.sha256,
        renderNodeId: renderNode.node.id,
        renderNodeVersion: renderNode.version,
        renderNodeReadToken: renderNode.readToken,
        renderAssetId,
        renderAssetSha256,
      });
    }
    if (matches.length === 0) {
      throw new Error(
        "The submitted Timeline and render do not match live product state",
      );
    }
    matchedArtifactIds.push(
      timelineArtifact.descriptor.id,
      videoArtifact.descriptor.id,
    );
    const report: TimelineProductReadbackReport = {
      schemaVersion: 1,
      status: "pass",
      projectId: input.ready.projectId,
      matchedArtifactIds,
      timelines,
      matches,
      detail: `Matched Timeline revision and completed product render for ${matches.length} live Timeline(s) with Host receipts.`,
    };
    await writeJson(reportPath, report);
    return report;
  } catch (error) {
    const report: TimelineProductReadbackReport = {
      schemaVersion: 1,
      status: "fail",
      projectId: input.ready?.projectId ?? null,
      matchedArtifactIds,
      timelines,
      matches,
      detail: error instanceof Error ? error.message : String(error),
    };
    await writeJson(reportPath, report);
    return report;
  }
}
