// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { RevisionHistoryBadge } from "./RevisionHistoryBadge";

describe("RevisionHistoryBadge", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows recent text revisions and an explicit CLI content recovery command", () => {
    render(
      <RevisionHistoryBadge
        kind="text"
        history={{
          count: 2,
          latest: {
            revisionId: "txrev-2",
            actor: "agent",
            sourceFilePath: "texts/script.md",
            createdAt: "2026-07-09T01:00:00.000Z",
          },
          revisions: [
            {
              revisionId: "txrev-2",
              actor: "agent",
              sourceFilePath: "texts/script.md",
              createdAt: "2026-07-09T01:00:00.000Z",
            },
            {
              revisionId: "txrev-1",
              actor: "user",
              sourceFilePath: "texts/script.md",
              createdAt: "2026-07-09T00:30:00.000Z",
            },
          ],
          loading: false,
          error: null,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Text revision history/ }));

    expect(screen.getByRole("region", { name: "Text revision history panel" })).toBeTruthy();
    expect(screen.getByText("txrev-2")).toBeTruthy();
    expect(screen.getByText("agent")).toBeTruthy();
    expect(screen.getAllByText("texts/script.md")).toHaveLength(2);
    expect(screen.getByText("clash text content --revision txrev-2 --out revisions/txrev-2.md")).toBeTruthy();
  });

  it("uses the timeline content recovery command for timeline revisions", () => {
    render(
      <RevisionHistoryBadge
        kind="timeline"
        history={{
          count: 1,
          latest: { revisionId: "tlrev-1", timelineHash: "timeline-hash" },
          revisions: [{ revisionId: "tlrev-1", timelineHash: "timeline-hash" }],
          loading: false,
          error: null,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Timeline revision history/ }));

    expect(screen.getByText("timeline-hash")).toBeTruthy();
    expect(screen.getByText("clash timeline content --revision tlrev-1 --out revisions/tlrev-1.timeline.yaml")).toBeTruthy();
  });

  it("stays hidden when no revisions are indexed", () => {
    const { container } = render(
      <RevisionHistoryBadge
        kind="text"
        history={{
          count: 0,
          latest: null,
          revisions: [],
          loading: false,
          error: null,
        }}
      />,
    );

    expect(container.firstChild).toBeNull();
  });
});
