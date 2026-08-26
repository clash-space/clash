import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createProjectRecord,
  listArchivedProjects,
  listProjects,
  purgeProject,
  restoreProject,
} from "./clientActions";

describe("project client actions", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a raw project record without navigating or serializing prompt references into its name", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "project-1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(createProjectRecord("Quiet forest film")).resolves.toEqual({
      id: "project-1",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/v1\/projects$/);
    expect(JSON.parse(String(init.body))).toEqual({
      name: "Quiet forest film",
    });
  });

  it("lists stable project summaries for reference pickers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        projects: [
          { id: "project-1", name: "Launch film", updatedAt: 123 },
          { id: "project-2", name: null },
          { id: 3, name: "invalid" },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(listProjects()).resolves.toEqual([
      { id: "project-1", name: "Launch film" },
      { id: "project-2", name: "Untitled" },
    ]);
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(
      /\/api\/v1\/projects$/,
    );
  });

  it("uses the project archive lifecycle for restore and permanent purge", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          projects: [
            {
              id: "project-1",
              name: "Archived film",
              deletedAt: "2026-08-26T00:00:00.000Z",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(Response.json({ restored: true }))
      .mockResolvedValueOnce(Response.json({ purged: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listArchivedProjects()).resolves.toEqual([
      {
        id: "project-1",
        name: "Archived film",
        deletedAt: "2026-08-26T00:00:00.000Z",
      },
    ]);
    await restoreProject("project-1");
    await purgeProject("project-1");

    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(
      /\/api\/v1\/projects\?archived=only$/,
    );
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "POST" });
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({
      method: "DELETE",
      body: JSON.stringify({ confirm: "purge" }),
    });
  });
});
