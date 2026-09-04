import { afterEach, describe, expect, it, vi } from "vitest";

import { loader } from "./appLayoutLoader";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  globalThis.__CLASH_RUNTIME_CONFIG__ = undefined;
});

describe("app layout authentication", () => {
  it.each(["local", "desktop"] as const)(
    "treats a %s local-user runtime as authenticated without a login session",
    async (mode) => {
      globalThis.__CLASH_RUNTIME_CONFIG__ = {
        mode,
        apiBaseUrl: "http://127.0.0.1:8789",
      };
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new Error("Local chrome must not depend on Better Auth");
        }),
      );

      await expect(loader({} as never)).resolves.toEqual({
        isAuthenticated: true,
      });
    },
  );
});
