import { describe, expect, it } from "vitest";
import {
  resolveDesktopHostStartupTimeoutMs,
  resolveDesktopRuntime,
  resolveDesktopSourceHostNodeArgs,
  shouldWatchDesktopSourceHost,
} from "./runtime";

describe("desktop runtime", () => {
  it("accepts an explicit positive host startup timeout without changing the default", () => {
    expect(resolveDesktopHostStartupTimeoutMs("60000")).toBe(60_000);
    expect(resolveDesktopHostStartupTimeoutMs(undefined)).toBeUndefined();
    expect(resolveDesktopHostStartupTimeoutMs("0")).toBeUndefined();
    expect(resolveDesktopHostStartupTimeoutMs("not-a-timeout")).toBeUndefined();
  });

  it("allows isolated E2E runs to disable source-host restarts", () => {
    expect(shouldWatchDesktopSourceHost(undefined)).toBe(false);
    expect(shouldWatchDesktopSourceHost("1")).toBe(true);
    expect(shouldWatchDesktopSourceHost("0")).toBe(false);
  });

  it("runs the source host in one process unless file watching is explicitly enabled", () => {
    expect(
      resolveDesktopSourceHostNodeArgs({
        watch: false,
        tsxLoaderPath: "/workspace/tsx/loader.mjs",
        tsxCliPath: "/workspace/tsx/cli.mjs",
        tsconfigPath: "/workspace/tsconfig.json",
      }),
    ).toEqual(["--import", "/workspace/tsx/loader.mjs"]);
    expect(
      resolveDesktopSourceHostNodeArgs({
        watch: true,
        tsxLoaderPath: "/workspace/tsx/loader.mjs",
        tsxCliPath: "/workspace/tsx/cli.mjs",
        tsconfigPath: "/workspace/tsconfig.json",
      }),
    ).toEqual([
      "/workspace/tsx/cli.mjs",
      "watch",
      "--tsconfig",
      "/workspace/tsconfig.json",
    ]);
  });

  it("derives local API and WebSocket endpoints from the API port", () => {
    expect(resolveDesktopRuntime({ apiPort: 49321 })).toEqual({
      mode: "desktop",
      apiBaseUrl: "http://127.0.0.1:49321",
      wsBaseUrl: "ws://127.0.0.1:49321",
      webUrl: "clash://app/",
      capabilities: {
        assets: { storage: "local", signing: "unsigned", upload: "local" },
        workflows: { runner: "local-node", mediaPostprocess: "disabled" },
        loro: { persistence: "local", sync: "local-websocket" },
        auth: { mode: "local-user" },
      },
    });
  });

  it("allows environment overrides for desktop development", () => {
    expect(
      resolveDesktopRuntime({
        apiPort: 49321,
        apiBaseUrl: "http://localhost:8788",
        wsBaseUrl: "ws://localhost:8788",
        webUrl: "http://localhost:3001",
      }),
    ).toEqual({
      mode: "desktop",
      apiBaseUrl: "http://localhost:8788",
      wsBaseUrl: "ws://localhost:8788",
      webUrl: "http://localhost:3001",
      capabilities: {
        assets: { storage: "local", signing: "unsigned", upload: "local" },
        workflows: { runner: "local-node", mediaPostprocess: "disabled" },
        loro: { persistence: "local", sync: "local-websocket" },
        auth: { mode: "local-user" },
      },
    });
  });
});
