// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RevisionHistoryBadge } from "./RevisionHistoryBadge";

describe("RevisionHistoryBadge", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows recent text revisions and explicit CLI recovery and restore commands", () => {
    render(
      <RevisionHistoryBadge
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

  it("emits an explicit restore action without touching canvas state directly", () => {
    const onRestoreRevision = vi.fn();
    render(
      <RevisionHistoryBadge
        nodeId="text-1"
        onRestoreRevision={onRestoreRevision}
        history={{
          count: 1,
          latest: { revisionId: "txrev-2" },
          revisions: [{ revisionId: "txrev-2" }],
          loading: false,
          error: null,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Text revision history/ }));
    fireEvent.click(screen.getByRole("button", { name: "Restore text revision txrev-2" }));

    expect(onRestoreRevision).toHaveBeenCalledWith({
      kind: "text",
      nodeId: "text-1",
      revisionId: "txrev-2",
      mode: "replace",
      command: "clash text restore --node text-1 --revision txrev-2 --mode replace",
    });
  });

  it("dispatches a browser restore request when no callback is provided", () => {
    const listener = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    window.addEventListener("clash:revision-restore-request", listener);
    render(
      <RevisionHistoryBadge
        nodeId="text-1"
        history={{
          count: 1,
          latest: { revisionId: "txrev-1" },
          revisions: [{ revisionId: "txrev-1" }],
          loading: false,
          error: null,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Text revision history/ }));
    fireEvent.click(screen.getByRole("button", { name: "Copy restore command for text revision txrev-1" }));

    expect(writeText).toHaveBeenCalledWith("clash text restore --node text-1 --revision txrev-1 --mode replace");
    const event = listener.mock.calls[0]?.[0] as CustomEvent;
    expect(event.detail).toEqual({
      kind: "text",
      nodeId: "text-1",
      revisionId: "txrev-1",
      mode: "replace",
      command: "clash text restore --node text-1 --revision txrev-1 --mode replace",
    });
    window.removeEventListener("clash:revision-restore-request", listener);
  });

  it("quotes unsafe shell arguments in CLI restore commands", () => {
    render(
      <RevisionHistoryBadge
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
