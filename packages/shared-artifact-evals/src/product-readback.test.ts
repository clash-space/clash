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

async function withProductHost<T>(
  timelines: unknown[],
  run: (input: {
    projectId: string;
    apiUrl: string;
    requestedActions: string[];
  }) => Promise<T>,
  options: { renderReadbackError?: string } = {},
): Promise<T> {
  const projectId = "project-remotion-readback";
  const versions = Object.fromEntries(
    timelines.map((value) => {
      const parsed = value as Parameters<typeof projectTimelineReadToken>[0];
      const readToken = projectTimelineReadToken(parsed);
      return [parsed.id, `${readToken}:receipt:trusted-host`];
    }),
  );
  const requestedActions: string[] = [];
  let apiUrl = "";
  const httpServer = createHttpServer(async (request, response) => {
    if (
      request.method === "POST" &&
      request.url ===
        `/api/v1/projects/${encodeURIComponent(projectId)}/host-command`
    ) {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const command = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        action?: string;
        nodeId?: string;
        canvasId?: string;
        status?: string;
      };
      requestedActions.push(String(command.action ?? ""));
      let body: unknown = { error: "unsupported" };
      if (command.action === "ping") body = { pong: true };
      if (command.action === "list_timelines") body = { timelines, versions };
      if (command.action === "list_canvases")
        body = { canvases: [{ id: "main", name: "Main" }] };
      if (command.action === "get" && command.nodeId === sourceNode.id) {
        body = {
          node: sourceNode,
          version: "node-v1:source",
          readToken: "node-v1:source:receipt:trusted-host",
        };
      }
      if (command.action === "list_timeline_renders") {
        if (options.renderReadbackError) {
          body = { error: options.renderReadbackError };
        } else {
          const version = canvasNodeReadToken(renderNode);
          body = {
            canvasId: PROJECT_ASSET_RENDER_CANVAS_ID,
            status: command.status ?? "completed",
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
        command.action === "list" &&
        command.canvasId === PROJECT_ASSET_RENDER_CANVAS_ID
      ) {
        body = {
          error: `Canvas ${PROJECT_ASSET_RENDER_CANVAS_ID} is internal and unregistered`,
        };
      }
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(body));
      return;
    }
    if (
      request.url ===
      `/api/v1/projects/${projectId}/assets/${renderNode.data.assetId}`
    ) {
      response.setHeader("content-type", "application/json");
      response.setHeader("x-clash-read-receipt", "receipt-render-asset");
      response.end(
        JSON.stringify({
          id: renderNode.data.assetId,
          kind: "video",
          metadata: { contentType: "video/mp4" },
          status: "ready",
          url: `${apiUrl}/assets/render.mp4`,
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
    return await run({ projectId, apiUrl, requestedActions });
  } finally {
    await new Promise<void>((resolveClose) =>
      httpServer.close(() => resolveClose()),
    );
  }
}

describe("trusted Remotion product readback", () => {
  it("matches a product-exported Timeline envelope to its live state and render", async () => {
    await withProductHost(
      [timeline],
      async ({ projectId, apiUrl, requestedActions }) => {
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
          `${JSON.stringify({ id: timeline.id, name: timeline.name, ...timeline.state }, null, 2)}\n`,
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
          requestedActions.filter(
            (action) => action === "list_timeline_renders",
          ),
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
    await withProductHost(
      [timeline],
      async ({ projectId, apiUrl, requestedActions }) => {
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
          requestedActions.filter(
            (action) => action === "list_timeline_renders",
          ),
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
    await withProductHost([], async ({ projectId, apiUrl }) => {
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
          apiUrl,
        },
      });

      expect(report.status).toBe("fail");
      expect(report.matchedArtifactIds).toEqual([]);
      expect(report.detail).toMatch(/do not match live product state/i);
      await rm(caseRoot, { recursive: true, force: true });
    });
  });

  it("reports the exact Host error from Timeline render readback", async () => {
    await withProductHost(
      [timeline],
      async ({ projectId, apiUrl }) => {
        const caseRoot = await mkdtemp(
          join("/tmp", "timeline-readback-error-"),
        );
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
