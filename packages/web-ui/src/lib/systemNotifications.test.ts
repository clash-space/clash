import { describe, expect, it } from "vitest";

import {
  createLongActionNotificationTracker,
  notificationForAgentEvent,
  sendSystemNotification,
  type SystemNotificationRequest,
} from "./systemNotifications";

describe("sendSystemNotification", () => {
  it("delivers a notification through the desktop bridge", async () => {
    const delivered: SystemNotificationRequest[] = [];

    await expect(
      sendSystemNotification(
        { title: "Agent finished", body: "Storyboard draft is ready." },
        {
          notify: async (request) => {
            delivered.push(request);
            return { shown: true };
          },
        },
      ),
    ).resolves.toBe(true);

    expect(delivered).toEqual([
      { title: "Agent finished", body: "Storyboard draft is ready." },
    ]);
  });
});

describe("notificationForAgentEvent", () => {
  it("describes permission requests with the pending tool name", () => {
    expect(
      notificationForAgentEvent({
        type: "session.permission_request",
        tool_call: { title: "Run deployment command" },
      }),
    ).toEqual({
      title: "Agent needs approval",
      body: "Run deployment command",
    });
  });

  it("describes terminal agent turns", () => {
    expect(notificationForAgentEvent({ type: "session.complete" })).toEqual({
      title: "Agent finished",
      body: "The current task is ready to review.",
    });
    expect(
      notificationForAgentEvent({
        type: "session.error",
        message: "Provider authentication expired",
      }),
    ).toEqual({
      title: "Agent stopped",
      body: "Provider authentication expired",
    });
  });
});

describe("createLongActionNotificationTracker", () => {
  it("notifies once when an observed action finishes after the configured threshold", () => {
    const tracker = createLongActionNotificationTracker({ thresholdMs: 1_000 });

    expect(
      tracker.observe(
        [
          {
            id: "image-1",
            type: "image",
            data: { label: "Launch key art", status: "generating" },
          },
        ],
        5_000,
      ),
    ).toEqual([]);

    expect(
      tracker.observe(
        [
          {
            id: "image-1",
            type: "image",
            data: { label: "Launch key art", status: "completed" },
          },
        ],
        6_001,
      ),
    ).toEqual([
      {
        title: "Action completed",
        body: "Launch key art is ready.",
      },
    ]);

    expect(
      tracker.observe(
        [
          {
            id: "image-1",
            type: "image",
            data: { label: "Launch key art", status: "completed" },
          },
        ],
        7_000,
      ),
    ).toEqual([]);
  });

  it("does not notify for old results or actions that finish below the threshold", () => {
    const tracker = createLongActionNotificationTracker({ thresholdMs: 1_000 });

    expect(
      tracker.observe(
        [
          {
            id: "old",
            type: "video",
            data: { label: "Old render", status: "completed" },
          },
        ],
        1_000,
      ),
    ).toEqual([]);
    expect(
      tracker.observe(
        [
          {
            id: "quick",
            type: "audio",
            data: { label: "Quick voice", status: "pending" },
          },
        ],
        2_000,
      ),
    ).toEqual([]);
    expect(
      tracker.observe(
        [
          {
            id: "quick",
            type: "audio",
            data: { label: "Quick voice", status: "completed" },
          },
        ],
        2_999,
      ),
    ).toEqual([]);
  });

  it("surfaces a long-running action failure", () => {
    const tracker = createLongActionNotificationTracker({ thresholdMs: 1_000 });

    tracker.observe(
      [
        {
          id: "render-1",
          type: "video",
          data: { label: "Final render", status: "pending" },
        },
      ],
      10_000,
    );

    expect(
      tracker.observe(
        [
          {
            id: "render-1",
            type: "video",
            data: { label: "Final render", status: "failed" },
          },
        ],
        11_500,
      ),
    ).toEqual([
      {
        title: "Action failed",
        body: "Final render needs attention.",
      },
    ]);
  });

  it("uses the host task start time when the action was already running before observation", () => {
    const tracker = createLongActionNotificationTracker({ thresholdMs: 5_000 });

    tracker.observe(
      [
        {
          id: "video-2",
          type: "video",
          data: {
            label: "Remote render",
            status: "generating",
            pendingTaskAt: 1_000,
          },
        },
      ],
      10_000,
    );

    expect(
      tracker.observe(
        [
          {
            id: "video-2",
            type: "video",
            data: { label: "Remote render", status: "completed" },
          },
        ],
        10_001,
      ),
    ).toEqual([
      {
        title: "Action completed",
        body: "Remote render is ready.",
      },
    ]);
  });
});
