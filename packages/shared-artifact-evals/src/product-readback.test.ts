import { createServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  PROJECT_ASSET_RENDER_CANVAS_ID,
  canvasNodeReadToken,
  projectTimelineReadToken,
} from "@clash/shared-types";
import { describe, expect, it } from "vitest";

import {
  captureRemotionProductReadback,
  captureTimelineProductReadback,
} from "./product-readback";
import type { ArtifactBenchmarkCase } from "./types";

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

const componentSource = `import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
export default function ReadbackCharacter() {
  const frame = useCurrentFrame();
  const wave = interpolate(frame, [0, 12, 23], [0, 1, 0]);
  return <AbsoluteFill data-character-part="torso" data-wave={wave} />;
}
`;

const timeline = {
  id: "remotion-main",
  name: "Remotion Main",
  owner: { kind: "project" as const },
  revisionId: "timeline-revision-remotion-main",
  state: {
    compositionWidth: 320,
    compositionHeight: 180,
    fps: 12,
    durationInFrames: 24,
    tracks: [
      {
        id: "overlays",
        items: [
          {
            id: "overlay-readback-character",
            type: "composition",
            compositionKind: "custom",
            runtime: "remotion",
            compositionId: "ReadbackCharacter",
            sourcePath: "components/readback-character.tsx",
            sourceNodeId: "remotion-component-fixed",
            from: 0,
            durationInFrames: 24,
          },
        ],
      },
    ],
  },
};

const sourceNode = {
  id: "remotion-component-fixed",
  type: "remotion-component",
  data: { componentId: "ReadbackCharacter", content: componentSource },
};

const renderNode = {
  id: "render-node-fixed",
  canvas_id: PROJECT_ASSET_RENDER_CANVAS_ID,
  type: "video",
  data: {
    status: "completed",
    sourceTimelineId: timeline.id,
    sourceTimelineRevisionId: timeline.revisionId,
    assetId: "render-asset-fixed",
  },
};

const benchmark: ArtifactBenchmarkCase = {
  id: "remotion-readback-case",
  title: "Remotion readback",
  category: "mg-character",
  outcome: {
    objective:
      "Persist a Remotion character and render it through a Project Timeline.",
    acceptanceCriteria: [
      "The live component, Timeline, and render are product-backed.",
    ],
    deliverables: [
      {
        artifactId: "mg-character",
        kind: "remotion-component",
        description: "Remotion TSX source",
      },
      {
        artifactId: "timeline",
        kind: "timeline",
        description: "Editable Timeline",
      },
      { artifactId: "mg-video", kind: "video", description: "Timeline render" },
    ],
  },
  passScore: 100,
  timeoutMs: 10_000,
  skills: [],
  execution: {
    profile: "clash-host",
    requiredMcpTools: ["clash"],
    productReadback: {
      required: true,
      mechanism: "remotion-component-timeline-render-receipt",
      artifactIds: ["mg-character", "timeline", "mg-video"],
      description: "Trusted Remotion Canvas and Timeline readback.",
    },
  },
  rubric: [],
};

const timelineBenchmark: ArtifactBenchmarkCase = {
  ...benchmark,
  id: "timeline-readback-case",
  title: "Timeline readback",
  category: "timeline",
  outcome: {
    objective: "Persist and render a Project Timeline.",
    acceptanceCriteria: ["The live Timeline and render are product-backed."],
    deliverables: [
      {
        artifactId: "timeline",
        kind: "timeline",
        description: "Editable Timeline",
      },
      {
        artifactId: "final-video",
        kind: "video",
        description: "Timeline render",
      },
    ],
  },
  execution: {
    profile: "clash-host",
    requiredMcpTools: ["clash_timeline_render"],
    productReadback: {
      required: true,
      mechanism: "timeline-state-and-render-receipt",
      artifactIds: ["timeline", "final-video"],
      description: "Trusted Timeline and render readback.",
    },
  },
};

async function withProductDaemon<T>(
  timelines: unknown[],
  run: (input: {
    socketPath: string;
    projectId: string;
    apiUrl: string;
    requestedActions: string[];
  }) => Promise<T>,
  options: { renderReadbackError?: string } = {},
): Promise<T> {
  const root = await mkdtemp("/tmp/remotion-readback-");
  const socketPath = join(root, "daemon.sock");
  const projectId = "project-remotion-readback";
  const versions = Object.fromEntries(
    timelines.map((value) => {
      const parsed = value as Parameters<typeof projectTimelineReadToken>[0];
      const readToken = projectTimelineReadToken(parsed);
      return [parsed.id, `${readToken}:receipt:trusted-host`];
    }),
  );
  const requestedActions: string[] = [];
  const server = createServer((connection) => {
    let data = "";
    connection.on("data", (chunk) => {
      data += chunk.toString();
      if (!data.includes("\n")) return;
      const request = JSON.parse(data.slice(0, data.indexOf("\n"))) as {
        action?: string;
        nodeId?: string;
        canvasId?: string;
        status?: string;
      };
      requestedActions.push(String(request.action ?? ""));
      let response: unknown = { error: "unsupported" };
      if (request.action === "list_timelines")
        response = { timelines, versions };
      if (request.action === "list_canvases")
        response = { canvases: [{ id: "main", name: "Main" }] };
      if (request.action === "get" && request.nodeId === sourceNode.id) {
        response = {
          node: sourceNode,
          version: "node-v1:source",
          readToken: "node-v1:source:receipt:trusted-host",
        };
      }
      if (request.action === "list_timeline_renders") {
        if (options.renderReadbackError) {
          response = { error: options.renderReadbackError };
        } else {
          const version = canvasNodeReadToken(renderNode);
          response = {
            canvasId: PROJECT_ASSET_RENDER_CANVAS_ID,
            status: request.status ?? "completed",
            renders: [
              {
                node: renderNode,
                lineage: {
                  sourceTimelineId: timeline.id,
                  sourceTimelineRevisionId: timeline.revisionId,
                  renderTarget: { kind: "project-asset" },
                },
                version,
                readToken: `${version}:receipt:trusted-host`,
              },
            ],
          };
        }
      }
      if (
        request.action === "list" &&
        request.canvasId === PROJECT_ASSET_RENDER_CANVAS_ID
      ) {
        response = {
          error: `Canvas ${PROJECT_ASSET_RENDER_CANVAS_ID} is internal and unregistered`,
        };
      }
      connection.end(`${JSON.stringify(response)}\n`);
    });
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(socketPath, resolveListen);
  });
  let apiUrl = "";
  const httpServer = createHttpServer((request, response) => {
    if (request.url === `/api/v1/assets/${renderNode.data.assetId}`) {
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          id: renderNode.data.assetId,
          signedUrl: `${apiUrl}/assets/render.mp4`,
          readToken: "asset-read-receipt:trusted-host",
        }),
      );
      return;
    }
    if (request.url === "/assets/render.mp4") {
      response.setHeader("content-type", "video/mp4");
      response.end("video");
      return;
    }
    response.statusCode = 404;
    response.end("not found");
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    httpServer.once("error", rejectListen);
    httpServer.listen(0, "127.0.0.1", () => {
      const address = httpServer.address();
      if (!address || typeof address === "string") {
        rejectListen(new Error("HTTP test server did not expose a TCP port"));
        return;
      }
      apiUrl = `http://127.0.0.1:${address.port}`;
      resolveListen();
    });
  });
  try {
    return await run({ socketPath, projectId, apiUrl, requestedActions });
  } finally {
    await new Promise<void>((resolveClose) =>
      server.close(() => resolveClose()),
    );
    await new Promise<void>((resolveClose) =>
      httpServer.close(() => resolveClose()),
    );
    await rm(root, { recursive: true, force: true });
  }
}

describe("trusted Remotion product readback", () => {
  it("matches source, fixed node id, Timeline revision, and completed product render", async () => {
    await withProductDaemon(
      [timeline],
      async ({ socketPath, projectId, apiUrl, requestedActions }) => {
        const caseRoot = await mkdtemp(join("/tmp", "remotion-readback-case-"));
        const workspace = join(caseRoot, "workspace");
        await mkdir(join(workspace, ".clash"), { recursive: true });
        await writeFile(
          join(workspace, ".clash", "project.toml"),
          `schema_version = 1\nproject_id = "${projectId}"\n`,
          "utf8",
        );
        await mkdir(join(workspace, "components"), { recursive: true });
        await writeFile(
          join(workspace, "components", "character.tsx"),
          componentSource,
          "utf8",
        );
        await writeFile(
          join(workspace, "timeline.yaml"),
          `${JSON.stringify(timeline.state, null, 2)}\n`,
          "utf8",
        );
        await writeFile(join(workspace, "render.mp4"), "video", "utf8");
        await writeJson(join(workspace, "submission.json"), {
          schemaVersion: 1,
          taskId: benchmark.id,
          artifacts: [
            {
              id: "mg-character",
              kind: "remotion-component",
              path: "components/character.tsx",
            },
            { id: "timeline", kind: "timeline", path: "timeline.yaml" },
            { id: "mg-video", kind: "video", path: "render.mp4" },
          ],
        });

        const report = await captureRemotionProductReadback({
          benchmark,
          workspace,
          caseRoot,
          ready: {
            projectId,
            daemonPid: process.pid,
            mcpUrl: "http://127.0.0.1/mcp",
            socketPath,
            apiUrl,
          },
        });

        expect(report).toMatchObject({
          status: "pass",
          projectId,
          matchedArtifactIds: ["mg-character", "timeline", "mg-video"],
          sourceNodes: [{ id: sourceNode.id, type: "remotion-component" }],
          matches: [
            {
              timelineId: timeline.id,
              sourceNodeId: sourceNode.id,
              componentArtifactId: "mg-character",
              timelineArtifactId: "timeline",
              videoArtifactId: "mg-video",
              renderNodeId: renderNode.id,
              renderAssetId: "render-asset-fixed",
            },
          ],
        });
        expect(report.timelines[0]?.hostReceipt).toMatch(
          /:receipt:trusted-host$/u,
        );
        expect(
          requestedActions.filter((action) => action === "list_timeline_renders"),
        ).toEqual(["list_timeline_renders"]);
        expect(requestedActions).not.toContain("list");
        expect(
          JSON.parse(
            await readFile(join(caseRoot, "remotion-readback.json"), "utf8"),
          ),
        ).toEqual(report);
        await rm(caseRoot, { recursive: true, force: true });
      },
    );
  });

  it("matches a plain Timeline revision to its completed product render", async () => {
    await withProductDaemon(
      [timeline],
      async ({ socketPath, projectId, apiUrl, requestedActions }) => {
        const caseRoot = await mkdtemp(join("/tmp", "timeline-readback-case-"));
        const workspace = join(caseRoot, "workspace");
        await mkdir(join(workspace, ".clash"), { recursive: true });
        await writeFile(
          join(workspace, ".clash", "project.toml"),
          `schema_version = 1\nproject_id = "${projectId}"\n`,
          "utf8",
        );
        await writeFile(
          join(workspace, "timeline.yaml"),
          `${JSON.stringify(timeline.state, null, 2)}\n`,
          "utf8",
        );
        await writeFile(join(workspace, "render.mp4"), "video", "utf8");
        await writeJson(join(workspace, "submission.json"), {
          schemaVersion: 1,
          taskId: timelineBenchmark.id,
          artifacts: [
            { id: "timeline", kind: "timeline", path: "timeline.yaml" },
            { id: "final-video", kind: "video", path: "render.mp4" },
          ],
        });

        const report = await captureTimelineProductReadback({
          benchmark: timelineBenchmark,
          workspace,
          caseRoot,
          ready: {
            projectId,
            daemonPid: process.pid,
            mcpUrl: "http://127.0.0.1/mcp",
            socketPath,
            apiUrl,
          },
        });

        expect(report).toMatchObject({
          status: "pass",
          projectId,
          matchedArtifactIds: ["timeline", "final-video"],
          matches: [
            {
              timelineId: timeline.id,
              timelineArtifactId: "timeline",
              videoArtifactId: "final-video",
              renderNodeId: renderNode.id,
              renderAssetId: "render-asset-fixed",
            },
          ],
        });
        expect(
          requestedActions.filter((action) => action === "list_timeline_renders"),
        ).toEqual(["list_timeline_renders"]);
        expect(requestedActions).not.toContain("list");
        expect(
          JSON.parse(
            await readFile(join(caseRoot, "timeline-readback.json"), "utf8"),
          ),
        ).toEqual(report);
        await rm(caseRoot, { recursive: true, force: true });
      },
    );
  });

  it("rejects files that were never persisted through the live product graph", async () => {
    await withProductDaemon([], async ({ socketPath, projectId, apiUrl }) => {
      const caseRoot = await mkdtemp(
        join("/tmp", "remotion-readback-missing-"),
      );
      const workspace = join(caseRoot, "workspace");
      await mkdir(join(workspace, ".clash"), { recursive: true });
      await writeFile(
        join(workspace, ".clash", "project.toml"),
        `schema_version = 1\nproject_id = "${projectId}"\n`,
        "utf8",
      );
      await writeFile(
        join(workspace, "component.tsx"),
        componentSource,
        "utf8",
      );
      await writeFile(
        join(workspace, "timeline.yaml"),
        `${JSON.stringify(timeline.state)}\n`,
        "utf8",
      );
      await writeFile(join(workspace, "render.mp4"), "video", "utf8");
      await writeJson(join(workspace, "submission.json"), {
        schemaVersion: 1,
        taskId: benchmark.id,
        artifacts: [
          {
            id: "mg-character",
            kind: "remotion-component",
            path: "component.tsx",
          },
          { id: "timeline", kind: "timeline", path: "timeline.yaml" },
          { id: "mg-video", kind: "video", path: "render.mp4" },
        ],
      });

      const report = await captureRemotionProductReadback({
        benchmark,
        workspace,
        caseRoot,
        ready: {
          projectId,
          daemonPid: process.pid,
          mcpUrl: "http://127.0.0.1/mcp",
          socketPath,
          apiUrl,
        },
      });

      expect(report.status).toBe("fail");
      expect(report.matchedArtifactIds).toEqual([]);
      expect(report.detail).toMatch(/do not match live product state/i);
      await rm(caseRoot, { recursive: true, force: true });
    });
  });

  it("reports the exact daemon error from Timeline render readback", async () => {
    await withProductDaemon(
      [timeline],
      async ({ socketPath, projectId, apiUrl }) => {
        const caseRoot = await mkdtemp(join("/tmp", "timeline-readback-error-"));
        const workspace = join(caseRoot, "workspace");
        await mkdir(join(workspace, ".clash"), { recursive: true });
        await writeFile(
          join(workspace, ".clash", "project.toml"),
          `schema_version = 1\nproject_id = "${projectId}"\n`,
          "utf8",
        );
        await writeFile(
          join(workspace, "timeline.yaml"),
          `${JSON.stringify(timeline.state, null, 2)}\n`,
          "utf8",
        );
        await writeFile(join(workspace, "render.mp4"), "video", "utf8");
        await writeJson(join(workspace, "submission.json"), {
          schemaVersion: 1,
          taskId: timelineBenchmark.id,
          artifacts: [
            { id: "timeline", kind: "timeline", path: "timeline.yaml" },
            { id: "final-video", kind: "video", path: "render.mp4" },
          ],
        });

        const report = await captureTimelineProductReadback({
          benchmark: timelineBenchmark,
          workspace,
          caseRoot,
          ready: {
            projectId,
            daemonPid: process.pid,
            mcpUrl: "http://127.0.0.1/mcp",
            socketPath,
            apiUrl,
          },
        });

        expect(report.status).toBe("fail");
        expect(report.detail).toBe("render index unavailable at revision 42");
        await rm(caseRoot, { recursive: true, force: true });
      },
      { renderReadbackError: "render index unavailable at revision 42" },
    );
  });
});
