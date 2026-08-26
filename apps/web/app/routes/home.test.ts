import { afterEach, describe, expect, it, vi } from "vitest";

import { loader } from "./home";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("home loader marketplace feed", () => {
  it("maps only configured featured plugins into the authenticated homepage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const path = new URL(String(input), "http://clash.local").pathname;
        if (path === "/api/better-auth/get-session") {
          return Response.json({ user: { id: "user-1" } });
        }
        if (path === "/api/v1/projects") {
          return Response.json({ projects: [{ id: "project-1" }] });
        }
        if (path === "/api/marketplace/feed") {
          return Response.json({
            version: 1,
            featuredPlugins: [
              { id: "skill-1", type: "skill", name: "Skill One" },
            ],
          });
        }
        if (path === "/api/marketplace/registry") {
          throw new Error("Home must not read the full Marketplace registry");
        }
        if (path === "/api/settings/actions") {
          return Response.json([{ actionId: "action-1" }]);
        }
        if (path === "/api/settings/skills") {
          return Response.json([{ skillId: "skill-1" }]);
        }
        throw new Error(`Unexpected request: ${path}`);
      }),
    );

    await expect(loader({} as never)).resolves.toEqual({
      authed: true,
      projects: [{ id: "project-1" }],
      marketplaceFeed: {
        featuredPlugins: [
          { id: "skill-1", type: "skill", name: "Skill One" },
        ],
        installedActionIds: ["action-1"],
        installedSkillIds: ["skill-1"],
      },
    });
  });

  it("degrades feed failures without hiding authenticated projects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const path = new URL(String(input), "http://clash.local").pathname;
        if (path === "/api/better-auth/get-session") {
          return Response.json({ user: { id: "user-1" } });
        }
        if (path === "/api/v1/projects") {
          return Response.json({ projects: [{ id: "project-1" }] });
        }
        throw new TypeError("runtime offline");
      }),
    );

    await expect(loader({} as never)).resolves.toEqual({
      authed: true,
      projects: [{ id: "project-1" }],
      marketplaceFeed: {
        featuredPlugins: [],
        installedActionIds: [],
        installedSkillIds: [],
      },
    });
  });

  it("preserves authentication redirects from installed feed sources", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const path = new URL(String(input), "http://clash.local").pathname;
        if (path === "/api/better-auth/get-session") {
          return Response.json({ user: { id: "user-1" } });
        }
        if (path === "/api/settings/skills") {
          return new Response(null, { status: 401 });
        }
        if (path === "/api/v1/projects") {
          return Response.json({ projects: [] });
        }
        return Response.json(
          path === "/api/marketplace/feed"
            ? { version: 1, featuredPlugins: [] }
            : [],
        );
      }),
    );

    await expect(loader({} as never)).rejects.toMatchObject({ status: 302 });
  });
});
