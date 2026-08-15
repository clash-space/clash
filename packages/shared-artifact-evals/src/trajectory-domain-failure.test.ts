import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { writeNormalizedTrajectory, type TrajectoryAction } from "./trajectory";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function normalizePiEvents(events: unknown[]): Promise<{
  actions: TrajectoryAction[];
  errors: Array<{ message: string }>;
}> {
  const root = await mkdtemp(join(tmpdir(), "pi-domain-failure-"));
  roots.push(root);
  const logsRoot = join(root, "logs");
  const rawPath = join(logsRoot, "events.jsonl");
  const observedPath = join(logsRoot, "observed.jsonl");
  await mkdir(logsRoot, { recursive: true });
  await Promise.all([
    writeFile(
      rawPath,
      `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
      "utf8",
    ),
    writeFile(
      observedPath,
      `${events
        .map((_event, index) =>
          JSON.stringify({
            line: index + 1,
            observedAt: new Date(Date.UTC(2026, 7, 15) + index).toISOString(),
            monotonicMs: index,
            rawLineSha256: "0".repeat(64),
            parsed: true,
          }),
        )
        .join("\n")}\n`,
      "utf8",
    ),
  ]);

  const trajectoryPath = await writeNormalizedTrajectory({
    agent: { adapter: "pi" },
    logsRoot,
    rawPath,
    observedPath,
  });
  return JSON.parse(await readFile(trajectoryPath, "utf8")) as {
    actions: TrajectoryAction[];
    errors: Array<{ message: string }>;
  };
}

describe("trajectory MCP domain failures", () => {
  it("marks the r5 Pi structured result as failed even when transport isError is false", async () => {
    const failureMessage =
      "Generation failed. See the owning Host for private diagnostics.";
    const structuredContent = {
      submitted: true,
      timelineId: "timeline-mixed-v1",
      renderNodeId: "dd2457a3",
      completed: false,
      status: "failed",
      error: failureMessage,
    };
    const trajectory = await normalizePiEvents([
      {
        type: "tool_execution_start",
        toolCallId: "render-1",
        toolName: "clash_composition",
        args: {
          kind: "timeline",
          operation: "clash_timeline_render",
          arguments: { timelineId: "timeline-mixed-v1" },
        },
      },
      {
        type: "tool_execution_end",
        toolCallId: "render-1",
        toolName: "clash_composition",
        isError: false,
        result: {
          content: [
            { type: "text", text: JSON.stringify(structuredContent) },
            {
              type: "text",
              text: `Structured result:\n${JSON.stringify(structuredContent)}`,
            },
          ],
          details: { structuredContent },
        },
      },
    ]);

    expect(trajectory.actions.at(-1)).toMatchObject({
      operation: "clash/clash_timeline_render",
      status: "failed",
      error: failureMessage,
    });
    expect(trajectory.errors).toContainEqual({
      source: "pi",
      sourceLine: 2,
      message: failureMessage,
    });
  });

  it("recognizes structuredContent directly on an MCP result", async () => {
    const trajectory = await normalizePiEvents([
      {
        type: "tool_execution_start",
        toolCallId: "render-2",
        toolName: "clash_composition",
        args: {
          kind: "timeline",
          operation: "clash_timeline_render",
          arguments: { timelineId: "timeline-mixed-v1" },
        },
      },
      {
        type: "tool_execution_end",
        toolCallId: "render-2",
        toolName: "clash_composition",
        isError: false,
        result: {
          content: [],
          structuredContent: {
            status: "failed",
            error: "Renderer process exited before producing an Asset",
          },
        },
      },
    ]);

    expect(trajectory.actions.at(-1)).toMatchObject({
      operation: "clash/clash_timeline_render",
      status: "failed",
      error: "Renderer process exited before producing an Asset",
    });
  });

  it("recognizes a structured result preserved directly in an MCP content block", async () => {
    const trajectory = await normalizePiEvents([
      {
        type: "tool_execution_start",
        toolCallId: "save-1",
        toolName: "clash_composition",
        args: {
          kind: "timeline",
          operation: "clash_timeline_save",
          arguments: { timelineId: "timeline-mixed-v1" },
        },
      },
      {
        type: "tool_execution_end",
        toolCallId: "save-1",
        toolName: "clash_composition",
        isError: false,
        result: {
          content: [
            {
              type: "structured_result",
              structuredContent: {
                ok: false,
                error: {
                  code: "INVALID_TIMELINE_DSL",
                  message: "Timeline state is invalid",
                },
              },
            },
          ],
        },
      },
    ]);

    expect(trajectory.actions.at(-1)).toMatchObject({
      operation: "clash/clash_timeline_save",
      status: "failed",
      error: "Timeline state is invalid",
    });
  });
});
