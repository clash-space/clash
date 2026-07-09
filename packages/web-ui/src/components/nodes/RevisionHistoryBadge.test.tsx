// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { RevisionHistoryBadge } from "./RevisionHistoryBadge";

describe("RevisionHistoryBadge", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows recent text revisions and explicit CLI recovery and restore commands", () => {
    render(
      <RevisionHistoryBadge
        kind="text"
        nodeId="text-1"
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
    expect(screen.getByText("clash text restore --node text-1 --revision txrev-2 --mode replace")).toBeTruthy();
  });

  it("uses timeline recovery and restore commands for timeline revisions", () => {
    render(
      <RevisionHistoryBadge
        kind="timeline"
        nodeId="editor-1"
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
    expect(screen.getByText("clash timeline restore --node editor-1 --revision tlrev-1 --mode replace")).toBeTruthy();
  });

  it("quotes unsafe shell arguments in CLI restore commands", () => {
    render(
      <RevisionHistoryBadge
        kind="text"
        nodeId={"script node 'A'"}
        history={{
          count: 1,
          latest: { revisionId: "txrev-weird id" },
          revisions: [{ revisionId: "txrev-weird id" }],
          loading: false,
          error: null,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Text revision history/ }));

    expect(screen.getByText("clash text content --revision 'txrev-weird id' --out 'revisions/txrev-weird id.md'")).toBeTruthy();
    expect(screen.getByText("clash text restore --node 'script node '\\''A'\\''' --revision 'txrev-weird id' --mode replace")).toBeTruthy();
  });

  it("stays hidden when no revisions are indexed", () => {
    const { container } = render(
      <RevisionHistoryBadge
        kind="text"
        nodeId="text-1"
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
