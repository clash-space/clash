// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SessionArchiveLibrary } from "./SessionArchiveLibrary";

describe("SessionArchiveLibrary", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("loads the global archive and keeps permanent deletion behind confirmation", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.endsWith("/api/v1/sessions?archived=only") && !init?.method) {
          return new Response(
            JSON.stringify({
              sessions: [
                {
                  threadId: "archived-one",
                  title: "Archived draft",
                  type: "runtime",
                  projectId: "project-one",
                  agentId: "codex",
                  archivedAt: "2026-08-26T00:00:00.000Z",
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.endsWith("/api/v1/projects?archived=only") && !init?.method) {
          return new Response(
            JSON.stringify({
              projects: [
                {
                  id: "project-archived",
                  name: "Archived project",
                  deletedAt: "2026-08-25T00:00:00.000Z",
                  updatedAt: "2026-08-25T00:00:00.000Z",
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (
          url.endsWith("/api/v1/sessions/archived-one") &&
          init?.method === "PATCH"
        ) {
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        if (
          url.endsWith("/api/v1/sessions?threadId=archived-one") &&
          init?.method === "DELETE"
        ) {
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        return new Response(null, { status: 404 });
      });

    render(<SessionArchiveLibrary />);

    expect(
      await screen.findByRole("heading", { name: "Archive Library" }),
    ).toBeTruthy();
    expect(await screen.findByText("Archived draft")).toBeTruthy();
    expect(await screen.findByText("Archived project")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Restore Archived draft" }),
    );
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/v1\/sessions\/archived-one$/),
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ archived: false }),
        }),
      );
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText("Archived draft")).toBeNull();
  });

  it("requires a second explicit action before permanently deleting", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.endsWith("/api/v1/sessions?archived=only") && !init?.method) {
          return new Response(
            JSON.stringify({
              sessions: [
                {
                  threadId: "archived-one",
                  title: "Archived draft",
                  type: "runtime",
                  archivedAt: "2026-08-26T00:00:00.000Z",
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.endsWith("/api/v1/projects?archived=only") && !init?.method) {
          return new Response(JSON.stringify({ projects: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (
          url.includes("threadId=archived-one") &&
          init?.method === "DELETE"
        ) {
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        return new Response(null, { status: 404 });
      });

    render(<SessionArchiveLibrary />);
    await screen.findByText("Archived draft");

    fireEvent.click(
      screen.getByRole("button", { name: "Delete Archived draft permanently" }),
    );
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE"),
    ).toBe(false);

    fireEvent.click(
      screen.getByRole("button", { name: "Confirm permanent delete" }),
    );
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE"),
      ).toBe(true);
    });
  });

  it("restores archived projects", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.endsWith("/api/v1/sessions?archived=only") && !init?.method) {
          return new Response(JSON.stringify({ sessions: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.endsWith("/api/v1/projects?archived=only") && !init?.method) {
          return new Response(
            JSON.stringify({
              projects: [
                {
                  id: "project-archived",
                  name: "Archived project",
                  deletedAt: "2026-08-25T00:00:00.000Z",
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (
          url.endsWith("/api/v1/projects/project-archived/restore") &&
          init?.method === "POST"
        ) {
          return new Response(JSON.stringify({ restored: true }), {
            status: 200,
          });
        }
        if (
          url.endsWith("/api/v1/projects/project-archived/purge") &&
          init?.method === "DELETE"
        ) {
          return new Response(JSON.stringify({ purged: true }), {
            status: 200,
          });
        }
        return new Response(null, { status: 404 });
      });

    render(<SessionArchiveLibrary />);
    await screen.findByText("Archived project");

    fireEvent.click(
      screen.getByRole("button", { name: "Restore Archived project" }),
    );
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(
          /\/api\/v1\/projects\/project-archived\/restore$/,
        ),
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  it("requires confirmation before permanently deleting an archived project", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.endsWith("/api/v1/sessions?archived=only") && !init?.method) {
          return new Response(JSON.stringify({ sessions: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.endsWith("/api/v1/projects?archived=only") && !init?.method) {
          return new Response(
            JSON.stringify({
              projects: [
                {
                  id: "project-archived",
                  name: "Archived project",
                  deletedAt: "2026-08-25T00:00:00.000Z",
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (
          url.endsWith("/api/v1/projects/project-archived/purge") &&
          init?.method === "DELETE"
        ) {
          return new Response(JSON.stringify({ purged: true }), {
            status: 200,
          });
        }
        return new Response(null, { status: 404 });
      });

    render(<SessionArchiveLibrary />);
    await screen.findByText("Archived project");

    fireEvent.click(
      screen.getByRole("button", {
        name: "Delete Archived project permanently",
      }),
    );
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE"),
    ).toBe(false);

    fireEvent.click(
      screen.getByRole("button", { name: "Confirm permanent delete" }),
    );
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/v1\/projects\/project-archived\/purge$/),
        expect.objectContaining({
          method: "DELETE",
          body: JSON.stringify({ confirm: "purge" }),
        }),
      );
    });
  });
});
