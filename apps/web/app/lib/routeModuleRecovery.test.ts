import { describe, expect, it, vi } from "vitest";

import {
  clearRouteModuleRecovery,
  recoverFailedRouteModule,
} from "./routeModuleRecovery";

function createMemoryStorage(): Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

describe("route module recovery", () => {
  it("waits for a failed same-origin route module and reloads only once", async () => {
    const storage = createMemoryStorage();
    const reload = vi.fn();
    let attempts = 0;
    const fetchModule = vi.fn(async () => {
      attempts += 1;
      if (attempts < 3) throw new TypeError("renderer restarting");
      return new Response("export default {}", {
        headers: { "content-type": "text/javascript" },
      });
    });
    const error = new TypeError(
      "Failed to fetch dynamically imported module: http://127.0.0.1:3001/app/routes/home.tsx",
    );

    await expect(
      recoverFailedRouteModule({
        error,
        origin: "http://127.0.0.1:3001",
        fetchModule,
        reload,
        storage,
        sleep: async () => undefined,
        maxAttempts: 4,
      }),
    ).resolves.toBe("reloaded");
    expect(fetchModule).toHaveBeenCalledTimes(3);
    expect(reload).toHaveBeenCalledTimes(1);

    await expect(
      recoverFailedRouteModule({
        error,
        origin: "http://127.0.0.1:3001",
        fetchModule,
        reload,
        storage,
        sleep: async () => undefined,
      }),
    ).resolves.toBe("already-retried");
    expect(fetchModule).toHaveBeenCalledTimes(3);
    expect(reload).toHaveBeenCalledTimes(1);

    clearRouteModuleRecovery(storage);
    await expect(
      recoverFailedRouteModule({
        error,
        origin: "http://127.0.0.1:3001",
        fetchModule,
        reload,
        storage,
        sleep: async () => undefined,
        maxAttempts: 1,
      }),
    ).resolves.toBe("reloaded");
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("ignores ordinary route errors and cross-origin module URLs", async () => {
    const fetchModule = vi.fn();
    const common = {
      origin: "http://127.0.0.1:3001",
      fetchModule,
      reload: vi.fn(),
      storage: createMemoryStorage(),
      sleep: async () => undefined,
    };

    await expect(
      recoverFailedRouteModule({
        ...common,
        error: new Error("loader failed"),
      }),
    ).resolves.toBe("ignored");
    await expect(
      recoverFailedRouteModule({
        ...common,
        error: new TypeError(
          "Failed to fetch dynamically imported module: https://example.com/route.tsx",
        ),
      }),
    ).resolves.toBe("ignored");
    expect(fetchModule).not.toHaveBeenCalled();
  });

  it("reloads a stale same-origin optimized dependency with an invalid export shape", async () => {
    const storage = createMemoryStorage();
    const reload = vi.fn();
    const fetchModule = vi.fn(
      async () =>
        new Response("export const version = 'fixed'", {
          headers: { "content-type": "text/javascript" },
        }),
    );
    const error = new SyntaxError(
      "The requested module '/node_modules/.vite/deps/typescript.js?v=old' does not provide an export named 'default'",
    );

    await expect(
      recoverFailedRouteModule({
        error,
        origin: "http://127.0.0.1:3001",
        fetchModule,
        reload,
        storage,
        sleep: async () => undefined,
        maxAttempts: 1,
      }),
    ).resolves.toBe("reloaded");
    expect(fetchModule).toHaveBeenCalledWith(
      "http://127.0.0.1:3001/node_modules/.vite/deps/typescript.js?v=old",
      { cache: "no-store" },
    );
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
