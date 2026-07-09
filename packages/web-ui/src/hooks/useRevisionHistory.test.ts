// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useRevisionHistory } from "./useRevisionHistory";

describe("useRevisionHistory", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.__CLASH_RUNTIME_CONFIG__ = undefined;
  });

  it("loads text revisions from the host-owned revision index", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("/api/v1/projects/project-1/text-revisions?nodeId=text-1&limit=5");
      expect(init?.credentials).toBe("same-origin");
      return new Response(JSON.stringify({
        revisions: [
          {
            revisionId: "txrev-2",
            projectId: "project-1",
            nodeId: "text-1",
            textId: "text-1",
            textHash: "sha256:new",
            parentRevisionId: "txrev-1",
            sourceFilePath: "texts/text-1.md",
            actor: "agent",
            createdAt: "2026-07-09T01:00:00.000Z",
            content: {
              kind: "text-revision-content",
              stored: true,
              url: "/api/v1/projects/project-1/text-revisions/txrev-2/content",
              immutable: true,
            },
          },
        ],
      }), { headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() =>
      useRevisionHistory({ projectId: "project-1", nodeId: "text-1", kind: "text", limit: 5 }),
    );

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.latest?.revisionId).toBe("txrev-2"));
    expect(result.current.count).toBe(1);
    expect(result.current.revisions[0]?.content?.kind).toBe("text-revision-content");
    expect(result.current.error).toBeNull();
  });

  it("loads timeline revisions from the host-owned revision index", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("/api/v1/projects/project-1/timeline-revisions?nodeId=editor-1&limit=3");
      return new Response(JSON.stringify({
        revisions: [
          {
            revisionId: "tlrev-1",
            projectId: "project-1",
            nodeId: "editor-1",
            timelineId: "editor-1",
            timelineHash: "timeline-hash",
            createdAt: "2026-07-09T01:10:00.000Z",
          },
        ],
      }), { headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() =>
      useRevisionHistory({ projectId: "project-1", nodeId: "editor-1", kind: "timeline", limit: 3 }),
    );

    await waitFor(() => expect(result.current.latest?.revisionId).toBe("tlrev-1"));
    expect(result.current.count).toBe(1);
    expect(result.current.loading).toBe(false);
  });

  it("does not fetch until project and node identity are known", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() =>
      useRevisionHistory({ projectId: null, nodeId: "text-1", kind: "text" }),
    );

    expect(result.current.loading).toBe(false);
    expect(result.current.revisions).toEqual([]);
    expect(result.current.latest).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
