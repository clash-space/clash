import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LoroDoc } from "loro-crdt";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  ExternalAigcService,
  MockMediaGenerationInput,
  MockMediaGenerationResult,
} from "./local-aigc.js";
import { createLocalWorkflowProcessor } from "./local-processor.js";

const THIRTY_MINUTES_MS = 30 * 60 * 1000;

function imageNode(data: Record<string, unknown> = {}) {
  return {
    id: "deadline-image",
    type: "image",
    position: { x: 0, y: 0 },
    data: {
      status: "pending",
      actionType: "image-gen",
      prompt: "deadline probe",
      modelId: "deadline-image-model",
      ...data,
    },
  };
}

function nodeData(doc: LoroDoc): Record<string, unknown> {
  const node = doc.getMap("nodes").get("deadline-image") as {
    data: Record<string, unknown>;
  };
  return node.data;
}

function aigcWithImage(
  generateImage: (
    input: MockMediaGenerationInput,
  ) => Promise<MockMediaGenerationResult>,
): ExternalAigcService {
  const completed = async (): Promise<MockMediaGenerationResult> => ({
    bytes: new Uint8Array([1]),
    contentType: "application/octet-stream",
  });
  return {
    generateImage,
    generateVideo: completed,
    generateAudio: completed,
    generateText: async () => ({ text: "unused" }),
  };
}

describe("provider generation total deadline", () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    vi.useRealTimers();
    await Promise.all(
      temporaryRoots
        .splice(0)
        .map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  async function processor(
    generateImage: (
      input: MockMediaGenerationInput,
    ) => Promise<MockMediaGenerationResult>,
    options: { providerPollDelayCapMs?: number } = {},
  ) {
    const dataDir = await mkdtemp(join(tmpdir(), "clash-provider-deadline-"));
    temporaryRoots.push(dataDir);
    return createLocalWorkflowProcessor({
      dataDir,
      aigc: aigcWithImage(generateImage),
      modelCards: async () => [],
      ...options,
    });
  }

  it("can compress poll scheduling in an isolated replay without changing the total deadline", async () => {
    vi.useFakeTimers();
    const startedAt = Date.parse("2026-08-12T00:00:00.000Z");
    vi.setSystemTime(startedAt);
    const workflow = await processor(async () => ({
      status: "accepted",
      pollState: { taskId: "recorded-task" },
      retryAfterMs: 5_000,
    }), { providerPollDelayCapMs: 25 });
    const doc = new LoroDoc();
    doc.getMap("nodes").set("deadline-image", imageNode());

    await workflow.process({ doc, projectId: "replay-project" });

    expect(nodeData(doc)).toMatchObject({
      providerPollAt: startedAt + 25,
      providerDeadlineAt: startedAt + THIRTY_MINUTES_MS,
    });
  });

  it("keeps one absolute 30 minute deadline across submit, wait, and accepted polls", async () => {
    vi.useFakeTimers();
    const startedAt = Date.parse("2026-08-12T00:00:00.000Z");
    vi.setSystemTime(startedAt);
    const calls: MockMediaGenerationInput[] = [];
    const workflow = await processor(async (input) => {
      calls.push(input);
      return {
        status: "accepted",
        pollState: { taskId: "paid-task-1" },
        retryAfterMs: 1_000,
      };
    });
    const doc = new LoroDoc();
    doc.getMap("nodes").set("deadline-image", imageNode());

    await workflow.process({ doc, projectId: "deadline-project" });
    expect(nodeData(doc)).toMatchObject({
      providerStartedAt: startedAt,
      providerDeadlineAt: startedAt + THIRTY_MINUTES_MS,
      providerAcceptedAt: startedAt,
    });

    vi.setSystemTime(startedAt + 29 * 60 * 1000);
    await workflow.process({ doc, projectId: "deadline-project" });
    expect(nodeData(doc)).toMatchObject({
      providerStartedAt: startedAt,
      providerDeadlineAt: startedAt + THIRTY_MINUTES_MS,
      providerAcceptedAt: startedAt,
    });

    vi.setSystemTime(startedAt + THIRTY_MINUTES_MS);
    await workflow.process({ doc, projectId: "deadline-project" });
    expect(calls).toHaveLength(3);
    expect(calls[0]).not.toHaveProperty("pollState");
    expect(calls[1]).toMatchObject({ pollState: { taskId: "paid-task-1" } });
    expect(calls[2]).toMatchObject({ pollState: { taskId: "paid-task-1" } });
    expect(nodeData(doc)).toMatchObject({
      status: "failed",
      providerFinalPolledAt: startedAt + THIRTY_MINUTES_MS,
      providerDeadlineAt: startedAt + THIRTY_MINUTES_MS,
      error: expect.stringMatching(/30 minutes/),
    });
  });

  it("reconciles an expired restarted task once and never resubmits or polls it again", async () => {
    const now = Date.now();
    const calls: MockMediaGenerationInput[] = [];
    const generateImage = async (
      input: MockMediaGenerationInput,
    ): Promise<MockMediaGenerationResult> => {
      calls.push(input);
      return { status: "accepted", pollState: { taskId: "paid-task-restart" } };
    };
    const doc = new LoroDoc();
    doc.getMap("nodes").set(
      "deadline-image",
      imageNode({
        status: "generating",
        providerPollState: { taskId: "paid-task-restart" },
        providerStartedAt: now - THIRTY_MINUTES_MS - 1,
        providerDeadlineAt: now - 1,
        providerPollAt: now + 60_000,
      }),
    );

    await (
      await processor(generateImage)
    ).process({ doc, projectId: "deadline-project" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      pollState: { taskId: "paid-task-restart" },
    });
    expect(nodeData(doc)).toMatchObject({
      status: "failed",
      providerFinalPolledAt: expect.any(Number),
      error: expect.stringMatching(/30 minutes/),
    });
    expect(nodeData(doc).providerPollState).toBeUndefined();
    expect(nodeData(doc).providerPollAt).toBeUndefined();

    await (
      await processor(generateImage)
    ).process({ doc, projectId: "deadline-project" });
    expect(calls).toHaveLength(1);
  });

  it("does not poll an accepted task before the provider interval has elapsed", async () => {
    vi.useFakeTimers();
    const now = Date.parse("2026-08-12T00:30:00.000Z");
    vi.setSystemTime(now);
    const generateImage = vi.fn(
      async (): Promise<MockMediaGenerationResult> => ({
        status: "accepted",
        pollState: { taskId: "not-due-yet" },
      }),
    );
    const doc = new LoroDoc();
    doc.getMap("nodes").set(
      "deadline-image",
      imageNode({
        status: "generating",
        providerPollState: { taskId: "not-due-yet" },
        providerStartedAt: now - 1_000,
        providerDeadlineAt: now + THIRTY_MINUTES_MS,
        providerPollAt: now + 60_000,
      }),
    );

    await (
      await processor(generateImage)
    ).process({ doc, projectId: "deadline-project" });

    expect(generateImage).not.toHaveBeenCalled();
    expect(nodeData(doc)).toMatchObject({
      status: "generating",
      providerPollState: { taskId: "not-due-yet" },
      providerPollAt: now + 60_000,
    });
  });

  it("accepts a completion returned by the final reconciliation poll", async () => {
    const now = Date.now();
    const workflow = await processor(async () => ({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "image/png",
    }));
    const doc = new LoroDoc();
    doc.getMap("nodes").set(
      "deadline-image",
      imageNode({
        status: "generating",
        providerPollState: { taskId: "completed-at-deadline" },
        providerStartedAt: now - THIRTY_MINUTES_MS,
        providerDeadlineAt: now,
        providerPollAt: now + 60_000,
      }),
    );

    await workflow.process({ doc, projectId: "deadline-project" });
    expect(nodeData(doc)).toMatchObject({
      status: "completed",
      providerFinalPolledAt: expect.any(Number),
      assetId: expect.any(String),
    });
    expect(nodeData(doc).providerPollState).toBeUndefined();
    expect(nodeData(doc).providerPollAt).toBeUndefined();
  });

  it("keeps the real provider failure returned by the final reconciliation poll", async () => {
    const now = Date.now();
    const workflow = await processor(async () => {
      throw new Error("upstream task failed its safety check");
    });
    const doc = new LoroDoc();
    doc.getMap("nodes").set(
      "deadline-image",
      imageNode({
        status: "generating",
        providerPollState: { taskId: "failed-at-deadline" },
        providerStartedAt: now - THIRTY_MINUTES_MS,
        providerDeadlineAt: now,
      }),
    );

    await workflow.process({ doc, projectId: "deadline-project" });
    expect(nodeData(doc)).toMatchObject({
      status: "failed",
      providerFinalPolledAt: expect.any(Number),
      error: "upstream task failed its safety check",
    });
    expect(nodeData(doc).providerPollState).toBeUndefined();
    expect(nodeData(doc).providerPollAt).toBeUndefined();
  });

  it("does not repeat a final poll already persisted before restart", async () => {
    const now = Date.now();
    const generateImage = vi.fn(
      async (): Promise<MockMediaGenerationResult> => ({
        status: "accepted",
        pollState: { taskId: "must-not-poll-again" },
      }),
    );
    const doc = new LoroDoc();
    doc.getMap("nodes").set(
      "deadline-image",
      imageNode({
        status: "generating",
        providerPollState: { taskId: "must-not-poll-again" },
        providerStartedAt: now - THIRTY_MINUTES_MS,
        providerDeadlineAt: now - 1,
        providerFinalPolledAt: now - 1,
      }),
    );

    await (
      await processor(generateImage)
    ).process({ doc, projectId: "deadline-project" });
    expect(generateImage).not.toHaveBeenCalled();
    expect(nodeData(doc)).toMatchObject({
      status: "failed",
      providerFinalPolledAt: now - 1,
      error: expect.stringMatching(/30 minutes/),
    });
  });

  it("applies the same 30 minute deadline to a synchronous provider invocation", async () => {
    vi.useFakeTimers();
    const startedAt = Date.parse("2026-08-12T01:00:00.000Z");
    vi.setSystemTime(startedAt);
    const calls: MockMediaGenerationInput[] = [];
    const workflow = await processor(async (input) => {
      calls.push(input);
      return await new Promise<MockMediaGenerationResult>(() => {});
    });
    const doc = new LoroDoc();
    doc.getMap("nodes").set("deadline-image", imageNode());

    const processing = workflow.process({ doc, projectId: "deadline-project" });
    await vi.advanceTimersByTimeAsync(THIRTY_MINUTES_MS);
    await processing;

    expect(calls).toHaveLength(1);
    expect(nodeData(doc)).toMatchObject({
      status: "failed",
      providerStartedAt: startedAt,
      providerDeadlineAt: startedAt + THIRTY_MINUTES_MS,
      error: expect.stringMatching(/30 minutes/),
    });
  });

  it("times out synchronous text once without retrying the same provider", async () => {
    vi.useFakeTimers();
    const startedAt = Date.parse("2026-08-12T02:00:00.000Z");
    vi.setSystemTime(startedAt);
    const generateText = vi.fn(
      async () => await new Promise<{ text: string }>(() => {}),
    );
    const dataDir = await mkdtemp(
      join(tmpdir(), "clash-provider-deadline-text-"),
    );
    temporaryRoots.push(dataDir);
    const workflow = createLocalWorkflowProcessor({
      dataDir,
      modelCards: async () => [],
      aigc: {
        ...aigcWithImage(async () => ({
          bytes: new Uint8Array([1]),
          contentType: "image/png",
        })),
        generateText,
      },
    });
    const doc = new LoroDoc();
    doc.getMap("nodes").set("deadline-text", {
      id: "deadline-text",
      type: "text",
      position: { x: 0, y: 0 },
      data: {
        status: "pending",
        actionType: "text-gen",
        prompt: "deadline text probe",
        modelId: "deadline-text-model",
      },
    });

    const processing = workflow.process({ doc, projectId: "deadline-project" });
    await vi.advanceTimersByTimeAsync(THIRTY_MINUTES_MS);
    await processing;

    const text = doc.getMap("nodes").get("deadline-text") as {
      data: Record<string, unknown>;
    };
    expect(generateText).toHaveBeenCalledTimes(1);
    expect(text.data).toMatchObject({
      status: "failed",
      providerStartedAt: startedAt,
      providerDeadlineAt: startedAt + THIRTY_MINUTES_MS,
      error: expect.stringMatching(/30 minutes/),
    });
  });
});
