// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useLongActionNotifications } from "./useLongActionNotifications";

describe("useLongActionNotifications", () => {
  it("delivers the tracker result when a long action reaches a terminal state", () => {
    const send = vi.fn();
    const pending = [
      {
        id: "video-1",
        type: "video",
        data: { label: "Campaign render", status: "generating" },
      },
    ];
    const { rerender } = renderHook(
      ({ nodes, now }) =>
        useLongActionNotifications(nodes, {
          thresholdMs: 1_000,
          now: () => now,
          send,
        }),
      { initialProps: { nodes: pending, now: 10_000 } },
    );

    rerender({
      nodes: [
        {
          id: "video-1",
          type: "video",
          data: { label: "Campaign render", status: "completed" },
        },
      ],
      now: 11_001,
    });

    expect(send).toHaveBeenCalledWith({
      title: "Action completed",
      body: "Campaign render is ready.",
    });
  });
});
