import { afterEach, describe, expect, it, vi } from "vitest";

import { setRuntimeConfigOverride } from "@clash/web-ui/lib/runtimeConfig";

import { loader } from "./projects";

afterEach(() => {
  setRuntimeConfigOverride(undefined);
  globalThis.__CLASH_RUNTIME_CONFIG__ = undefined;
  globalThis.__CLASH_DESKTOP__ = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("projects loader Host recovery", () => {
  it("refreshes a replaced Desktop Host before loading project cards", async () => {
    globalThis.__CLASH_RUNTIME_CONFIG__ = {
      mode: "desktop",
      apiBaseUrl: "http://127.0.0.1:49321",
    };
    const refreshRuntime = vi.fn().mockResolvedValue({
      mode: "desktop" as const,
      apiBaseUrl: "http://127.0.0.1:61631",
    });
    globalThis.__CLASH_DESKTOP__ = {
      isDesktop: true,
      newWindow: vi.fn(),
      refreshRuntime,
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(
        Response.json({ projects: [{ id: "project-after-restart" }] }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(loader({} as never)).resolves.toEqual({
      projects: [{ id: "project-after-restart" }],
    });
    expect(refreshRuntime).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:61631/api/v1/projects",
      { credentials: "include" },
    );
  });
});
